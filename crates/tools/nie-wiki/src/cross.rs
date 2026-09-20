//! Lossless import and bounded queries for the extracted Cross Addressables catalogue.
//!
//! Masterdata schemas describe unavailable records; catalogue locations are not
//! masterdata rows. A GUID can identify several typed locations, so it is never
//! used as the primary key. Imports replace only this module's tables atomically.

use std::{collections::BTreeMap, io::BufRead};

use anyhow::{Context, ensure};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Original location, retaining unknown fields for forward-compatible export.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Location {
    pub kind: String,
    pub guid: Option<String>,
    pub key: String,
    #[serde(rename = "type")]
    pub asset_type: String,
    pub bundle: String,
    pub size: u64,
    pub n_deps: usize,
    pub deps: Vec<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

/// Counts measured from imported rows, distinct from upstream aggregate claims.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImportReport {
    pub indexed_rows: usize,
    pub loadable_objects: usize,
    pub physical_bundles: usize,
    pub distinct_asset_guids: usize,
    pub dependency_edges: usize,
    pub documents: usize,
    pub source_catalog_rows: Option<u64>,
    pub masterdata_records_available: bool,
}

/// Administrative provenance. Never return this object from a public endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provenance {
    pub source: String,
    pub sha256: String,
}

/// Replace an extracted catalogue in one transaction. Invalid input rolls back
/// schema creation, deletes, data and provenance together. `documents` holds the
/// original named schema/enums/status reports without projecting away relations.
pub fn import<R: BufRead>(
    connection: &mut Connection,
    input: R,
    documents: &BTreeMap<String, Value>,
    provenance: &Provenance,
) -> anyhow::Result<ImportReport> {
    ensure!(
        provenance.sha256.len() == 64
            && provenance
                .sha256
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit()),
        "source SHA-256 must contain 64 hexadecimal digits"
    );
    let tx = connection.transaction()?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS nie_cross_locations (
            ordinal INTEGER PRIMARY KEY, kind TEXT NOT NULL, guid TEXT,
            key TEXT NOT NULL, asset_type TEXT NOT NULL, bundle TEXT NOT NULL,
            payload TEXT NOT NULL);
         CREATE INDEX IF NOT EXISTS nie_cross_guid ON nie_cross_locations(guid);
         CREATE INDEX IF NOT EXISTS nie_cross_type ON nie_cross_locations(asset_type, key);
         CREATE INDEX IF NOT EXISTS nie_cross_bundle_key ON nie_cross_locations(kind, key);
         CREATE TABLE IF NOT EXISTS nie_cross_dependencies (
            ordinal INTEGER NOT NULL, position INTEGER NOT NULL, bundle TEXT NOT NULL,
            PRIMARY KEY(ordinal, position));
         CREATE TABLE IF NOT EXISTS nie_cross_documents (name TEXT PRIMARY KEY, payload TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS nie_cross_import (id INTEGER PRIMARY KEY CHECK(id = 1),
            provenance TEXT NOT NULL, report TEXT NOT NULL);
         DELETE FROM nie_cross_dependencies;
         DELETE FROM nie_cross_locations;
         DELETE FROM nie_cross_documents;
         DELETE FROM nie_cross_import;",
    )?;
    let mut report = ImportReport {
        indexed_rows: 0,
        loadable_objects: 0,
        physical_bundles: 0,
        distinct_asset_guids: 0,
        dependency_edges: 0,
        documents: documents.len(),
        source_catalog_rows: documents
            .get("catalog-stats")
            .and_then(|doc| doc.pointer("/totals/catalog_rows"))
            .and_then(Value::as_u64),
        masterdata_records_available: false,
    };
    {
        let mut insert =
            tx.prepare("INSERT INTO nie_cross_locations VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")?;
        let mut edge = tx.prepare("INSERT INTO nie_cross_dependencies VALUES (?1, ?2, ?3)")?;
        for (index, line) in input.lines().enumerate() {
            let line = line.context("read catalogue input")?;
            if line.trim().is_empty() {
                continue;
            }
            let row: Location = serde_json::from_str(&line)
                .with_context(|| format!("invalid catalogue row {}", index + 1))?;
            ensure!(
                matches!(row.kind.as_str(), "asset" | "bundle" | "cri"),
                "unknown location kind at row {}",
                index + 1
            );
            ensure!(
                !row.key.is_empty() && !row.asset_type.is_empty(),
                "empty location identity at row {}",
                index + 1
            );
            ensure!(
                row.n_deps == row.deps.len(),
                "dependency count mismatch at row {}",
                index + 1
            );
            if row.kind == "asset" {
                ensure!(
                    row.guid.as_ref().is_some_and(|guid| !guid.is_empty()),
                    "missing asset GUID at row {}",
                    index + 1
                );
                report.loadable_objects += 1;
            } else {
                report.physical_bundles += 1;
            }
            report.indexed_rows += 1;
            insert.execute(params![
                report.indexed_rows,
                row.kind,
                row.guid,
                row.key,
                row.asset_type,
                row.bundle,
                line
            ])?;
            for (position, dependency) in row.deps.iter().enumerate() {
                edge.execute(params![report.indexed_rows, position, dependency])?;
                report.dependency_edges += 1;
            }
        }
    }
    ensure!(report.indexed_rows > 0, "catalogue must not be empty");
    report.distinct_asset_guids = tx.query_row(
        "SELECT COUNT(DISTINCT guid) FROM nie_cross_locations WHERE kind = 'asset'",
        [],
        |row| row.get(0),
    )?;
    if let Some(totals) = documents
        .get("catalog-stats")
        .and_then(|doc| doc.get("totals"))
    {
        for (name, actual) in [
            ("index_lines_written", report.indexed_rows),
            ("loadable_objects", report.loadable_objects),
            ("physical_bundles", report.physical_bundles),
        ] {
            if let Some(expected) = totals.get(name).and_then(Value::as_u64) {
                ensure!(
                    expected == actual as u64,
                    "source count mismatch for {name}: expected {expected}, imported {actual}"
                );
            }
        }
    }
    for (name, document) in documents {
        tx.execute(
            "INSERT INTO nie_cross_documents VALUES (?1, ?2)",
            params![name, serde_json::to_string(document)?],
        )?;
    }
    tx.execute(
        "INSERT INTO nie_cross_import VALUES (1, ?1, ?2)",
        params![
            serde_json::to_string(provenance)?,
            serde_json::to_string(&report)?
        ],
    )?;
    tx.commit()?;
    Ok(report)
}

