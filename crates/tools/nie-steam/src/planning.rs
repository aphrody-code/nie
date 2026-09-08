//! Platform-neutral Steam depot and manifest planning.
//!
//! The network client, authentication state, manifest parser, and filesystem
//! probing live behind the crate's `host` feature. This module accepts owned,
//! serializable values so browser and WebAssembly callers can plan the same
//! work without access to credentials or host resources.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Sentinel used when a branch has no manifest.
pub const INVALID_MANIFEST: u64 = 0;

/// Directory bit in Valve's `EDepotFileFlag` protocol value.
pub const STEAM_FLAG_DIRECTORY: u32 = 64;

/// A Steam manifest GID serialized as a decimal string for JavaScript safety.
///
/// Steam GIDs routinely exceed JavaScript's exact integer range. Deserialization
/// accepts either a string or a native unsigned integer, while serialization
/// always emits a string.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct ManifestId(pub u64);

impl Serialize for ManifestId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.collect_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for ManifestId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct ManifestIdVisitor;

        impl serde::de::Visitor<'_> for ManifestIdVisitor {
            type Value = ManifestId;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("a decimal Steam manifest GID string or unsigned integer")
            }

            fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E> {
                Ok(ManifestId(value))
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                value.parse::<u64>().map(ManifestId).map_err(E::custom)
            }
        }

        deserializer.deserialize_any(ManifestIdVisitor)
    }
}

/// Upper bounds applied before processing untrusted browser input.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningLimits {
    /// Maximum number of depot records inspected by one selection.
    pub max_depots: usize,
    /// Maximum number of manifest entries inspected by one collision plan.
    pub max_manifest_entries: usize,
    /// Maximum number of existing path records accepted by one collision plan.
    pub max_existing_paths: usize,
    /// Maximum UTF-8 byte length of any path.
    pub max_path_bytes: usize,
    /// Maximum collisions retained in the output.
    pub max_collisions: usize,
}

impl Default for PlanningLimits {
    fn default() -> Self {
        Self {
            max_depots: 4_096,
            max_manifest_entries: 500_000,
            max_existing_paths: 500_000,
            max_path_bytes: 4_096,
            max_collisions: 4_096,
        }
    }
}

/// A normalized Steam depot record independent of Steam's KeyValue parser.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepotRecord {
    /// Numeric Steam depot identifier.
    pub depot_id: u32,
    /// Whether the source record has content rather than being a placeholder.
    pub has_content: bool,
    /// Allowed operating systems from the comma-separated `oslist` field.
    #[serde(default)]
    pub operating_systems: Vec<String>,
    /// Required architecture, when Steam specifies one.
    pub architecture: Option<String>,
    /// Required language, when Steam specifies one.
    pub language: Option<String>,
    /// Whether this is a reduced-content depot excluded by the normal policy.
    #[serde(default)]
    pub low_violence: bool,
    /// Branch name to manifest GID.
    #[serde(default)]
    pub manifests: BTreeMap<String, ManifestId>,
    /// Whether Steam supplied a local `manifests` section, even if empty.
    #[serde(default)]
    pub has_manifest_section: bool,
    /// Source application for a proxied depot with no local manifest section.
    pub proxy_app_id: Option<u32>,
}

/// Caller-provided depot selection policy.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepotSelection {
    /// Explicit depot IDs. A non-empty list bypasses platform filtering.
    #[serde(default)]
    pub explicit_depots: Vec<u32>,
    /// Include all content-bearing depots regardless of platform metadata.
    #[serde(default)]
    pub all_platforms: bool,
    /// Target operating system, such as `windows`.
    pub operating_system: String,
    /// Target architecture, such as `64`.
    pub architecture: Option<String>,
    /// Target Steam language, such as `english`.
    pub language: String,
}

/// One manifest entry needed by the collision planner.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    /// Manifest-relative path. Both slash styles are accepted.
    pub path: String,
    /// Raw Steam file flags.
    pub flags: u32,
    /// Declared uncompressed size.
    pub size: u64,
    /// Number of SteamPipe chunks.
    pub chunk_count: usize,
}

