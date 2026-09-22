# Inazuma console pipeline

Measured 2026-09-22. This is the integration boundary for legally dumped Inazuma Eleven
software on Nintendo DS, Nintendo 3DS, Wii, and Android. It does not download, redistribute, or
embed games, BIOS files, keys, NAND images, or proprietary SDKs.

## Ownership

`niers` remains a thin compatibility surface. `nie-emu` is the single in-process owner for
execution, inspection, saves, memory, extraction and mod capability contracts. Rust backends
are linked directly; C/C++/C#/Python implementations are migration sources or shared-library/
WASM FFI providers. No emulator operation may invoke a CLI or spawn a subprocess.

The pipeline is an adapter over existing owners:

| Stage | Canonical owner | External adapter | Output |
|---|---|---|---|
| Acquire and fingerprint | `nie-formats` + provenance manifest | User-owned cartridge/disc/APK dump | SHA-256 inventory, platform and title candidate |
| Container extraction | `nie-formats` where Level-5 is understood | `ninfs`, `pyctr`, Project_CTR, Wiimms ISO Tools | Read-only extracted staging tree |
| Level-5 decoding | `nie-formats` | None | Typed CPK, CFG, G4*, Criware and archive records |
| Data ingestion | `nie-data`, `nie-index`, `nie-seed` | None | Canonical indexed records and evidence |
| Reverse engineering | `iecode-re`, `nie-re`, `nie-dump`, `nie-trace` | Emulator debugger only when needed | Reproducible offline evidence |
| Mod authoring | `nie-viola`, `nie-launcher`, `nie-formats` | `Lynx`, `Strikers2013Editor` as compatibility references | Validated overlay or save/mod package |
| Saves | `nie-save`, `nie-launcher::save` | `Strikers2013Editor`, NoFarmForMe compatibility behavior | Versioned save analysis/edit with backup and hash |
| Live memory | `nie-trace`, Inacord `live_mod` | Former IEVR Save Editor hooks as measured references | Guarded read/write session evidence |
| Launching | `nie-launcher`, `nie-steam` | Former EACLauncher behavior and emulator runners | Explicit offline launch profile and health result |
| Runtime verification | `nie-emu` | Dust and Gecko-Wii as native Rust examples; Azahar/Dolphin through FFI/WASM | In-process emulator result, never a source of truth |
| Mobile packaging | `nie-formats` for known assets | Android package inspection only | Read-only APK/asset inventory |

External repositories are migration sources or dynamic-library/WASM FFI providers. They must not
be invoked as subprocesses, copied into the Rust workspace as duplicate owners, reimplemented in
Bun, or made owners of Inazuma data. Their public operations are absorbed into `nie-emu` one by
one and verified against user-owned fixtures.

The same rule applies to C and C# utilities: a tool is admitted only for a capability that the
Rust workspace does not already own. `nie-viola` replaces the old Level-5 archive/modding tools;
`nie-formats` replaces format readers already proven against the Inazuma VFS; and `nie-dump`
replaces the minidump scanner. The external tool remains an optional, version-pinned adapter or a
compatibility oracle.

## Expanded repository audit

The authenticated `gh search` audit was repeated on 2026-09-22 across the Aphrody account,
GitHub repository/code search, GitLab project search, and Japanese/Spanish web terminology. The
following repositories were missing from the first pass:

