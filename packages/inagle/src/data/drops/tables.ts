import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../../core/paths.js";
import { loadDropTablesFromConfig } from "../../parsers/drops-parser.js";

export interface DropEntry {
  itemId: number | string; // dropRarity for now, string if from new parser
  weight: number;
}

export interface ItemDropTable {
  itemTableId: string;
  dropItems: DropEntry[];
}

interface RawItemDropTable {
  id: string;
  data: [number, number]; // [offset, count]
}

interface RawItemDropData {
  dropRarity: number;
  weight: number;
}

export function loadItemDropTables(_dataDir: string): Map<string, DropEntry[]> {
  const tablePath = join(PATHS.allGamedata, "itemDropTable.json");
  const dataPath = join(PATHS.allGamedata, "itemDropData.json");

  if (!existsSync(tablePath) || !existsSync(dataPath)) {
    // Fallback: Parse raw config
    // Try win_treasure_lot_table_config_0.00.00.cfg.bin.json
    const map = loadDropTablesFromConfig(
      "win_treasure_lot_table_config_0.00.00.cfg.bin.json",
      "item",
    );
    if (map.size > 0) {
      const converted = new Map<string, DropEntry[]>();
      for (const [key, val] of map) {
        converted.set(
          key,
          val.map((v) => ({ itemId: v.itemId, weight: v.rate })),
        );
      }
      return converted;
    }

    // Try soccer_prize_config
    const prizeMap = loadDropTablesFromConfig("soccer_prize_config_0.04.68.cfg.bin.json", "soccer");
    if (prizeMap.size > 0) {
      const converted = new Map<string, DropEntry[]>();
      for (const [key, val] of prizeMap) {
        converted.set(
          key,
          val.map((v) => ({ itemId: v.itemId, weight: v.rate })),
        );
      }
      return converted;
    }

    console.warn("[Drops] Files not found");
    return new Map();
  }

  const map = new Map<string, DropEntry[]>();

  try {
    const rawTable: { data: RawItemDropTable[] } = JSON.parse(readFileSync(tablePath, "utf-8"));
    const rawData: { data: RawItemDropData[] } = JSON.parse(readFileSync(dataPath, "utf-8"));
    const allDrops = rawData.data;

    for (const entry of rawTable.data) {
      const [offset, count] = entry.data;
      const drops = allDrops.slice(offset, offset + count).map((d) => ({
        itemId: d.dropRarity,
        weight: d.weight,
      }));
      map.set(entry.id, drops);
    }
  } catch (e) {
    console.error("[Drops] Failed to load itemDropTable.json", e);
  }

  return map;
}
