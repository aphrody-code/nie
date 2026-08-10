//! Safe Rust port of `FUN_140ef7980` — Level-5 virtual filesystem path resolver.
//!
//! Original Ghidra source: `decomp/functions/vfs_path_resolver.c`
//! Subsystem: Virtual Filesystem / Path Resolution
//!
//! Two virtual path schemes are recognised:
//!
//! - `#/...`  — asset path. The `#` marker means "mounted virtual path".
//!              The remainder is hashed via the engine's CRC32-like routine.
//! - `C[name]/...` — CPK-relative path. The archive name is extracted
//!              between `[` and `]` and resolved against the global CPK binder.
//!
//! Anything else returns `None`.
//!
//! The original native function exposes three operations multiplexed on a
//! single `int` parameter (`1` = exists, `7` = hash-only, anything else =
//! full CPK resolve). We model this as an explicit [`Operation`] enum.
//!
//! Native dependencies (`FUN_1402b5cb0` hash + `FUN_140d83c60` CPK lookup +
//! `DAT_141f7d6e0` file manager singleton) are abstracted behind the
//! [`FileManager`] trait so this module stays `#![forbid(unsafe_code)]`-clean
//! and is unit-testable without the binary.

#![forbid(unsafe_code)]

/// Result of resolving a virtual path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResolveResult {
    /// Which scheme matched.
    pub kind: PathKind,
    /// Primary output — either a hash (for `#/` paths) or a CPK handle.
    pub primary: u32,
    /// Secondary hash copy (only meaningful for `Operation::HashOnly`
    /// on `#/` paths, and for the CPK resolver's `param_6` side-channel).
    pub secondary: u32,
}

/// Which virtual-path scheme the input matched.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathKind {
    /// `#/...` — engine-managed asset path.
    HashMounted,
    /// `C[name]/...` — relative to a mounted CPK archive.
    CpkRelative,
}

/// Operation requested by the caller. Replaces the bare `int param_2`
/// of the original C decompilation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Operation {
    /// "Does the path resolve?" — short-circuits to success for any
    /// recognised prefix without touching the hash or the binder.
    /// Corresponds to `param_2 == 1` in the native code.
    Exists,
    /// Compute the CRC32-style hash and return it as both primary and
    /// secondary outputs. CPK lookup is skipped.
    /// Corresponds to `param_2 == 7`.
    HashOnly,
    /// Full resolve. For `#/` paths this is currently treated as a no-op
    /// (the native function falls through without touching outputs). For
    /// `C[...]` paths it triggers a CPK binder lookup with the embedded
    /// extra parameter (originally `param_3`).
    Resolve { cpk_extra: u32 },
}

/// Engine-side dependencies abstracted from the native decompilation.
///
/// The original native function calls into:
///
/// - `FUN_1402b5cb0(path_without_marker)` — CRC32-like path hasher.
/// - The global `DAT_141f7d6e0` singleton + offset `0x750` — the master
///   CPK binder handle.
/// - `FUN_140d83c60(binder, cpk_name, extra, secondary_out)` — CPK lookup
///   inside that binder.
///
/// Implementations bridge to those when wiring the real engine and provide
/// in-memory stand-ins for tests.
pub trait FileManager {
    /// Hash a virtual path (after the leading `#`).
    fn path_hash(&self, path_without_marker: &str) -> u32;

    /// Resolve a CPK by its bracketed name. Returns `(primary_handle,
    /// secondary_side_channel)` on hit. `None` if the binder is absent or
    /// the name is unknown.
    fn cpk_lookup(&self, cpk_name: &str, extra: u32) -> Option<(u32, u32)>;
}

/// Maximum CPK name length we accept between the brackets.
/// Mirrors the bounded stack buffer that the original native function used
/// (`auStack_38` was 32 bytes and the loop ran for `param_2 + 2` chars).
/// We pick a generous upper bound that is still small enough to keep the
/// happy path stack-only.
const MAX_CPK_NAME: usize = 256;

