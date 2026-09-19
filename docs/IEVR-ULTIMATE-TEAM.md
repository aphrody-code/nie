# IEVR Ultimate Team — Reverse-Engineering and Architectural Specification

This document provides a comprehensive reverse-engineering report and technical specification for
**Inazuma Eleven: Victory Road Ultimate Team (IEVR Ultimate Team)**, analyzing:
- The Web Application: `https://ievr-ultimate-team.fly.dev/`
- The Desktop Launcher: `UTLauncher.exe` (Google Drive `1tmcEfcsD8sEMBcY8NC7JddOmrwqRPVdw`)
- The Official Mod Package: `UTMod.utmod` (`IEVR_Ultimate_Team_OPEN_BETA.zip`)
- The DRM & Licensing Service: `https://ievr-key-service.lilkitools.workers.dev/`
- The Native Anti-Cheat & VFS Hooks: `AbsorbDefenseWall.dll` and `UltimateTeamVfs.dll`
- The Save Editor Engine: `ievr_save_character_editor.py` & save container crypto (`0x9DCE66C3`)

---

## 1. System Architecture

```mermaid
flowchart TD
    subgraph Web ["Web Platform (https://ievr-ultimate-team.fly.dev/)"]
        UI["Vite + React SPA<br/>(Plantilla, Tienda, Mercado, Jugar)"]
        Supa[("Supabase (ovgasnwnfnlvczmtpfrb)<br/>40 Tables, 154 RPCs, 10 Edge Functions")]
        Export["exportarPlantilla<br/>AES-256-GCM + PBKDF2<br/>(Passphrase: Rmfr4Dic6...)"]
        UI --> Supa
        UI --> Export
    end

    subgraph DRM ["DRM & Auth (Cloudflare Worker)"]
        Worker["ievr-key-service.lilkitools.workers.dev"]
        DiscordOAuth["Discord OAuth2 PKCE<br/>(/v1/auth/discord/*)"]
        KeyEndpoint["Package Key Service<br/>(/v1/package-keys)"]
        Worker --> DiscordOAuth
        Worker --> KeyEndpoint
    end

    subgraph Launcher ["Desktop Client (UTLauncher.exe)"]
        Host[".NET 8 Single-File PE32+<br/>UTLauncher.dll + Core.dll"]
        PyRuntime["Embedded Python 3 Engine<br/>ievr_save_character_editor.py"]
        SaveSwap["Save Session Coordinator<br/>(USERDATALIVE <-> .bk)"]
        PackageDec["Package Decryptor<br/>(AES-256 + HMAC-SHA256)"]
        NamedPipe["Named Pipe Server<br/>(\\\\.\\pipe\\UTL_PIPE)"]
        
        Host --> PyRuntime
        Host --> SaveSwap
        Host --> PackageDec
        PackageDec --> NamedPipe
    end

    subgraph TargetGame ["INAZUMA ELEVEN Victory Road (nie.exe)"]
        ProxyD3D["D3DCompiler_47.dll<br/>(AbsorbDefenseWall.dll)"]
        ProxyWinmm["winmm.dll<br/>(UltimateTeamVfs.dll)"]
        SaveFile[("Steam Save<br/>002AB8F4-USERDATALIVE")]
        EngineLoop["Game Engine Loop<br/>(DefenseWall Patched)"]
        
        ProxyD3D -.->|Disables Check| EngineLoop
        ProxyWinmm -.->|Pipes Assets| NamedPipe
        ProxyWinmm -.->|Hooks I/O| EngineLoop
        SaveFile -.->|Loaded by| EngineLoop
    end

    Export -.->|Team JSON| Host
    DRM -.->|64-byte Key Material| PackageDec
    Host -.->|Parks & Replaces| SaveFile
    Host -.->|Injects / Copies DLLs| TargetGame
```

---

## 2. Web Application & Backend Analysis

### 2.1 Infrastructure & Hosting
- **Frontend**: Vite SPA hosted on Fly.io (`https://ievr-ultimate-team.fly.dev/`), served via Caddy.
- **Backend**: Supabase project `ovgasnwnfnlvczmtpfrb.supabase.co`.
- **Public Anon Key**:
  ```text
  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im92Z2FzbnduZm5sdmN6bXRwZnJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NTI2NjQsImV4cCI6MjEwMjIyODY2NH0.amPgGMw-j6i3FkhEQIMupNuLXbxzR9BiV67yztD2xSw
  ```
- **Storage Buckets**: `imagenes-inazuma` (cards, badges, kits, tactics, audio soundtrack).

