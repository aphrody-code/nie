# Famille de données : root-manifests

> Index/manifestes d'assets à la racine de `data/`. Glob `data/*.json` (le symlink `sheet_export.json` est exclu).
> Source: parse Bun/TS de chaque fichier. Valeurs = contenu réel des JSON.

| fichier | type racine | contenu |
|---|---|---|
| `asset-cross-reference.json` | objet + array `assets` | 17 353 assets / 35 958 sources — index inverse asset→entries |
| `character-face-manifest.json` | array de codes | 5 677 codes de visages de personnages disponibles |
| `character-model-manifest.json` | array de codes | 6 028 codes de modèles 3D (persos + pièces customisation) |
| `discord-channels-scan.json` | objet (stats + channels) | scrape communauté Discord (136 salons, 1 751 msgs) |
| `glossary.json` | objet de sections | 24 001 libellés trilingues ja/en/fr (persos, techniques, items…) |
| `item-image-manifest.json` | objet plat | 1 459 mappings itemCode → atlas d'icône |
| `miximax-icon-manifest.json` | objet plat | 36 mappings code Miximax → icône |
| `passive-sheets.json` | objet de sections | 175 passifs (joueur/custom/coordinateur) + playstyles |
| `zukan-audit-mirror.json` | objet (metadata + issues) | même audit, forme condensée + source miroir SQLite |
| `zukan-audit.json` | objet (metadata + issues) | audit cohérence zukan vs DB : 5 463 audités, 12 issues |

## asset-cross-reference.json

- generatedAt: `2026-06-01T22:23:17.082Z`
- totalAssets: **17353**, totalSources: **35958**
- clés racine: generatedAt, totalAssets, totalSources, bucketSummary, folderSummary, assets

### bucketSummary
| bucket | count |
|---|---|
| 200_icon | 14567 |
| 220_img | 2765 |
| other | 21 |

### folderSummary (top 15 par count)
| folder | count |
|---|---|
| `200_icon/10_icon_chr` | 11373 |
| `200_icon/02_icon_item` | 3130 |
| `220_img/telop_waza` | 2706 |
| `200_icon/25_icon_nameplate` | 54 |
| `220_img/soul_effect` | 37 |
| `other/102_team` | 7 |
| `other/102_equip` | 5 |
| `other/111_item` | 4 |
| `220_img/hlp` | 4 |
| `220_img/vsroute_map` | 4 |
| `220_img/stamp_img` | 3 |
| `other/15_craft` | 2 |
| `200_icon/13_icon_skill` | 2 |
| `200_icon/15_icon_common` | 2 |
| `220_img/ev_end_title` | 2 |

- autres clés (non résumé): assets

### `assets` — 17353 entrées, type=array
Champs d'une entrée: `assetPath`, `bucket`, `folder`, `subfolder`, `isTemplate`, `sources`
Exemple (entrée avec assetPath renseigné):
```json
{
  "assetPath": "10_win/win07/win07_01/<LG>/win07_01.g4tx",
  "bucket": "other",
  "folder": "10_win",
  "subfolder": "win07",
  "isTemplate": true,
  "sources": [
    {
      "entryFile": "lua/chara_filter_menu_4.00.01.00",
      "field": "string",
      "value": "#/menu/10_win/win07/win07_01/<LG>/win07_01.g4tx"
    }
  ]
}
```
- `isTemplate`=true sur **41** assets (variantes paramétrées) ; multi-sources fréquent (un asset référencé par plusieurs entries).

## character-face-manifest.json

- Type: tableau plat de codes string. **5677** entrées.
### Préfixes (familles de codes)
| préfixe | count | exemples |
|---|---|---|
| `c` | 5675 | c01000010, c01000020, c01000030 |
| `an` | 1 | an000150 |
| `npc` | 1 | npc2323 |

Premiers: `an000150`, `c01000010`, `c01000020`, `c01000030`, `c01000040`, `c01000050`
Derniers: `c11908190`, `c11908200`, `c11908210`, `c11908300`, `c11908310`, `npc2323`

## character-model-manifest.json

- Type: tableau plat de codes string. **6028** entrées.
### Préfixes (familles de codes)
| préfixe | count | exemples |
|---|---|---|
| `c` | 5561 | c01000010, c01000020, c01000030 |
| `h` | 113 | h0001010, h0001020, h0001030 |
| `face` | 64 | face01_nose01, face01_nose02, face01_nose03 |
| `hairf` | 63 | hairf000, hairf001, hairf002 |
| `hairb` | 54 | hairb000, hairb001, hairb002 |
| `hairu` | 46 | hairu000, hairu001, hairu002 |
| `accessory` | 44 | accessory001, accessory001_07, accessory002 |
| `e` | 31 | e000401, e000403, e000501 |
| `base` | 18 | base_big_00, base_bigman_00, base_bigman_01 |
| `f` | 9 | f000101, f000102, f000103 |
| `tw` | 9 | tw00000010, tw00000020, tw00000030 |
| `ei` | 8 | ei0000011, ei0000012, ei0000013 |
| `ear` | 6 | ear001, ear002, ear003 |
| `u` | 2 | u11010078, u911021 |