/// Resolve a virtual path. Returns `Some(ResolveResult)` if the path
/// matched a known scheme and the operation succeeded, `None` otherwise.
///
/// `None` covers both "unknown prefix" and "binder unavailable" — the
/// original C code distinguished those via the `param_5` success-out
/// flag, but in safe Rust the `Option` is more honest.
pub fn resolve_path<F: FileManager>(
    path: &str,
    op: Operation,
    fm: &F,
) -> Option<ResolveResult> {
    let first = path.chars().next()?;

    match first {
        '#' => resolve_hash_mounted(path, op, fm),
        'C' => resolve_cpk_relative(path, op, fm),
        _ => None,
    }
}

fn resolve_hash_mounted<F: FileManager>(
    path: &str,
    op: Operation,
    fm: &F,
) -> Option<ResolveResult> {
    match op {
        Operation::Exists => Some(ResolveResult {
            kind: PathKind::HashMounted,
            primary: 0,
            secondary: 0,
        }),
        Operation::HashOnly => {
            // Strip the leading '#' before hashing — matches `param_1 + 1`.
            let hash = fm.path_hash(&path[1..]);
            Some(ResolveResult {
                kind: PathKind::HashMounted,
                primary: hash,
                secondary: hash,
            })
        }
        Operation::Resolve { .. } => {
            // The native function falls through here without touching the
            // outputs and returns 0. We surface that as `None`.
            None
        }
    }
}

fn resolve_cpk_relative<F: FileManager>(
    path: &str,
    op: Operation,
    fm: &F,
) -> Option<ResolveResult> {
    if matches!(op, Operation::Exists) {
        return Some(ResolveResult {
            kind: PathKind::CpkRelative,
            primary: 0,
            secondary: 0,
        });
    }

    let cpk_name = extract_cpk_name(path)?;
    let Operation::Resolve { cpk_extra } = op else {
        // Hash-only on a CPK-relative path is not supported by the native
        // routine — it falls through to the failure exit.
        return None;
    };

    let (primary, secondary) = fm.cpk_lookup(cpk_name, cpk_extra)?;
    Some(ResolveResult {
        kind: PathKind::CpkRelative,
        primary,
        secondary,
    })
}

