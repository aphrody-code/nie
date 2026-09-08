//! Shared orchestration for the multi-pass rebuild and recovery workflows.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use nie_index::{Db, query::Coverage};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkflowStep {
    Pdata,
    Vtable,
    Disassembly,
    Propagation,
    Ghidra,
    Leaves,
    AnonymousVtables,
    StringReferences,
    FuncLua,
    Adjacency,
    CoverageSnapshot,
}

fn completed<T>(
    result: Result<T>,
    step: WorkflowStep,
    observer: &mut impl FnMut(WorkflowStep),
) -> Result<T> {
    let value = result?;
    observer(step);
    Ok(value)
}

fn pdata_identity(path: &str, sha256: &str) -> (String, String) {
    (format!("{path}#pdata"), format!("{sha256}-pdata"))
}

/// Inputs for a complete `.pdata`-based database rebuild.
#[derive(Debug, Clone, Copy)]
pub struct RebuildOptions {
    pub source_binary_id: i64,
    pub image_base: i64,
    pub rounds: usize,
    pub skip_indirect: bool,
}

/// Typed results of every rebuild pass, in execution order.
#[derive(Debug)]
pub struct RebuildReport {
    pub target_binary_id: i64,
    pub pdata: crate::pdata::RebuildStats,
    pub vtable: crate::vtable::VtableStats,
    pub disassembly: crate::disasm::DisasmStats,
    pub propagation: crate::loop_db::Stats,
    pub classified_confident: i64,
    pub named_total: i64,
}

/// Runs rebuild passes in their canonical order: pdata, vtable, disassembly, propagation.
pub fn rebuild(db: &mut Db, executable: &Path, options: RebuildOptions) -> Result<RebuildReport> {
    rebuild_with_observer(db, executable, options, &mut |_| {})
}