| Repository | Language | Decision | Reason |
|---|---|---|---|
| [`aphrody-code/winDS`](https://github.com/aphrody-code/winDS) | C++ | oracle | Aphrody fork of melonDS; keep as a reference, not a second DS owner |
| [`aphrody-code/dscode`](https://github.com/aphrody-code/dscode) | unknown | inspect-only | Empty/undocumented repository in the authenticated listing |
| [`aphrody-code/iecode-csharp`](https://github.com/aphrody-code/iecode-csharp) | C# | historical oracle | Preserved IECODE reference; canonical runtime is `nie` |
| [`aphrody-code/iecode-cpp`](https://github.com/aphrody-code/iecode-cpp) | C++ | historical oracle | Preserved C/C++ comparison toolkit; canonical runtime is `nie` |
| [`Tiniifan/InazumaElevenSaveEditor`](https://github.com/Tiniifan/InazumaElevenSaveEditor) | C# | oracle | Open-source GO/Chrono Stones/Galaxy save coverage |
| [`SwareJonge/Inazuma-Eleven-Toolbox`](https://github.com/SwareJonge/Inazuma-Eleven-Toolbox) | C# | oracle | Older multi-game editor; useful for DS/3DS field comparison |
| [`ThatPlayer2/Inazuma-Eleven-Save-Editor`](https://github.com/ThatPlayer2/Inazuma-Eleven-Save-Editor) | unknown | oracle | Toolbox-based fork; compare behavior, do not duplicate it |
| [`wfee2000/IESE`](https://github.com/wfee2000/IESE) | C# | oracle | Cross-platform save-editor candidate, coverage must be measured per title |
| [`Tiniifan/UltimateGalaxyRandomizer`](https://github.com/Tiniifan/UltimateGalaxyRandomizer) | C# | oracle | Galaxy-only randomizer; test transformations against owned dumps |
| [`Tiniifan/InazumaElevenGoMapenv`](https://github.com/Tiniifan/InazumaElevenGoMapenv) | Python | adopt as fixture | GO mapenv compiler/decompiler; candidate for a Rust round-trip port |
| [`Tiniifan/InazumaElevenMapEventEditor`](https://github.com/Tiniifan/InazumaElevenMapEventEditor) | C# | oracle | GO map-event authoring reference |
| [`obluda3/Strikers2013-Tools`](https://github.com/obluda3/Strikers2013-Tools) | C# | oracle | Wii archive/text/graphics/font tooling |
| [`obluda3/strikers2013-xtreme`](https://github.com/obluda3/strikers2013-xtreme) | C++ | oracle | Wii custom-code/mod build reference; proprietary compiler stays external |
| [`SwareJonge/IEStrikers`](https://github.com/SwareJonge/IEStrikers) | C | oracle | Wii Strikers decompilation/build reference |
| [`CacaBueno64/ie3ogres`](https://github.com/CacaBueno64/ie3ogres) | Assembly | oracle | DS IE3 decompilation; requires the operator's own source dump |
| [`migueleven/Buscador-Inazuma`](https://github.com/migueleven/Buscador-Inazuma) | Python | oracle | DS model/sprite location finder |
| [`Javiju555/IE-repack`](https://github.com/Javiju555/IE-repack) | Rust | oracle | Spanish 3DS translation repacker; no ROMs, useful for patch provenance |
| [`Adr1GR/IEVR_Mod_Manager`](https://github.com/Adr1GR/IEVR_Mod_Manager) | C# | superseded | Its documented dependency is `Viola`; use `nie-viola` instead |
| [`Telmo26/IEVR-Toolbox`](https://github.com/Telmo26/IEVR-Toolbox) | Rust | superseded | Reimplements Viola-style Victory Road dumping; do not create a second owner |

The remaining GitLab hits (`dalosa/inazuma*`, generic DS emulators, ROM collections and unrelated
Wii projects) were rejected because they were empty, unrelated, or distributive rather than
Inazuma tooling. Japanese pages such as the old Strikers code archive and Spanish sources such as
InazumaLife, eol forums and translation guides are retained as provenance/terminology references,
not executable dependencies. Public guides that link opaque downloads or anti-cheat bypasses are
not treated as source material.

## Saves, memory editors, launchers and NoFarmForMe

The complete discovered surface is converged as follows:

- `nie-save` owns the native save format implementation: decrypt, inspect, edit, re-encrypt,
  validate and round-trip. It is the only save implementation allowed in the Rust workspace.
- `nie-launcher::save` owns slot parking, save coordination, team-slot injection and mod-package
  metadata. `nie-launcher::ut` owns the Ultimate Team payloads and launcher-facing data.
- `nie-trace` and Inacord `live_mod` own live memory inspection and guarded writes. The extracted
  IEVR Save Editor memory signatures remain evidence and regression fixtures; the .NET editor is
  not reintroduced as a runtime dependency.
- `nie-launcher` and `nie-steam` own launch profiles, Steam acquisition and the already measured
  EAC/launcher behavior. No second EAC launcher or Discord/service launcher is added.
- **NoFarmForMe/NFFM** is a historical 3DS Inazuma GO save-editor workflow for player edits,
  version links and download-content flags. Its public distribution is not a verified source
  repository or license, so it is recorded as a behavior oracle only: do not clone, redistribute,
  download, or execute an unverified archive. Reproduce only behavior that can be validated from
  user-owned saves and documented in `nie-save` tests.

Every save operation must preserve the original file byte-for-byte, write to a run-specific
staging directory, record the game/version/platform, hash before and after, and refuse a save
whose format or title identity is not proven. Memory editing is disabled by default and requires a
live process identity plus an explicit force/confirmation boundary.

## Selected projects

### DS

- [Dust](https://github.com/kelpsyberry/dust): Rust Nintendo DS emulator, retained in
  `var/emu/dust` for runtime smoke tests.
- [melonDS](https://github.com/melonDS-emu): C++ reference emulator for compatibility checks;
  use an installed build or an explicit operator path, not a vendored clone.
- `ninfs` is the extraction bridge because it can mount `.nds`/`.srl` images read-only.

### 3DS

- [Azahar](https://github.com/azahar-emu/azahar): current C++ 3DS runtime, including Android
  builds.
- [Project_CTR](https://github.com/3DSGuy/Project_CTR): C tools for reading/extracting and
  creating CTR containers; invoke only on user-provided images.
- [PyCTR](https://github.com/ihaveamac/pyctr): MIT Python library for metadata, NCCH, ExeFS,
  RomFS, saves, and SD/NAND records.
- [ninfs](https://github.com/ihaveamac/ninfs): MIT read-only FUSE/mount bridge for CIA, CCI,
  NCCH, ExeFS, RomFS, DS images, saves and SD contents.
- [Lynx](https://github.com/Tiniifan/Lynx): Inazuma Eleven GO data editor reference for
  extracted RomFS overlays; its format knowledge must be translated into `nie-formats`, not
  duplicated as a second editor.

### C and C++ adapters

- [3dstool](https://github.com/dnasdw/3dstool): C++ CTR/NCCH/ExeFS/RomFS extraction and rebuild
  oracle when a container is not yet handled by `nie-formats`.
- [Project_CTR](https://github.com/3DSGuy/Project_CTR): C CTRTool/MakeROM utilities for 3DS
  container inspection and homebrew packaging.
- [Wiimms ISO Tools](https://github.com/Wiimm/wiimms-iso-tools): C ISO/WBFS/WDF extraction and
  rebuild adapter for Wii discs.
- [decomp-toolkit](https://github.com/encounter/decomp-toolkit): Apache-2.0 GameCube/Wii
  decompilation and disc inspection utilities; use for Wii code/data work not owned by
  `nie-formats`.
- Dolphin, Azahar and melonDS remain external C++ runtime oracles, not vendored libraries.

### C# adapters and references

- [Lynx](https://github.com/Tiniifan/Lynx): C# Inazuma Eleven GO Light/Shadow editor. Use it to
  compare extracted RomFS edits; the canonical implementation belongs in Rust.
- [Strikers2013Editor](https://github.com/obluda3/Strikers2013Editor): C# MIT editor and save
  reference for Strikers 2013. Use only with an extracted user-owned ISO and keep its fixtures
  outside the repository.
- [ndsSharp](https://github.com/h4lfheart/ndsSharp): C# DS ROM parser reference. It is a
  compatibility oracle only until its licensing and format coverage are independently recorded.
- [AssetStudio](https://github.com/Perfare/AssetStudio): C# Unity asset inspection reference
  for a mobile package when the target is actually Unity-based; it is not an Inazuma format
  owner and must not be assumed applicable.

### Python adapters

- [ninfs](https://github.com/ihaveamac/ninfs): read-only mounts for DS/DSi and 3DS containers.
- [PyCTR](https://github.com/ihaveamac/pyctr): MIT metadata/container/save library for 3DS.
- [3DSkit](https://github.com/Tyulis/3DSkit): multi-console extraction/repack reference for
  NDS/3DS archive formats.
- [inz_cond](https://github.com/Tiniifan/inz_cond): Inazuma 3DS condition compiler/decompiler;
  use as a test oracle until its behavior is covered by a Rust format module.

### Wii

- [Dolphin](https://github.com/dolphin-emu/dolphin): C++ GameCube/Wii runtime and the primary
  compatibility runner for Strikers.
- [Wiimms ISO Tools](https://github.com/Wiimm/wiimms-iso-tools): C extraction/rebuild tool for
  ISO/WBFS; use it as a staging adapter.
- [Gecko-Wii](https://github.com/Torashi1069/emu.nintendo.wii.gecko): Rust development/debug
  emulator, retained in `var/emu/gecko-wii` for Rust-side experiments and homebrew fixtures.
- [Strikers2013Editor](https://github.com/obluda3/Strikers2013Editor): MIT editor/save-tool
  reference for `Inazuma Eleven GO Strikers 2013`; compatibility fixtures belong in tests, not
  in the core pipeline.

### Android and mobile

- Azahar is the 3DS Android runtime when the target is a 3DS Inazuma release.
- Android package inspection is a separate read-only adapter. It may record APK/AAB metadata and
  extract assets from an operator-provided package, but it does not bypass signing, licensing,
  DRM, network authentication, or paid-content controls.
- No relevant Rust emulator for an Inazuma-native mobile release was found. Do not clone a generic
  Android emulator or confuse an Android controller app with an emulator.

## Unified flow

```text
owned media
  -> identify + SHA-256 + provenance
  -> read-only container mount/extract
  -> Level-5 format decode in nie-formats
  -> indexed evidence in nie-index / nie-seed
  -> mod overlay through nie-viola
  -> validate round-trip and hashes
  -> run smoke test in the platform runner
  -> publish only the manifest and derived non-copyright metadata
```

The input remains immutable. Every write goes to a per-run staging directory under `var/` and
must produce a manifest containing source hash, tool version, command, output hashes, license and
whether the result is an extraction, a mod overlay, or a test fixture. A failed validation cannot
be promoted to a runtime or mod package.

## First implementation boundary

The next code batch should add one Rust library crate for the pipeline manifest and stage graph,
then expose it through the existing `niers` CLI and MCP binding. It should reuse `nie-formats`,
`nie-viola`, `nie-index`, `nie-seed` and `nie-dump`; it should not add a second parser or vendor
an emulator. The initial `nie-emu` registry now owns platform/backend identity and capability
contracts; external commands are optional capabilities discovered at runtime and recorded in the
manifest, never compile-time dependencies.
