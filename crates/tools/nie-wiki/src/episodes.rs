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
    /// Nom de la chaîne qui a publié l'épisode (`channels.channel`), et non son identifiant.
    ///
    /// C'est la SEULE clé stable entre ce catalogue et celui d'un client installé : les deux
    /// bases ont leur propre `AUTOINCREMENT`, donc un `channel_id` d'ici ne désigne rien
    /// là-bas. Sans ce champ, `fusionner` côté client ne peut rattacher aucun épisode à une
    /// chaîne et les écarte tous — un catalogue qui se met à jour en ne changeant rien.
    pub channel: Option<String>,
}

/// Une chaîne du catalogue, telle qu'un client doit la recréer chez lui.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Channel {
    pub id: i64,
    pub channel: String,
    pub title: Option<String>,
}

/// Une saison, rattachée à sa chaîne par l'identifiant DISTANT que porte `Channel::id`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Season {
    pub channel_id: i64,
    pub season: i64,
    pub name: Option<String>,
    pub total: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EpisodePage {
    pub elements: Vec<Episode>,
    pub total: usize,
    pub latest_harvested: Option<i64>,
    /// Les chaînes du catalogue, TOUJOURS en entier, même sous un `since` récent.
    ///
    /// Elles ne sont pas filtrées avec les épisodes : un client qui reçoit un seul épisode neuf
    /// a besoin de la chaîne qui le publie, et elle peut lui être inconnue. Onze chaînes et
    /// trente-neuf saisons pèsent quelques kilo-octets — les omettre pour les économiser ferait
    /// écarter l'épisode.
    pub channels: Vec<Channel>,
    pub seasons: Vec<Season>,
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

/// Cette base porte-t-elle cette table ?
///
/// Un catalogue réduit aux seuls épisodes existe — les fixtures de `nie-site` en créent un, et
/// il servait ses épisodes avant que les chaînes n'entrent dans la réponse. Interroger
/// `channels` sans vérifier ferait échouer TOUTE la route sur une base que l'on savait lire :
/// une fonctionnalité ajoutée ne doit pas retirer celle qui marchait.
fn has_table(connection: &Connection, name: &str) -> Result<bool, EpisodeError> {
    connection
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [name],
            |_| Ok(()),
        )
        .map(|()| true)
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(false),
            other => Err(EpisodeError::Query(other)),
        })
}

pub fn read_page(path: &Path, since: i64, limit: u32) -> Result<EpisodePage, EpisodeError> {
    let connection = open_read_only(path)?;
    let avec_chaines = has_table(&connection, "channels")?;
    let mut query = connection
        .prepare(if avec_chaines {
            "SELECT e.id, e.season, e.episode, e.videoId, e.title, e.url, e.titleJp, e.romaji, \
             e.thumbnail, e.publishDate, e.language, e.duration, e.createdAt, c.channel \
             FROM episodes e LEFT JOIN channels c ON c.id = e.channel_id \
             WHERE e.createdAt > ?1 ORDER BY e.createdAt ASC LIMIT ?2"
        } else {
            "SELECT id, season, episode, videoId, title, url, titleJp, romaji, thumbnail, \
             publishDate, language, duration, createdAt, NULL \
             FROM episodes WHERE createdAt > ?1 ORDER BY createdAt ASC LIMIT ?2"
        })
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
                channel: row.get(13)?,
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
        channels: if avec_chaines {
            read_channels(&connection)?
        } else {
            Vec::new()
        },
        seasons: if has_table(&connection, "seasons")? {
            read_seasons(&connection)?
        } else {
            Vec::new()
        },
    })
}

/// Les chaînes déclarées par le catalogue.
fn read_channels(connection: &Connection) -> Result<Vec<Channel>, EpisodeError> {
    let mut query = connection
        .prepare("SELECT id, channel, title FROM channels ORDER BY id")
        .map_err(EpisodeError::Query)?;
    query
        .query_map([], |row| {
            Ok(Channel {
                id: row.get(0)?,
                channel: row.get(1)?,
                title: row.get(2)?,
            })
        })
        .map_err(EpisodeError::Query)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(EpisodeError::Query)
}

/// Les saisons, rattachées à leur chaîne par l'identifiant de CETTE base.
fn read_seasons(connection: &Connection) -> Result<Vec<Season>, EpisodeError> {
    let mut query = connection
        .prepare("SELECT channel_id, season, name, totalEpisodes FROM seasons ORDER BY channel_id, season")
        .map_err(EpisodeError::Query)?;
    query
        .query_map([], |row| {
            Ok(Season {
                channel_id: row.get(0)?,
                season: row.get(1)?,
                name: row.get(2)?,
                total: row.get(3)?,
            })
        })
        .map_err(EpisodeError::Query)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(EpisodeError::Query)
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
                channel: None,
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