/// Filesystem object kind supplied by a host probe.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExistingPathKind {
    /// A regular file or other non-directory object.
    File,
    /// A directory.
    Directory,
}

/// A normalized snapshot of an existing install path.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistingPath {
    /// Install-relative path.
    pub path: String,
    /// Current filesystem object kind.
    pub kind: ExistingPathKind,
}

/// Cause of a manifest/application collision.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CollisionReason {
    /// An empty path aliases the install directory itself.
    EmptyPath,
    /// The manifest expects a file but the snapshot contains a directory.
    DirectoryOnDisk,
    /// The manifest expects a directory but the snapshot contains a file.
    FileOnDisk,
}

impl CollisionReason {
    /// Short French label used by the existing native CLI.
    pub fn label(self) -> &'static str {
        match self {
            Self::EmptyPath => "chemin vide (= le répertoire d'install)",
            Self::DirectoryOnDisk => "répertoire sur le disque, fichier au manifest",
            Self::FileOnDisk => "fichier sur le disque, répertoire au manifest",
        }
    }
}

/// Manifest entry that cannot be applied to the supplied install snapshot.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestCollision {
    /// Depot that owns the manifest entry.
    pub depot_id: u32,
    /// Slash-normalized manifest path.
    pub path: String,
    /// Raw Steam file flags.
    pub flags: u32,
    /// Declared uncompressed size.
    pub size: u64,
    /// Number of SteamPipe chunks.
    pub chunk_count: usize,
    /// Conflicting path condition.
    pub reason: CollisionReason,
}

/// Bounded result of applying manifest entries to an install snapshot.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollisionPlan {
    /// Number of entries inspected.
    pub inspected_entries: usize,
    /// Conflicts retained up to `PlanningLimits::max_collisions`.
    pub collisions: Vec<ManifestCollision>,
    /// Number of additional conflicts omitted from the retained list.
    pub omitted_collisions: usize,
}

/// Invalid or oversized planner input.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum PlanningError {
    /// A collection exceeds its configured bound.
    #[error("{field} contains {actual} items; limit is {limit}")]
    TooManyItems {
        /// Input field name.
        field: &'static str,
        /// Observed item count.
        actual: usize,
        /// Configured limit.
        limit: usize,
    },
    /// A path exceeds its configured byte-length bound.
    #[error("{field} path contains {actual} bytes; limit is {limit}")]
    PathTooLong {
        /// Input field name.
        field: &'static str,
        /// Observed UTF-8 byte length.
        actual: usize,
        /// Configured limit.
        limit: usize,
    },
}

/// Return whether a depot matches a platform selection policy.
pub fn is_depot_eligible(depot: &DepotRecord, selection: &DepotSelection) -> bool {
    if selection.all_platforms {
        return true;
    }

    if !depot.operating_systems.is_empty()
        && !depot
            .operating_systems
            .iter()
            .any(|value| value.trim() == selection.operating_system)
    {
        return false;
    }

    if let (Some(required), Some(selected)) = (
        depot.architecture.as_deref(),
        selection.architecture.as_deref(),
    ) && !required.trim().is_empty()
        && required.trim() != selected
    {
        return false;
    }

    if let Some(required) = depot.language.as_deref()
        && !required.trim().is_empty()
        && required.trim() != selection.language
    {
        return false;
    }

    !depot.low_violence
}

/// Select depot IDs while preserving source order and first explicit occurrence.
pub fn select_depot_ids(
    depots: &[DepotRecord],
    selection: &DepotSelection,
    limits: PlanningLimits,
) -> Result<Vec<u32>, PlanningError> {
    check_count("depots", depots.len(), limits.max_depots)?;

    if !selection.explicit_depots.is_empty() {
        check_count(
            "explicitDepots",
            selection.explicit_depots.len(),
            limits.max_depots,
        )?;
        let mut seen = HashSet::new();
        return Ok(selection
            .explicit_depots
            .iter()
            .filter(|&&id| seen.insert(id))
            .copied()
            .collect());
    }

    Ok(depots
        .iter()
        .filter(|depot| depot.has_content && is_depot_eligible(depot, selection))
        .map(|depot| depot.depot_id)
        .collect())
}

