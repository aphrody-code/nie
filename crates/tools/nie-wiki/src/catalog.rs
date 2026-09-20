//! Reusable, bounded catalogue queries for HTTP and command-line bindings.

use std::collections::BTreeMap;

use rusqlite::{Connection, ToSql};

/// Mirror table that owns character catalogue rows.
pub const CHARACTER_TABLE: &str = "inagle_characters";

/// Explicit character projection. Keeping this list here prevents bindings from drifting.
pub const CHARACTER_COLUMNS: [&str; 12] = [
    "internal_code",
    "chara_id",
    "base_slug",
    "name_fr",
    "name_en",
    "name_ja",
    "element",
    "position",
    "rarity",
    "series",
    "model_id",
    "zukan_order",
];

/// Public sort token to mirror-column mapping.
pub const CHARACTER_SORTS: [(&str, &str); 6] = [
    ("zukan", "zukan_order"),
    ("code", "internal_code"),
    ("nom_fr", "name_fr"),
    ("nom_en", "name_en"),
    ("nom_ja", "name_ja"),
    ("rarete", "rarity"),
];

/// Character columns exposed as counted facets.
pub const CHARACTER_FACETS: [&str; 9] = [
    "element",
    "position",
    "rarity",
    "series",
    "gender",
    "playstyle",
    "age_group",
    "school_year",
    "team_id",
];

/// The mirror stores every scraped value as `TEXT`, including `zukan_order`, and represents
/// missing values with the imported dump sentinel `\\N` (two literal backslashes followed by
/// `N`). Normalize it at the query boundary so
/// callers receive the declared integer type and ordering is numeric (`2` before `10`).
const CHARACTER_ZUKAN_ORDER_SQL: &str = "CAST(NULLIF(\"zukan_order\", '\\\\N') AS INTEGER)";

fn character_text_sql(column: &str) -> String {
    format!("NULLIF(\"{column}\", '\\\\N')")
}

/// One row from the stable character catalogue projection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CharacterRecord {
    pub id: Option<String>,
    pub internal_code: Option<String>,
    pub chara_id: Option<String>,
    pub base_slug: Option<String>,
    pub name_fr: Option<String>,
    pub name_en: Option<String>,
    pub name_ja: Option<String>,
    pub element: Option<String>,
    pub position: Option<String>,
    pub rarity: Option<String>,
    pub series: Option<String>,
    pub model_id: Option<String>,
    pub zukan_order: Option<i64>,
    pub gender: Option<String>,
    pub playstyle: Option<String>,
    pub age_group: Option<String>,
    pub school_year: Option<String>,
    pub team_id: Option<String>,
    pub playable: bool,
    pub incomplete: bool,
}

/// Owned request accepted by [`query_character_catalog`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CharacterCatalogRequest {
    /// Historical Azalee player selection, used only by the legacy DTO adapter.
    pub legacy_selection: bool,
    pub query: Option<String>,
    pub element: Option<String>,
    pub position: Option<String>,
    pub rarity: Option<String>,
    pub series: Option<String>,
    pub element_in: Option<String>,
    pub position_in: Option<String>,
    pub rarity_in: Option<String>,
    pub series_in: Option<String>,
    /// Additional whitelisted native facets, including multi-select values.
    pub attributes: BTreeMap<String, Vec<String>>,
    pub playable: Option<bool>,
    pub incomplete: Option<bool>,
    pub sort: Option<String>,
    pub order: Option<String>,
    pub limit: u32,
    pub offset: usize,
}

/// Filters actually applied to a catalogue query.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AppliedCharacterFilters {
    pub query: Option<String>,
    pub element: Option<String>,
    pub position: Option<String>,
    pub rarity: Option<String>,
    pub series: Option<String>,
    pub sort: String,
    pub order: &'static str,
    pub lists: BTreeMap<String, Vec<String>>,
    pub attributes: BTreeMap<String, Vec<String>>,
    pub playable: Option<bool>,
    pub incomplete: Option<bool>,
}

fn optional_columns(
    connection: &Connection,
) -> rusqlite::Result<std::collections::BTreeSet<String>> {
    connection
        .prepare("PRAGMA table_info(inagle_characters)")?
        .query_map([], |row| row.get(1))?
        .collect()
}

