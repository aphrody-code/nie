# re-derived

Famille de données **re-derived** — artefacts de reverse-engineering régénérables, glob `data/re/**/*.json` (4 fichiers). Produits par `scripts/extract_*.py` + `nie-game --build-region-index`. Source RE : `nie.exe` PE64 (2026-04-15), `/home/ubuntu/.local/share/Steam/iecode/inazuma/nie.exe`.

Ce résumé ne reflète QUE le contenu réel des JSON.

| Fichier | Taille | Forme | Entrées |
|---|---|---|---|
| `funclua-cmdids.json` | 17 Ko | objet : `_meta` + 15 sections de dispatch | 15 tables (3 avec commandes détaillées) |
| `funclua-cmdid-handlers.json` | 101 Ko | objet plat `hash → handler_va` | 3 471 |
| `menu-crc32-dictionary.json` | 5,2 Mo | objet plat `hash → nom` | 160 513 |
| `menu-region-index.json` | 54 Ko | objet plat `symbole → chemin g4tx` | 694 |

---

## 1. `funclua-cmdids.json` — tables de dispatch des commandes Lua

Les scripts Lua du jeu appellent des fonctions natives via des dispatchers `funcLua*Command(cmdId, ...)`. `cmdId` = CRC32 d'un nom de commande C++ interne (encodage inconnu, lookup forward non trouvé ; noms *inférés* depuis les patterns d'arguments). Le dispatch fait une recherche binaire sur une table de hash triée (tri au 1er appel, once-flag en `.data`). Table source en `.rdata`, entrées de 16 octets `{func_ptr[8], hash32[4], pad[4]}`. Les `count` sont les occurrences dans `re/lua/decompiled/**/*.lua`.

### 1.1 Les 15 dispatchers (sections)

| Section | handler_va | table_count | source_table_va | rôle (note du fichier) |
|---|---|---|---|---|
| `funcLuaMenuCommand` | 0x140C53850 | **1026** | 0x141A84640 | UI menu (sprites, textes, layers, focus) |
| `funcLuaCommand` | 0x140B939E0 | **2389** | 0x141A7ADF0 | logique de jeu générale (toutes domaines) |
| `funcLuaActionCommand` | 0x140B8D6E0 | 26 | 0x141A7A940 | actions terrain foot/combat (shoot, pass, tackle) |
| `funcLuaCameraCommand` | 0x140B90430 | 46 | 0x141A7AAE0 | caméra (position, angle, zoom, shake) |
| `funcLuaEffectCommand` | 0x140C4EBE0 | 48 | 0x141A84340 | effets visuels (particules, overlays, bloom) |
| `funcLuaSpTacticsCommand` | 0x140CB16C0 | 9 | 0x141A88660 | tactiques spéciales / hissatsu |
| `funcLuaMenuDictCommand` | 0x140FDBDF0 | 9 | 0x141A8D5F0 | menu dictionnaire / encyclopédie |
| `funcLuaMenuMapCommand` | 0x14104F0B0 | 39 | 0x141A8D7B0 | navigation carte du monde |
| `funcLuaMenuMapTravelCommand` | 0x141055250 | 28 | 0x141A8DA70 | menu voyage / confirmation de trajet |
| `funcLuaMenuNetworkCommand` | 0x1410A1C40 | 39 | — | lobby réseau / online |
| `funcLuaMenuMultiplayCommand` | 0x1410AAC10 | 8 | — | session multijoueur |
| `funcLuaMenuNfcCommand` | 0x1410B09D0 | 8 | — | menu NFC (amiibo) |
| `funcLuaMenuPostListCommand` | 0x1410D1790 | 18 | — | liste messages / babillard |
| `funcLuaMenuPostCommand` | 0x1410D1E40 | 18 | — | message individuel |
| `funcLuaMenuVSRouteTownCommand` | 0x14112F9D0 | 18 | 0x141A8DE60 | VS Route / exploration de ville |

### 1.2 `funcLuaMenuCommand` — 30 commandes détaillées (triées par fréquence d'usage Lua)