/// Read a depot's manifest GID for a branch.
pub fn manifest_id_for_branch(depot: &DepotRecord, branch: &str) -> u64 {
    depot
        .manifests
        .get(branch)
        .map(|id| id.0)
        .unwrap_or(INVALID_MANIFEST)
}

/// Return the source app for a proxied depot with no local manifests.
pub fn proxy_app_id(depot: &DepotRecord) -> Option<u32> {
    (!depot.has_manifest_section)
        .then_some(depot.proxy_app_id)
        .flatten()
        .filter(|id| *id != 0)
}

/// Return whether raw Steam flags describe a directory.
pub fn is_manifest_directory(flags: u32) -> bool {
    flags & STEAM_FLAG_DIRECTORY != 0
}

/// Plan manifest collisions against a caller-supplied install snapshot.
///
/// Inputs are rejected before traversal when they exceed configured bounds.
/// Collision collection itself is capped and reports the omitted count.
pub fn plan_manifest_application(
    depot_id: u32,
    entries: &[ManifestEntry],
    existing_paths: &[ExistingPath],
    limits: PlanningLimits,
) -> Result<CollisionPlan, PlanningError> {
    check_count(
        "manifestEntries",
        entries.len(),
        limits.max_manifest_entries,
    )?;
    check_count(
        "existingPaths",
        existing_paths.len(),
        limits.max_existing_paths,
    )?;

    let mut existing = HashMap::with_capacity(existing_paths.len());
    for item in existing_paths {
        check_path("existingPaths", &item.path, limits.max_path_bytes)?;
        existing.insert(normalize_path(&item.path), item.kind);
    }

    let mut collisions = Vec::new();
    let mut omitted_collisions = 0;
    for entry in entries {
        check_path("manifestEntries", &entry.path, limits.max_path_bytes)?;
        let path = normalize_path(&entry.path);
        let trimmed = path.trim_matches('/');
        let manifest_is_directory = is_manifest_directory(entry.flags);
        let reason = if trimmed.is_empty() {
            Some(CollisionReason::EmptyPath)
        } else {
            existing.get(&path).and_then(|kind| match kind {
                ExistingPathKind::Directory if !manifest_is_directory => {
                    Some(CollisionReason::DirectoryOnDisk)
                }
                ExistingPathKind::File if manifest_is_directory => {
                    Some(CollisionReason::FileOnDisk)
                }
                _ => None,
            })
        };

        if let Some(reason) = reason {
            if collisions.len() < limits.max_collisions {
                collisions.push(ManifestCollision {
                    depot_id,
                    path,
                    flags: entry.flags,
                    size: entry.size,
                    chunk_count: entry.chunk_count,
                    reason,
                });
            } else {
                omitted_collisions += 1;
            }
        }
    }

    Ok(CollisionPlan {
        inspected_entries: entries.len(),
        collisions,
        omitted_collisions,
    })
}

fn normalize_path(path: &str) -> String {
    path.replace('\\', "/")
}

fn check_count(field: &'static str, actual: usize, limit: usize) -> Result<(), PlanningError> {
    if actual > limit {
        return Err(PlanningError::TooManyItems {
            field,
            actual,
            limit,
        });
    }
    Ok(())
}

