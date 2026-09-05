# Famille de données : exports-inagle

Exports consolidés inagle/azalee — données de jeu agrégées, prêtes à servir.
Glob : `data/exports/**/*.json` (7 fichiers). Tout le contenu ci-dessous est **factuel**,
extrait directement des JSON (analyse ad hoc, scripts non committés).

Source des feuilles tabulaires : *Inazuma Eleven VR Document v3.06 (Last Updated 3/2/2026)*
(document communautaire repris dans `sheet_data.json` et `sheet_export.json`).

## Vue d'ensemble des fichiers

| Fichier | Taille | Type racine | Volume |
|---|---|---|---|
| `character_fr.json` | 1,2 Mo | `array` | 14 389 entrées (mapping characterId → modelId/nameId) |
| `inagle_enriched.json` | 6,5 Mo | `array` | 5 132 personnages enrichis (stats + dérivées + movesets + passifs) |
| `noun_fr.json` | 1,3 Mo | `array` | 20 908 entrées (crc32 → libellé, 19 976 crc32 distincts) |
| `orion-report.json` | 223 Ko | `object` | rapport d'audit du DLC/série « Orion » (190 persos, 15 équipes, scénario encodé) |
| `passive-sheets.json` | 57 Ko | `object` | barèmes de passifs (joueur/custom/coordinateur) |
| `sheet_data.json` | 632 Ko | `object` | 14 tables de jeu structurées (hissatsu, auras, tactics, items, kizuna…) |
| `sheet_export.json` | 15 Mo | `object` | 25 feuilles brutes (rows = tableaux de cellules) du Google Sheet source |

Référentiels d'énumérations communs à plusieurs fichiers :
- **Éléments** : `風 (Wind)`, `火 (Fire)`, `林 (Forest)`, `山 (Mountain)`, `無 (Void)`.
- **Positions** : `GK`, `DF`, `MF`, `FW`.
- **Playstyles** (6) : `Justice`, `Tension`, `Counter`, `Bond`, `Breach`, `Rough Play`.

---

## `character_fr.json` — mapping characterId → modèle/nom

Tableau de 14 389 objets `{ characterId:int, modelId:string, nameId:int }`.
`characterId` et `nameId` sont des **hash signés** (crc32). 1 316 entrées ont un `modelId` vide ou `"0"`.

Répartition des préfixes de `modelId` (13 073 entrées non vides) :

| Préfixe | Compte | Sens probable |
|---|---|---|
| (numérique) | 5 879 | id de modèle numérique |
| `c` | 5 864 | personnages (`c08010010`…) |
| `npc` | 622 | PNJ (`npc0010`…) |
| `ev` | 216 | acteurs d'événement/cinématique |
| `i` | 178 | items |
| `k` | 99 | keshin |
| `a` | 56 | animaux |
| `kt`, `editpreview`, `mannequin`, `edit`, `d`, `PV`, `scout`, `spirit`, `tw`, `an`, `w`, `b`, `test`, … | ≤ 21 chacun | mannequins d'édition, prévisus, spirits… |

Exemples : `npc0010..npc0019`, `npc0070`, `mannequin_friend_big`, `mannequin_enemy_big`, `mannequin_friend_small`.
6 512 entrées portent un `nameId != 0`.

---

## `inagle_enriched.json` — roster complet enrichi

Tableau de 5 132 personnages. Champs (34) :
`id, name_kanji, name_hiragana, name_romaji, name_localised, nickname, gender, game, type,
position, alt_position, element, kick, control, technique, pressure, physical, agility,
intelligence, total_stats, playstyle, moveset, alt_moveset, main_path, alt_paths, passives,
image_url, shot_at, focus_at, focus_df, scramble_at, scramble_df, castle_wall_df, kp`.