### 2.2 Database Schema (40 Tables)
1. **Core Game Entities**: `jugadores` (character stats, IDs, CRC32, rarity), `equipos` (teams, badges), `supertacticas`, `supertecnicas`, `uniformes`, `formaciones`.
2. **User Club & Inventory**: `plantillas` (active squads/lineups), `mis_escudos`, `mis_supertacticas`, `mis_uniformes`, `usuarios`, `usuarios_cosmeticos`, `movimientos_saldo`.
3. **Packs & Shop**: `sobres` (pack catalog), `sobres_pendientes`, `precios_venta_rapida`.
4. **Marketplace & Auctions**: `subastas_vip`, `subastas_vip_config`, market items.
5. **Multiplayer & Matchmaking**: `partidos` (match history and PvP states), `vr_draft_config`, `vr_draft_probabilidades`.
6. **Social & Clans**: `clanes`, `clan_actividad`, `clan_banco_movimientos`, `clan_configuracion`, `clan_mensajes_chat`, `clan_rol_permisos`, `conversaciones_chat`, `notificaciones`.
7. **Administration & System**: `admins`, `beta_testers`, `contenido_paginas`, `game_flags`, `vip_planes`, `desafios_catalogo`, `desafios_plantilla_catalogo`, `desafios_progreso`.

### 2.3 Server RPC Functions (154 Stored Procedures)
All critical transactions and game balance rules are enforced in PostgreSQL functions:
- **Pack Opening**: `abrir_sobre`, `abrir_sobre_escudos`, `abrir_sobre_supertacticas`, `abrir_sobre_uniformes`.
- **Transfer Market**: `publicar_en_mercado`, `pujar_en_mercado`, `comprar_item_mercado`, `buscar_mercado`, `venta_rapida`.
- **Match Engine**: `partido_rapido_buscar`, `partido_rapido_confirmar_encontrado`, `partido_rapido_reportar_resultado`, `partido_rapido_confirmar_resultado`, `partido_rapido_disputar_resultado`.
- **VR Draft**: `vr_draft_iniciar`, `vr_draft_elegir_formacion`, `vr_draft_ofrecer_jugadores`, `vr_draft_elegir_jugador`, `vr_draft_ofrecer_tacticas`.
- **Team Management**: `asignar_equipo_inicial`, `cambiar_nombre_equipo`, `equipar_uniforme`, `guardar_nombre_y_escudo`.

### 2.4 Cryptographic Team Export (`exportarPlantilla`)
When the user clicks **ESPORTAR EQUIPO** in the web app, the client executes `exportarPlantilla-D5SK__eT.js`:
- **Cipher**: `AES-256-GCM`
- **Key Derivation**: `PBKDF2-SHA256`
- **Iterations**: `210,000`
- **Salt**: 16 random bytes
- **IV / Nonce**: 12 random bytes
- **Recovered Passphrase**:
  ```text
  Rmfr4Dic6EAQaSgmLF__S64v7AgTNXb3q7-BLsBO5_0
  ```

#### Exported JSON Payload Schema (Decrypted):
```json
{
  "formationId": 1,
  "emblemId": 105,
  "teamName": "Inazuma Japan",
  "tacticsId": [12, 14, 20],
  "uniformId": 3,
  "characters": [
    {
      "slot": 0,
      "param_id_crc": 305419896,
      "charaRarity": 5,
      "skill_count": 6
    }
  ]
}
```

#### Character Rarity Mapping:
| Web UI Label | In-Game Rarity Value (`charaRarity`) |
|---|---|
| Común | 2 |
| Raro | 3 |
| Legendario | 4 |
| Icono | 5 |
| Basara | 8 |

---

## 3. Desktop Client Architecture (`UTLauncher.exe`)

`UTLauncher.exe` is a 28.2 MB single-file Windows executable targeting `.NET 8.0` (`win-x64`).

### 3.1 Single-File Bundle Layout
- Bundle Version: `6.0`
- Bundle ID: `Q1FOQ58Nfw_V`
- Embedded Assemblies:
  1. `UTLauncher.dll` (27,801,088 bytes) — WPF UI, application controller, Steam detection.
  2. `UltimateTeamLauncher.Core.dll` (205,824 bytes) — DRM, named pipes, VFS manager, save coordinator.
  3. `UTLauncher.runtimeconfig.json` (429 bytes) — .NET 8 Desktop runtime configuration.
  4. `UTLauncher.deps.json` (914 bytes) — Assembly dependencies.

