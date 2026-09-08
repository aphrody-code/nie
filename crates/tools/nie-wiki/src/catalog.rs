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
pub const CHARACTER_FACETS: [&str; 4] = ["element", "position", "rarity", "series"];

/// One row from the stable character catalogue projection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CharacterRecord {
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
}

/// Owned request accepted by [`query_character_catalog`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CharacterCatalogRequest {
    pub query: Option<String>,
    pub element: Option<String>,
    pub position: Option<String>,
    pub rarity: Option<String>,
    pub series: Option<String>,
    pub element_in: Option<String>,
    pub position_in: Option<String>,
    pub rarity_in: Option<String>,
    pub series_in: Option<String>,
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
        let pattern = format!(
            "%{}%",
            query
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        );
        clauses.push(FilterClause {
            column: None,
            sql: "(name_fr LIKE ? ESCAPE '\\' OR name_en LIKE ? ESCAPE '\\' \
                  OR name_ja LIKE ? ESCAPE '\\' OR base_slug LIKE ? ESCAPE '\\' \
                  OR internal_code LIKE ? ESCAPE '\\')"
                .to_owned(),
            params: vec![pattern; 5],
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
                sql: format!("\"{column}\" = ?"),
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
    let (clauses, mut filters, direction) = build_clauses(request);
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
        let sql = format!(
            "SELECT \"{column}\", count(*) FROM \"{CHARACTER_TABLE}\"{facet_where} \
             GROUP BY \"{column}\" ORDER BY count(*) DESC, \"{column}\""
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

    let default_order =
        "CASE WHEN zukan_order IS NULL THEN 1 ELSE 0 END, zukan_order, internal_code".to_owned();
    let requested_sort = request.sort.as_deref().map(str::trim).unwrap_or_default();
    let selected = CHARACTER_SORTS
        .iter()
        .find(|(public_name, _)| *public_name == requested_sort);
    let order_sql = match selected {
        Some((public_name, column)) => {
            filters.sort = (*public_name).to_owned();
            format!(
                "CASE WHEN \"{column}\" IS NULL THEN 1 ELSE 0 END, \"{column}\" {direction}, internal_code"
            )
        }
        None => {
            filters.sort = "zukan".to_owned();
            default_order
        }
    };

    let sql = format!(
        "SELECT {} FROM \"{CHARACTER_TABLE}\"{where_sql} ORDER BY {order_sql} LIMIT ? OFFSET ?",
        CHARACTER_COLUMNS
            .map(|column| format!("\"{column}\""))
            .join(", ")
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
        assert!(
            CHARACTER_FACETS
                .iter()
                .all(|column| CHARACTER_COLUMNS.contains(column))
        );
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
