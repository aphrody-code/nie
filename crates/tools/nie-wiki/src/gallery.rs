//! Gallery mirror enrichment for native resources, shared by host bindings.
//! Rows describe catalogue metadata; they do not prove a VFS file exists or is unlocked.

use rusqlite::{Connection, Row, params, types::Type, types::ValueRef};
use std::{
    collections::{HashMap, HashSet},
    sync::OnceLock,
};

use serde::{Deserialize, Serialize};

const EDITORIAL_MANIFEST: &str = include_str!("../../../../data/azalee/menu-gallery-manifest.json");
static PARSED_EDITORIAL_MANIFEST: OnceLock<Result<EditorialManifest, String>> = OnceLock::new();

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct GalleryRequest {
    /// `editorial` combines the five in-game selection buckets and the six measured menu sets.
    pub view: Option<String>,
    pub q: Option<String>,
    pub category: Option<String>,
    /// Exact image/thumbnail key, filename, or original gallery VFS path.
    pub resource: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryRecord {
    pub id: String,
    pub img_path: Option<String>,
    pub thumb_path: Option<String>,
    pub need_token_num: Option<i64>,
    pub flg_no: Option<i64>,
    pub category: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vfs_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GalleryCategory {
    pub id: String,
    pub count: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryPage {
    pub records: Vec<GalleryRecord>,
    /// Count of matching mirror rows only, never a count of mounted files.
    pub total: u64,
    pub limit: u32,
    pub offset: u32,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub categories: Vec<GalleryCategory>,
}

impl GalleryRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        if !(1..=200).contains(&self.limit.unwrap_or(48)) || self.offset.unwrap_or(0) > 1_000_000 {
            return Err("Require limit 1..200 and offset 0..1000000");
        }
        if self
            .q
            .as_ref()
            .is_some_and(|q| q.len() > 256 || q.chars().any(char::is_control))
        {
            return Err("Query must contain at most 256 bytes and no control characters");
        }
        if self.view.as_deref().is_some_and(|view| view != "editorial") {
            return Err("Unknown gallery view");
        }
        let editorial = self.view.as_deref() == Some("editorial");
        if self
            .category
            .as_ref()
            .is_some_and(|category| !is_category(category, editorial))
        {
            return Err("Unknown gallery metadata category");
        }
        if let Some(resource) = &self.resource {
            resource_key(resource)?;
        }
        Ok(())
    }
}

fn is_category(category: &str, editorial: bool) -> bool {
    matches!(
        category,
        "story" | "chronicle" | "special" | "kizuna" | "other"
    ) || (editorial
        && matches!(
            category,
            "gallery_img2" | "ev_pic" | "stadium" | "vsroute_map" | "hlp" | "telop_waza"
        ))
}

/// Strip only the documented original image/thumbnail directory and container extension.
/// Arbitrary directories are rejected so an unrelated file cannot inherit gallery metadata.
pub fn resource_key(resource: &str) -> Result<&str, &'static str> {
    if resource.is_empty() || resource.len() > 512 || resource.chars().any(char::is_control) {
        return Err("Invalid gallery resource");
    }
    let name = resource
        .strip_prefix("data/dx11/menu/220_img/gallery_img2/")
        .or_else(|| resource.strip_prefix("data/dx11/menu/220_img/gallery_thumb2/"))
        .unwrap_or(resource);
    let key = name.strip_suffix(".g4tx").unwrap_or(name);
    if key.is_empty() || key.contains(['/', '\\']) || key == "." || key == ".." {
        return Err("Require a gallery image key or original gallery VFS path");
    }
    Ok(key)
}

const CATEGORY: &str = "CASE
    WHEN img_path GLOB 'img_story_*' THEN 'story'
    WHEN img_path GLOB 'img_chronicle_*' THEN 'chronicle'
    WHEN img_path GLOB 'img_special_*' THEN 'special'
    WHEN img_path GLOB 'img_kizuna_*' THEN 'kizuna'
    ELSE 'other' END";