/// Extract the CPK archive name from a `C[name]/...` path. Returns `None`
/// for malformed paths (missing `[`, missing `]`, empty name, or name
/// exceeding [`MAX_CPK_NAME`]).
fn extract_cpk_name(path: &str) -> Option<&str> {
    // Path is at least one byte (the leading 'C') because the caller
    // already inspected `path.chars().next()`.
    let rest = path.get(1..)?;
    let bracketed = rest.strip_prefix('[')?;
    let end = bracketed.find(']')?;
    let name = &bracketed[..end];
    if name.is_empty() || name.len() > MAX_CPK_NAME {
        return None;
    }
    Some(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    /// Test double — records the last call and returns canned values.
    struct FakeFm {
        last_hash_input: Cell<Option<&'static str>>,
        last_cpk: Cell<Option<&'static str>>,
        hash_value: u32,
        cpk_result: Option<(u32, u32)>,
    }

    impl FakeFm {
        fn new(hash: u32, cpk: Option<(u32, u32)>) -> Self {
            Self {
                last_hash_input: Cell::new(None),
                last_cpk: Cell::new(None),
                hash_value: hash,
                cpk_result: cpk,
            }
        }
    }

    impl FileManager for FakeFm {
        fn path_hash(&self, path: &str) -> u32 {
            // Leak the slice into a 'static via Box — only OK in tests where
            // we control the path lifetimes.
            let leaked: &'static str = Box::leak(path.to_owned().into_boxed_str());
            self.last_hash_input.set(Some(leaked));
            self.hash_value
        }

        fn cpk_lookup(&self, name: &str, _extra: u32) -> Option<(u32, u32)> {
            let leaked: &'static str = Box::leak(name.to_owned().into_boxed_str());
            self.last_cpk.set(Some(leaked));
            self.cpk_result
        }
    }

    #[test]
    fn hash_mounted_exists() {
        let fm = FakeFm::new(0xdead_beef, None);
        let r = resolve_path("#/font/gaiji_game.g4tx", Operation::Exists, &fm).unwrap();
        assert_eq!(r.kind, PathKind::HashMounted);
        assert_eq!(r.primary, 0);
        assert_eq!(r.secondary, 0);
        // No hash should have been computed.
        assert!(fm.last_hash_input.get().is_none());
    }

    #[test]
    fn hash_mounted_hash_only_strips_marker() {
        let fm = FakeFm::new(0xcafe_d00d, None);
        let r = resolve_path("#/shader/v2/foo", Operation::HashOnly, &fm).unwrap();
        assert_eq!(r.kind, PathKind::HashMounted);
        assert_eq!(r.primary, 0xcafe_d00d);
        assert_eq!(r.secondary, 0xcafe_d00d);
        assert_eq!(fm.last_hash_input.get(), Some("/shader/v2/foo"));
    }

    #[test]
    fn hash_mounted_resolve_falls_through() {
        let fm = FakeFm::new(0, None);
        assert!(resolve_path("#/foo", Operation::Resolve { cpk_extra: 0 }, &fm).is_none());
    }

    #[test]
    fn cpk_relative_exists() {
        let fm = FakeFm::new(0, None);
        let r = resolve_path("C[archive01]/data/x", Operation::Exists, &fm).unwrap();
        assert_eq!(r.kind, PathKind::CpkRelative);
        assert!(fm.last_cpk.get().is_none());
    }

    #[test]
    fn cpk_relative_resolve_hits_binder() {
        let fm = FakeFm::new(0, Some((42, 7)));
        let r = resolve_path(
            "C[archive01]/data/x",
            Operation::Resolve { cpk_extra: 9 },
            &fm,
        )
        .unwrap();
        assert_eq!(r.kind, PathKind::CpkRelative);
        assert_eq!(r.primary, 42);
        assert_eq!(r.secondary, 7);
        assert_eq!(fm.last_cpk.get(), Some("archive01"));
    }

    #[test]
    fn cpk_relative_resolve_misses_when_binder_returns_none() {
        let fm = FakeFm::new(0, None);
        assert!(resolve_path(
            "C[archive01]/data/x",
            Operation::Resolve { cpk_extra: 9 },
            &fm,
        )
        .is_none());
    }

    #[test]
    fn cpk_relative_hash_only_not_supported() {
        let fm = FakeFm::new(0, Some((1, 2)));
        assert!(resolve_path("C[archive01]/x", Operation::HashOnly, &fm).is_none());
    }

    #[test]
    fn malformed_cpk_paths() {
        let fm = FakeFm::new(0, Some((1, 2)));
        // Missing '['
        assert!(resolve_path("Carchive]", Operation::Resolve { cpk_extra: 0 }, &fm).is_none());
        // Missing ']'
        assert!(resolve_path("C[archive", Operation::Resolve { cpk_extra: 0 }, &fm).is_none());
        // Empty name
        assert!(resolve_path("C[]/x", Operation::Resolve { cpk_extra: 0 }, &fm).is_none());
    }

    #[test]
    fn unknown_prefix() {
        let fm = FakeFm::new(0, Some((1, 2)));
        assert!(resolve_path("/abs/path", Operation::Exists, &fm).is_none());
        assert!(resolve_path("", Operation::Exists, &fm).is_none());
    }

    #[test]
    fn cpk_name_length_cap() {
        let fm = FakeFm::new(0, Some((1, 2)));
        let oversized = format!("C[{}]/x", "a".repeat(MAX_CPK_NAME + 1));
        assert!(resolve_path(&oversized, Operation::Resolve { cpk_extra: 0 }, &fm).is_none());
    }
}
