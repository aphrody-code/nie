//! `niers atlas` — l'index unique des surfaces RE du dépôt.
//!
//! Une seule base (`var/nie-atlas.sqlite`) rassemble ce qui était éparpillé : la base de
//! connaissance de 19 Go, l'arborescence `data/re/`, la forge (`forge/`, `data/forge/`), les
//! exports (C, ASM, EXE, JSON), la documentation Markdown, les 45 crates et les outils
//! exécutables. Un miroir Redis (`db4` par défaut) rend l'ensemble interrogeable sans ouvrir
//! SQLite, et `atlas gaps`/`atlas next` donnent la route mesurée vers les 100 %.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use clap::{CommandFactory, Subcommand};
use nie_index::atlas::{Atlas, ScanConfig, ToolRecord};

/// Binaires connus de la chaîne, dans l'ordre `(chemin relatif, rôle)`.
const BINARIES: &[(&str, &str)] = &[
    ("nie.exe", "reference"),
    ("dist/nie.exe", "produced"),
    ("nie_eacpatched.exe", "patched"),
];

#[derive(Debug, Subcommand)]
pub enum AtlasCmd {
    /// Construit (ou met à jour) l'index complet : fichiers, crates, docs, base de
    /// connaissance, binaires, outils, métriques et écarts.
    Build {
        /// Base atlas cible.
        #[arg(long, env = "NIERS_ATLAS", default_value = nie_index::atlas::DEFAULT_ATLAS_PATH)]
        db: PathBuf,
        /// Racine du dépôt.
        #[arg(long, default_value = ".")]
        root: PathBuf,
        /// Base de connaissance à digérer.
        #[arg(long, default_value = "var/niers.sqlite")]
        kb: PathBuf,
        /// Saute le digest de la base de connaissance (scan de fichiers seul).
        #[arg(long)]
        no_kb: bool,
        /// Plafond de lignes comptées par table de la base de connaissance.
        #[arg(long, default_value_t = 20_000_000)]
        row_cap: i64,
        /// Saute l'appariement symbole → source Rust (le plus coûteux du build).
        #[arg(long)]
        no_link: bool,
        /// Miroir Redis à écrire dans la foulée.
        #[arg(long)]
        redis: Option<String>,
        /// Sortie JSON.
        #[arg(long)]
        json: bool,
    },
    /// Une ligne d'état mesurée.
    Status {
        #[arg(long, env = "NIERS_ATLAS", default_value = nie_index::atlas::DEFAULT_ATLAS_PATH)]
        db: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// Cherche dans tout l'index d'un coup (docs, symboles, outils, fichiers, crates).
    Search {
        /// Motif recherché.
        query: String,
        #[arg(long, env = "NIERS_ATLAS", default_value = nie_index::atlas::DEFAULT_ATLAS_PATH)]
        db: PathBuf,
        /// Restreint à un type (`doc`, `symbol`, `tool`, `artifact`, `crate`).
        #[arg(long)]
        kind: Option<String>,
        #[arg(long, default_value_t = 20)]
        limit: usize,
        #[arg(long)]
        json: bool,
    },
    /// La route vers les 100 %, classée par travail restant × poids.
    Gaps {
        #[arg(long, env = "NIERS_ATLAS", default_value = nie_index::atlas::DEFAULT_ATLAS_PATH)]
        db: PathBuf,
        #[arg(long, default_value_t = 20)]
        limit: usize,
        #[arg(long)]
        json: bool,
    },
    /// Le prochain chantier (écart le mieux classé), en JSON pour la boucle autonome.
    Next {
        #[arg(long, env = "NIERS_ATLAS", default_value = nie_index::atlas::DEFAULT_ATLAS_PATH)]
        db: PathBuf,
    },
    /// Enregistre une mesure dans la chronologie (source obligatoire : la commande qui l'a produite).
    Metric {
        /// Nom de la métrique (`re.classified`, `proofs.ok`, `forge.units`…).
        name: String,
        /// Valeur mesurée.
        value: f64,
        #[arg(long, env = "NIERS_ATLAS", default_value = nie_index::atlas::DEFAULT_ATLAS_PATH)]
        db: PathBuf,
        /// Total, quand la métrique est un ratio.
        #[arg(long)]
        total: Option<f64>,
        /// Commande ou table qui a produit le chiffre.
        #[arg(long)]
        source: String,
        /// Note libre.
        #[arg(long)]
        note: Option<String>,
        /// Recalcule les écarts après enregistrement.
        #[arg(long)]
        refresh: bool,
    },
    /// Enregistre un pas de la boucle autonome.
    Run {
        /// Étape exécutée.
        step: String,
        #[arg(long, env = "NIERS_ATLAS", default_value = nie_index::atlas::DEFAULT_ATLAS_PATH)]
        db: PathBuf,
        /// Domaine visé (`forge.identity`, `re.named`…).
        #[arg(long)]
        area: Option<String>,
        /// Succès de l'étape.
        #[arg(long)]
        ok: bool,
        /// Durée en millisecondes.
        #[arg(long, default_value_t = 0)]
        ms: i64,
        /// Métriques JSON associées.
        #[arg(long)]
        metrics: Option<String>,
        /// Dernières lignes de journal.
        #[arg(long)]
        log: Option<String>,
    },
    /// Documents indexés, classés par ancrage machine (adresses, symboles, empreintes).
    Docs {
        #[arg(long, env = "NIERS_ATLAS", default_value = nie_index::atlas::DEFAULT_ATLAS_PATH)]
        db: PathBuf,
        /// N'affiche que les documents sans aucune référence machine.
        #[arg(long)]
        orphans: bool,
        #[arg(long, default_value_t = 30)]
        limit: usize,
    },
    /// Fichiers strictement identiques (même sha256) présents à plusieurs chemins.
    Dupes {
        #[arg(long, env = "NIERS_ATLAS", default_value = nie_index::atlas::DEFAULT_ATLAS_PATH)]
        db: PathBuf,
        /// Restreint à une zone (`re-data`, `doc`, `forge`, `crate`…).
        #[arg(long)]
        zone: Option<String>,
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
    /// Miroir Redis de l'index (statut, écarts, outils, symbole → adresse).
    Sync {
        #[arg(long, env = "NIERS_ATLAS", default_value = nie_index::atlas::DEFAULT_ATLAS_PATH)]
        db: PathBuf,
        #[arg(long, env = "NIERS_ATLAS_REDIS", default_value = nie_index::atlas::DEFAULT_ATLAS_REDIS)]
        redis: String,
        #[arg(long, default_value = "atlas")]
        prefix: String,
    },
}

pub fn run(cmd: AtlasCmd) -> Result<()> {
    match cmd {
        AtlasCmd::Build {
            db,
            root,
            kb,
            no_kb,
            row_cap,
            no_link,
            redis,
            json,
        } => build(&db, &root, &kb, no_kb, row_cap, no_link, redis.as_deref(), json),
        AtlasCmd::Status { db, json } => status(&db, json),
        AtlasCmd::Search {
            query,
            db,
            kind,
            limit,
            json,
        } => search(&db, &query, kind.as_deref(), limit, json),
        AtlasCmd::Gaps { db, limit, json } => gaps(&db, limit, json),
        AtlasCmd::Next { db } => next(&db),
        AtlasCmd::Metric {
            name,
            value,
            db,
            total,
            source,
            note,
            refresh,
        } => metric(&db, &name, value, total, &source, note.as_deref(), refresh),
        AtlasCmd::Run {
            step,
            db,
            area,
            ok,
            ms,
            metrics,
            log,
        } => run_step(
            &db,
            &step,
            area.as_deref(),
            ok,
            ms,
            metrics.as_deref(),
            log.as_deref(),
        ),
        AtlasCmd::Docs {
            db,
            orphans,
            limit,
        } => docs(&db, orphans, limit),
        AtlasCmd::Dupes { db, zone, limit } => dupes(&db, zone.as_deref(), limit),
        AtlasCmd::Sync { db, redis, prefix } => sync(&db, &redis, &prefix),
    }
}

#[allow(clippy::too_many_arguments, clippy::fn_params_excessive_bools)]
fn build(
    db: &Path,
    root: &Path,
    kb: &Path,
    no_kb: bool,
    row_cap: i64,
    no_link: bool,
    redis: Option<&str>,
    json: bool,
) -> Result<()> {
    let started = std::time::Instant::now();
    let mut atlas = Atlas::open(db).context("ouverture de l'atlas")?;
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());

    let tracked = git_tracked(&root);
    let scan = atlas
        .scan(&ScanConfig::new(&root), &tracked)
        .context("scan du dépôt")?;
    let crates = atlas.import_crates(&root).context("import des crates")?;
    let docs = atlas.import_docs(&root).context("import des documents")?;
    let binaries = atlas
        .import_binaries(
            &root,
            &BINARIES
                .iter()
                .map(|(p, r)| ((*p).to_string(), (*r).to_string()))
                .collect::<Vec<_>>(),
        )
        .context("import des binaires")?;
    let forge = atlas.import_forge(&root).context("import de la forge")?;
    let mut tools = atlas
        .import_repo_tools(&root)
        .context("import des outils du dépôt")?;
    tools += atlas
        .import_tools(&cli_tools())
        .context("import des sous-commandes niers")?;

    let mut kb_digest = None;
    if !no_kb {
        let kb_path = if kb.is_absolute() {
            kb.to_path_buf()
        } else {
            root.join(kb)
        };
        if kb_path.is_file() {
            let digest = atlas
                .import_kb(&kb_path, row_cap)
                .with_context(|| format!("digest de {}", kb_path.display()))?;
            record_kb_metrics(&atlas, &digest)?;
            kb_digest = Some(digest);
        } else {
            eprintln!(
                "atlas: base de connaissance absente ({}) — index construit sans son digest",
                kb_path.display()
            );
        }
    }

    let linked = if no_link {
        0
    } else {
        atlas
            .link_ported_symbols(&root)
            .context("appariement symbole → source Rust")?
    };

    record_forge_metrics(&atlas)?;
    let gaps = atlas.refresh_gaps().context("calcul des écarts")?;
    let mirrored = match redis {
        Some(url) => atlas.sync_redis(url, "atlas").unwrap_or(0),
        None => 0,
    };

    let elapsed = started.elapsed().as_millis() as i64;
    let status = atlas.status()?;
    atlas.record_run(
        "atlas.build",
        None,
        true,
        elapsed,
        Some(&serde_json::to_string(&status)?),
        None,
    )?;

    if json {
        let payload = serde_json::json!({
            "scan": scan,
            "crates": crates,
            "docs": docs,
            "binaries": binaries,
            "forge": forge,
            "tools": tools,
            "kb": kb_digest,
            "symbols_linked": linked,
            "gaps": gaps,
            "redis_keys": mirrored,
            "status": status,
            "ms": elapsed,
        });
        println!("{}", serde_json::to_string_pretty(&payload)?);
    } else {
        println!(
            "atlas-build files={} bytes={} crates={} docs={} doc_refs={} binaries={} tools={} symbols={} units={} units_lifted={} units_exact={} kb_tables={} kb_rows={} linked={} gaps={} redis={} ms={}",
            scan.files,
            scan.bytes,
            crates,
            docs,
            status.doc_refs,
            binaries,
            tools,
            status.symbols,
            status.units,
            forge.lifted,
            status.units_exact,
            status.kb_tables,
            status.kb_rows,
            linked,
            gaps,
            mirrored,
            elapsed
        );
    }
    Ok(())
}

/// Métriques dérivées du digest de la base de connaissance.
///
/// La couverture n'est pas recalculée ici : la dernière ligne de `kb.coverage`, écrite par
/// `niers rebuild`, est reprise telle quelle — c'est la mesure honnête de la boucle.
fn record_kb_metrics(atlas: &Atlas, digest: &nie_index::atlas::KbDigest) -> Result<()> {
    atlas.record_metric(
        "kb.rows",
        digest.rows as f64,
        None,
        "atlas import_kb (COUNT borné par --row-cap)",
        None,
        Some(&format!("{} tables, {} plafonnées", digest.tables, digest.capped)),
    )?;
    if let Some(cov) = digest.coverage {
        atlas.record_metric(
            "re.classified",
            cov.classified as f64,
            Some(cov.total as f64),
            "kb.coverage (dernière ligne)",
            None,
            None,
        )?;
        atlas.record_metric(
            "re.named",
            cov.named as f64,
            Some(cov.total as f64),
            "kb.coverage (dernière ligne)",
            None,
            None,
        )?;
        return Ok(());
    }
    // Sans ligne de couverture, la seule mesure disponible est le digest lui-même.
    let functions: Option<i64> = atlas
        .conn()
        .query_row(
            "SELECT n_rows FROM atlas_kb_table WHERE name = 'function'",
            [],
            |r| r.get(0),
        )
        .ok();
    if let Some(total) = functions
        && total > 0
    {
        atlas.record_metric(
            "re.named",
            digest.symbols as f64,
            Some(total as f64),
            "atlas import_kb (kb.function)",
            None,
            None,
        )?;
    }
    Ok(())
}

/// Métriques de la forge : identité du binaire produit, unités relevées et byte-exactes.
fn record_forge_metrics(atlas: &Atlas) -> Result<()> {
    let conn = atlas.conn();
    let (units, exact, lifted): (i64, i64, i64) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(byte_exact), 0),
                COALESCE(SUM(CASE WHEN lang = 'asm' THEN 1 ELSE 0 END), 0)
         FROM atlas_unit",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    if units > 0 {
        atlas.record_metric(
            "forge.units",
            exact as f64,
            Some(units as f64),
            "atlas_unit (byte_exact)",
            None,
            None,
        )?;
        atlas.record_metric(
            "forge.lifted",
            lifted as f64,
            Some(units as f64),
            "atlas_unit (lang=asm)",
            None,
            None,
        )?;
    }
    if let Ok((identical, sha)) = conn.query_row(
        "SELECT COALESCE(identical, 0), COALESCE(sha256, '') FROM atlas_binary
         WHERE role = 'produced' ORDER BY seen_at DESC LIMIT 1",
        [],
        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
    ) {
        atlas.record_metric(
            "forge.identity",
            identical as f64 * 100.0,
            Some(100.0),
            "sha256 dist/nie.exe vs nie.exe",
            Some(&sha),
            None,
        )?;
    }
    Ok(())
}

