//! Bounded decoded-text storage shared by requests, never by distinct VFS mounts.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex, Weak};

use nie_formats::vfs::Vfs;

use super::text::{Line, decode};
use crate::error::ErreurSite;

const BYTE_BUDGET: usize = 32 * 1024 * 1024;

#[derive(Default)]
struct Entries {
    source: Weak<Vfs>,
    rows: VecDeque<(String, Vec<Line>, usize)>,
    bytes: usize,
}

impl Entries {
    fn get_or_load(
        &mut self,
        path: &str,
        budget: usize,
        load: impl FnOnce() -> Result<Vec<Line>, ErreurSite>,
    ) -> Result<Vec<Line>, ErreurSite> {
        if let Some(index) = self.rows.iter().position(|(key, _, _)| key == path) {
            let entry = self.rows.remove(index).expect("existing cache index");
            let result = entry.1.clone();
            self.rows.push_back(entry);
            return Ok(result);
        }
        let lines = load()?;
        let weight = std::mem::size_of::<(String, Vec<Line>, usize)>()
            + path.len()
            + lines.capacity() * std::mem::size_of::<Line>()
            + lines
                .iter()
                .map(|line| line.hash_hex.capacity() + line.text.capacity())
                .sum::<usize>();
        if weight <= budget {
            while self.bytes > budget - weight {
                if let Some((_, _, evicted)) = self.rows.pop_front() {
                    self.bytes -= evicted;
                }
            }
            self.bytes += weight;
            self.rows
                .push_back((path.to_owned(), lines.clone(), weight));
        }
        Ok(lines)
    }
}

/// Decode once per retained file; loading happens only on the blocking worker pool.
#[derive(Default)]
pub(crate) struct TextCache(Mutex<Entries>);

impl TextCache {
    pub(crate) fn read(&self, vfs: &Arc<Vfs>, path: &str) -> Result<Vec<Line>, ErreurSite> {
        let mut entries = self
            .0
            .lock()
            .map_err(|_| ErreurSite::Interne("text cache unavailable".to_owned()))?;
        let source = Arc::downgrade(vfs);
        if !entries.source.ptr_eq(&source) {
            *entries = Entries {
                source,
                ..Entries::default()
            };
        }
        // Keeping this lock during a cold decode coalesces concurrent requests for the
        // same corpus. No failed read is retained, so transient failures remain retryable.
        entries.get_or_load(path, BYTE_BUDGET, || {
            let bytes = vfs.read(path).map_err(|error| {
                tracing::debug!(%error, path, "text VFS read failed");
                ErreurSite::Introuvable("indexed text is unreadable on this mount".to_owned())
            })?;
            decode(path, &bytes)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines() -> Vec<Line> {
        vec![
            Line {
                hash: 7,
                hash_hex: "0x00000007".to_owned(),
                text: "Menu".to_owned()
            };
            2
        ]
    }

    #[test]
    fn reuse_preserves_duplicates_and_does_not_decode_again() {
        let mut cache = Entries::default();
        let expected = lines();
        assert_eq!(
            cache
                .get_or_load("fr/a", 1024, || Ok(expected.clone()))
                .unwrap(),
            expected
        );
        assert_eq!(
            cache
                .get_or_load("fr/a", 1024, || panic!("must reuse"))
                .unwrap(),
            expected
        );
        assert_eq!(cache.rows.len(), 1);
        assert!(cache.bytes <= 1024);
    }

    #[test]
    fn bounded_cache_evicts_least_recent_file_and_retries_errors() {
        let mut cache = Entries::default();
        cache.get_or_load("fr/a", 1024, || Ok(lines())).unwrap();
        let one = cache.bytes;
        cache.get_or_load("en/b", one, || Ok(lines())).unwrap();
        assert_eq!(cache.rows.len(), 1);
        assert_eq!(cache.rows[0].0, "en/b");
        assert!(
            cache
                .get_or_load("fr/a", one, || Err(ErreurSite::Introuvable(
                    "missing".to_owned()
                )))
                .is_err()
        );
        assert_eq!(
            cache.get_or_load("fr/a", one, || Ok(lines())).unwrap(),
            lines()
        );
        assert_eq!(cache.rows[0].0, "fr/a");
    }

    #[test]
    fn replacing_the_vfs_mount_never_reuses_the_previous_text() {
        let first = Arc::new(Vfs::new());
        let next = Arc::new(Vfs::new());
        let mut entries = Entries {
            source: Arc::downgrade(&first),
            ..Entries::default()
        };
        entries.get_or_load("fr/a", 1024, || Ok(lines())).unwrap();
        let cache = TextCache(Mutex::new(entries));
        assert_eq!(cache.read(&first, "fr/a").unwrap(), lines());
        assert!(cache.read(&next, "fr/a").is_err());
        let entries = cache.0.lock().unwrap();
        assert!(entries.rows.is_empty());
        assert_eq!(entries.bytes, 0);
    }

    #[test]
    fn oversized_file_is_returned_without_being_retained() {
        let mut cache = Entries::default();
        assert_eq!(
            cache.get_or_load("fr/a", 1, || Ok(lines())).unwrap(),
            lines()
        );
        assert!(cache.rows.is_empty());
        assert_eq!(cache.bytes, 0);
    }
}