fn column_expression(column: &str, available: &std::collections::BTreeSet<String>) -> String {
    if column == "playstyle" {
        if available.contains("sheet_data") {
            return "CASE WHEN json_valid(sheet_data) THEN json_extract(sheet_data, '$.playstyle') END".into();
        }
        return "NULL".into();
    }
    if available.contains(column) {
        character_text_sql(column)
    } else {
        "NULL".into()
    }
}

fn playable_expression(available: &std::collections::BTreeSet<String>) -> String {
    format!(
        "COALESCE(lower({}) IN ('t', 'true', '1'), 0)",
        column_expression("is_controllable", available)
    )
}

fn incomplete_expression(available: &std::collections::BTreeSet<String>) -> String {
    format!(
        "NOT ({} OR {} IS NOT NULL OR {} IS NOT NULL)",
        playable_expression(available),
        column_expression("sheet_data", available),
        column_expression("zukan_order", available)
    )
}

/// One counted value from a character facet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CharacterFacetCount {
    pub value: String,
    pub total: usize,
}

/// Complete result of a bounded character catalogue query.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CharacterCatalogPage {
    pub records: Vec<CharacterRecord>,
    pub total: usize,
    pub filters: AppliedCharacterFilters,
    pub facets: BTreeMap<String, Vec<CharacterFacetCount>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FilterClause {
    column: Option<&'static str>,
    sql: String,
    params: Vec<String>,
}

fn without_column(clauses: &[FilterClause], excluded: Option<&str>) -> (String, Vec<String>) {
    let retained: Vec<&FilterClause> = clauses
        .iter()
        .filter(|clause| clause.column.is_none() || clause.column != excluded)
        .collect();
    let sql = if retained.is_empty() {
        String::new()
    } else {
        format!(
            " WHERE {}",
            retained
                .iter()
                .map(|clause| clause.sql.as_str())
                .collect::<Vec<_>>()
                .join(" AND ")
        )
    };
    let params = retained
        .iter()
        .flat_map(|clause| clause.params.iter().cloned())
        .collect();
    (sql, params)
}

fn list_values(raw: Option<&String>) -> Vec<String> {
    let mut values = Vec::new();
    for value in raw
        .map(String::as_str)
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if !values.iter().any(|known| known == value) {
            values.push(value.to_owned());
        }
    }
    values
}

fn build_clauses(
    request: &CharacterCatalogRequest,
) -> (Vec<FilterClause>, AppliedCharacterFilters, &'static str) {
    let mut clauses = Vec::new();
    let mut applied = AppliedCharacterFilters::default();

    if let Some(query) = request
        .query
        .as_deref()
        .map(str::trim)
        .filter(|q| !q.is_empty())
    {
        let pattern = if request.legacy_selection {
            format!("%{query}%")
        } else {
            format!(
                "%{}%",
                query
                    .replace('\\', "\\\\")
                    .replace('%', "\\%")
                    .replace('_', "\\_")
            )
        };
        clauses.push(FilterClause {
            column: None,
            sql: if request.legacy_selection {
                "(name_fr LIKE ? ESCAPE '\\' OR name_en LIKE ? ESCAPE '\\')".to_owned()
            } else {
                "(name_fr LIKE ? ESCAPE '\\' OR name_en LIKE ? ESCAPE '\\' \
                  OR name_ja LIKE ? ESCAPE '\\' OR base_slug LIKE ? ESCAPE '\\' \
                  OR internal_code LIKE ? ESCAPE '\\')"
                    .to_owned()
            },
            params: vec![pattern; if request.legacy_selection { 2 } else { 5 }],
        });
        applied.query = Some(query.to_owned());
    }

    for (column, value, list) in [
        ("element", &request.element, &request.element_in),
        ("position", &request.position, &request.position_in),
        ("rarity", &request.rarity, &request.rarity_in),
        ("series", &request.series, &request.series_in),
    ] {
        if let Some(value) = value
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            clauses.push(FilterClause {
                column: Some(column),
                sql: format!(
                    "\"{}\" = ?",
                    if request.legacy_selection && column == "rarity" {
                        "rarity_label"
                    } else {
                        column
                    }
                ),
                params: vec![value.to_owned()],
            });
            match column {
                "element" => applied.element = Some(value.to_owned()),
                "position" => applied.position = Some(value.to_owned()),
                "rarity" => applied.rarity = Some(value.to_owned()),
                _ => applied.series = Some(value.to_owned()),
            }
        }

        let values = list_values(list.as_ref());
        if !values.is_empty() {
            let placeholders = std::iter::repeat_n("?", values.len())
                .collect::<Vec<_>>()
                .join(", ");
            clauses.push(FilterClause {
                column: Some(column),
                sql: format!("\"{column}\" IN ({placeholders})"),
                params: values.clone(),
            });
            applied.lists.insert(format!("{column}__in"), values);
        }
    }

    let direction = match request.order.as_deref().map(str::trim) {
        Some("desc" | "decroissant" | "descendant") => "DESC",
        _ => "ASC",
    };
    applied.order = if direction == "DESC" { "desc" } else { "asc" };
    (clauses, applied, direction)
}