fn status(db: &Path, json: bool) -> Result<()> {
    let atlas = Atlas::open(db)?;
    let status = atlas.status()?;
    if json {
        println!("{}", serde_json::to_string_pretty(&status)?);
    } else {
        println!(
            "atlas artifacts={} bytes={} crates={} docs={} doc_refs={} symbols={} units={} units_exact={} tools={} kb_tables={} kb_rows={} gaps_open={} runs={}",
            status.artifacts,
            status.artifact_bytes,
            status.crates,
            status.docs,
            status.doc_refs,
            status.symbols,
            status.units,
            status.units_exact,
            status.tools,
            status.kb_tables,
            status.kb_rows,
            status.gaps_open,
            status.runs
        );
    }
    Ok(())
}

fn search(db: &Path, query: &str, kind: Option<&str>, limit: usize, json: bool) -> Result<()> {
    let atlas = Atlas::open(db)?;
    let hits: Vec<_> = atlas
        .search(query, limit * 4)?
        .into_iter()
        .filter(|h| kind.is_none_or(|k| h.kind == k))
        .take(limit)
        .collect();
    if json {
        println!("{}", serde_json::to_string_pretty(&hits)?);
    } else {
        for hit in &hits {
            println!(
                "{:<8} {:<48} {}",
                hit.kind,
                hit.key,
                hit.reference.clone().unwrap_or_default()
            );
        }
        println!("hits={}", hits.len());
    }
    Ok(())
}

