# Inazuma Eleven VR - Save Editor & Memory Trainer Port

Comprehensive technical specification and reverse-engineering audit for the port of `ievrsaveeditor.com` (InazumaElevenVRSaveEditor v2.2.2 by "An Average Developer" / GameBanana Tool #21299) into the native Rust workspace `aphrody-code/nie` (`nie`).

---

## 1. Provenance & Binary Architecture

- **Source Application**: `InazumaElevenVRSaveEditor.exe` (v2.2.2, 88.9 MB, .NET 9 SingleFile bundle, `win-x64`).
- **Inner Application Assembly**: `app_extracted.dll` (carved at PE offset `0x1444000`, size 14,364,672 bytes).
- **Embedded Metadata**:
  - `#~` (Metadata tables): 253 TypeDefs, 2,301 MethodDefs, 1,814 Fields, 191 FieldRVAs.
  - `#Strings`: 86,944 bytes of identifiers.
  - `#US` (UserStrings): 181,784 bytes (4,604 UTF-16 user strings).
- **Native Execution Paradigm**:
  The application uses `OpenProcess`, `VirtualAllocEx` (allocated within a ±2 GB range of the target instruction to allow 32-bit near `jmp`/`call`), `VirtualProtectEx`, `ReadProcessMemory`, and `WriteProcessMemory`.
  This is 100% equivalent to and now unified within `crates/forge/nie-trace` and `crates/tools/nie-launcher`.

---

## 2. Memory Catalog & Hook Specification (`nie-trace::catalog`)

All 33 memory signatures and injection points are mapped in [`crates/forge/nie-trace/src/catalog.rs`](file:///home/ubuntu/nie/crates/forge/nie-trace/src/catalog.rs):

### 2.1 Player & Abilearn Board
- `max-abilities`: AOB `44 8B 6F 10 8B 47 04`, RVA `0xD8FF75`, Field `+0x10`. Forces player stats to maximum.
- `enhance`: AOB `44 8B 81 ?? ?? ?? ?? 48 ?? ?? 45 ?? ?? 0F ?? ?? ?? ?? ?? 66`, RVA `0x1194FB6`. Item enhancement.
- `player-level`: AOB `FF ?? 48 ?? ?? ?? 40 88 7D ?? 49 8B CF`, RVA `0xC72400`. Direct player level hook.
- `badge-slot`: AOB `66 83 B8 E8 01 00 00 1E`, Field `+0x1E8`. Unlocks the 30 badge slots in the Abilearn Board.

### 2.2 Match Cheats
- `tension`: AOB `8B 80 58 10 00 00 EB ?? 8B ?? 80`, RVA `0xEB5D8D`, Field `+0x1058`. Match tension gauge control.
- `rank`: AOB `48 8B 81 ?? ?? 00 00 4C 8B 89 ?? ?? 00 00 8B 50 5C 33 C0`, RVA `0xE6AA57`, Chain `[+0x69C8] + 0x5C`. Match rank capture and editing.
- `match-time`: AOB `F3 0F 59 C6 F3 0F 58 ?? ?? ?? ?? ?? F3 0F 11 ?? ?? ?? ?? ?? EB`, RVA `0x16831B9`, Field `+0x2208`. Match timer manipulation.
- `special-moves-cooldown`: AOB `F3 0F 5C ?? 0F ?? ?? F3 ?? ?? ?? 77 ?? 89`, RVA `0x15B51DE`. Instant special move cooldown.
- `special-tactics-cooldown`: AOB `76 ?? F3 0F 5C ?? 0F 2F C6 F3 0F 11 84`, RVA `0x16CB9EC`. Instant tactics cooldown.
- `freeze-time-ok-to-pass`: AOB `0F ?? ?? ?? ?? ?? F3 ?? ?? ?? B9 ?? ?? ?? ?? F3 0F 58 83 ?? ?? ?? ?? F3`, RVA `0x14ED6DE`. Freezes the "OK to pass" timer.
- `freeze-time-special-move`: AOB `F3 0F 10 83 ?? ?? ?? ?? F3 41 0F 58 ?? ?? F3 0F 5D ?? F3`, RVA `0x14EE985`. Freezes move execution timers.
- `freeze-time-goal-keeper`: AOB `75 ?? F3 ?? ?? ?? F3 41 0F 5C ?? F3 ?? ?? ?? F3`, RVA `0x152322E`. Freezes goalkeeper reaction timer.
- `end-match-99-0-score`: AOB `88 81 ?? ?? ?? ?? 49 8B 88 ?? ?? ?? ?? 0F B6 83 ?? ?? ?? ?? 88 81 ?? ?? ?? ?? 49 8B 90 ?? ?? ?? ??`. Forces 99-0 score injection.
- `end-match-99-0-half`: AOB `44 88 8A ?? ?? ?? ?? 0F B6 8B ?? ?? ?? ?? 80 F9 01 74 ?? E8 ?? ?? ?? ?? 4C 8B 05 ?? ?? ?? ??`. Forces match half-time trigger.
- `end-match-99-0-time`: AOB `F3 0F 58 86 ?? ?? ?? ?? F3 0F 11 86 ?? ?? ?? ?? EB ??`. Sets match clock directly to 30:00.
- `goal-trigger`: AOB `44 0F B6 84 08 ?? ?? 00 00 EB`. Goal event hook fallback.

### 2.3 Shop & Economy
- `free-buy-shop`: AOB `4C 8B 7C 24 ?? 8B ?? 4C 8B 64`. Free shop purchases.
- `free-buy-spirit-market`: AOB `0F B7 C6 41 89 06 0F`, RVA `0xE62D1D`. Free spirit market purchases.
- `free-buy-spirit-market-call`: AOB `49 8B ?? 0F B7 D7 E8 ?? ?? ?? ?? 4C`. Secondary call hook.
- `drop-rate`: AOB `F3 0F 10 B0 ?? 00 00 00 F3 0F 58 70 1C`, RVA `0xC27CF4`, Field `+0x1C`. Drop rate multiplier.
- `store-item-multiplier`: AOB `89 4E 10 8B C3`, RVA `0x209A45` (alternatives `0x208965`, `0x208CC5`), Field `+0x10`. Injects `x2457` multiplier on item acquisition.

### 2.4 Spirits & Cards
- `spirit-increment`: AOB `66 89 70 10 EB 41 3C 05`, RVA `0xDC0B25`, Field `+0x10`. Auto-increments spirits on use.
- `elite-spirit-increment`: AOB `66 41 89 74 42 14 4C 8B 74 24 40`, RVA `0xDC0B66`, Field `+0x14`.
- `spirit-card`: AOB `49 8B 07 49 8B CF FF 50 30 ?? ?? ?? ?? 44 8B`, RVA `0xDBFB29`. Injects cards into user collection.
- `add-spirit`: AOB `4D 8B 7C ?? 08 4D ?? ?? 0F 84 ?? ?? ?? ?? 49`, RVA `0xDBFB1B`.
- `spirit-list`: AOB `48 69 E9 28 01 00 00 49 03 2E 74 ?? 39 ?? ?? 74`, RVA `0xE9271A`, Field `+0x128` (record stride).
- `spirit-id`: AOB `49 8B ?? 48 8B 51 18 49 8B ?? FF D2 39 30`, RVA `0xC9DC1F`, Field `+0x18`.
- `unlimited-spirits`: AOB `75 03 8B 58 10 49`, Field `+0x10`. Unlimited Hero/Fabled spirits in team.
- `unlimited-spirits-dock`: AOB `75 ?? 8B 40 10 48`, Field `+0x10`. Secondary team dock check bypass.

### 2.5 Passives & Move Editing
- `passive-value`: AOB `48 8B 0F 0F 57 C9 F3 ?? ?? C8 E8 ?? ?? ?? ?? EB`, RVA `0xC14385`. Live passive value editing.
- `special-move-type`: AOB `E8 ?? ?? ?? ?? 48 85 C0 74 3F 8B 58 04`, Field `+0x04`. Move slot type override.
- `custom-passives`: AOB `75 03 45 8B 3E 45 ?? ?? 74 ?? 48 ?? ?? ?? ?? ?? ?? 48 ?? ?? 74 ?? 4C`, RVA `0x165D4DA`.
- `custom-passives-summon`: AOB `42 8B BC AB ?? ?? 00 00`, RVA `0xE7A070`.

---

## 3. Spirit Roster & Moves Database (`nie-launcher::spirit`)

- **142 Spirit Cards**: Full roster with color variants (`Pink`, `White-Black`, `Red`, `Black`) and 32-bit spirit hashes.
  - Examples:
    - Mark Evans (`White-Black`): `0x8EEDF4C6`
    - Mark Evans (`Pink`): `0xA7254034`
    - Axel Blaze (`White-Black`): `0x9634AFB0`
    - Axel Blaze (`Pink`): `0xBFFC1B42`
    - Jude Sharp (`White-Black`): `0xA6B01E2E`
    - Jude Sharp (`Pink`): `0xC567EB6A`
- **1,299 Special Moves**: Complete database with 32-bit CRC32/Murmur IDs and categories (`Shot`, `Catch`/`Goalkeep`, `Dribble`, `Block`).
  - Examples:
    - `0x016DEA27`: Accelerator Gears (Shot)
    - `0x5AF33BC7`: God Hand (Goalkeep)
    - `0xB8C5883B`: God Hand X (Goalkeep)
    - `0xE647BCEE`: God Hand V (Goalkeep)

---

## 4. Single Unified Pipeline Integration

All features are unified under the canonical CLI binary `nie` and MCP server:

```bash
# Query spirit cards
nie launcher spirit cards -q "Axel Blaze"

# Query special moves by category
nie launcher spirit moves -q "God Hand" -c Goalkeep

# Inspect memory catalog
nie mem catalog --category match

# Apply memory recipes live
nie mem recette --file recipe.txt --force

# EAC offline bypass
nie launcher eac scan --file nie.exe
nie launcher eac patch --file nie.exe -o nie_patched.exe

# Save container swap & team injection
nie launcher save park --live-save 002AB8F4-USERDATALIVE --mod-save custom.sav
nie launcher team decrypt --file team.json
```
