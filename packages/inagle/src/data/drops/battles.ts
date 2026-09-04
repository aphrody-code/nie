import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { basename } from "node:path";

import { PATHS, resolveGameDataFile } from "../../core/paths.js";
import { loadBattleDropsFromConfig } from "../../parsers/drops-parser.js";

interface RawBtlLotInfo {
  winBtlGroupId: string; // Hex string in JSON
  charaBaseIdCrc: string;
}

interface RawDecideTableData {
  dropRarityNameCrc: string;
  itemTableId: string;
}

export interface BattleDropInfo {
  battleGroupId: number;
  itemTableId: string;
}

export function loadBattleDrops(_dataDir: string): Map<number, BattleDropInfo> {
  const btlLotPath = join(PATHS.allGamedata, "btlLotInfo.json");
  const decidePath = join(PATHS.allGamedata, "decideTableData.json");

  if (!existsSync(btlLotPath) || !existsSync(decidePath)) {
    // Repli : parse du config brut soccer_drop_config (version la plus haute)
    const dropConfig = resolveGameDataFile("soccer", "soccer_drop_config");
    const map = dropConfig
      ? loadBattleDropsFromConfig(basename(dropConfig))
      : new Map<number, BattleDropInfo>();
    if (map.size > 0) return map;

    console.warn("[Drops] Files not found: btlLotInfo.json or decideTableData.json");
    return new Map();
  }

  const btlLotInfo: { data: RawBtlLotInfo[] } = JSON.parse(readFileSync(btlLotPath, "utf-8"));
  const decideTableData: { data: RawDecideTableData[] } = JSON.parse(
    readFileSync(decidePath, "utf-8"),
  );

  const drops = new Map<number, BattleDropInfo>();

  // Create a map for quick lookup of decideTableData
  const decideMap = new Map<string, string>();
  for (const decide of decideTableData.data) {
    decideMap.set(decide.dropRarityNameCrc, decide.itemTableId);
  }

  for (const lot of btlLotInfo.data) {
    const itemTableId = decideMap.get(lot.charaBaseIdCrc);
    if (itemTableId) {
      const groupId = Number.parseInt(lot.winBtlGroupId, 16);
      drops.set(groupId, {
        battleGroupId: groupId,
        itemTableId: itemTableId,
      });
    }
  }

  return drops;
}