Premiers: `accessory001`, `accessory001_07`, `accessory002`, `accessory002_07`, `accessory003`, `accessory003_07`
Derniers: `tw00000070`, `tw00000080`, `tw00000090`, `tw00000100`, `u11010078`, `u911021`

## glossary.json

- generatedAt: `2026-05-29T23:03:20.210Z`
### _meta.counts
| catégorie | count |
|---|---|
| characters | 17825 |
| techniques | 1115 |
| auras | 0 |
| passives | 0 |
| teams | 244 |
| items | 1699 |
| terms | 3118 |
| total | 24001 |

- sections (tableaux): characters, techniques, auras, passives, teams, items, terms

### `characters` — 17825 entrées
Champs: `ja`, `en`, `fr`, `code`
Exemples:
| ja | en | fr | code |
|---|---|---|---|
| ジョセフィーヌ | Josephine | Joséphine | an000150 |
| 守 円堂 | Mark Evans | Mark Evans | c01000010 |
| 円堂 守 | Mark Evans | Mark Evans | c01000010_5000 |
| 一郎太 風丸 | Nathan Swift | Nathan Swift | c01000020 |
| 壁山 塀吾郎 | Jack Wallside | Jack Wallside | c01000030 |

### `techniques` — 1115 entrées
Champs: `ja`, `en`, `fr`
Exemples:
| ja | en | fr |
|---|---|---|
| イナズマ落とし | Inazuma Drop | Trampoline du tonnerre |
| ツインブースト | Twin Boost | Tir puissance 2 |
| ファイアトルネード | Fire Tornado | Tornade de feu |
| 百烈ショット | Wrath Shot | Tir fatal |
| イナズマ１号 | Inazuma-1 | Foudre |

### `teams` — 244 entrées
Champs: `ja`, `en`, `fr`
Exemples:
| ja | en | fr |
|---|---|---|
| 雷門中 | Raimon | Raimon |
| 帝国学園 | Royal Academy | Royal Academy |
| 稲妻ＫＦＣ | Inazuma Kids FC | Inazuma KFT |
| 尾刈斗中 | Occult | Occulte |
| 野生中 | Wild | Wild |

### `items` — 1699 entrées
Champs: `ja`, `en`, `fr`, `category`
Exemples:
| ja | en | fr | category |
|---|---|---|---|
| ガッツギア | Guts Gear | Guts Gear | consume |
| げんきプロテイン | PWR Protein Bar | Barre protéinée | consume |
| エナジードリンク | Energy Drink | Boisson énergétique | consume |
| スピリット『』 | Spirit "" | Esprits « » | consume |
| スピリット『』(Growing) | Spirit "" | Esprits « » | consume |

### `terms` — 3118 entrées
Champs: `ja`, `en`, `fr`
Exemples:
| ja | en | fr |
|---|---|---|
| 南雲原中学校 正門前 | In Front of Nagumo Middle School Main Ga | Devant le portail principal du collège N |
| 南雲原中学校 校舎前 | In Front of Nagumo Middle School Buildin | Devant le bâtiment du collège Nagumo |
| 南雲原中学校 噴水前 | In Front of Nagumo Middle School Fountai | Devant la fontaine du collège Nagumo |
| 南雲原中学校 プール前 | In Front of Nagumo Middle School Pool | Devant la piscine du collège Nagumo |
| 海公園 | Seaside park | Parc océanique |

## item-image-manifest.json

- Type: objet plat `itemCode -> chemin atlas`. **1459** entrées.
### Préfixes des codes item (top 15)
| préfixe | count |
|---|---|
| `eq_sh` | 196 |
| `whk` | 174 |
| `uni_u` | 172 |
| `whs` | 163 |
| `whd` | 162 |
| `who` | 154 |
| `eq_mi` | 80 |
| `eq_ac` | 80 |
| `eq_sp` | 80 |
| `cos_u` | 66 |
| `ke` | 34 |
| `performance_type` | 16 |
| `gd` | 11 |
| `tk_hr` | 9 |
| `ex` | 9 |