fn optional_i64(row: &Row<'_>, index: usize) -> rusqlite::Result<Option<i64>> {
    match row.get_ref(index)? {
        ValueRef::Null => Ok(None),
        ValueRef::Integer(value) => Ok(Some(value)),
        ValueRef::Text(raw) => {
            let text = std::str::from_utf8(raw).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(index, Type::Text, Box::new(error))
            })?;
            let text = text.trim();
            if text.is_empty() || text == "\\N" {
                return Ok(None);
            }
            text.parse::<i64>().map(Some).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(index, Type::Text, Box::new(error))
            })
        }
        value => Err(rusqlite::Error::InvalidColumnType(
            index,
            format!("column_{index}"),
            value.data_type(),
        )),
    }
}

/// Query the existing `inagle_gallery` mirror using literal search and exact resource joins.
pub fn query(conn: &Connection, request: &GalleryRequest) -> anyhow::Result<GalleryPage> {
    request.validate().map_err(anyhow::Error::msg)?;
    if request.view.as_deref() == Some("editorial") {
        return query_editorial(conn, request);
    }
    let limit = request.limit.unwrap_or(48);
    let offset = request.offset.unwrap_or(0);
    let resource = request
        .resource
        .as_deref()
        .map(resource_key)
        .transpose()
        .map_err(anyhow::Error::msg)?;
    let search = request.q.as_deref().unwrap_or("").trim();
    let filter = format!(
        "WHERE (?1 = '' OR instr(lower(COALESCE(img_path, '')), lower(?1)) > 0)
        AND (?2 IS NULL OR ({CATEGORY}) = ?2)
        AND (?3 IS NULL OR img_path = ?3 OR thumb_path = ?3)"
    );
    // One snapshot keeps page and count coherent if another connection updates the mirror.
    let snapshot = conn.unchecked_transaction()?;
    let total = snapshot.query_row(
        &format!("SELECT COUNT(*) FROM inagle_gallery {filter}"),
        params![search, request.category, resource],
        |row| row.get::<_, u64>(0),
    )?;
    let records = {
        let mut statement = snapshot.prepare(&format!(
            "SELECT id, img_path, thumb_path,
            need_token_num, flg_no, {CATEGORY} FROM inagle_gallery {filter}
            ORDER BY CASE
                WHEN flg_no IS NULL OR trim(flg_no) = '' OR flg_no = '\\N' THEN NULL
                ELSE CAST(flg_no AS INTEGER)
            END ASC NULLS LAST, id ASC LIMIT ?4 OFFSET ?5"
        ))?;
        statement
            .query_map(
                params![search, request.category, resource, limit, offset],
                |row| {
                    Ok(GalleryRecord {
                        id: row.get(0)?,
                        img_path: row.get(1)?,
                        thumb_path: row.get(2)?,
                        need_token_num: optional_i64(row, 3)?,
                        flg_no: optional_i64(row, 4)?,
                        category: row.get(5)?,
                        title: None,
                        vfs_path: None,
                        source: None,
                    })
                },
            )?
            .collect::<Result<Vec<_>, _>>()?
    };
    snapshot.commit()?;
    Ok(GalleryPage {
        records,
        total,
        limit,
        offset,
        categories: Vec::new(),
    })
}

#[derive(Debug, Clone, Deserialize)]
struct EditorialManifest {
    items: Vec<EditorialManifestItem>,
}

#[derive(Debug, Clone, Deserialize)]
struct EditorialManifestItem {
    id: String,
    dir: String,
    file: String,
    title: String,
    category: String,
}

