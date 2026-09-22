# Reverse-engineering center

The canonical local reverse-engineering workspace is [`data/re`](../../data/re/00-index/README.md).

`docs/re` intentionally contains only this lightweight entry point. Binaries,
VFS inventories, Ghidra projects, dumps, derived data, IECODE snapshots, and
machine-generated manifests live together under `data/re` so documentation
cannot drift into a second archive.

The local-to-canonical consumer and parity decision is recorded in
[`PARITY-AUDIT-2026-09-07.md`](PARITY-AUDIT-2026-09-07.md). It complements
[`docs/COMPUTER-USE-RE-TRACE.md`](../COMPUTER-USE-RE-TRACE.md) for the `nie-re`/`nie-trace` bridge.

## RE anchors

Knowledge base (`var/nie.sqlite`) tables:
- `function` — all 117 068 functions of `nie.exe`
- `coverage` — coverage rate of `.pdata` entry points
- `xref` — call-graph relationships
- `rtti_class` — RTTI MSVC classes
- `pdata_func` — 55 351 authoritative function start addresses
- `hash_name` — VFS and UI hash tables
- `forge_unit` — unit definitions for byte-exact forge

Key binary reference addresses:
- `0x1404ecd60` — Core character controller
- `0x1406d5840` — Core game state tick loop