### Dossiers cibles (atlas)
| dossier | count |
|---|---|
| `200_icon/02_icon_item` | 797 |
| `220_img/telop_waza/en` | 637 |
| `220_img/telop_waza/fr` | 25 |

Exemples:
| code | chemin |
|---|---|
| `tk_hr000007` | `200_icon/02_icon_item/icon_item10_tk_hr000007` |
| `tk_tr000001` | `200_icon/02_icon_item/icon_item10_tk_tr000001` |
| `tk_bb000003` | `200_icon/02_icon_item/icon_item10_tk_bb000003` |
| `tk_hr000001` | `200_icon/02_icon_item/icon_item10_tk_hr000001` |
| `tk_hr000003` | `200_icon/02_icon_item/icon_item10_tk_hr000003` |
| `tk_hr000005` | `200_icon/02_icon_item/icon_item10_tk_hr000005` |

## miximax-icon-manifest.json

- Type: objet plat `code -> icône`. **36** entrées.
- préfixes clés: `c`(18), `wmm`(18)
- préfixes valeurs (icônes): `cn`(16), `iau`(12), `ca`(6), `cp`(2)

Exemples:
| code | icône |
|---|---|
| `c05028010` | `ca0201` |
| `c05028040` | `cn0221` |
| `c05028050` | `cn0242` |
| `c05028055` | `cn0242` |
| `c05028060` | `cn0254` |
| `c05028070` | `ca0210` |
| `c05028080` | `iau0012a` |
| `c05028090` | `cn0255` |

## passive-sheets.json

- clés racine: playerPassives, customPassives, coordinatorPassives, playstyles, extractedAt
### `playerPassives` — 60 entrées
Champs: `no`, `playstyle`, `requirement`, `stat`, `legendary`, `top`, `advanced`, `growing`, `common`
```json
{
  "no": 1,
  "playstyle": "",
  "requirement": "For players of the same element",
  "stat": "Shot AT",
  "legendary": {
    "low": "1%",
    "high": "1.5%"
  },
  "top": {
    "low": "0.8%",
    "high": "1.2%"
  },
  "advanced": {
    "low": "0.7%",
    "high": "1%"
  },
  "growing": {
    "low": "0.6%",
    "high": "0.7%"
  },
  "common": {
    "low": "0.5%",
    "high": "0.5%"
  }
}
```
- stats distincts (27): Shot AT, Focus AT & DF, Scramble AT & DF, Castle Wall DF, Team Focus AT & DF, Own Shot AT, Own Focus AT & DF, Own Scramble AT & DF, Own Castle Wall DF, Team Breach Rate, Team Castle Wall Pierce Rate, Team Tension Breach Cost, Drain Tension, Team Tension, Team Shot AT, [MF] Focus AT & DF, [DF] Focus AT & DF, [KP] KP, Team Rough Attack AT & DF, Team Bond Power
- requirements distincts (24), ex.: "For players of the same element"; "For players of different elements"; "For players of the same positions"; "For players of different positions"; "For nearby players"; "When a player of the same element is nearby"

### `customPassives` — 35 entrées
Champs: `no`, `requirement`, `stat`, `buff`
```json
{
  "no": 1,
  "requirement": "For players of the same element",
  "stat": "Shot AT",
  "buff": "1%"
}
```
- stats distincts (9): Shot AT, Focus AT & DF, Scramble AT & DF, Castle Wall DF, Own Shot AT, Own Focus AT & DF, Own Scramble AT & DF, Own Castle Wall, Team Focus AT & DF
- requirements distincts (10), ex.: "For players of the same element"; "For players of different elements"; "For players of the same position"; "For players of different positions"; "For nearby players"; "When a player of the same element is nearby"

### `coordinatorPassives` — 80 entrées
Champs: `no`, `playstyle`, `requirement`, `stat`, `coordinatorCommon`, `coordinatorLegendary`, `managerCommon`, `managerLegendary`
```json
{
  "no": 1,
  "playstyle": "",
  "requirement": "For players of the same element",
  "stat": "Shot AT",
  "coordinatorCommon": "0.1%",
  "coordinatorLegendary": "0.5%",
  "managerCommon": "1.5%",
  "managerLegendary": "3%"
}
```
- stats distincts (27): Shot AT, Focus AT & DF, Scramble AT & DF, Castle Wall DF, Team Focus AT & DF, [Substitute Player] AT, [Substitute Player] DF, Own Special Tactics Cooldown, Team AT, Team DF, Team Breach Rate, Team Castle Wall Pierce Rate, Team Tension Breach Cost, Team Tension, Team Shot AT, [MF] Focus AT & DF, [DF] Focus AT & DF, [KP] KP, Team Rough Attack AT & DF, Team Bond Power
- requirements distincts (21), ex.: "For players of the same element"; "For players of different elements"; "On your half of the pitch"; "On the opposition's half of the pitch"; "When outside the zone"; "Upon being subbed in (15s)"