| hash | dec | count | nom inféré | handler_va | signature |
|---|---|---|---|---|---|
| 0x2A64B198 | 711242136 | 328 | SetObjectVisible | 0x140C881E0 | `(layerId, objectId, visible:bool)` |
| 0xE15FD945 | 3781155141 | 308 | SetSprite | 0x140CAD740 | `(layerId, objectId, textureHash, frameIdx:int, colorHash)` |
| 0x4096E67E | 1083631230 | 289 | SetText | 0x140CA6980 | `(layerId, textObjectId, textValue:string\|uint32, extra)` |
| 0xCB0296B4 | 3405944500 | 240 | SetObjectActive | 0x140CA39F0 | `(layerId, objectId, active:bool, value)` |
| 0x5CE7F1AE | 1558704558 | 133 | SetLayerVisible | 0x140CB0D40 | `(layerId, visible:bool)` |
| 0x2581DC5C | 629267548 | 125 | SetFocus | 0x140CB0430 | `(layerId, itemIndex:int)` |
| 0x80AB69F3 | 2158717427 | 124 | SetObjectParam | 0x140CA3790 | `(layerId, objectId, value, extra)` |
| 0x214DA123 | 558735651 | 120 | SetTextMulti | 0x140CA3210 | `(layerId, objectId, textParam1, textParam2, numParam:int, extra?)` |
| 0x4BE9C865 | 1273612389 | 97 | SetCurrentItem | 0x140CAFF70 | `(layerId, itemIndex:int)` |
| 0xD1B51DF0 | 3518307824 | 89 | SetLayerEnabled | 0x140CAF4B0 | `(layerId, enabled:bool)` |
| 0x69C9F55C | 1774843228 | 86 | PlayAnimation | 0x140C89A20 | `(layerId, animHash, ...)` |
| 0x86544EF0 | 2253672176 | 64 | SetNumericDisplay | 0x140C8C520 | `(layerId, objectId, number:int)` |
| 0x6A06BC75 | 1778826357 | 63 | SetColorTint | 0x140CA28A0 | `(layerId, objectId, colorHash)` |
| 0xD72B5ED5 | 3609943765 | 62 | LoadSubLayer | 0x140C9B340 | `(layerId, subLayerHash, ...)` |
| 0x9D688EB3 | 2640875187 | 62 | SetScrollIndex | 0x140CB0080 | `(layerId, objectId, index:int)` |
| 0x8A8491FB | 2323943931 | 60 | SetObjectNum | 0x140CAFE50 | `(layerId, objectId, num:int)` |
| 0x52D91057 | 1389957207 | 49 | SetObjectFlag | 0x140CAE610 | `(layerId, objectId, flag:bool)` |
| 0x497ED10D | 1233047821 | 46 | SetObjectPosition | 0x140C9A8E0 | `(layerId, objectId, positionIndex:int)` |
| 0xBAC3BAA4 | 3133389476 | 35 | SetIconTexture | 0x140CAC890 | `(layerId, objectId, iconHash)` |
| 0x58E879A0 | 1491630496 | 35 | ClearLayer | 0x140C8C800 | `(layerId, ...)` |
| 0x16C1C4C0 | 381797568 | 34 | SetObjectColorRGBA | 0x140C94F80 | `(layerId, objectId, r, g, b, a:int)` |
| 0x83B4F0AC | 2209673388 | 34 | RegisterLayer | 0x140C6CB20 | `(parentMenuId, layerId, btnTable:table, ...)` |
| 0x5F2101DB | 1595998683 | 34 | SetProgressBar | 0x140CAA0A0 | `(layerId, objectId, value:int\|float)` |
| 0x84FCEF86 | 2231168902 | 33 | SetSortKey | 0x140CB14E0 | `(layerId, objectId, sortKey:int)` |
| 0x1AF61E89 | 452337289 | 32 | RegisterSimpleLayer | 0x140C6C900 | `(parentMenuId, layerId, configTable:table)` |
| 0x20447515 | 541357333 | 30 | SetObjectScale | 0x140CAA560 | `(layerId, objectId, scale:float)` |
| 0x59B7A7B2 | 1505208242 | 29 | SetListItemData | 0x140CA57F0 | `(layerId, itemIndex:int, dataHash)` |
| 0x45E9070A | 1172899594 | 25 | SetButtonEnabled | 0x140CA4480 | `(layerId, buttonId, enabled:bool)` |
| 0x32F65AA1 | 855005857 | 23 | SetGroupVisible | 0x140C83A60 | `(groupId, visible:bool)` |
| 0x9B2AAF08 | 2603265800 | 22 | SetBadge | 0x140CA2790 | `(layerId, objectId, badgeValue:int)` |

