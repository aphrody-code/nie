//! Portable read-only access to the locally mirrored episode catalogue.

use std::path::Path;

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum EpisodeError {
    #[error("episode catalogue could not be opened")]
    Open(#[source] rusqlite::Error),
    #[error("episode catalogue could not be queried")]
    Query(#[source] rusqlite::Error),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Episode {
    pub id: i64,
    pub season: Option<i64>,
    pub episode: Option<i64>,
    pub video_id: Option<String>,
    pub title: Option<String>,
    pub url: Option<String>,
    pub title_jp: Option<String>,
    pub romaji: Option<String>,
    pub thumbnail: Option<String>,
    pub publish_date: Option<String>,
    pub language: Option<String>,
    pub duration: Option<i64>,
    pub created_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EpisodePage {
    pub elements: Vec<Episode>,
    pub total: usize,
    pub latest_harvested: Option<i64>,
}

#[must_use]
pub fn immutable_uri(path: &Path) -> String {
    let mut output = String::with_capacity(path.display().to_string().len() + 24);
    output.push_str("file:");
    for character in path.display().to_string().chars() {
        match character {
            '?' => output.push_str("%3f"),
            '#' => output.push_str("%23"),
            other => output.push(other),
        }
    }
    output.push_str("?mode=ro&immutable=1");
    output
}

pub fn open_read_only(path: &Path) -> Result<Connection, EpisodeError> {
    let readable = |connection: &Connection| {
        connection
            .query_row("PRAGMA schema_version", [], |row| row.get::<_, i64>(0))
            .is_ok()
    };
    if let Ok(connection) = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        && readable(&connection)
    {
        return Ok(connection);
    }
    let connection = Connection::open_with_flags(
        immutable_uri(path),
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(EpisodeError::Open)?;
    if !readable(&connection) {
        return Err(EpisodeError::Open(rusqlite::Error::InvalidQuery));
    }
    Ok(connection)
}

pub fn read_page(path: &Path, since: i64, limit: u32) -> Result<EpisodePage, EpisodeError> {
    let connection = open_read_only(path)?;
    let mut query = connection
        .prepare(
            "SELECT id, season, episode, videoId, title, url, titleJp, romaji, thumbnail, \
             publishDate, language, duration, createdAt FROM episodes \
             WHERE createdAt > ?1 ORDER BY createdAt ASC LIMIT ?2",
        )
        .map_err(EpisodeError::Query)?;
    let elements = query
        .query_map(rusqlite::params![since, limit], |row| {
            Ok(Episode {
                id: row.get(0)?,
                season: row.get(1)?,
                episode: row.get(2)?,
                video_id: row.get(3)?,
                title: row.get(4)?,
                url: row.get(5)?,
                title_jp: row.get(6)?,
                romaji: row.get(7)?,
                thumbnail: row.get(8)?,
                publish_date: row.get(9)?,
                language: row.get(10)?,
                duration: row.get(11)?,
                created_at: row.get(12)?,
            })
        })
        .map_err(EpisodeError::Query)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(EpisodeError::Query)?;
    let latest_harvested = elements
        .iter()
        .filter_map(|episode| episode.created_at)
        .max();
    Ok(EpisodePage {
        total: elements.len(),
        latest_harvested,
        elements,
    })
}

pub fn read_feed(path: &Path, limit: u32) -> Result<Vec<Episode>, EpisodeError> {
    let connection = open_read_only(path)?;
    let mut query = connection.prepare("SELECT id, season, episode, NULL, title, url, titleJp, NULL, NULL, publishDate, language, NULL, createdAt FROM episodes ORDER BY createdAt DESC, id DESC LIMIT ?1").map_err(EpisodeError::Query)?;
    query
        .query_map([limit], |row| {
            Ok(Episode {
                id: row.get(0)?,
                season: row.get(1)?,
                episode: row.get(2)?,
                video_id: None,
                title: row.get(4)?,
                url: row.get(5)?,
                title_jp: row.get(6)?,
                romaji: None,
                thumbnail: None,
                publish_date: row.get(9)?,
                language: row.get(10)?,
                duration: None,
                created_at: row.get(12)?,
            })
        })
        .map_err(EpisodeError::Query)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(EpisodeError::Query)
}

#[must_use]
pub fn rfc3339_timestamp(raw: &str) -> Option<String> {
    let value = raw.trim();
    if value.is_empty() {
        return None;
    }
    let valid_date = |date: &str| {
        date.len() == 10
            && date.as_bytes().iter().enumerate().all(|(index, byte)| {
                if index == 4 || index == 7 {
                    *byte == b'-'
                } else {
                    byte.is_ascii_digit()
                }
            })
    };
    let Some((date, time)) = value.split_once('T') else {
        return valid_date(value).then(|| format!("{value}T00:00:00Z"));
    };
    if !valid_date(date) {
        return None;
    }
    let (clock, offset) = match time.strip_suffix('Z') {
        Some(clock) => (clock, None),
        None if time.len() == 14 => (&time[..8], Some(&time[8..])),
        None => return None,
    };
    let clock_ok = clock.len() == 8
        && clock.as_bytes().iter().enumerate().all(|(index, byte)| {
            if index == 2 || index == 5 {
                *byte == b':'
            } else {
                byte.is_ascii_digit()
            }
        });
    let offset_ok = offset.is_none_or(|offset| {
        offset
            .as_bytes()
            .iter()
            .enumerate()
            .all(|(index, byte)| match index {
                0 => *byte == b'+' || *byte == b'-',
                3 => *byte == b':',
                _ => byte.is_ascii_digit(),
            })
    });
    (clock_ok && offset_ok).then(|| value.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_filters_orders_limits_and_reports_cursor() {
        let path =
            std::env::temp_dir().join(format!("nie-wiki-episodes-{}.db", std::process::id()));
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch("CREATE TABLE episodes(id INTEGER, season INTEGER, episode INTEGER, videoId TEXT, title TEXT, url TEXT, titleJp TEXT, romaji TEXT, thumbnail TEXT, publishDate TEXT, language TEXT, duration INTEGER, createdAt INTEGER); INSERT INTO episodes VALUES(2,1,2,NULL,'B',NULL,NULL,NULL,NULL,NULL,'fr',20,200); INSERT INTO episodes VALUES(1,1,1,NULL,'A',NULL,NULL,NULL,NULL,NULL,'fr',10,100);").unwrap();
        drop(connection);
        let page = read_page(&path, 50, 1).unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.elements[0].id, 1);
        assert_eq!(page.latest_harvested, Some(100));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn immutable_uri_escapes_query_delimiters() {
        let uri = immutable_uri(Path::new("/tmp/a?b#c.db"));
        assert!(uri.contains("a%3fb%23c.db"));
        assert!(uri.ends_with("?mode=ro&immutable=1"));
    }

    #[test]
    fn feed_orders_descending_and_normalizes_dates() {
        assert_eq!(
            rfc3339_timestamp("2008-10-05").as_deref(),
            Some("2008-10-05T00:00:00Z")
        );
        assert!(rfc3339_timestamp("bad").is_none());
    }
}