/// Query the character catalogue with stable filtering, faceting, ordering and pagination.
pub fn query_character_catalog(
    connection: &Connection,
    request: &CharacterCatalogRequest,
) -> rusqlite::Result<CharacterCatalogPage> {
    let available = optional_columns(connection)?;
    let (mut clauses, mut filters, direction) = build_clauses(request);
    if request.legacy_selection {
        clauses.push(FilterClause { column: None,
            sql: format!("internal_code NOT LIKE '%_5000' AND internal_code NOT LIKE 'c05028%' AND internal_code NOT LIKE 'an%' AND name_en NOT LIKE '%×%' AND {} IS NOT NULL AND name_en != ''", character_text_sql("name_en")), params: Vec::new() });
        if !matches!(request.rarity.as_deref(), Some("Héros" | "BASARA")) {
            clauses.push(FilterClause {
                column: None,
                sql: "lower(is_primary) IN ('1','t','true')".into(),
                params: Vec::new(),
            });
        }
    }
    for (column, values) in &request.attributes {
        let Some(&column) = CHARACTER_FACETS.iter().find(|&&known| known == column) else {
            continue;
        };
        let mut values: Vec<String> = values
            .iter()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .collect();
        values.sort();
        values.dedup();
        if values.is_empty() {
            continue;
        }
        filters.attributes.insert(column.to_owned(), values.clone());
        if column == "playstyle" && values.iter().any(|value| value == "Breach") {
            values.push("Freedom".into());
        }
        if column == "gender" {
            for value in &mut values {
                *value = match value.as_str() {
                    "1" => "M".into(),
                    "2" => "F".into(),
                    _ => value.clone(),
                };
            }
        }
        let placeholders = std::iter::repeat_n("?", values.len())
            .collect::<Vec<_>>()
            .join(", ");
        let mut expression = format!(
            "{} IN ({placeholders})",
            column_expression(column, &available)
        );
        if column == "team_id" && available.contains("teams") {
            expression = format!(
                "({expression} OR EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(teams) THEN teams ELSE '[]' END) AS membership WHERE json_extract(membership.value, '$.id') IN ({placeholders})))"
            );
            values.extend(values.clone());
        }
        clauses.push(FilterClause {
            column: Some(column),
            sql: expression,
            params: values,
        });
    }
    for (name, value, expression) in [
        (
            "playable",
            request.playable,
            playable_expression(&available),
        ),
        (
            "incomplete",
            request.incomplete,
            incomplete_expression(&available),
        ),
    ] {
        if let Some(value) = value {
            clauses.push(FilterClause {
                column: Some(name),
                sql: format!("({expression}) = {}", u8::from(value)),
                params: Vec::new(),
            });
        }
    }
    filters.playable = request.playable;
    filters.incomplete = request.incomplete;
    let (where_sql, params) = without_column(&clauses, None);
    let bound: Vec<&dyn ToSql> = params.iter().map(|value| value as &dyn ToSql).collect();

    let total: i64 = connection.query_row(
        &format!("SELECT count(*) FROM \"{CHARACTER_TABLE}\"{where_sql}"),
        bound.as_slice(),
        |row| row.get(0),
    )?;

    let mut facets = BTreeMap::new();
    for column in CHARACTER_FACETS {
        let (facet_where, facet_params) = without_column(&clauses, Some(column));
        let facet_bound: Vec<&dyn ToSql> = facet_params
            .iter()
            .map(|value| value as &dyn ToSql)
            .collect();
        let expression = column_expression(column, &available);
        let sql = format!(
            "SELECT {expression}, count(*) FROM \"{CHARACTER_TABLE}\"{facet_where} \
             GROUP BY {expression} ORDER BY count(*) DESC, {expression}"
        );
        let mut statement = connection.prepare(&sql)?;
        let counts = statement
            .query_map(facet_bound.as_slice(), |row| {
                let value: Option<String> = row.get(0)?;
                let total: i64 = row.get(1)?;
                Ok(CharacterFacetCount {
                    value: value.unwrap_or_default(),
                    total: usize::try_from(total).unwrap_or(0),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .filter(|count| !count.value.is_empty())
            .collect();
        facets.insert(column.to_owned(), counts);
    }

    let default_order = format!(
        "CASE WHEN {CHARACTER_ZUKAN_ORDER_SQL} IS NULL THEN 1 ELSE 0 END, \
         {}, {}",
        if request.legacy_selection {
            character_text_sql("zukan_order")
        } else {
            CHARACTER_ZUKAN_ORDER_SQL.to_owned()
        },
        character_text_sql("internal_code")
    );
    let requested_sort = request.sort.as_deref().map(str::trim).unwrap_or_default();
    let selected = CHARACTER_SORTS
        .iter()
        .find(|(public_name, _)| *public_name == requested_sort);
    let order_sql = match selected {
        Some((public_name, column)) => {
            filters.sort = (*public_name).to_owned();
            let expression = if *column == "zukan_order" {
                CHARACTER_ZUKAN_ORDER_SQL.to_owned()
            } else {
                character_text_sql(column)
            };
            format!(
                "CASE WHEN {expression} IS NULL THEN 1 ELSE 0 END, {expression} {direction}, {}",
                character_text_sql("internal_code")
            )
        }
        None => {
            filters.sort = "zukan".to_owned();
            default_order
        }
    };

    let sql = format!(
        "SELECT {}, {}, {}, {}, {}, {}, {}, {}, {} FROM \"{CHARACTER_TABLE}\"{where_sql} ORDER BY {order_sql} LIMIT ? OFFSET ?",
        CHARACTER_COLUMNS
            .map(|column| if column == "zukan_order" {
                format!("{CHARACTER_ZUKAN_ORDER_SQL} AS \"zukan_order\"")
            } else {
                format!("{} AS \"{column}\"", character_text_sql(column))
            })
            .join(", "),
        column_expression("id", &available),
        column_expression("gender", &available),
        column_expression("playstyle", &available),
        column_expression("age_group", &available),
        column_expression("school_year", &available),
        column_expression("team_id", &available),
        playable_expression(&available),
        incomplete_expression(&available),
    );
    let limit = i64::from(request.limit);
    let offset = i64::try_from(request.offset).unwrap_or(i64::MAX);
    let mut paged_bound = bound;
    paged_bound.push(&limit);
    paged_bound.push(&offset);
    let mut statement = connection.prepare(&sql)?;
    let records = statement
        .query_map(paged_bound.as_slice(), |row| {
            Ok(CharacterRecord {
                id: row.get(12)?,
                internal_code: row.get(0)?,
                chara_id: row.get(1)?,
                base_slug: row.get(2)?,
                name_fr: row.get(3)?,
                name_en: row.get(4)?,
                name_ja: row.get(5)?,
                element: row.get(6)?,
                position: row.get(7)?,
                rarity: row.get(8)?,
                series: row.get(9)?,
                model_id: row.get(10)?,
                zukan_order: row.get(11)?,
                gender: row.get(13)?,
                playstyle: row.get(14)?,
                age_group: row.get(15)?,
                school_year: row.get(16)?,
                team_id: row.get(17)?,
                playable: row.get(18)?,
                incomplete: row.get(19)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(CharacterCatalogPage {
        records,
        total: usize::try_from(total).unwrap_or(0),
        filters,
        facets,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE inagle_characters (
                    internal_code TEXT, chara_id TEXT, base_slug TEXT,
                    name_fr TEXT, name_en TEXT, name_ja TEXT,
                    element TEXT, position TEXT, rarity TEXT, series TEXT,
                    model_id TEXT, zukan_order INTEGER
                );
                INSERT INTO inagle_characters VALUES
                    ('c3', NULL, 'three', '100%_a', NULL, NULL, 'Feu', 'Attaquant', 'SSR', 'GO', NULL, 3),
                    ('c1', NULL, 'one', 'Mark', NULL, NULL, 'Vent', 'Gardien', 'SR', 'OG', NULL, 1),
                    ('c2', NULL, 'two', 'Axel', NULL, NULL, 'Feu', 'Attaquant', 'SSR', 'OG', NULL, 2);",
            )
            .unwrap();
        connection
    }

    #[test]
    fn extended_facets_filter_before_pagination_and_normalize_dump_values() {
        let connection = fixture();
        connection.execute_batch("ALTER TABLE inagle_characters ADD COLUMN gender TEXT;
            ALTER TABLE inagle_characters ADD COLUMN sheet_data TEXT;
            ALTER TABLE inagle_characters ADD COLUMN age_group TEXT;
            ALTER TABLE inagle_characters ADD COLUMN school_year TEXT;
            ALTER TABLE inagle_characters ADD COLUMN team_id TEXT;
            ALTER TABLE inagle_characters ADD COLUMN is_controllable TEXT;
            UPDATE inagle_characters SET gender='M', sheet_data='{\"playstyle\":\"Freedom\"}',
                age_group='Middle School',school_year='Grade 7',team_id='t1',is_controllable='t' WHERE internal_code='c1';
            UPDATE inagle_characters SET gender='F',sheet_data='\\\\N',is_controllable='f' WHERE internal_code='c2';
            UPDATE inagle_characters SET zukan_order=NULL,sheet_data='\\\\N',is_controllable='f' WHERE internal_code='c3';").unwrap();
        let page = query_character_catalog(
            &connection,
            &CharacterCatalogRequest {
                attributes: BTreeMap::from([
                    ("gender".into(), vec!["1".into()]),
                    ("playstyle".into(), vec!["Breach".into()]),
                    ("age_group".into(), vec!["Middle School".into()]),
                    ("school_year".into(), vec!["Grade 7".into()]),
                    ("team_id".into(), vec!["t1".into()]),
                ]),
                playable: Some(true),
                incomplete: Some(false),
                limit: 1,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.records[0].internal_code.as_deref(), Some("c1"));
        assert_eq!(page.records[0].playstyle.as_deref(), Some("Freedom"));
        assert!(page.records[0].playable);
        assert!(!page.records[0].incomplete);
        assert_eq!(page.facets["playstyle"][0].value, "Freedom");
        let incomplete = query_character_catalog(
            &connection,
            &CharacterCatalogRequest {
                incomplete: Some(true),
                limit: 10,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(incomplete.total, 1);
        assert_eq!(incomplete.records[0].internal_code.as_deref(), Some("c3"));
    }

    #[test]
    fn query_is_literal_and_pagination_is_stable() {
        let page = query_character_catalog(
            &fixture(),
            &CharacterCatalogRequest {
                query: Some("100%_a".to_owned()),
                limit: 10,
                ..CharacterCatalogRequest::default()
            },
        )
        .unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.records[0].internal_code.as_deref(), Some("c3"));

        let page = query_character_catalog(
            &fixture(),
            &CharacterCatalogRequest {
                limit: 1,
                offset: 1,
                ..CharacterCatalogRequest::default()
            },
        )
        .unwrap();
        assert_eq!(page.total, 3);
        assert_eq!(page.records[0].internal_code.as_deref(), Some("c2"));
    }

    #[test]
    fn text_zukan_order_is_numeric_and_dump_null_is_absent() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE inagle_characters (
                    internal_code TEXT, chara_id TEXT, base_slug TEXT,
                    name_fr TEXT, name_en TEXT, name_ja TEXT,
                    element TEXT, position TEXT, rarity TEXT, series TEXT,
                    model_id TEXT, zukan_order TEXT
                );
                INSERT INTO inagle_characters VALUES
                    ('c10', NULL, NULL, 'Ten', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '10'),
                    ('c2', NULL, NULL, 'Two', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2'),
                    ('cx', NULL, NULL, 'Missing', '\\\\N', NULL, '\\\\N', NULL, NULL, NULL, NULL, '\\\\N');",
            )
            .unwrap();

        let page = query_character_catalog(
            &connection,
            &CharacterCatalogRequest {
                limit: 10,
                ..CharacterCatalogRequest::default()
            },
        )
        .unwrap();

        assert_eq!(
            page.records
                .iter()
                .map(|record| record.internal_code.as_deref())
                .collect::<Vec<_>>(),
            [Some("c2"), Some("c10"), Some("cx")]
        );
        assert_eq!(page.records[0].zukan_order, Some(2));
        assert_eq!(page.records[1].zukan_order, Some(10));
        assert_eq!(page.records[2].zukan_order, None);
        assert_eq!(page.records[2].name_en, None);
        assert!(
            page.facets["element"]
                .iter()
                .all(|facet| facet.value != "\\\\N")
        );
    }

    #[test]
    fn clauses_bind_every_client_value() {
        let request = CharacterCatalogRequest {
            query: Some("mark".to_owned()),
            element: Some("Feu".to_owned()),
            rarity: Some("SSR".to_owned()),
            order: Some("desc".to_owned()),
            ..CharacterCatalogRequest::default()
        };
        let (clauses, filters, direction) = build_clauses(&request);
        let (sql, params) = without_column(&clauses, None);
        assert_eq!(direction, "DESC");
        assert_eq!(filters.order, "desc");
        assert_eq!(filters.element.as_deref(), Some("Feu"));
        assert_eq!(params.len(), 7);
        assert_eq!(sql.matches('?').count(), 7);
        assert!(!sql.contains("mark") && !sql.contains("Feu"));
    }

    #[test]
    fn empty_filters_do_not_create_sql() {
        let (clauses, filters, direction) = build_clauses(&CharacterCatalogRequest::default());
        let (sql, params) = without_column(&clauses, None);
        assert!(sql.is_empty());
        assert!(params.is_empty());
        assert_eq!(direction, "ASC");
        assert!(filters.query.is_none());
    }

    #[test]
    fn multiple_choice_is_deduplicated_and_empty_choice_is_ignored() {
        let request = CharacterCatalogRequest {
            element_in: Some("Feu, Vent, Feu".to_owned()),
            series_in: Some(" , ".to_owned()),
            ..CharacterCatalogRequest::default()
        };
        let (clauses, filters, _) = build_clauses(&request);
        let (sql, params) = without_column(&clauses, None);
        assert_eq!(sql, " WHERE \"element\" IN (?, ?)");
        assert_eq!(params, ["Feu", "Vent"]);
        assert_eq!(filters.lists["element__in"], ["Feu", "Vent"]);
        assert!(!filters.lists.contains_key("series__in"));
        assert!(without_column(&clauses, Some("element")).0.is_empty());
    }

    #[test]
    fn public_sort_tokens_only_reference_projected_columns() {
        assert_eq!(CHARACTER_COLUMNS.len(), 12);
        assert!(!CHARACTER_COLUMNS.contains(&"*"));
        assert!(
            CHARACTER_SORTS
                .iter()
                .all(|(_, column)| CHARACTER_COLUMNS.contains(column))
        );
        assert_eq!(CHARACTER_FACETS.len(), 9);
    }

    #[test]
    fn own_facet_filter_is_removed_but_other_filters_remain() {
        let page = query_character_catalog(
            &fixture(),
            &CharacterCatalogRequest {
                element: Some("Feu".to_owned()),
                position: Some("Attaquant".to_owned()),
                element_in: Some("Feu, Vent,Feu".to_owned()),
                sort: Some("nom_fr".to_owned()),
                order: Some("descendant".to_owned()),
                limit: 10,
                ..CharacterCatalogRequest::default()
            },
        )
        .unwrap();

        assert_eq!(page.total, 2);
        assert_eq!(page.filters.order, "desc");
        assert_eq!(page.filters.sort, "nom_fr");
        assert_eq!(page.filters.lists["element__in"], ["Feu", "Vent"]);
        assert_eq!(
            page.facets["element"]
                .iter()
                .map(|count| (count.value.as_str(), count.total))
                .collect::<Vec<_>>(),
            [("Feu", 2)]
        );
        assert_eq!(page.records[0].name_fr.as_deref(), Some("Axel"));
    }
}