fn gaps(db: &Path, limit: usize, json: bool) -> Result<()> {
    let atlas = Atlas::open(db)?;
    let gaps = atlas.gaps(limit)?;
    if json {
        println!("{}", serde_json::to_string_pretty(&gaps)?);
        return Ok(());
    }
    for gap in &gaps {
        println!(
            "{:<18} {:>6.2}{} -> {:>6.2} score={:>7.2} {} [{}]",
            gap.area,
            gap.current,
            gap.unit,
            gap.target,
            gap.score,
            gap.action.clone().unwrap_or_default(),
            gap.evidence.clone().unwrap_or_default()
        );
    }
    println!("gaps={}", gaps.len());
    Ok(())
}

fn next(db: &Path) -> Result<()> {
    let atlas = Atlas::open(db)?;
    match atlas.next_gap()? {
        Some(gap) => println!("{}", serde_json::to_string(&gap)?),
        None => println!("{{\"area\":null}}"),
    }
    Ok(())
}

fn metric(
    db: &Path,
    name: &str,
    value: f64,
    total: Option<f64>,
    source: &str,
    note: Option<&str>,
    refresh: bool,
) -> Result<()> {
    let atlas = Atlas::open(db)?;
    atlas.record_metric(name, value, total, source, None, note)?;
    let gaps = if refresh { atlas.refresh_gaps()? } else { 0 };
    println!(
        "metric name={name} value={value} total={} gaps={gaps}",
        total.unwrap_or(0.0)
    );
    Ok(())
}

