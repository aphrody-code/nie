# Fan mods, game versions and creation workflow

This repository supports fan modifications as source-authored VFS changes. It does not ship ROMs,
ISOs, decrypted game archives, console keys, copyrighted video, or third-party mod payloads.
Obtain the base game and a mod from their lawful owner/author, then keep the original installation
separate from the modded working tree.

## Version inventory

The canonical game and platform inventory lives in `packages/nie-media/src/canon.ts`:

| Work | Platforms in the current measured catalogue | Rust owner closest to the content |
|---|---|---|
| Inazuma Eleven 1/2/3 | Nintendo DS | `nie-formats` (reader; no DS emulator in this repository) |
| Inazuma Eleven GO / Chrono Stones / Galaxy | Nintendo 3DS | `nie-formats` (reader; no 3DS emulator in this repository) |
| Inazuma Eleven Strikers / 2012 Extreme / GO Strikers 2013 | Wii | `nie-formats` (reader; no Wii emulator in this repository) |
| Victory Road | Switch, Switch 2, PS4, PS5, Xbox, PC/Steam | `nie-steam::emulator` for the PC Steam API; `nie-formats` for other platform data |
| Cross | iOS, Android, mobile | `nie-formats` (reader; no mobile emulator in this repository) |

The release list is intentionally an anchor list, not an invented patch database. Add a concrete
game version only with a source URL, region/platform, and measured build identifier. Every release
is exposed through `CANONICAL_GAME_RELEASES`; every game work carries `runtimeLinks` for its
platforms.

## How to obtain a game or a mod

1. Obtain the game from its official store, an original cartridge/disc, or the platform account
   that legitimately owns it. For Victory Road, use the official product page and the platform
   edition matching the mod's `version_jeu`.
2. Obtain a fan mod from its author's release page or repository. Do not use a ROM/ISO mirror,
   cracked executable, leaked key, or repack that bundles the original game.
3. Check the mod's `mod.json`: `jeu`, `version_jeu`, `dependances`, `priorite`, `source_url`,
   `release_url`, `license`, and `sha256` identify what it targets and where it came from.
4. Test in a disposable copy. Keep the vanilla `cpk_list.cfg.bin` as the recovery baseline.
5. Verify the resulting VFS and launch only the supported platform. Unsupported console rows are
   readable/inspectable contracts, not claims that niers emulates that console.

## Mod directory format

```text
mods/my-mod/
  mod.json
  README.md
  LICENSE
  data/common/text/fr/chara_text.cfg.bin
  data/common/gamedata/character/chara_param_1.03.66.00.cfg.bin
```

All game files must retain their exact `data/...` VFS path. Flattened names are rejected because
the game would silently ignore them. `mod.json` is metadata and is not installed into the VFS.

Example metadata:

```json
{
  "nom": "Example VFS mod",
  "auteur": "Author",
  "version": "1.0.0",
  "description": "A small, reversible data override",
  "jeu": "IEVR",
  "version_jeu": "Steam-<measured-build>",
  "source_url": "https://author.example/mod",
  "release_url": "https://author.example/mod/releases/1.0.0",
  "license": "CC-BY-4.0",
  "sha256": "<sha256-of-the-release-archive>",
  "dependances": [],
  "priorite": 10
}
```

## How to create one

1. Start from a clean, legally obtained installation and dump/inspect only the files you are
   allowed to modify. Use `nie-formats` to identify by magic, not by extension.
2. Create the manifest with `nie_viola::Manifeste::gabarit`, set the target game/build, source,
   license and checksum, then run `valider_arborescence`.
3. Change the smallest possible VFS files. Use the existing Rust encoders only where an encoder
   exists; otherwise preserve the original format and add a round-trip/golden test before
   distributing it.
4. Merge dependencies in manifest order with `nie-viola::ordonner` and `merge_dirs`. The higher
   priority mod wins; duplicate names and dependency cycles are errors.
5. For a PC loose-file build, call `nie-viola::pack_mod` with the untouched vanilla
   `cpk_list.cfg.bin`. It detects and preserves the original AES/Viola/plain envelope and writes
   the output atomically.
6. For `.utmod` files, inspect the package with `nie-launcher package info`; never install a
   package whose target/build, source or checksum cannot be established.
7. Test load, rollback, and a second install. Never overwrite the only vanilla copy. Save-file
   mods are a separate path handled by `nie-launcher`/`nie-save`, not mixed into a VFS asset mod.

## What “all fan mods” means here

Community releases change and cannot be truthfully enumerated from this checkout. The repository
therefore accepts every verified mod through one manifest and one Rust installer path, while
refusing to fabricate entries for releases that have no author source, target build, checksum or
license. A new community mod is complete only when its metadata and compatibility evidence are
recorded; its copyrighted payload remains outside this repository.