#[derive(Debug, Default, Clone, Deserialize)]
pub struct CatalogQuery {
    pub q: Option<String>,
    pub asset_type: Option<String>,
    pub guid: Option<String>,
    pub kind: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct CatalogPage {
    pub assets: Vec<CatalogAsset>,
    pub total: usize,
    pub limit: usize,
    pub offset: usize,
}

/// Public projection: established catalogue fields without arbitrary source metadata.
#[derive(Debug, Serialize)]
pub struct CatalogAsset {
    pub kind: String,
    pub guid: Option<String>,
    pub key: String,
    #[serde(rename = "type")]
    pub asset_type: String,
    pub bundle: String,
    pub size: u64,
    pub n_deps: usize,
    pub deps: Vec<String>,
}

impl From<Location> for CatalogAsset {
    fn from(location: Location) -> Self {
        Self {
            kind: location.kind,
            guid: location.guid,
            key: location.key,
            asset_type: location.asset_type,
            bundle: location.bundle,
            size: location.size,
            n_deps: location.n_deps,
            deps: location.deps,
        }
    }
}

/// Search literal substrings (including `%` and `_`) with deterministic pages.
/// By default only loadable assets are returned, matching the historical API.
pub fn search(connection: &Connection, query: &CatalogQuery) -> anyhow::Result<CatalogPage> {
    let q = query.q.as_deref().unwrap_or("").trim().to_lowercase();
    ensure!(q.len() <= 512, "catalogue query exceeds 512 bytes");
    let kind = query.kind.as_deref().unwrap_or("asset");
    ensure!(
        matches!(kind, "asset" | "bundle" | "cri"),
        "invalid location kind"
    );
    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let offset = query.offset.unwrap_or(0).min(i64::MAX as usize);
    let filter = " FROM nie_cross_locations WHERE kind = ?1
        AND (?2 = '' OR instr(lower(key), ?2) > 0 OR instr(lower(bundle), ?2) > 0)
        AND (?3 IS NULL OR asset_type = ?3) AND (?4 IS NULL OR guid = ?4)";
    let total = connection.query_row(
        &format!("SELECT COUNT(*){filter}"),
        params![kind, q, query.asset_type, query.guid],
        |row| row.get(0),
    )?;
    let mut statement = connection.prepare(&format!(
        "SELECT payload{filter} ORDER BY key, asset_type, ordinal LIMIT ?5 OFFSET ?6"
    ))?;
    let rows = statement.query_map(
        params![kind, q, query.asset_type, query.guid, limit, offset],
        |row| row.get::<_, String>(0),
    )?;
    let assets = rows
        .map(|row| Ok(CatalogAsset::from(serde_json::from_str::<Location>(&row?)?)))
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(CatalogPage {
        assets,
        total,
        limit,
        offset,
    })
}

/// Retrieve one source document (schema, enums, taxonomy or extraction status).
/// Source documents are administrative and may include original extraction paths.
pub fn document(connection: &Connection, name: &str) -> anyhow::Result<Option<Value>> {
    let json: Option<String> = connection
        .query_row(
            "SELECT payload FROM nie_cross_documents WHERE name = ?1",
            [name],
            |row| row.get(0),
        )
        .optional()?;
    json.map(|value| serde_json::from_str(&value).map_err(Into::into))
        .transpose()
}

pub fn report(connection: &Connection) -> anyhow::Result<ImportReport> {
    let json: String = connection.query_row(
        "SELECT report FROM nie_cross_import WHERE id = 1",
        [],
        |row| row.get(0),
    )?;
    Ok(serde_json::from_str(&json)?)
}

/// Verify every pre-existing IEVR table against the read-only source snapshot.
/// Rows are compared in full, including IDs and duplicate multiplicity; no hashes
/// or assumed primary keys hide dropped data. Returns the number of verified tables.
pub fn verify_mirror_preserved(
    source: &Connection,
    candidate: &Connection,
) -> anyhow::Result<usize> {
    let mut tables = source.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'inagle_%' ORDER BY name")?;
    let names = tables
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    ensure!(!names.is_empty(), "base mirror has no inagle tables");
    for name in &names {
        let table = format!("\"{}\"", name.replace('"', "\"\""));
        let columns = source
            .prepare(&format!("SELECT * FROM {table} LIMIT 0"))?
            .column_count();
        let order = (1..=columns)
            .map(|column| column.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!("SELECT * FROM {table} ORDER BY {order}");
        let mut original_statement = source.prepare(&sql)?;
        let mut candidate_statement = candidate.prepare(&sql)?;
        ensure!(
            original_statement.column_names() == candidate_statement.column_names(),
            "base mirror columns changed: {name}"
        );
        let mut original_rows = original_statement.query([])?;
        let mut candidate_rows = candidate_statement.query([])?;
        loop {
            match (original_rows.next()?, candidate_rows.next()?) {
                (None, None) => break,
                (Some(original), Some(copy)) => {
                    for column in 0..columns {
                        ensure!(
                            original.get_ref(column)? == copy.get_ref(column)?,
                            "base mirror row changed: {name}"
                        );
                    }
                }
                _ => anyhow::bail!("base mirror row count changed: {name}"),
            }
        }
    }
    Ok(names.len())
}

/// Public schema listing matching Azalee's table summary contract.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TableSummary {
    pub slug: String,
    pub short: String,
    pub full_name: String,
    pub file: String,
    pub column_count: usize,
    pub ref_count: usize,
    pub enum_count: usize,
    pub extends: Option<String>,
}

pub fn tables(connection: &Connection, query: Option<&str>) -> anyhow::Result<Vec<TableSummary>> {
    let schema = document(connection, "masterdata-schema")?
        .context("Cross masterdata schema is unavailable")?;
    let schema = schema
        .as_object()
        .context("Cross schema must be an object")?;
    let needle = query.unwrap_or("").trim().to_lowercase();
    ensure!(needle.len() <= 512, "table query exceeds 512 bytes");
    let mut summaries = Vec::new();
    for (name, table) in schema {
        let short = name.rsplit('.').next().unwrap_or(name).to_owned();
        let file = table
            .get("file")
            .and_then(Value::as_str)
            .context("schema table filename missing")?;
        if !needle.is_empty()
            && !short.to_lowercase().contains(&needle)
            && !file.to_lowercase().contains(&needle)
        {
            continue;
        }
        let columns = table
            .get("columns")
            .and_then(Value::as_array)
            .context("schema columns missing")?;
        summaries.push(TableSummary {
            slug: short.clone(),
            short,
            full_name: name.clone(),
            file: file.to_owned(),
            column_count: columns.len(),
            ref_count: columns
                .iter()
                .filter(|column| column.get("kind").and_then(Value::as_str) == Some("ref"))
                .count(),
            enum_count: columns
                .iter()
                .filter(|column| column.get("kind").and_then(Value::as_str) == Some("enum"))
                .count(),
            extends: table
                .get("extends")
                .and_then(Value::as_str)
                .map(str::to_owned),
        });
    }
    summaries.sort_by(|left, right| left.short.cmp(&right.short));
    Ok(summaries)
}

/// Whitelisted public statistics; extraction paths and import provenance are absent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogStats {
    pub generated: String,
    pub totals: Value,
    pub by_asset_type: Value,
    pub by_row_type: Value,
    pub by_bundle_top60: Value,
    pub localization: Value,
    pub audio_cri: Value,
    pub skit_timeline: Value,
}