fn run_step(
    db: &Path,
    step: &str,
    area: Option<&str>,
    ok: bool,
    ms: i64,
    metrics: Option<&str>,
    log: Option<&str>,
) -> Result<()> {
    let atlas = Atlas::open(db)?;
    let id = atlas.record_run(step, area, ok, ms, metrics, log)?;
    println!("run id={id} step={step} ok={ok} ms={ms}");
    Ok(())
}

fn docs(db: &Path, orphans: bool, limit: usize) -> Result<()> {
    let atlas = Atlas::open(db)?;
    let sql = if orphans {
        "SELECT path, COALESCE(title,''), re_score, words FROM atlas_doc
         WHERE re_score = 0 ORDER BY words DESC LIMIT ?1"
    } else {
        "SELECT path, COALESCE(title,''), re_score, words FROM atlas_doc
         ORDER BY re_score DESC, words DESC LIMIT ?1"
    };
    let conn = atlas.conn();
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([limit as i64], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, i64>(3)?,
        ))
    })?;
    let mut count = 0usize;
    for row in rows {
        let (path, title, score, words) = row?;
        println!("{score:>6} {words:>7} {path} — {title}");
        count += 1;
    }
    println!("docs={count}");
    Ok(())
}

/// Doublons stricts : même sha256, plusieurs chemins. Le dépôt en porte par construction
/// (`refs/iecode-re/` et `data/re/50-source/upstream-iecode/` sont deux copies du même
/// corpus) ; les mesurer est la condition pour décider laquelle fait autorité.
fn dupes(db: &Path, zone: Option<&str>, limit: usize) -> Result<()> {
    let atlas = Atlas::open(db)?;
    let conn = atlas.conn();
    let mut stmt = conn.prepare(
        "SELECT sha256, COUNT(*) AS n, SUM(bytes) AS total, GROUP_CONCAT(path, ' | ')
         FROM atlas_artifact
         WHERE sha256 IS NOT NULL AND (?1 IS NULL OR zone = ?1)
         GROUP BY sha256 HAVING n > 1
         ORDER BY total DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(nie_index::rusqlite::params![zone, limit as i64], |r| {
        Ok((
            r.get::<_, i64>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, String>(3)?,
        ))
    })?;
    let mut groups = 0usize;
    let mut wasted = 0i64;
    for row in rows {
        let (n, total, paths) = row?;
        wasted += total - total / n;
        println!("{n:>3}x {:>10} o  {paths}", total / n);
        groups += 1;
    }
    println!("dupes groups={groups} redundant_bytes={wasted}");
    Ok(())
}

fn sync(db: &Path, redis: &str, prefix: &str) -> Result<()> {
    let atlas = Atlas::open(db)?;
    let keys = atlas
        .sync_redis(redis, prefix)
        .with_context(|| format!("miroir redis {redis}"))?;
    println!("atlas-sync redis={redis} prefix={prefix} keys={keys}");
    Ok(())
}

/// Chemins suivis par git, pour distinguer versionné et matière locale (`data/re/`).
fn git_tracked(root: &Path) -> HashSet<String> {
    let Ok(out) = std::process::Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["ls-files", "-z"])
        .output()
    else {
        return HashSet::new();
    };
    String::from_utf8_lossy(&out.stdout)
        .split('\0')
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

/// Les sous-commandes de `niers`, lues sur la définition clap elle-même : l'index ne peut
/// pas dériver de la CLI réelle.
fn cli_tools() -> Vec<ToolRecord> {
    let cmd = crate::Cli::command();
    cmd.get_subcommands()
        .map(|sub| ToolRecord {
            name: sub.get_name().to_string(),
            kind: "cli-cmd".to_string(),
            path: Some("crates/tools/nie-cli".to_string()),
            summary: sub.get_about().map(ToString::to_string),
        })
        .collect()
}
