# Inacord — Operational Directives & Quality Charters

## 1. Zero AI Slop & Authentic Asset Sovereignty (Strict Level-5 Invariant)

- **AI Slop Strict Prohibition**: Synthetic placeholders, hallucinated game data, generic AI-generated images, or speculative schemas are strictly forbidden in Inacord.
- **Authentic Game Assets Only**: All textures, models, UI sprites, and audio consumed or displayed by Inacord must originate from the verified Steam game VFS (`nie.exe`, `.cpk`, `.g4md`, `.g4mg`, `.g4pkm`) or official Level-5 game dumps.
- **Authentic Game Icon**: Inacord uses the authentic multi-resolution executable icon extracted from `nie.exe` (PE Resource ID 101, portrait of Unmei Sasanami). Under no circumstances may a synthetic or generic SVG/PNG replace the authentic game icon.
- **Reverse Engineering Fidelity**: Every format parser, table schema, and memory layout must match Ghidra-verified symbols and measured game binary layouts.

## 2. Inacord Build & Validation Gates

- **TypeScript / UI**:
  ```bash
  bunx tsc --noEmit -p tsconfig.desktop.json
  bun run --cwd apps/nie-web build:desktop
  bun run --cwd apps/nie-web build
  ```
- **Tauri Desktop Backend (GNU toolchain)**:
  ```bash
  cargo +1.98.1-x86_64-pc-windows-gnu check -p inacord
  ```
- **Embedded Databases**:
  ```powershell
  pwsh -NoProfile -File scripts/packager-bases-explorer.ps1
  ```