pub fn stats(connection: &Connection) -> anyhow::Result<CatalogStats> {
    serde_json::from_value(
        document(connection, "catalog-stats")?
            .context("Cross catalogue statistics are unavailable")?,
    )
    .context("invalid Cross statistics")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    const INPUT: &str = concat!(
        "{\"kind\":\"asset\",\"guid\":\"same\",\"key\":\"a_b%\",\"type\":\"Sprite\",\"bundle\":\"b\",\"size\":1,\"n_deps\":1,\"deps\":[\"b\"],\"alt_keys\":[\"remote\"]}\n",
        "{\"kind\":\"asset\",\"guid\":\"same\",\"key\":\"a_b%\",\"type\":\"Texture2D\",\"bundle\":\"b\",\"size\":1,\"n_deps\":1,\"deps\":[\"b\"]}\n",
        "{\"kind\":\"bundle\",\"guid\":null,\"key\":\"b\",\"type\":\"AssetBundle\",\"bundle\":\"b\",\"size\":1,\"n_deps\":0,\"deps\":[]}\n"
    );

    fn provenance() -> Provenance {
        Provenance {
            source: "fixture".into(),
            sha256: "0".repeat(64),
        }
    }

    #[test]
    fn mirror_comparison_detects_changed_ids_values_and_duplicate_counts() {
        let source = Connection::open_in_memory().unwrap();
        let candidate = Connection::open_in_memory().unwrap();
        for connection in [&source, &candidate] {
            connection.execute_batch("CREATE TABLE inagle_fixture(id TEXT, value INTEGER); INSERT INTO inagle_fixture VALUES ('a', 1), ('a', 1), ('b', 2)").unwrap();
        }
        assert_eq!(verify_mirror_preserved(&source, &candidate).unwrap(), 1);
        candidate
            .execute("UPDATE inagle_fixture SET id = 'c' WHERE id = 'b'", [])
            .unwrap();
        assert!(verify_mirror_preserved(&source, &candidate).is_err());
        candidate
            .execute("UPDATE inagle_fixture SET id = 'b' WHERE id = 'c'", [])
            .unwrap();
        candidate
            .execute("UPDATE inagle_fixture SET value = 3 WHERE id = 'b'", [])
            .unwrap();
        assert!(verify_mirror_preserved(&source, &candidate).is_err());
        candidate
            .execute("UPDATE inagle_fixture SET value = 2 WHERE id = 'b'", [])
            .unwrap();
        candidate
            .execute("DELETE FROM inagle_fixture WHERE rowid = 1", [])
            .unwrap();
        assert!(verify_mirror_preserved(&source, &candidate).is_err());
    }

    #[test]
    fn preserves_guid_variants_relationships_and_unknown_fields_idempotently() {
        let mut db = Connection::open_in_memory().unwrap();
        let docs = BTreeMap::from([(
            "masterdata-schema".into(),
            serde_json::json!({"Example":{"columns":[{"kind":"ref","ref":"Other"}]}}),
        )]);
        let first = import(&mut db, Cursor::new(INPUT), &docs, &provenance()).unwrap();
        assert_eq!(
            import(&mut db, Cursor::new(INPUT), &docs, &provenance()).unwrap(),
            first
        );
        assert_eq!(
            (
                first.indexed_rows,
                first.distinct_asset_guids,
                first.dependency_edges
            ),
            (3, 1, 2)
        );
        assert_eq!(
            document(&db, "masterdata-schema").unwrap(),
            docs.get("masterdata-schema").cloned()
        );
        let page = search(
            &db,
            &CatalogQuery {
                guid: Some("same".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(page.total, 2);
        let payload: String = db
            .query_row(
                "SELECT payload FROM nie_cross_locations WHERE ordinal = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let stored: Location = serde_json::from_str(&payload).unwrap();
        assert_eq!(stored.extra["alt_keys"], serde_json::json!(["remote"]));
        assert!(
            serde_json::to_value(&page.assets[0])
                .unwrap()
                .get("alt_keys")
                .is_none()
        );
        assert!(!first.masterdata_records_available);
    }

    #[test]
    fn malformed_or_incomplete_import_rolls_back_previous_catalogue() {
        let mut db = Connection::open_in_memory().unwrap();
        let original =
            import(&mut db, Cursor::new(INPUT), &BTreeMap::new(), &provenance()).unwrap();
        for input in [
            format!("{INPUT}invalid\n"),
            String::new(),
            INPUT.replace("\"n_deps\":1", "\"n_deps\":2"),
        ] {
            assert!(import(&mut db, Cursor::new(input), &BTreeMap::new(), &provenance()).is_err());
            assert_eq!(report(&db).unwrap(), original);
            assert_eq!(search(&db, &CatalogQuery::default()).unwrap().total, 2);
        }
        let docs = BTreeMap::from([(
            "catalog-stats".into(),
            serde_json::json!({"totals":{"loadable_objects":99}}),
        )]);
        assert!(import(&mut db, Cursor::new(INPUT), &docs, &provenance()).is_err());
        assert_eq!(report(&db).unwrap(), original);
    }

    #[test]
    fn public_schema_and_stats_preserve_contract_without_extraction_paths() {
        let mut db = Connection::open_in_memory().unwrap();
        let docs = BTreeMap::from([
            (
                "masterdata-schema".into(),
                serde_json::json!({"ExampleMaster": {
                    "fullName":"Soccer.Shared.ExampleMaster", "file":"Example.tsv", "extends":null,
                    "columns":[{"kind":"ref","ref":"Other"},{"kind":"enum","type":"Element"}]
                }}),
            ),
            (
                "catalog-stats".into(),
                serde_json::json!({
                    "source":"/private/extraction", "generated":"2026-06-09T23:51:00Z", "totals":{"catalog_rows":10},
                    "by_asset_type":{}, "by_row_type":{}, "by_bundle_top60":[], "localization":{}, "audio_cri":{}, "skit_timeline":{}
                }),
            ),
        ]);
        import(&mut db, Cursor::new(INPUT), &docs, &provenance()).unwrap();
        let tables = tables(&db, Some("EXAMPLE")).unwrap();
        assert_eq!(tables.len(), 1);
        assert_eq!(tables[0].slug, "ExampleMaster");
        assert_eq!(tables[0].ref_count, 1);
        assert_eq!(tables[0].enum_count, 1);
        let json = serde_json::to_value(&tables[0]).unwrap();
        assert_eq!(json["columnCount"], 2);
        let json = serde_json::to_value(stats(&db).unwrap()).unwrap();
        assert!(json.get("source").is_none());
        assert_eq!(json["totals"]["catalog_rows"], 10);
    }

    #[test]
    fn search_preserves_literal_filters_and_bounds() {
        let mut db = Connection::open_in_memory().unwrap();
        import(&mut db, Cursor::new(INPUT), &BTreeMap::new(), &provenance()).unwrap();
        let page = search(
            &db,
            &CatalogQuery {
                q: Some("_%".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(page.total, 0);
        let page = search(
            &db,
            &CatalogQuery {
                q: Some("B%".into()),
                limit: Some(1),
                offset: Some(1),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(page.total, 2);
        assert_eq!(page.assets.len(), 1);
        assert_eq!(page.assets[0].asset_type, "Texture2D");
        assert!(
            search(
                &db,
                &CatalogQuery {
                    kind: Some("unknown".into()),
                    ..Default::default()
                }
            )
            .is_err()
        );
    }
}
