//! PostgreSQL writes: migrations and the transactional import of one decoded file.

use crate::MIGRATIONS;
use crate::decode::{Body, Decoded};
use futures_util::pin_mut;
use tokio_postgres::binary_copy::BinaryCopyInWriter;
use tokio_postgres::types::{ToSql, Type};
use tokio_postgres::{Client, Error, Transaction};

/// Advisory lock serialising concurrent migrations.
const MIGRATION_LOCK: i64 = 0x6e69_6570_6700_0001;

/// Outcome of importing one file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportOutcome {
    /// Same SHA-256 already stored: nothing is rewritten.
    Unchanged,
    /// Missing or changed file: written in full.
    Written { rows: u64 },
}

/// Applies missing migrations inside one transaction.
///
/// # Errors
/// PostgreSQL error while running a migration.
pub async fn migrate(client: &mut Client) -> Result<Vec<i32>, Error> {
    let tx = client.transaction().await?;
    tx.execute("SELECT pg_advisory_xact_lock($1)", &[&MIGRATION_LOCK])
        .await?;
    let exists: bool = tx
        .query_one("SELECT to_regclass('nie.schema_version') IS NOT NULL", &[])
        .await?
        .get(0);
    let applied: Vec<i32> = if exists {
        tx.query("SELECT version FROM nie.schema_version", &[])
            .await?
            .iter()
            .map(|r| r.get(0))
            .collect()
    } else {
        Vec::new()
    };
    let mut done = Vec::new();
    for (version, sql) in MIGRATIONS {
        if !applied.contains(version) {
            tx.batch_execute(sql).await?;
            done.push(*version);
        }
    }
    tx.commit().await?;
    Ok(done)
}

/// Imports one decoded file, atomically replacing an older version.
///
/// # Errors
/// PostgreSQL error; the transaction is rolled back and the previous state kept.
pub async fn store_file(
    client: &mut Client,
    path: &str,
    file: &Decoded,
) -> Result<ImportOutcome, Error> {
    let tx = client.transaction().await?;
    let current = tx
        .query_opt(
            "SELECT sha256 FROM nie.cfgbin_file WHERE path = $1 FOR UPDATE",
            &[&path],
        )
        .await?;
    if let Some(row) = current {
        let sha: Vec<u8> = row.get(0);
        if sha == file.sha256 {
            tx.commit().await?;
            return Ok(ImportOutcome::Unchanged);
        }
        tx.execute("DELETE FROM nie.cfgbin_file WHERE path = $1", &[&path])
            .await?;
    }
    let file_id: i64 = tx
        .query_one(
            "INSERT INTO nie.cfgbin_file (path, format, sha256, byte_size) VALUES ($1, $2, $3, $4) RETURNING id",
            &[&path, &file.body.format(), &file.sha256.as_slice(), &file.byte_size],
        )
        .await?
        .get(0);
    let rows = match &file.body {
        Body::Rdbn(lists) => store_rdbn(&tx, file_id, lists).await?,
        Body::T2b { entries, vars } => store_t2b(&tx, file_id, entries, vars).await?,
    };
    tx.commit().await?;
    Ok(ImportOutcome::Written { rows })
}

async fn store_rdbn(
    tx: &Transaction<'_>,
    file_id: i64,
    lists: &[crate::decode::RdbnListRows],
) -> Result<u64, Error> {
    let mut rows = 0;
    for (ord, list) in lists.iter().enumerate() {
        let ord = i32::try_from(ord).unwrap_or(i32::MAX);
        let list_id: i64 = tx
            .query_one(
                "INSERT INTO nie.rdbn_list (file_id, ord, name, type_name) VALUES ($1, $2, $3, $4) RETURNING id",
                &[&file_id, &ord, &list.name, &list.type_name],
            )
            .await?
            .get(0);
        if list.values.is_empty() {
            continue;
        }
        let sink = tx
            .copy_in(
                "COPY nie.rdbn_value (list_id, row_idx, field_idx, field_name, kind, v_int, v_real, v_text, v_vec, v_bytes) FROM STDIN BINARY",
            )
            .await?;
        let writer = BinaryCopyInWriter::new(
            sink,
            &[
                Type::INT8,
                Type::INT4,
                Type::INT2,
                Type::TEXT,
                Type::INT2,
                Type::INT8,
                Type::FLOAT8,
                Type::TEXT,
                Type::FLOAT4_ARRAY,
                Type::BYTEA,
            ],
        );
        pin_mut!(writer);
        for v in &list.values {
            let row: [&(dyn ToSql + Sync); 10] = [
                &list_id,
                &v.row_idx,
                &v.field_idx,
                &v.field_name,
                &v.kind,
                &v.v_int,
                &v.v_real,
                &v.v_text,
                &v.v_vec,
                &v.v_bytes,
            ];
            writer.as_mut().write(&row).await?;
        }
        rows += writer.finish().await?;
    }
    Ok(rows)
}

async fn store_t2b(
    tx: &Transaction<'_>,
    file_id: i64,
    entries: &[crate::decode::T2bEntryRow],
    vars: &[crate::decode::T2bVarRow],
) -> Result<u64, Error> {
    let sink = tx
        .copy_in("COPY nie.t2b_entry (file_id, idx, parent_idx, depth, name) FROM STDIN BINARY")
        .await?;
    let writer = BinaryCopyInWriter::new(
        sink,
        &[Type::INT8, Type::INT4, Type::INT4, Type::INT2, Type::TEXT],
    );
    pin_mut!(writer);
    for e in entries {
        writer
            .as_mut()
            .write(&[&file_id, &e.idx, &e.parent_idx, &e.depth, &e.name])
            .await?;
    }
    let mut rows = writer.finish().await?;

    let sink = tx
        .copy_in("COPY nie.t2b_var (file_id, entry_idx, ord, kind, v_int, v_real, v_text) FROM STDIN BINARY")
        .await?;
    let writer = BinaryCopyInWriter::new(
        sink,
        &[
            Type::INT8,
            Type::INT4,
            Type::INT2,
            Type::INT2,
            Type::INT4,
            Type::FLOAT4,
            Type::TEXT,
        ],
    );
    pin_mut!(writer);
    for v in vars {
        writer
            .as_mut()
            .write(&[
                &file_id,
                &v.entry_idx,
                &v.ord,
                &v.kind,
                &v.v_int,
                &v.v_real,
                &v.v_text,
            ])
            .await?;
    }
    rows += writer.finish().await?;
    Ok(rows)
}
