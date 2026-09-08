//! Character-model catalogue and identity queries over the read-only wiki mirror.

use rusqlite::Connection;
use serde::Serialize;

/// Mirror table that carries character model codes.
pub const CHARACTER_TABLE: &str = "inagle_characters";

const CHARACTER_SOURCE: &str = "SELECT CASE WHEN instr(internal_code, '_') > 0 \
     THEN substr(internal_code, 1, instr(internal_code, '_') - 1) \
     ELSE internal_code END AS code, \
     coalesce(nullif(name_fr, ''), nullif(name_en, ''), nullif(name_ja, '')) AS name \
     FROM \"inagle_characters\" \
     WHERE internal_code IS NOT NULL AND internal_code <> '' AND internal_code LIKE 'c%'";

/// One unique assembly code and its stable preferred display name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CharacterModelEntry {
    pub code: String,
    pub name: Option<String>,
}

/// A bounded page of unique character-model assembly codes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CharacterModelPage {
    pub entries: Vec<CharacterModelEntry>,
    pub total: usize,
}

/// Stable mirror identity for one character-model assembly code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CharacterModelIdentity {
    pub name_fr: Option<String>,
    pub name_en: Option<String>,
    pub name_ja: Option<String>,
    pub element: Option<String>,
    pub position: Option<String>,
    pub series: Option<String>,
    pub variants: usize,
}

/// Count distinct character-model assembly codes.
pub fn count_character_models(connection: &Connection) -> rusqlite::Result<usize> {
    let count: i64 = connection.query_row(
        &format!("SELECT count(DISTINCT s.code) FROM ({CHARACTER_SOURCE}) s"),
        [],
        |row| row.get(0),
    )?;
    Ok(usize::try_from(count).unwrap_or(0))
}

/// Query a page after variant deduplication and stable name selection.
pub fn character_model_page(
    connection: &Connection,
    page_size: u32,
    offset: usize,
    search: Option<&str>,
) -> rusqlite::Result<CharacterModelPage> {
    let pattern = search.map_or_else(|| "%".to_owned(), |value| format!("%{value}%"));
    let filter = "WHERE lower(s.code) LIKE ?1 OR lower(coalesce(s.name, '')) LIKE ?1";
    let total: i64 = connection.query_row(
        &format!(
            "SELECT count(*) FROM (SELECT s.code FROM ({CHARACTER_SOURCE}) s {filter} GROUP BY s.code)"
        ),
        rusqlite::params![&pattern],
        |row| row.get(0),
    )?;
    let mut statement = connection.prepare(&format!(
        "SELECT s.code, min(s.name) FROM ({CHARACTER_SOURCE}) s {filter} \
         GROUP BY s.code ORDER BY s.code LIMIT ?2 OFFSET ?3"
    ))?;
    let entries = statement
        .query_map(
            rusqlite::params![
                &pattern,
                i64::from(page_size),
                i64::try_from(offset).unwrap_or(i64::MAX)
            ],
            |row| {
                Ok(CharacterModelEntry {
                    code: row.get(0)?,
                    name: row.get(1)?,
                })
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(CharacterModelPage {
        entries,
        total: usize::try_from(total).unwrap_or(0),
    })
}

/// Resolve one exact assembly identity and its underscore-delimited variants.
pub fn character_model_identity(
    connection: &Connection,
    code: &str,
) -> rusqlite::Result<Option<CharacterModelIdentity>> {
    let mut statement = connection.prepare(&format!(
        "SELECT min(name_fr), min(name_en), min(name_ja), min(element), min(position), \
         min(series), count(*) FROM \"{CHARACTER_TABLE}\" \
         WHERE internal_code = ?1 OR internal_code LIKE ?1 || '\\_%' ESCAPE '\\'"
    ))?;
    let (identity, variants) = statement.query_row(rusqlite::params![code], |row| {
        let variants: i64 = row.get(6)?;
        Ok((
            CharacterModelIdentity {
                name_fr: row.get(0)?,
                name_en: row.get(1)?,
                name_ja: row.get(2)?,
                element: row.get(3)?,
                position: row.get(4)?,
                series: row.get(5)?,
                variants: usize::try_from(variants).unwrap_or(0),
            },
            variants,
        ))
    })?;
    Ok((variants > 0).then_some(identity))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(
            "CREATE TABLE inagle_characters(
                internal_code TEXT, name_fr TEXT, name_en TEXT, name_ja TEXT,
                element TEXT, position TEXT, series TEXT
             );
             INSERT INTO inagle_characters VALUES ('c010_5000', 'Zed', 'Zed', NULL, 'fire', 'fw', 'one');
             INSERT INTO inagle_characters VALUES ('c010', 'Alpha', 'Alpha', NULL, 'fire', 'fw', 'one');
             INSERT INTO inagle_characters VALUES ('c020', '', 'Beta', NULL, 'wood', 'mf', 'two');
             INSERT INTO inagle_characters VALUES ('c0100_1000', 'Neighbour', NULL, NULL, NULL, NULL, NULL);
             INSERT INTO inagle_characters VALUES ('n001', 'Not a character model', NULL, NULL, NULL, NULL, NULL);"
        ).unwrap();
        connection
    }

    #[test]
    fn variants_are_deduplicated_with_a_stable_name() {
        let page = character_model_page(&database(), 50, 0, None).unwrap();
        assert_eq!(page.total, 3);
        assert_eq!(page.entries[0].code, "c010");
        assert_eq!(page.entries[0].name.as_deref(), Some("Alpha"));
    }

    #[test]
    fn preferred_name_falls_back_in_language_order() {
        let page = character_model_page(&database(), 50, 0, Some("beta")).unwrap();
        assert_eq!(page.entries.len(), 1);
        assert_eq!(page.entries[0].name.as_deref(), Some("Beta"));
    }

    #[test]
    fn underscore_is_literal_when_resolving_identity() {
        let identity = character_model_identity(&database(), "c010")
            .unwrap()
            .unwrap();
        assert_eq!(identity.variants, 2);
        assert_eq!(identity.name_fr.as_deref(), Some("Alpha"));
        assert!(
            character_model_identity(&database(), "c01")
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn serialized_fields_are_adapter_compatible() {
        let identity = character_model_identity(&database(), "c010")
            .unwrap()
            .unwrap();
        let value = serde_json::to_value(identity).unwrap();
        assert_eq!(value["name_fr"], "Alpha");
        assert_eq!(value["variants"], 2);
        assert!(value.get("internal_code").is_none());
    }
}