fn selection_records(conn: &Connection) -> anyhow::Result<Vec<GalleryRecord>> {
    let mut statement = conn.prepare(&format!(
        "SELECT id, img_path, thumb_path, need_token_num, flg_no, {CATEGORY}
         FROM inagle_gallery ORDER BY CASE
            WHEN flg_no IS NULL OR trim(flg_no) = '' OR flg_no = '\\N' THEN NULL
            ELSE CAST(flg_no AS INTEGER)
         END ASC NULLS LAST, id ASC"
    ))?;
    Ok(statement
        .query_map([], |row| {
            let img_path: Option<String> = row.get(1)?;
            let vfs_path = img_path
                .as_ref()
                .map(|name| format!("data/dx11/menu/220_img/gallery_img2/{name}.g4tx"));
            Ok(GalleryRecord {
                id: row.get(0)?,
                img_path: img_path.clone(),
                thumb_path: row.get(2)?,
                need_token_num: optional_i64(row, 3)?,
                flg_no: optional_i64(row, 4)?,
                category: row.get(5)?,
                title: img_path.map(|name| title_from_stem(&name)),
                vfs_path,
                source: Some("selection".into()),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn title_from_stem(stem: &str) -> String {
    stem.trim_start_matches("img_")
        .trim_start_matches("back_")
        .trim_start_matches("hlp_")
        .trim_start_matches("grid_")
        .replace('_', " ")
}

/// Shared manifest projection. Legacy menu-only requests must not require a gallery table.
pub(crate) fn manifest_records() -> anyhow::Result<Vec<GalleryRecord>> {
    let manifest = PARSED_EDITORIAL_MANIFEST
        .get_or_init(|| serde_json::from_str(EDITORIAL_MANIFEST).map_err(|error| error.to_string()))
        .as_ref()
        .map_err(|error| anyhow::anyhow!(error.clone()))?;
    Ok(manifest
        .items
        .iter()
        .map(|item| {
            let stem = item.file.strip_suffix(".png").unwrap_or(&item.file);
            GalleryRecord {
                id: item.id.clone(),
                img_path: None,
                thumb_path: None,
                need_token_num: None,
                flg_no: None,
                category: item.category.clone(),
                title: Some(item.title.clone()),
                vfs_path: Some(format!("data/dx11/menu/220_img/{}/{stem}.g4tx", item.dir)),
                source: Some("manifest".into()),
            }
        })
        .collect())
}

fn query_editorial(conn: &Connection, request: &GalleryRequest) -> anyhow::Result<GalleryPage> {
    let mut records = selection_records(conn)?;
    records.extend(manifest_records()?);

    // Ids are source-scoped: gallery_img2 intentionally overlaps the in-game selection, but
    // duplicate rows inside either source must never inflate the published 3,939-item inventory.
    let mut seen = HashSet::new();
    records.retain(|record| {
        seen.insert((record.source.clone().unwrap_or_default(), record.id.clone()))
    });

    let mut counts = HashMap::<String, u64>::new();
    for record in &records {
        *counts.entry(record.category.clone()).or_default() += 1;
    }
    let categories = [
        "story",
        "chronicle",
        "special",
        "kizuna",
        "other",
        "gallery_img2",
        "ev_pic",
        "stadium",
        "vsroute_map",
        "hlp",
        "telop_waza",
    ]
    .into_iter()
    .filter_map(|id| {
        counts.get(id).map(|count| GalleryCategory {
            id: id.into(),
            count: *count,
        })
    })
    .collect();

    let search = request.q.as_deref().unwrap_or("").trim().to_lowercase();
    records.retain(|record| {
        request
            .category
            .as_ref()
            .is_none_or(|category| &record.category == category)
            && (search.is_empty()
                || record.id.to_lowercase().contains(&search)
                || record
                    .title
                    .as_deref()
                    .unwrap_or("")
                    .to_lowercase()
                    .contains(&search)
                || record
                    .vfs_path
                    .as_deref()
                    .unwrap_or("")
                    .to_lowercase()
                    .contains(&search))
            && request.resource.as_ref().is_none_or(|resource| {
                resource_key(resource).is_ok_and(|key| {
                    record.img_path.as_deref() == Some(key)
                        || record.vfs_path.as_deref().is_some_and(|path| {
                            path.strip_suffix(".g4tx")
                                .is_some_and(|path| path.ends_with(key))
                        })
                })
            })
    });

    let total = records.len() as u64;
    let limit = request.limit.unwrap_or(48);
    let offset = request.offset.unwrap_or(0);
    let records = records
        .into_iter()
        .skip(offset as usize)
        .take(limit as usize)
        .collect();
    Ok(GalleryPage {
        records,
        total,
        limit,
        offset,
        categories,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Connection {
        let connection = Connection::open_in_memory().expect("memory mirror");
        connection
            .execute_batch(
                "CREATE TABLE inagle_gallery (
            id TEXT PRIMARY KEY, img_path TEXT, thumb_path TEXT,
            need_token_num INTEGER, flg_no INTEGER);
            INSERT INTO inagle_gallery VALUES
            ('b', 'img_story_one', 'thumb_story_one', 2, 7),
            ('a', 'img_special_two', 'thumb_special_two', 0, 7),
            ('c', 'img_future_three', NULL, NULL, NULL),
            ('d', 'img_story_100%_four', 'thumb_story_100%_four', 1, 8),
            ('e', 'imgXstory_not_a_prefix', NULL, NULL, 9);",
            )
            .expect("fixture rows");
        connection
    }

    fn real_mirror_text_fixture() -> Connection {
        let connection = Connection::open_in_memory().expect("real mirror shaped fixture");
        connection
            .execute_batch(
                "CREATE TABLE inagle_gallery (
                    id TEXT, img_path TEXT, thumb_path TEXT, need_token_num TEXT,
                    flg_no TEXT, data TEXT, updated_at TEXT);
                 INSERT INTO inagle_gallery VALUES
                    ('numeric', 'img_story_numeric', 'thumb_story_numeric', '1', '52', '{}', 'now'),
                    ('sentinel', 'img_story_sentinel', NULL, '\\N', '\\N', '{}', 'now'),
                    ('empty', 'img_story_empty', NULL, '', '', '{}', 'now');",
            )
            .expect("text mirror rows");
        connection
    }

    #[test]
    fn pagination_counts_only_mirror_rows_and_preserves_nulls() {
        let conn = fixture();
        let page = query(
            &conn,
            &GalleryRequest {
                limit: Some(2),
                offset: Some(1),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(page.total, 5);
        assert_eq!(
            page.records
                .iter()
                .map(|row| row.id.as_str())
                .collect::<Vec<_>>(),
            ["b", "d"]
        );
        let end = query(
            &conn,
            &GalleryRequest {
                offset: Some(4),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(end.records[0].id, "c");
        assert_eq!(end.records[0].thumb_path, None);
        assert_eq!(end.records[0].need_token_num, None);
        assert_eq!(end.records[0].flg_no, None);
        assert_eq!(end.records[0].category, "other");
    }

    #[test]
    fn real_mirror_text_numbers_and_null_sentinels_are_decoded() {
        let conn = real_mirror_text_fixture();
        for view in [None, Some("editorial".to_owned())] {
            let page = query(
                &conn,
                &GalleryRequest {
                    view,
                    category: Some("story".into()),
                    ..Default::default()
                },
            )
            .unwrap();
            let numeric = page.records.iter().find(|row| row.id == "numeric").unwrap();
            assert_eq!(numeric.need_token_num, Some(1));
            assert_eq!(numeric.flg_no, Some(52));
            for id in ["sentinel", "empty"] {
                let row = page.records.iter().find(|row| row.id == id).unwrap();
                assert_eq!(row.need_token_num, None);
                assert_eq!(row.flg_no, None);
            }
        }
    }

    #[test]
    fn category_and_search_use_literal_resource_tokens() {
        let conn = fixture();
        let story = query(
            &conn,
            &GalleryRequest {
                category: Some("story".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(story.total, 2);
        let percent = query(
            &conn,
            &GalleryRequest {
                q: Some("100%_".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(percent.total, 1);
        assert_eq!(percent.records[0].id, "d");
        let other = query(
            &conn,
            &GalleryRequest {
                category: Some("other".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(other.total, 2);
    }

    #[test]
    fn native_resource_lookup_joins_original_image_and_thumbnail_keys() {
        let conn = fixture();
        for resource in [
            "img_story_one",
            "img_story_one.g4tx",
            "data/dx11/menu/220_img/gallery_img2/img_story_one.g4tx",
            "data/dx11/menu/220_img/gallery_thumb2/thumb_story_one.g4tx",
        ] {
            let page = query(
                &conn,
                &GalleryRequest {
                    resource: Some(resource.into()),
                    ..Default::default()
                },
            )
            .unwrap();
            assert_eq!(page.total, 1);
            assert_eq!(page.records[0].img_path.as_deref(), Some("img_story_one"));
            assert_eq!(
                page.records[0].thumb_path.as_deref(),
                Some("thumb_story_one")
            );
        }
        let missing = query(
            &conn,
            &GalleryRequest {
                resource: Some("img_missing".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(missing.total, 0);
        assert!(missing.records.is_empty());
    }

    #[test]
    fn invalid_filters_fail_before_querying() {
        let empty = Connection::open_in_memory().unwrap();
        for resource in [
            "",
            "../img_story_one",
            "data/unrelated/img_story_one.g4tx",
            "data/dx11/menu/220_img/gallery_img2/../img_story_one.g4tx",
            "x\\img_story_one",
            "img_\0one",
        ] {
            assert!(
                GalleryRequest {
                    resource: Some(resource.into()),
                    ..Default::default()
                }
                .validate()
                .is_err()
            );
        }
        for input in [
            GalleryRequest {
                limit: Some(0),
                ..Default::default()
            },
            GalleryRequest {
                limit: Some(201),
                ..Default::default()
            },
            GalleryRequest {
                offset: Some(1_000_001),
                ..Default::default()
            },
            GalleryRequest {
                category: Some("menu".into()),
                ..Default::default()
            },
            GalleryRequest {
                q: Some("x".repeat(257)),
                ..Default::default()
            },
        ] {
            assert!(input.validate().is_err());
            assert!(
                !query(&empty, &input)
                    .unwrap_err()
                    .to_string()
                    .contains("no such table")
            );
        }
    }

    #[test]
    fn editorial_manifest_is_complete_unique_and_source_scoped() {
        let manifest: EditorialManifest = serde_json::from_str(EDITORIAL_MANIFEST).unwrap();
        assert_eq!(manifest.items.len(), 3_579);
        let ids = manifest
            .items
            .iter()
            .map(|item| item.id.as_str())
            .collect::<HashSet<_>>();
        assert_eq!(ids.len(), 3_579);

        let page = query(
            &fixture(),
            &GalleryRequest {
                view: Some("editorial".into()),
                limit: Some(200),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(page.total, 3_584);
        assert_eq!(
            page.categories.iter().map(|row| row.count).sum::<u64>(),
            3_584
        );
        assert_eq!(
            page.categories
                .iter()
                .find(|row| row.id == "gallery_img2")
                .unwrap()
                .count,
            363
        );
        assert!(
            page.records
                .iter()
                .any(|record| record.source.as_deref() == Some("selection"))
        );
        assert!(
            page.records
                .iter()
                .any(|record| record.source.as_deref() == Some("manifest"))
        );
    }

    #[test]
    fn editorial_search_category_and_paths_are_applied_before_pagination() {
        let page = query(
            &fixture(),
            &GalleryRequest {
                view: Some("editorial".into()),
                category: Some("ev_pic".into()),
                q: Some("ev02 02700".into()),
                limit: Some(1),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(page.total >= 2);
        assert_eq!(page.records.len(), 1);
        assert_eq!(page.records[0].category, "ev_pic");
        assert!(
            page.records[0]
                .vfs_path
                .as_deref()
                .unwrap()
                .starts_with("data/dx11/menu/220_img/ev_pic/")
        );
    }
}