### 3.2 Extracted Embedded Resources
`UTLauncher.dll` embeds 11 internal manifest resources in its CLR resource stream (offset `0x19880`, size `26.3 MB`):
1. `UltimateTeamLauncher.Native.UltimateTeamVfs.dll` (181 KB): Native VFS interceptor.
2. `UltimateTeamLauncher.Native.AbsorbDefenseWall.dll` (106 KB): Native DefenseWall anti-cheat bypass.
3. `UltimateTeamLauncher.SaveEditor.ievr_save_character_editor.py` (123 KB, 2,936 lines): Full save editor.
4. `UltimateTeamLauncher.SaveEditor.ievr_save_tool.py` (11.7 KB): Save container crypto & checksum repair.
5. `UltimateTeamLauncher.SaveEditor.ievr_save_json.py` (15.7 KB): Plaintext save chunk parser.
6. `UltimateTeamLauncher.SaveEditor.ievr_save_mapper.py` (17.7 KB): Chunk purpose and field mapper.
7. `UltimateTeamLauncher.SaveEditor.ievr_save_teams.py` (13.5 KB): Team set structure parser.
8. `UltimateTeamLauncher.SaveEditor.ievr_character_collector.py` (42.6 KB): Character T2B cfg.bin collector.
9. `UltimateTeamLauncher.Runtime.Python.zip` (12.6 MB): Embedded portable Python 3.11 environment.
10. `UltimateTeamLauncher.SaveTemplate.USERDATALIVE` (12.5 MB): Clean base save baseline.
11. `UTLauncher.g.resources` (1.8 MB): WPF compiled XAML BAML and UI assets.

---

## 4. Mod Package Specification (`.utmod` / `UTMOD2`)

The mod distribution file `UTMod.utmod` (44 MB) contains game modifications and CPKs.

### 4.1 Header Format
| Offset | Type | Field | Value |
|---|---|---|---|
| `0x00..0x08` | `u8[9]` | `magic` | `UTMOD2\r\n\x1a` (`0x55544D4F44320D0A1A`) |
| `0x09..0x18` | `u8[16]` | `package_id` | 128-bit GUID (`eff56b73-d4c1-ab4f-926c-b6a8507f9501`) |
| `0x19..0x1C` | `u32` | `header_size` | Header metadata length |
| `0x1D..` | `bytes` | `payload` | Encrypted package entries |

### 4.2 DRM & Key Service Architecture
Key distribution is managed by a Cloudflare Worker:
- **Base URL**: `https://ievr-key-service.lilkitools.workers.dev/`
- **Authentication**: Discord OAuth2 PKCE (`/v1/auth/discord/start`, `/v1/auth/discord/attempts/{id}/poll`)
- **Key Retrieval**:
  - Endpoint: `POST /v1/package-keys`
  - Headers: `Authorization: Bearer <accountSessionToken>`, `Content-Type: application/json`
  - Body: `{"packageId": "eff56b73d4c1ab4f926cb6a8507f9501"}`
  - Response:
    ```json
    {
      "packageId": "eff56b73-d4c1-ab4f-926c-b6a8507f9501",
      "encryptedKeyMaterialBase64": "<base64_encoded_64_bytes>"
    }
    ```

### 4.3 Package Decryption & Verification
- **Key Material**: Exactly 64 bytes
  - Bytes `0..31`: AES-256 decryption key
  - Bytes `32..63`: HMAC-SHA256 authentication key
- **Integrity**: HMAC-SHA256 verification over ciphertext before decryption.
- **In-Memory Streaming**: The package is decrypted directly into memory (`DecryptServerPackageToMemoryAsync`). Decrypted files are never saved to disk.

---

## 5. Native Injection & Game Interception Pipeline

### 5.1 Anti-Cheat Bypass (`AbsorbDefenseWall.dll`)
Level-5 ships an anti-cheat / file integrity check called **DefenseWall** inside `nie.exe`.
- `AbsorbDefenseWall.dll` acts as a DLL proxy for `D3DCompiler_47.dll` located in the game directory.
- Exports: `D3DCompile`, `D3DReflect`, `IEVRWallPatchReady`.
- When `nie.exe` loads `D3DCompiler_47.dll`, `DllMain` attaches a patcher thread that scans memory for DefenseWall integrity scan functions and patches them in-place with `RET` / `NOP` instructions, preventing game tampering detection.

### 5.2 In-Memory VFS Interceptor (`UltimateTeamVfs.dll`)
To serve modded files and CPKs without modifying the Steam game files:
- `UltimateTeamVfs.dll` acts as a DLL proxy for `winmm.dll`.
- Exports: `timeBeginPeriod`, `timeEndPeriod`, `timeGetTime`.
- Hooks Win32 File APIs via IAT hooking:
  - `CreateFileW` / `CreateFileA`
  - `ReadFile`
  - `GetFileSize` / `GetFileSizeEx`
  - `GetFileAttributesW` / `GetFileAttributesExW`
  - `CreateFileMappingW` / `MapViewOfFile` / `UnmapViewOfFile`