fn check_path(field: &'static str, path: &str, limit: usize) -> Result<(), PlanningError> {
    if path.len() > limit {
        return Err(PlanningError::PathTooLong {
            field,
            actual: path.len(),
            limit,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(id: u32, os: &[&str]) -> DepotRecord {
        DepotRecord {
            depot_id: id,
            has_content: true,
            operating_systems: os.iter().map(|value| (*value).to_owned()).collect(),
            architecture: None,
            language: None,
            low_violence: false,
            manifests: BTreeMap::from([("public".to_owned(), ManifestId(u64::from(id) * 10))]),
            has_manifest_section: true,
            proxy_app_id: None,
        }
    }

    fn selection() -> DepotSelection {
        DepotSelection {
            explicit_depots: Vec::new(),
            all_platforms: false,
            operating_system: "windows".to_owned(),
            architecture: Some("64".to_owned()),
            language: "english".to_owned(),
        }
    }

    #[test]
    fn selects_matching_depots_and_deduplicates_explicit_ids() {
        let depots = [record(10, &["windows"]), record(20, &["linux"])];
        assert_eq!(
            select_depot_ids(&depots, &selection(), PlanningLimits::default()).unwrap(),
            vec![10]
        );

        let mut explicit = selection();
        explicit.explicit_depots = vec![20, 10, 20];
        assert_eq!(
            select_depot_ids(&depots, &explicit, PlanningLimits::default()).unwrap(),
            vec![20, 10]
        );
    }

    #[test]
    fn resolves_manifest_and_proxy_without_host_types() {
        let direct = record(10, &["windows"]);
        assert_eq!(manifest_id_for_branch(&direct, "public"), 100);
        assert_eq!(proxy_app_id(&direct), None);

        let proxy = DepotRecord {
            manifests: BTreeMap::new(),
            has_manifest_section: false,
            proxy_app_id: Some(42),
            ..record(11, &["windows"])
        };
        assert_eq!(manifest_id_for_branch(&proxy, "public"), INVALID_MANIFEST);
        assert_eq!(proxy_app_id(&proxy), Some(42));
    }

    #[test]
    fn collision_plan_normalizes_paths_and_caps_output() {
        let entries = [
            ManifestEntry {
                path: String::new(),
                flags: 0,
                size: 0,
                chunk_count: 0,
            },
            ManifestEntry {
                path: "data\\packs".to_owned(),
                flags: STEAM_FLAG_DIRECTORY,
                size: 0,
                chunk_count: 0,
            },
            ManifestEntry {
                path: "game.exe".to_owned(),
                flags: 0,
                size: 12,
                chunk_count: 1,
            },
        ];
        let existing = [
            ExistingPath {
                path: "data/packs".to_owned(),
                kind: ExistingPathKind::File,
            },
            ExistingPath {
                path: "game.exe".to_owned(),
                kind: ExistingPathKind::Directory,
            },
        ];
        let limits = PlanningLimits {
            max_collisions: 2,
            ..PlanningLimits::default()
        };

        let plan = plan_manifest_application(2799861, &entries, &existing, limits).unwrap();
        assert_eq!(plan.inspected_entries, 3);
        assert_eq!(plan.collisions.len(), 2);
        assert_eq!(plan.omitted_collisions, 1);
        assert_eq!(plan.collisions[1].path, "data/packs");
        assert_eq!(plan.collisions[1].reason, CollisionReason::FileOnDisk);
    }

    #[test]
    fn rejects_oversized_input_before_planning() {
        let entries = [ManifestEntry {
            path: "game.exe".to_owned(),
            flags: 0,
            size: 12,
            chunk_count: 1,
        }];
        let limits = PlanningLimits {
            max_manifest_entries: 0,
            ..PlanningLimits::default()
        };
        assert!(matches!(
            plan_manifest_application(1, &entries, &[], limits),
            Err(PlanningError::TooManyItems {
                field: "manifestEntries",
                actual: 1,
                limit: 0
            })
        ));
    }

    #[cfg(feature = "host")]
    #[test]
    fn manifest_ids_serialize_without_javascript_precision_loss() {
        let id = ManifestId(7_633_204_652_048_533_395);
        let json = serde_json::to_string(&id).unwrap();
        assert_eq!(json, r#""7633204652048533395""#);
        assert_eq!(serde_json::from_str::<ManifestId>(&json).unwrap(), id);
    }
}
