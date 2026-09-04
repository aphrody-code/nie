import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../../core/paths.js";

export interface TreasureDrop {
  mapId: string;
  pos: [number, number, number, number];
  items: { itemId: string; count: number }[];
}

interface TreasureItemInfo {
  contentId: string;
  mngNumber: number;
  mapId: string;
  pos: [number, number, number, number];
}

interface TreasureContentInfo {
  contentId: string;
  itemId1: string;
  itemNum1: number;
  itemId2: string;
  itemNum2: number;
  itemId3: string;
  itemNum3: number;
  itemId4: string;
  itemNum4: number;
}

export function loadTreasureDrops(_gamedataPath: string): TreasureDrop[] {
  const itemInfoPath = join(PATHS.allGamedata, "TreasureItemInfo.json");
  const contentInfoPath = join(PATHS.allGamedata, "TreasureContentInfo.json");

  if (!existsSync(itemInfoPath) || !existsSync(contentInfoPath)) {
    console.warn("Treasure info files not found");
    return [];
  }

  try {
    const itemInfo: { data: TreasureItemInfo[] } = JSON.parse(readFileSync(itemInfoPath, "utf-8"));
    const contentInfo: { data: TreasureContentInfo[] } = JSON.parse(
      readFileSync(contentInfoPath, "utf-8"),
    );

    // Create a map of contentId -> items
    const contentMap = new Map<string, { itemId: string; count: number }[]>();

    for (const content of contentInfo.data) {
      const items: { itemId: string; count: number }[] = [];

      if (content.itemId1 && content.itemId1 !== "0x00000000" && content.itemNum1 > 0) {
        items.push({ itemId: content.itemId1, count: content.itemNum1 });
      }
      if (content.itemId2 && content.itemId2 !== "0x00000000" && content.itemNum2 > 0) {
        items.push({ itemId: content.itemId2, count: content.itemNum2 });
      }
      if (content.itemId3 && content.itemId3 !== "0x00000000" && content.itemNum3 > 0) {
        items.push({ itemId: content.itemId3, count: content.itemNum3 });
      }
      if (content.itemId4 && content.itemId4 !== "0x00000000" && content.itemNum4 > 0) {
        items.push({ itemId: content.itemId4, count: content.itemNum4 });
      }

      if (items.length > 0) {
        contentMap.set(content.contentId, items);
      }
    }

    // Join with item info
    const treasures: TreasureDrop[] = [];

    for (const item of itemInfo.data) {
      const items = contentMap.get(item.contentId);
      if (items) {
        treasures.push({
          mapId: item.mapId,
          pos: item.pos,
          items,
        });
      }
    }

    return treasures;
  } catch (error) {
    console.error("Error loading treasure drops:", error);
    return [];
  }
}