Exemple (id 1) : *Mamoru Endo / Mark Evans*, GK (alt FW), 山 (Mountain), playstyle Justice,
stats kick 90 / control 97 / technique 91 / pressure 98 / physical 105 / agility 111 /
intelligence 97, total 689 ; dérivées shot_at 187, focus_at 233, focus_df 243.5,
scramble_at 202, scramble_df 195, castle_wall_df 203, kp 955 ;
moveset `Strong Punch / God Hand / Fireball Knuckle` ; main_path `Keep > Keep`.

Répartition par **type** : `選手 (Player)` 4 986 · `監督 (Manager)` 92 · `マネージャー (Coordinator)` 45 · `コーチ (Coach)` 9.

Répartition par **jeu d'origine** (`game`, 8 valeurs) :

| Jeu | Compte |
|---|---|
| イナズマイレブン (IE1) | 1 033 |
| イナズマイレブンGO シャイン／ダーク | 917 |
| イナズマイレブン 英雄たちのヴィクトリーロード (Victory Road) | 896 |
| イナズマイレブン2 脅威の侵略者 ファイア／ブリザード | 646 |
| イナズマイレブン3 世界への挑戦!! …（スパーク／ボンバー／ジ・オーガ） | 634 |
| イナズマイレブンGO2 クロノ・ストーン ネップウ／ライメイ | 402 |
| イナズマイレブンGO ギャラクシー ビッグバン／スーパーノヴァ | 386 |
| イナズマイレブン アレスの天秤 (Ares) | 218 |

`gender` : `男 (Male)`, `女 (Female)`, `不明`, `両性`, `不可`.
Complétude : `name_localised` 5 132/5 132, `moveset` 5 131, `passives` 4 880, `image_url` **0** (toujours `null`).
Quelques `alt_position`/`playstyle` portent des erreurs Sheet résiduelles (`#N/A (Did not find value …VLOOKUP…)`).

Top `total_stats` (= 693) : Haruna Otonashi, Yuto Kido, Terumi Afuro, Akio Fudo, Tenma Matsukaze, Takuto Shindo…
Exemple de passifs (Ryugo Someoka) : `For players of the same position, Shot AT +3.5%` / `On the opposition's half of the pitch, Own Shot AT +8%` …

---

## `noun_fr.json` — table de noms (crc32 → libellé)

20 908 entrées `{ crc32:int(signé), name:string }`, 19 976 crc32 distincts, 20 628 noms non vides.
Plusieurs lignes par crc32 = formes multiples (nom complet, nom de famille, prénom, surnom).

| crc32 | name |
|---|---|
| -447611118 | `Mamoru Endo` / `Endo` / `Mamoru` |
| -505710357 | `E-E-Endo` |
| -830690095 | `Ichirota Kazemaru` / `Kazemaru` / `Ichirota` |
| -681075312 | `Heigoro Kabeyama` |
| -1742337193 | `Jin Kageno` / `Kageno` / `Jin` |
| -2126693866 | `Teppei Kurimatsu` / `Kurimatsu` / `Teppei` |

C'est la table de résolution hash → nom (cohérente avec les `characterId`/`nameId` de `character_fr.json`).

---

## `orion-report.json` — audit série « Orion »

Rapport généré le 2026-02-19 sur la série `Inazuma Eleven: Orion`
(`seriesType: 8`, `seriesId: 0xE43DAFA3`, JA `イナズマイレブン オリオンの刻印`).
Clés racine : `metadata, statistics, scenario, teams, teamsDetailed, characters, zukanMatches, textReferences, dataGaps, recommendations`.

**statistics** : 190 personnages, 190 avec nom EN et FR, 190 avec stats, 172 avec équipe,
seulement 16 avec image zukan, 1 avec skills.
- positions : MF 84 · DF 53 · FW 33 · GK 20
- éléments : Mountain 53 · Fire 50 · Wind 44 · Forest 43
- rareté : `Normal` ×190 · genre : M 175 / F 15

**teams** (15) : effectif entre parenthèses