pub fn rebuild_with_observer(
    db: &mut Db,
    executable: &Path,
    options: RebuildOptions,
    observer: &mut impl FnMut(WorkflowStep),
) -> Result<RebuildReport> {
    let (path, sha256): (String, String) = db.conn().query_row(
        "SELECT path, sha256 FROM binary WHERE id=?1",
        [options.source_binary_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let (target_path, target_sha256) = pdata_identity(&path, &sha256);
    let target_binary_id = db.upsert_binary(
        &target_path,
        &target_sha256,
        "x86_64",
        64,
        options.image_base,
        0,
        None,
        None,
    )?;

    let pdata = completed(
        crate::pdata::rebuild_from_pdata(
            db,
            options.source_binary_id,
            target_binary_id,
            executable,
        ),
        WorkflowStep::Pdata,
        observer,
    )?;
    let vtable = completed(
        crate::vtable::vtable_edges_into(
            db,
            options.source_binary_id,
            target_binary_id,
            executable,
            options.skip_indirect,
        ),
        WorkflowStep::Vtable,
        observer,
    )?;
    let disassembly = completed(
        crate::disasm::recover_call_edges(db, target_binary_id, executable, options.skip_indirect),
        WorkflowStep::Disassembly,
        observer,
    )?;
    let propagation = completed(
        crate::loop_db::propagate_db(db, target_binary_id, options.rounds),
        WorkflowStep::Propagation,
        observer,
    )?;

    let classified_confident = db.conn().query_row(
        "SELECT COUNT(*) FROM function WHERE binary_id=?1 AND subsystem!='standalone' AND confidence>=0.3",
        [target_binary_id],
        |row| row.get(0),
    )?;
    let named_total = db.conn().query_row(
        "SELECT COUNT(*) FROM function WHERE binary_id=?1 AND name IS NOT NULL",
        [target_binary_id],
        |row| row.get(0),
    )?;

    Ok(RebuildReport {
        target_binary_id,
        pdata,
        vtable,
        disassembly,
        propagation,
        classified_confident,
        named_total,
    })
}

/// Inputs for the ordered structural recovery pipeline.
#[derive(Debug, Clone)]
pub struct RecoverOptions {
    pub binary_id: i64,
    pub dry_run: bool,
    pub ghidra_csv: Option<PathBuf>,
}

/// Mutating recovery passes that are intentionally absent during a dry run.
#[derive(Debug)]
pub struct RecoveryEnrichment {
    pub anonymous_vtables: crate::vtable_anon::AnonVtableStats,
    pub string_references: crate::strref::StrRefStats,
    pub func_lua: crate::funclua::FuncLuaStats,
    pub adjacency: crate::adjacency::AdjacencyStats,
    pub coverage: Coverage,
}

/// Typed results of the recovery workflow.
#[derive(Debug)]
pub struct RecoverReport {
    pub ghidra: Option<crate::ghidra_import::GhidraImportStats>,
    pub leaves: crate::recover::RecoverStats,
    pub enrichment: Option<RecoveryEnrichment>,
}

/// Runs recovery in the canonical order and snapshots coverage after all mutating passes.
pub fn recover(db: &mut Db, executable: &Path, options: &RecoverOptions) -> Result<RecoverReport> {
    recover_with_observer(db, executable, options, &mut |_| {})
}

pub fn recover_with_observer(
    db: &mut Db,
    executable: &Path,
    options: &RecoverOptions,
    observer: &mut impl FnMut(WorkflowStep),
) -> Result<RecoverReport> {
    let ghidra = options
        .ghidra_csv
        .as_deref()
        .filter(|_| !options.dry_run)
        .map(|csv| crate::ghidra_import::ingest_ghidra_csv(db, options.binary_id, csv))
        .transpose()?;
    if ghidra.is_some() {
        observer(WorkflowStep::Ghidra);
    }
    let leaves = completed(
        crate::recover::recover_leaves(db, options.binary_id, executable, options.dry_run),
        WorkflowStep::Leaves,
        observer,
    )?;
    if options.dry_run {
        return Ok(RecoverReport {
            ghidra,
            leaves,
            enrichment: None,
        });
    }

    let rtti_binary_id = db
        .conn()
        .query_row("SELECT id FROM binary ORDER BY id LIMIT 1", [], |row| {
            row.get(0)
        })
        .context("aucun binaire indexé")?;
    let anonymous_vtables = completed(
        crate::vtable_anon::anon_vtable_edges_into(
            db,
            rtti_binary_id,
            options.binary_id,
            executable,
        ),
        WorkflowStep::AnonymousVtables,
        observer,
    )?;
    let string_references = completed(
        crate::strref::ingest_string_refs(db, options.binary_id, executable),
        WorkflowStep::StringReferences,
        observer,
    )?;
    let func_lua = completed(
        crate::funclua::ingest_funclua(db, options.binary_id, executable),
        WorkflowStep::FuncLua,
        observer,
    )?;
    let adjacency = completed(
        crate::adjacency::classify_by_adjacency(db, options.binary_id, false),
        WorkflowStep::Adjacency,
        observer,
    )?;
    let coverage = completed(
        db.snapshot_coverage(options.binary_id)
            .context("snapshot recovery coverage"),
        WorkflowStep::CoverageSnapshot,
        observer,
    )?;

    Ok(RecoverReport {
        ghidra,
        leaves,
        enrichment: Some(RecoveryEnrichment {
            anonymous_vtables,
            string_references,
            func_lua,
            adjacency,
            coverage,
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn target_identity_preserves_contract() {
        assert_eq!(
            pdata_identity("nie.exe", "abc"),
            ("nie.exe#pdata".into(), "abc-pdata".into())
        );
    }
    #[test]
    fn observer_records_only_successful_steps_before_failure() {
        let mut seen = Vec::new();
        let mut observer = |s| seen.push(s);
        let _: Result<()> = completed(Ok(()), WorkflowStep::Leaves, &mut observer);
        let failed: Result<()> = completed(
            Err(anyhow::anyhow!("boom")),
            WorkflowStep::AnonymousVtables,
            &mut observer,
        );
        assert!(failed.is_err());
        assert_eq!(seen, [WorkflowStep::Leaves]);
    }
}
