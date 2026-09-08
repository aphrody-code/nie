//! Exact native resource-code joins against localized mirror names.
//! No filename-prefix inference: callers retain their original VFS paths separately.
use rusqlite::{Connection, params_from_iter};
use serde::Serialize;
use std::collections::BTreeSet;

/// All entity identities are retained when several variants share a resource code.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedName {
    pub code: String,
    pub kind: String,
    pub id: String,
    pub name: String,
    /// None means the exact entity ID is displayed because no name is available.
    pub locale_used: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamePage {
    pub locale: String,
    pub records: Vec<ResolvedName>,
    pub unresolved: Vec<String>,
    /// Missing mirror tables are explicit rather than silently reported as complete coverage.
    pub unavailable_kinds: Vec<String>,
}

pub fn validate(codes: &[String], locale: &str) -> Result<(), &'static str> {
    if !matches!(
        locale,
        "fr" | "en" | "ja" | "de" | "es" | "it" | "pt" | "zh_hans" | "zh_hant"
    ) {
        return Err("Unsupported game locale");
    }
    if codes.len() > 200
        || codes.iter().any(|code| {
            code.is_empty()
                || code.len() > 128
                || code
                    .chars()
                    .any(|c| c.is_control() || matches!(c, '/' | '\\' | ','))
        })
    {
        return Err("Require at most 200 exact resource codes of 1..128 bytes");
    }
    Ok(())
}

// These columns are declared in packages/db/src/types.gen.ts; no stadium name/code
// projection exists there. Asset codes for keshins/souls are explicit DB relations.
const SOURCES: &[(&str, &str, &str)] = &[
    ("chara", "inagle_characters", "internal_code"),
    ("skill", "inagle_skills", "internal_code"),
    ("item", "inagle_items", "internal_code"),
    ("team", "inagle_teams", "internal_code"),
    ("keshin", "inagle_keshins", "asset_code"),
    ("soul", "inagle_souls", "asset_code"),
];

/// Match the UI fallback policy: requested language, then English, French, Japanese, then ID.
fn display_name<'a>(
    locale: &str,
    id: &'a str,
    names: &'a [Option<String>; 3],
) -> (&'a str, Option<&'static str>) {
    let requested = match locale {
        "fr" => 0,
        "en" => 1,
        "ja" => 2,
        _ => 1,
    };
    for index in [requested, 1, 0, 2] {
        if let Some(name) = names[index]
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
        {
            return (name, Some(["fr", "en", "ja"][index]));
        }
    }
    (id, None)
}