| Équipe | Membres | | Équipe | Membres |
|---|---|---|---|---|
| Inazuma National | 5 | | The Sambassadors | 14 |
| Raging Bulls | 15 | | Guardians of the Queen | 0 |
| Fallen Angels | 17 | | Orion All-Stars | 14 |
| Eternal Dancers | 15 | | Star-Spangled Unicorns | 14 |
| Arabian Firebirds | 15 | | Unaffiliated | 0 |
| Avenging Acrobats | 15 | | Sub Character | 5 |
| Los Invencibles | 10 | | | |
| Ace Invaders | 15 | | | |
| Pitch Perfectionists | 18 | | | |

Exemple `characters[0]` : `charaParamId 0x98ADA341`, `internalCode c08010010`,
`slug ichihoshi_mitsuru-0x98ADA341`, JA `一星 充` / EN `Ichihoshi Mitsuru`, MF, Wind, Normal, M,
équipe Inazuma National, `statsTotal 667`.

**scenario** : `phases` (6, ex. phaseNumber 10/20…, champ `encodedData` base64),
`triggers` (17, `triggerType`, `entityHash`, `encodedData` base64), `objectives` (6).
Objectif type : `{ hashId:2017760444, textEn:"Tell everyone their tasks.", textFr:"Donnez à tout le monde leurs instructions." }`.

**textReferences** (24) par type : item 11 · menu 4 · post 4 · skill 2 · trophy 1 · archive 1 · chara_info 1.
Ex. menu `Orion Route`, `Orion Route Pt. 1`, trophy `Wins (Orion Route):`.