### `playstyles` — 6 entrées
Valeurs (tous les playstyles): `Breach`, `Tension`, `Counter`, `Bond`, `Rough Play`, `Justice`

- `extractedAt`: string
## discord-channels-scan.json

- clés racine: stats, channels
- scanDate: `2026-06-01T23:35:55.746Z`, durationMs: 8543
- totalChannelsScanned: **136**, totalMessages: **1751**, totalCharacters: 149500, averageMessageLength: 85
- autres clés stats: scanDate, durationMs, totalChannelsScanned, totalMessages, totalCharacters, averageMessageLength, mostActiveAuthors, mostActiveChannels

### mostActiveAuthors (top)
| author | count |
|---|---|
| mioleen_ | 195 |
| inazo__ | 109 |
| lecrepuscule03 | 98 |
| dleez215e | 64 |
| san_la_vraie | 64 |

### `channels` — 136 entrées (array)
Champs: `channelId`, `name`, `type`, `messageCount`, `error`
```json
{
  "channelId": "1073752409387573339",
  "name": "💬📖〡logs",
  "type": "0",
  "messageCount": 0,
  "error": "Missing Access"
}
```

## zukan-audit.json

- clés racine: metadata, issues
### metadata
```json
{
  "date": "2026-06-01T22:23:09.707Z",
  "totalAudited": 5463,
  "totalIssues": 12,
  "bySeverity": {
    "high": 0,
    "medium": 12
  }
}
```
- issues: **12**
Champs d'une issue: `code`, `hash`, `dbNameEn`, `dbNameFr`, `dbNameJa`, `dbPosition`, `dbElement`, `dbGender`, `dbSeries`, `dbRarity`, `dbStats`, `zukanNameEn`, `zukanNameJa`, `zukanPosition`, `zukanElement`, `zukanGender`, `zukanGame`, `zukanStats`, `statsCorrelation`, `severity`, `category`, `problems`, `imageUrl`
```json
{
  "code": "0xB2370A90",
  "hash": "k/o/y/oyf1x6tgvom",
  "dbNameEn": "Arion Matlock Hermes",
  "dbNameFr": "Arion Matlock Hermès",
  "dbNameJa": "経目 須商 ヘルメス",
  "dbPosition": "Milieu",
  "dbElement": "Forêt",
  "dbGender": "M",
  "dbSeries": "Ares",
  "dbRarity": "Normal",
  "dbStats": [
    155,
    179,
    181,
    130,
    132,
    130,
    160
  ],
  "zukanNameEn": "Arion Matlock",
  "zukanNameJa": "経目 須商",
  "zukanPosition": "MF",
  "zukanElement": "Forest",
  "zukanGender": "Male",
  "zukanGame": "Inazuma Eleven",
  "zukanStats": [
    101,
    109,
    107,
    88,
    89,
    81,
    97
  ],
  "statsCorrelation": 0.9196428571428571,
  "severity": "medium",
  "category": "era_mismatch",
  "problems": [
    "Ère: DB=Ares(Modern) image=Inazuma Eleven(OG)"
  ],
  "imageUrl": "https://dxi4wb638ujep.cloudfront.net/1/k/o/y/oyf1x6tgvom.png"
}
```
- répartition: era_mismatch=8, attribute_mismatch=3, duplicate_hash=1

## zukan-audit-mirror.json

- clés racine: metadata, issues
### metadata
```json
{
  "date": "2026-06-01T12:40:17.232Z",
  "mirror": "/home/ubuntu/rg/apps/azalee/data/backups/supabase-2026-06-01T09-07-12.sqlite",
  "totalAudited": 5463,
  "totalIssues": 12,
  "bySeverity": {
    "high": 0,
    "medium": 12
  },
  "byCategory": {
    "era_mismatch": 8,
    "attribute_mismatch": 3,
    "duplicate_hash": 1
  }
}
```
- issues: **12**
Champs d'une issue: `code`, `hash`, `dbNameEn`, `severity`, `category`, `problems`
```json
{
  "code": "0xB2370A90",
  "hash": "k/o/y/oyf1x6tgvom",
  "dbNameEn": "Arion Matlock Hermes",
  "severity": "medium",
  "category": "era_mismatch",
  "problems": [
    "Ère"
  ]
}
```
- répartition: era_mismatch=8, attribute_mismatch=3, duplicate_hash=1