### 1.3 `funcLuaCommand.notable_commands` (3 entrées, sur 2389)

| hash | dec | nom inféré | signature | desc |
|---|---|---|---|---|
| 0xF2C13584 | 4074371074 | GetText | `(textId:uint32) -> string` | renvoie la string localisée d'un text-ID |
| 0x0196FA01 | 424926145 | IsConditionActive | `() -> bool` | teste un flag de condition de jeu (contextuel) |
| 0x77E46CA8 | 2011560392 | GetListCount | `(listId, ...) -> int, bool` | nombre d'items + flag de validité d'une liste |

---

## 2. `funclua-cmdid-handlers.json` — `cmdId → adresse du handler`

Objet plat de **3 471** paires `hash32 → handler_va`, toutes distinctes (3 471 VAs uniques). Plage des handlers : **0x140B93B00 → 0x140CB2CF0** (dense dans `.text`). C'est la table des dispatch aplatie : les 30 hashes détaillés de §1.2 y figurent tous avec la même VA (ex. `0x2A64B198 → 0x140C881E0` = SetObjectVisible).

Échantillon brut :

| hash | handler_va |
|---|---|
| 0xD1BCC475 | 0x140C4E780 |
| 0x39FAA232 | 0x140C4E680 |
| 0x0E7C89C9 | 0x140C4E650 |
| 0x8413C49E | 0x140C4E620 |
| 0xD1F07CF1 | 0x140C4E440 |

---

## 3. `menu-crc32-dictionary.json` — dictionnaire inverse CRC32 → nom

**160 513** entrées `hash → chaîne`. C'est le reverse-lookup des CRC32 utilisés partout dans le jeu (IDs d'assets, noms de fonctions, paramètres, sous-titres, strings d'erreur du moteur Criware/PhysX). Composition :

| Catégorie | Nombre | Description |
|---|---|---|
| IDs code-like `prefix_NNNN` | 110 004 | identifiants d'assets numérotés |
| Noms / identifiants libres | 50 356 | fonctions, paramètres, chemins, strings |
| Sous-titres `Subtitle_*` | 153 | clés de sous-titres d'événements |

### 3.1 Familles d'IDs `prefix_NNNN` (chaque famille ≈ 10 000 IDs, 0000–9999)

| Préfixe | Compte | Domaine probable |
|---|---|---|
| `shp_` | 10000 | hissatsu / shoot (techniques) |
| `fm_` | 10000 | formations |
| `itm_` | 10000 | items |
| `stg_` | 10000 | stages / terrains |
| `psk_` | 10000 | passives skills |
| `aur_` | 10000 | auras / keshin |
| `chr_` | 10000 | personnages |
| `skl_` | 10000 | skills |
| `npc_` | 10000 | PNJ |
| `team_` | 10000 | équipes |
| `bsr_` | 9999 | basara / éléments |

(+ singletons isolés : `chair_`, `tag_`, `hlp_`, `area_`, `seat_`.)

### 3.2 Noms de fonctions / paramètres réels (échantillon)

`UpdateCharaPos`, `UpdateSettingMemberInfo`, `ExecuteCharacterCardLeftFadeAnimation`, `ChangePersonalPlatePageByCharaParamId`, `UpdatePersonalPlate`, `SetPersonalPlatePageFromCharaBank`, `GetBuildTypeNameTextIdFromTeamBuildType`, `SwitchLayerOpenOrClose`, `OpenCheckWindow`, `OnChangeFocusCommon`, `ChrSpiritLegendaryNewFlag`, `MoveJump`, `MotionConstraintBias`.

Paramètres de tuning numériques (noms parlants) : `goalnetSimBoundDeclRateHori`, `specialPopupFarScaleRate`, `soccerBattleVsSelfChara2ScaleY`, `frontMoveSpeedRate`, `sweetSpotCursorHoldOutTime`, `StickAutoFrameAngle`, `UniverseResultMenuNextGuideWaitTime`, `WarpPosOffset_Tall_Big_X`, `AreaDrawLineLineWidthVecSmoothingNum`.