/// Resolve a bounded batch without collapsing alternate entity IDs or inventing associations.
pub fn resolve(conn: &Connection, codes: &[String], locale: &str) -> anyhow::Result<NamePage> {
    validate(codes, locale).map_err(anyhow::Error::msg)?;
    let mut seen = BTreeSet::new();
    let codes: Vec<&str> = codes
        .iter()
        .map(String::as_str)
        .filter(|code| seen.insert(*code))
        .collect();
    let mut page = NamePage {
        locale: locale.into(),
        records: Vec::new(),
        unresolved: Vec::new(),
        unavailable_kinds: Vec::new(),
    };
    if codes.is_empty() {
        return Ok(page);
    }
    let placeholders = vec!["?"; codes.len()].join(",");
    let snapshot = conn.unchecked_transaction()?;
    for &(kind, table, column) in SOURCES {
        let exists: bool = snapshot.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name = ?1 AND type IN ('table', 'view'))", [table], |row| row.get(0))?;
        if !exists {
            page.unavailable_kinds.push(kind.into());
            continue;
        }
        // Mirrors from older imports may contain the table without its native code
        // or all translation columns. Diagnose that source, while preserving other
        // families. Introspection and query failures still propagate as real errors.
        let columns = {
            let mut statement = snapshot.prepare("SELECT name FROM pragma_table_info(?1)")?;
            statement
                .query_map([table], |row| row.get::<_, String>(0))?
                .collect::<Result<BTreeSet<_>, _>>()?
        };
        if [column, "id", "name_fr", "name_en", "name_ja"]
            .iter()
            .any(|required| !columns.contains(*required))
        {
            page.unavailable_kinds.push(kind.into());
            continue;
        }
        let sql = format!(
            "SELECT {column}, id, name_fr, name_en, name_ja FROM {table} WHERE {column} IN ({placeholders}) ORDER BY {column}, id LIMIT 10001"
        );
        let mut statement = snapshot.prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(codes.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                [
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ],
            ))
        })?;
        for row in rows {
            let (code, id, names) = row?;
            if page.records.len() >= 10_000 {
                anyhow::bail!("Resource name batch exceeds 10000 matching identities");
            }
            let (name, locale_used) = display_name(locale, &id, &names);
            page.records.push(ResolvedName {
                code,
                kind: kind.into(),
                name: name.into(),
                locale_used: locale_used.map(str::to_owned),
                id,
            });
        }
    }
    snapshot.commit()?;
    let matched: BTreeSet<&str> = page.records.iter().map(|row| row.code.as_str()).collect();
    page.unresolved = codes
        .into_iter()
        .filter(|code| !matched.contains(code))
        .map(str::to_owned)
        .collect();
    Ok(page)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE inagle_characters (internal_code TEXT, id TEXT, name_fr TEXT, name_en TEXT, name_ja TEXT);
            INSERT INTO inagle_characters VALUES
            ('c01000100', 'native-id-a', 'Marc', 'Mark', '円堂'),
            ('c01000100', 'native-id-b', ' ', 'Variant', NULL),
            ('unnamed', 'native-id-c', NULL, '', ' ');
            CREATE TABLE inagle_keshins (asset_code TEXT, id TEXT, name_fr TEXT, name_en TEXT, name_ja TEXT);
            INSERT INTO inagle_keshins VALUES ('keshin-exact', 'aura-id', 'Esprit', 'Spirit', '化身');").unwrap();
        conn
    }

    #[test]
    fn retains_variant_ids_requested_language_and_missing_kinds() {
        let page = resolve(
            &fixture(),
            &["c01000100".into(), "c01000100".into(), "unknown".into()],
            "ja",
        )
        .unwrap();
        assert_eq!(page.locale, "ja");
        assert_eq!(page.records.len(), 2);
        assert_eq!(page.records[0].id, "native-id-a");
        assert_eq!(page.records[0].name, "円堂");
        assert_eq!(page.records[0].locale_used.as_deref(), Some("ja"));
        assert_eq!(page.records[1].id, "native-id-b");
        assert_eq!(page.records[1].name, "Variant");
        assert_eq!(page.records[1].locale_used.as_deref(), Some("en"));
        assert_eq!(page.unresolved, ["unknown"]);
        assert_eq!(page.unavailable_kinds, ["skill", "item", "team", "soul"]);
    }

    #[test]
    fn exact_asset_code_links_and_absent_translations_remain_explicit() {
        let page = resolve(
            &fixture(),
            &["keshin-exact".into(), "keshin".into(), "unnamed".into()],
            "de",
        )
        .unwrap();
        assert_eq!(page.locale, "de");
        assert_eq!(page.records.len(), 2);
        let aura = page
            .records
            .iter()
            .find(|row| row.kind == "keshin")
            .unwrap();
        assert_eq!(aura.code, "keshin-exact");
        assert_eq!(aura.id, "aura-id");
        assert_eq!(aura.name, "Spirit");
        assert_eq!(aura.locale_used.as_deref(), Some("en"));
        let unnamed = page
            .records
            .iter()
            .find(|row| row.code == "unnamed")
            .unwrap();
        assert_eq!(unnamed.name, "native-id-c");
        assert_eq!(unnamed.locale_used, None);
        assert_eq!(page.unresolved, ["keshin"]);
    }

    #[test]
    fn incomplete_mirror_sources_do_not_block_other_families() {
        let conn = fixture();
        conn.execute_batch(
            "ALTER TABLE inagle_keshins DROP COLUMN asset_code;
            CREATE TABLE inagle_skills (internal_code TEXT, id TEXT, name_fr TEXT, name_en TEXT);",
        )
        .unwrap();
        let page = resolve(&conn, &["c01000100".into(), "keshin-exact".into()], "fr").unwrap();
        assert_eq!(page.records.len(), 2);
        assert!(page.records.iter().all(|record| record.kind == "chara"));
        assert_eq!(page.records[0].name, "Marc");
        assert_eq!(page.unresolved, ["keshin-exact"]);
        assert_eq!(
            page.unavailable_kinds,
            ["skill", "item", "team", "keshin", "soul"]
        );
    }

    #[test]
    fn malformed_source_values_remain_errors() {
        let conn = fixture();
        conn.execute(
            "UPDATE inagle_characters SET name_fr = x'FF' WHERE id = 'native-id-a'",
            [],
        )
        .unwrap();
        assert!(resolve(&conn, &["c01000100".into()], "fr").is_err());
    }

    #[test]
    fn validates_batch_and_never_interpolates_user_codes_as_sql() {
        let conn = fixture();
        let injection = "x') OR 1=1 --".to_string();
        let page = resolve(&conn, std::slice::from_ref(&injection), "en").unwrap();
        assert!(page.records.is_empty());
        assert_eq!(page.unresolved, [injection]);
        for code in ["", "data/c01000100", "a\\b", "a,b", "x\0y"] {
            assert!(validate(&[code.into()], "fr").is_err());
        }
        assert!(validate(&vec!["a".into(); 201], "fr").is_err());
        assert!(validate(&["a".repeat(129)], "fr").is_err());
        assert!(validate(&["a".into()], "invalid").is_err());
        assert!(resolve(&conn, &[], "fr").unwrap().records.is_empty());
    }
}
