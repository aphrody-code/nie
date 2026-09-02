# Drops API

This module provides access to item acquisition sources (Drops, Treasures, Shops).

## Data Sources

### Treasures

- **TreasureContentInfo.json**: Links `contentId` to `itemId` (up to 4 items per chest).
- **TreasureItemInfo.json**: Links `contentId` to `mapId` and coordinates.

### Shops (Delivery)

- **DeliveryContentsData.json**: Links `itemIdCrc` (Delivery ID) to `itemId`.
- **DeliveryInfo.json**: Links Delivery ID to Shop ID.

### Drops (Battle/Enemy)

The drop system is complex and partially reverse-engineered:

1. **itemDropTable.json**: Links an ID (likely Enemy/Battle ID) to a range in `itemDropData`.
2. **itemDropData.json**: Defines probability weights for "Rarity" tiers (0, 1, 10, 20, etc.), but DOES NOT contain Item IDs.
3. **itemEmissionRarityTableConfig.json**: Links `itemId` to `tableInfo` (Index/Count). This likely defines which items belong to which "Emission Table".

**Hypothesis**:

- Enemies have a `DropTableID`.
- `DropTableID` -> `DropData` (Rarity Probabilities).
- `ItemEmission` links Items to these tables? Or maybe `ItemEmission` defines the contents of a "Box" item?

## Usage

```typescript
import { createDropsAPI } from "@azalee/inagle";

const drops = createDropsAPI();

// Find where to get an item
const sources = drops.getSources("0xDE3A261E");
console.log(sources);
// [
//   { type: 'treasure', id: '0x335E990F', location: '0x6E2851B9', details: { amount: 1 } },
//   ...
// ]
```
