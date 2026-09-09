# Retired community exports

This document used to describe spreadsheet and community snapshots stored
under `data/exports/`. Those files were not a sufficient source of truth for
IEVR: they were not directly read from the game VFS, native `nie` formats,
verified `inagle` materializations, or the official `zukan` corpus.

The retired `passive-sheets.json` export was removed. Its passive rules are now
served by the Rust `nie-wiki` owner and the verified native export
`data/azalee/passives-full.json`.

The current IEVR inventory is documented in
[`root-manifests.md`](./root-manifests.md). The canonical implementation lives
in `crates/engine/nie-core`, `crates/tools/nie-wiki`, `crates/tools/nie-cli`,
and `crates/tools/nie-site`.
