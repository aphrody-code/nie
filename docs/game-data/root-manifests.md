# IEVR data manifests

This page describes the retained repository data under `data/azalee/`. The
directory contains only material that has a recorded origin in one of these
sources:

- the game VFS and its native CPK resources;
- a native `nie` export from those resources;
- a verified `inagle` mirror/materialization;
- the official `zukan` corpus.

The Rust crates own parsing and domain rules. JSON and compressed NDJSON files
in this directory are bounded generated indexes or verified materializations,
not a second database and not a replacement for the VFS.

## Retained files

| File | Origin | Purpose |
|---|---|---|
| `cpk-index.ndjson.gz` | game VFS / CPK index | Native resource presence and path lookup |
| `game-text-dialogue.ndjson.gz` | game VFS text resources | Localized dialogue lookup |
| `game-text-names.ndjson.gz` | game VFS text resources | Localized name lookup |
| `icon-texture-index.ndjson.gz` | game VFS textures | Verified icon texture lookup |
| `character-face-manifest.json` | game VFS | Existing character face resources |
| `character-model-manifest.json` | game VFS | Existing character model resources |
| `chr-model-manifest.json` | game VFS | Existing `common/chr` model and texture resources |
| `item-image-manifest.json` | game VFS | Existing item icon resources |
| `menu-asset-manifest.json` | game VFS | Existing menu assets and anti-404 gates |
| `menu-gallery-manifest.json` | game VFS | Existing menu gallery textures |
| `keshin-model-manifest.json` | game VFS | Existing Keshin and armoured model descriptors |
| `miximax-icon-manifest.json` | game VFS plus verified `inagle` rows | Non-derivable Miximax icon joins |
| `emblem-crc-map.json` | game VFS plus `inagle` identifiers | Verified team-emblem CRC mappings |
| `change-aura-skills.json` | verified `inagle` entries | Aura-to-character ownership joins |
| `item-enrichment.json` | verified `inagle` parser and game text | Item values absent from flat mirror columns |
| `passives-full.json` | native `nie` export | Generated IEVR passive instances and scaling data |
| `skills-cutin.json` | native `nie` export | Skill cut-in metadata and native resource paths |
| `skills-cutin-served.json` | game VFS gate | Cut-ins whose required native resources exist |
| `zukan-audit.json` | official `zukan` plus verified mirror | Reconciliation report |
| `zukan/param_en.json` | official `zukan` | English character parameter corpus |

## Runtime data

The read-only `inagle_*` SQLite materialization is kept under `var/` and is
never copied into this directory or into an application package. The canonical
Rust mirror owner is `crates/tools/nie-wiki`; `crates/tools/nie-site` and
`crates/tools/nie-cli` are its native bindings.

Cloud schema snapshots, Supabase exports, community passive sheets, generated
game dumps, and external CDN inventories are not retained IEVR data sources.
`Cross` is a separate Unity game and remains outside this IEVR directory.

## Regeneration

Use the repository's Rust exporters or the bounded VFS index commands. Every generator must fail
closed when the required VFS, `nie`, or `zukan` source is absent; it must not fetch a
cloud database or silently substitute an external catalog.
