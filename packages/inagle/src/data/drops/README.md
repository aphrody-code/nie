# Drops Data Module

This module handles the loading and querying of drop data from the game's configuration files.

## Components

### 1. Tables (`tables.ts`)
- **Source**: `itemDropTable.json` (Offsets/Counts) and `itemDropData.json` (Weights/Items).
- **Status**: **Fully Implemented**.
- **Logic**: `itemDropTable` contains an array of `[offset, count]` pairs. These point to a slice of `itemDropData`, which contains `{ itemId, weight }`.

### 2. Treasures (`treasures.ts`)
- **Source**: `placement_data.json` (Map placements).
- **Status**: **Fully Implemented**.
- **Logic**: Scans map entities for treasure chests and extracts their contents.

### 3. Battles (`battles.ts`)
- **Source**: `btlLotInfo.json` (Battle Groups) and `decideTableData.json` (Drop Tables).
- **Status**: **Partially Implemented**.
- **Issue**: `btlLotInfo` links Battle Groups to `charaBaseIdCrc`. `decideTableData` links `dropRarityNameCrc` to `itemTableId`.
  - We currently assume `charaBaseIdCrc` maps to `dropRarityNameCrc`, but no direct matches were found in the current dataset.
  - Further reverse engineering is needed to find the link between Character IDs and Drop Rarity CRCs.

## API (`api/drops.ts`)
- `getTable(tableId)`: Returns the contents of a drop table.
- `getSources(itemId)`: Returns all sources (Treasures, Battles) for an item.
- `getBattleDrops(battleGroupId)`: Returns potential drops for a battle.