- Reads environment variables:
  - `UTL_GAME_ROOT`: Path to real game installation.
  - `UTL_PIPE`: Name of the IPC named pipe (e.g. `\\.\pipe\UTL_...`).
- When `nie.exe` requests a game file or CPK:
  1. The hook checks if the requested relative path exists in the mod package.
  2. If matched, it requests the file data from `UTLauncher` across the named pipe.
  3. The data is returned directly into the game's buffer in memory.

---

## 6. Save File Architecture & Editing Engine

### 6.1 Container Structure (`002AB8F4-USERDATALIVE`)
- Header size: `0x800` bytes.
- Sentinels: `magic` LE `0x9DCE66C3` at offset `0x00`.
- Keystream: Derived from `CRC-32(key_le32, aligned_offset)`.
- Key Recovery: The 32-bit key is reconstructed directly from the 4-byte ciphertext at offset 0 by untransposing CRC lanes and finding the unique four-byte preimage.
- Descriptors: Eight `0x80`-byte section descriptors covering `AUTOSAVE_data.bin` and `HEADERSAVE_data.bin`.

### 6.2 Chunk Purposes in `AUTOSAVE_data.bin`
| Chunk ID | Subsystem / Purpose |
|---|---|
| `1` | General state, location, currency, play statistics, records, progression |
| `2` | Global bit flags |
| `3` | Story phase, environment and RPG progression state |
| `4` | Item and equipment inventories |
| `5` | Owned/guest/edit character records, skills, equipment and growth |
| `6` | Permanent story-character handle links |
| `7` | Parties, team sets, formations and character-bank handle lists |
| `8` | Story-list phase/order/new flags |
| `9` | Weather state |
| `10` | Shop stock and purchase counts |
| `11` | Persistent random-value array |
| `12` | Used NFC identifiers |
| `13` | Blocked-user records |
| `15` | Battle encounter records |
| `16` | Reported-user records |
| `17` | Storyboard/photo/captured-scene objects |
| `18` | Normal, hero, element, token, Basara and seasonal spirit inventories |
| `19` | Character/avatar editor slots |
| `20` | Kizuna Town craft objects |
| `21` | Craft-area object-handle lists |
| `22` | Craft map state |
| `23` | Craft resident state |
| `24` | Chat-emote slot groups |
| `25` | Monthly reward/calendar state |
| `26` | Inazuma Flower placement state |
| `27` | Victory Road tournament and seasonal state |

### 6.3 Character & Team Injection Algorithm
When `UTLauncher` injects the exported team into the mod save (`ievr_save_character_editor.py`):
1. **Target Team**: Team 2 in-game corresponds to serialized team-set index 3 (`TARGET_TEAM_SET = 3`, `ACTIVE_TEAM_SELECTOR = 3`).
2. **Chunk 5 (Character Records)**:
   - Sets character attributes, rarity (`charaRarity`), and learned skills from `CHARA_PARAM_INFO`.
   - Populates Abilearn boards with generated connector routes (`STANDARD_SKILL_PIECES = [0, 2, 4, 9, 11, 13]`, `BASARA_SKILL_PIECES = [..., 19, 21, 23]`).
3. **Chunk 7 (Team Sets & Roster)**:
   - Appends character handles (`charaStHdl`) into the party list.
   - Clears obsolete team flags (`(1 << 12) | (1 << 15)`).
   - Sets the active formation ID (`formationId`), emblem ID (`emblemId`), tactics IDs (`tacticsId`), and uniform ID (`uniformId`).
4. **Integrity & Checksum Repair**:
   - Recomputes CRC-32 for every descriptor.
   - Recomputes the main header CRC-32.
   - Re-encrypts container using the Steam user's key derived from `0x9DCE66C3`.

---

## 7. Python Interop Tooling in `aphrody-code/nie`

The tool `scripts/re/ievr_ultimate_team.py` is integrated into the repository to enable automated
analysis and interoperability:

```bash
# Decrypt an encrypted squad JSON exported from ievr-ultimate-team.fly.dev:
python3 scripts/re/ievr_ultimate_team.py team-decrypt exported_team.json

# Inspect a .utmod (UTMOD2) mod container:
python3 scripts/re/ievr_ultimate_team.py utmod-info UTMod.utmod

# Inspect and verify an IEVR PC save container:
python3 scripts/re/ievr_ultimate_team.py save-info 002AB8F4-USERDATALIVE
```