**dataGaps / recommendations** (factuel) : 174 sans image zukan, 165 secrets dans le zukan,
0 nom EN manquant. Note du rapport : *les noms EN/FR des persos Orion n'existent pas dans les fichiers du jeu*
(les 19 avec nom EN sont réutilisés d'autres séries Unicorn/IE3/Ares) ; persos Orion classés sous « Inazuma Eleven Ares » dans le zukan.

---

## `passive-sheets.json` — barèmes de passifs

Clés : `playerPassives` (60), `customPassives` (35), `coordinatorPassives` (80), `playstyles` (6), `extractedAt` (2026-02-08).

- **playerPassives** : `{ no, playstyle, requirement, stat, legendary{low,high}, top{…}, advanced{…}, growing{…}, common{…} }`.
  Barème à 5 rangs (Legendary > Top > Advanced > Growing > Common). Ex. n°1 Shot AT, même élément : legendary 1 %→1.5 %, common 0.5 %.
- **customPassives** : `{ no, requirement, stat, buff }` — valeur unique (ex. Shot AT, même élément, `1%`).
- **coordinatorPassives** : `{ no, playstyle, requirement, stat, coordinatorCommon, coordinatorLegendary, managerCommon, managerLegendary }`.
- **playstyles** : `["Breach","Tension","Counter","Bond","Rough Play","Justice"]`.

**stats** affectées par les passifs (27 valeurs côté joueur/coordinateur) — extrait :
`Shot AT`, `Focus AT & DF`, `Scramble AT & DF`, `Castle Wall DF`, `Team Focus AT & DF`,
`Own Shot AT`, `Own Focus AT & DF`, `Team Breach Rate`, `Team Tension`, `Team Bond Power`,
`[MF] Focus AT & DF`, `[DF] Focus AT & DF`, `[KP] KP`, `Team Direct Shot AT`, `Team Foul Rate`…

**requirements** (24 conditions) — extrait :
`For players of the same/different element(s)`, `…same/different position(s)`, `For nearby players`,
`On your half of the pitch`, `On the opposition's half of the pitch`, `When outside the zone`,
`When at 100% Tension`, `When tied or behind in goals`, `When at +15% or higher Breach Rate`, `Non-Conditional`…

---

## `sheet_data.json` — tables de jeu structurées

`meta` = titre VR Document v3.06. 14 tables (clé → tableau d'objets) :

### hissatsu (691 techniques)
`{ id, name, name_jp, element, power, tension, type, sub_type, shop1, shop2, duration }`.
- par **type** : Shoot 273 · Defense 144 · Offense 140 · Keep 134
- par **élément** : Wind 172 · Forest 166 · Fire 164 · Mountain 151 · Void 19 (+19 sans élément)
- **sub_type** : `Long Shoot`, `Counter Shoot`, `Shoot Block`
- **shop1** : Spirit Market, Chronicle Department Store, Vs Store, Magic Moves (Odaiba Branch), Special Training Booth, Legendary Chest
- Ex. : Chaos Break (カオスブレイク, Forest, power 100, tension 100, Shoot, durée 7.14 s), Grand Fenrir, Jet Stream (Long Shoot), Emperor Penguin No. 3, Supernova, Big Bang.

### auras (155) — Auras / Keshin / Totems
`{ name, type, element, passive, hissatsu_name, hissatsu_type, hissatsu_element, power, scroll_notes, scroll_effect, image_url }`.
- par **type** : Keshin 93 · Totem 56 · Awakening 5 · `?` 1.
- Ex. : *Burning Overdrive* (Awakening, passive `Own AT/DF +30% / Shot AT +20% / Hissatsu Power +30% / Movement Speed +50%`),
  *Keeper's Grit*, *Standard Bearer Brynhildr*, *Heroic Swordsman Lancelot*, *Brave Samurai Musashi*.

### tactics (54) — tactiques spéciales
`{ name, effect1, effect2, effect3, duration, cooldown, shop }`. Shops : Special Training Booth, Chronicle Department Store, BB Mart.
Ex. : *Keyman Lockdown* (cible : lignes de passe disparaissent, AT -50 %, DF -50 %, durée 40 s, cooldown 90 s), *Against All Odds*, *Flame Fortress*, *Three-Pronged Attack*.

### drops (98) — passifs de Free Match Drops
`{ team, game, fixed_beans, passive_type, no, requirement, stat, value }`.
- `passive_type` : Manager 34 · Custom 33 · Coordinator 31
- `game` : IE1, IE2, IE3, IEGO1, IEGO2, VR
- `fixed_beans` : `Offensive Beans`, `Defensive Beans`. Ex. team `Royal Academy 1`, `Inazuma Kids FC`.

### kizuna_items (125) — objets de Kizuna/Bond Town
`{ name, size, power, shop, notes }`.
- **size** : S 54 · L 36 · M 33 (+2 vides)
- **shops** : Chronicle Department Store, Vs Store, BB Mart, Bond Shop, Spirit Market, Extended Story Zeus, Ranked Reward, Magic Moves (Odaiba Branch), `???`
- Ex. : Inazuma Caravan (M, power 50), Inazuma Jet (M, 110), Timecraft, Nobunaga's Sword, Zhuge Liang's Scroll.

### heroes (126 lignes, 63 persos distincts) — variantes « Hero »
`{ character_id, name_romaji, name_localised, gender, position, element, playstyle, moveset, kick, control, technique, pressure, physical, agility, intelligence }`.
Plusieurs lignes par perso (une par playstyle). Ex. Shuya Goenji / Axel Blaze, FW, Fire, kick 145 / control 138 / technique 126.

### basara (63) — variantes « Basara »
Mêmes champs + `alt_position, alt_moveset, passive`. Ex. Shuya Goenji kick 168 (stats supérieures aux Heroes).

### items (433) — équipement
`{ name, type, kick, control, technique, pressure, physical, intelligence, agility, shop }`.
**type** : Boots 200 · Pendant 79 · Bracelet 76 (+78 sans type). Ex. Raimon Boots, Occult Boots. Cases de stat vides = pas de bonus.

### coordinators (102)
`{ image, name_kanji, name_hiragana, name_romaji, name_localised, gender, role, game, element, playstyle, passive_slot, passive_no, requirements, stat, buff }`.
**role** : Manager 68 · Coordinator 31 · Coach 3. Ex. Aki Kino / Silvia Woods (Coordinator, Tension, passif slot 1, Shot AT +1 %).

### Tables de barèmes de passifs (doublons normalisés)
- **passive_scaling** (60) : barème 5 rangs (`legendary_low/high` … `common_low/high`) — équivalent de `playerPassives`.
- **custom_passives** (37) : `{ id, requirements, stat, buff }`.
- **passive_generation** (34) : `{ passive_id (ex. "DF1"), no, requirement, stat }` — table de génération de passifs par slot.
- **manager_passives** (80) : `{ id, playstyle, requirements, stat, coord_common, coord_legendary, manager_common, manager_legendary }`.

> Note : `sheet_data.json` mélange éléments et positions dans `position`/`element` pour `heroes`
> (valeurs parasites `FW/DF/MF/GK` côté élément) — artefact de décalage de colonnes du Sheet source.

---

## `sheet_export.json` — feuilles brutes du Google Sheet (25 onglets)

`{ title, sheets }` où chaque feuille = tableau de rows, chaque row = tableau de cellules string.
C'est la **source brute** dont `sheet_data.json` est l'extraction normalisée.

| Feuille | Rows | Cols max | Contenu (en-tête) |
|---|---|---|---|
| Main | 182 | 9 | notes + formules dérivées (Shoot AT = Kick + Control ; Focus AT = (Control+Technique)+(Kick×0.5)…) |
| Characters | 5 133 | 26 | roster complet (ID, noms, gender, game, type, position, élément, playstyle, 3 premiers moves, 7 stats, total, paths) |
| Backup of Characters | 5 408 | 22 | ancien roster (+ colonne `Passive ID`, romaji minuscule `endou mamoru`) |
| Characters AT/DF | 5 133 | 25 | roster avec stats dérivées (Shot/Focus/Scramble AT-DF, Castle Wall, KP) |
| Characters AT/DF Old | 5 408 | 20 | idem, version précédente |
| Hero | 127 | 16 | variantes Hero (par playstyle) |
| Basara | 190 | 18 | variantes Basara (+ Alt Moveset, First 3, passif multi-lignes) |
| ALL Basara | 5 070 | 19 | roster complet format Basara (movesets + paths + passives) |
| Player Stat Calculator | 15 | 20 | calculateur (sélection nom/ID, beans, niveau) |
| Hyper Moves | 157 | 11 | auras/keshin/totems (= `auras`) |
| Hissatsu | 692 | 12 | techniques (= `hissatsu`) |
| Tactics | 55 | 7 | tactiques (= `tactics`) |
| Sheet3 | 8 | 7 | matrice de pondération stat → AT/DF (Kick→Shoot AT 82…) |
| Boots / Bracelet / Pendant / Misc | 202/79/80/79 | 17-18 | équipement par type + dérivées AT/DF/KP |
| Free Match Drops | 827 | 9 | passifs droppés par équipe/jeu (= `drops`) |
| Custom Passive | 38 | 4 | barème custom |
| Player Passive_old | 65 | 9 | ancien barème joueur (Min/Max) |
| Player Passive Generation | 111 | 8 | génération de passifs par slot (`DF1`…) |
| Player Passive | 62 | 17 | barème 5 rangs (Legendary/Top/Advanced/Growing/Common × Low/High) |
| Coordinator/Manager Passive | 81 | 17 | barème coordinateur/manager (Common/Legendary) |
| Coordinator/Managers | 503 | 15 | liste coordinateurs/managers/coachs |
| Kizuna Town Items | 126 | 7 | objets de ville (= `kizuna_items`) + « Bond Town Mechanics » (min 3000 Power…) |

Formules dérivées explicites (feuille Main / Sheet3) :
`Shoot AT = Kick + Control` · `Focus AT = (Control + Technique) + (Kick × 0.5)` · `Focus DF = (Intelligence + Technique) + (Agility × …)`.