Sous-titres d'événements (clé `Subtitle_evNN_NNNNN`) : `Subtitle_ev04_02110`, `Subtitle_ev73_00050`, `Subtitle_ev20_03010`, `Subtitle_ev75_00010`, `Subtitle_ev01_01825`.

### 3.3 Strings du moteur (middleware Criware ADX2 / PhysX) — exemples avec valeur

| hash | valeur |
|---|---|
| 0x00015DAA | `owner dead` |
| 0x002B95B2 | `Npc_Craft_0x%08x` |
| 0x003EDD88 | `_cmnd_skill_base_icon%02d` |
| 0x004722D7 | `D:\SVN\PhysX3.4\PxShared\src\pvd\src\PxPvdObjectModelMetaData.cpp` |
| 0x00BD41E9 | `E2019021800:Detect ACF data inconsistency in Category's Cue Limit item.` |
| 0x0128FCE8 | `E2013040805:AWB type mismatch.` |
| 0x01BDA369 | `E2019100103:This player cannot use instrument.` |
| 0x0166C00F | `E2018041323M:vpx_codec_vp9_dx() error` |

---

## 4. `menu-region-index.json` — symbole de région UI → atlas g4tx

**694** symboles `nom → chemin VFS d'un atlas g4tx`, vers **11** atlas distincts (le `<LG>` est le placeholder de langue). C'est la carte des sprites/icônes de menu vers leur texture-atlas.

### 4.1 Atlas cibles (par nombre de symboles)

| Symboles | Atlas |
|---|---|
| 167 | `#/menu/200_icon/16_icon_list_tab/<LG>/icon_list_tab.g4tx` |
| 143 | `#/menu/200_icon/15_icon_common/<LG>/icon_common.g4tx` |
| 117 | `#/font/gaiji_game.g4tx` |
| 71 | `#/menu/200_icon/13_icon_tactics/icon_tactics.g4tx` |
| 69 | `#/menu/102_team/team00/team00_01/<LG>/team00_01.g4tx` |
| 42 | `#/menu/200_icon/16_icon_list_tab_filter/<LG>/icon_list_tab_filter.g4tx` |
| 29 | `#/menu/200_icon/15_icon_common2/<LG>/icon_common2.g4tx` |
| 19 | `#/menu/10_win/win07/win07_01/<LG>/win07_01.g4tx` |
| 15 | `#/menu/200_icon/05_icon_rarity/<LG>/icon_rarity.g4tx` |
| 14 | `#/menu/102_team/team00/team00_03/<LG>/team00_03.g4tx` |
| 8 | `#/menu/200_icon/07_icon_rank/<LG>/icon_rank.g4tx` |

Répartition par répertoire : `menu/200_icon` (475), `font` (117), `menu/102_team` (83), `menu/10_win` (19).

### 4.2 Groupes de symboles (préfixe sans suffixe numérique)

| Compte | Groupe | Exemple |
|---|---|---|
| 71 | `icon_wht` | icônes monochromes |
| 14 | `icon_body_type` | type de corps |
| 12 | `icon_sp_area` / `icon_list_tab_filter` | zones SP / filtres d'onglet |
| 11 | `filter_symbol`, `gaiji_icon_sp_area`, `icon_list_tab_sp_area` | |
| 10 | `gaiji_icon_unlock`, `gtxt_rarity01`, `icon_body_type_c` | |
| 9 | `gaiji_body_type_c`, `icon_chr_base01_l/s`, `icon_chr_color01_l/s`, `icon_list_tab_series` | base/couleur perso L/S |
| 8 | `icon_cmd_position` | positions de commande |
| 7 | `gaiji_tr`, `icon_btl01/02/03_parameter`, `icon_build_l`, `icon_list_tab_town`, `icon_list_tab_training` | paramètres de combat, ville, entraînement |

Exemples de symboles bruts : `basara_ef01`, `base_person01`, `filter_symbol02..12`, `gaiji_body_type_c11010010` → `#/font/gaiji_game.g4tx`.
