//! Gallery mirror enrichment for native resources, shared by host bindings.
//! Rows describe catalogue metadata; they do not prove a VFS file exists or is unlocked.

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct GalleryRequest {
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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryPage {
    pub records: Vec<GalleryRecord>,
    /// Count of matching mirror rows only, never a count of mounted files.
    pub total: u64,
    pub limit: u32,
    pub offset: u32,
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
        if self.category.as_ref().is_some_and(|category| {
            !matches!(
                category.as_str(),
                "story" | "chronicle" | "special" | "kizuna" | "other"
            )
        }) {
            return Err("Unknown gallery metadata category");
        }
        if let Some(resource) = &self.resource {
            resource_key(resource)?;
        }
        Ok(())
    }
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

/// Query the existing `inagle_gallery` mirror using literal search and exact resource joins.
pub fn query(conn: &Connection, request: &GalleryRequest) -> anyhow::Result<GalleryPage> {
    request.validate().map_err(anyhow::Error::msg)?;
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
            ORDER BY flg_no ASC NULLS LAST, id ASC LIMIT ?4 OFFSET ?5"
        ))?;
        statement
            .query_map(
                params![search, request.category, resource, limit, offset],
                |row| {
                    Ok(GalleryRecord {
                        id: row.get(0)?,
                        img_path: row.get(1)?,
                        thumb_path: row.get(2)?,
                        need_token_num: row.get(3)?,
                        flg_no: row.get(4)?,
                        category: row.get(5)?,
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
}
