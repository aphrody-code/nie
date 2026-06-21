# Famille de données : zukan

Caches et consolidations de l'ingesteur **zukan.inazuma.jp** (cf. crate `nie-zukan`). Glob : `data/zukan/**/*.json` — **8 fichiers JSON** (les sous-dossiers `chara_*_cache*/`, `audit_series_cache/`, `skill/`, `my_team_assets/` contiennent des scrapes HTML/CSS/JS, pas du JSON).

Tous les médias (portraits, vidéos de skills) pointent vers le CDN officiel **`dxi4wb638ujep.cloudfront.net`** ; les pages de détail vers **`zukan.inazuma.jp/chara_param/?q=…`** (param base64/obfusqué). Identifiant pivot omniprésent : le **`zukanHash`** de forme `k/<a>/<b>/<slug>` (ex. `k/d/w/dwho-wi8ruk` = Mark Evans / 円堂 守).

| Fichier | Type | Taille | Contenu |
|---|---|---|---|
| `db_consolidated.json` | array(5137) | 2,0 Mo | DB consolidée des persos (JA) : nom, position, élément, rareté, URLs |
| `param_en.json` | array(5407) | 2,1 Mo | Paramètres persos en anglais + stats à 7 axes |
| `param_ja.json` | array(5407) | 2,7 Mo | Paramètres persos en japonais + stats (5 axes) + description |
| `zukan_order_en.json` | array(5407) | 1,0 Mo | Ordre canonique du zukan (EN), allégé |
| `zukan_mapping.json` | objet(5948) | 425 Ko | CRC32 hex → `{hash, order}` (résolution CRC→zukanHash) |
| `skill-videos.json` | array(883) | 269 Ko | Vidéos de techniques (skills) appariées |
| `series_audit.json` | objet | 11 Ko | Rapport d'audit du crawl par série (39 anomalies) |
| `unmatched-skills.json` | array(28) | 8,5 Ko | Vidéos de skills non appariées à la DB |

---

## db_consolidated.json — 5137 personnages (JA)

Clés par entrée : `zukanId, name, nickname, imageUrl, zukanHash, detailUrl, position, element, rarity`.
Fait notable : `zukanId === zukanHash` pour les **5137** entrées, et **100 %** des `zukanHash` commencent par `k/`.

Exemple :
```json
{"zukanId":"k/d/w/dwho-wi8ruk","name":"円堂 守","nickname":"円堂",
 "imageUrl":"https://dxi4wb638ujep.cloudfront.net/1/k/d/w/dwho-wi8ruk.png",
 "zukanHash":"k/d/w/dwho-wi8ruk",
 "detailUrl":"https://zukan.inazuma.jp/chara_param/?q=hN2ZlpOLmo2g…",
 "position":"GK","element":"山","rarity":"二年生"}
```

| position | n | | element (JA) | n | | rarity | n |
|---|---|---|---|---|---|---|---|
| DF | 1505 | | 林 (Forest) | 1314 | | 二年生 (2e année) | 2325 |
| MF | 1504 | | 風 (Wind) | 1311 | | 一年生 (1re année) | 1122 |
| FW | 1313 | | 火 (Fire) | 1282 | | - | 947 |
| GK | 815 | | 山 (Mountain) | 1230 | | 三年生 (3e année) | 742 |
| | | | | | | Grade 7 | 1 |

(La rareté reprend les "années" scolaires de la franchise ; `Grade 7` est un singleton, probable scrape FR/EN résiduel.)

---

## param_en.json — 5407 personnages (EN, avec stats)

Clés : `name, nickname, zukanHash, position, element, stats, game, gender`.
`stats` à **7 axes** : `kick, control, technique, pressure, physical, agility, intelligence`.

Exemple :
```json
{"name":"Mark Evans","nickname":"Evans","zukanHash":"k/d/w/dwho-wi8ruk",
 "position":"GK","element":"Mountain",
 "stats":{"kick":90,"control":97,"technique":91,"pressure":98,
          "physical":105,"agility":111,"intelligence":97},
 "game":"Inazuma Eleven","gender":"Male"}
```

**5242 / 5407** entrées portent un bloc `stats`. Amplitudes réelles observées :

| stat | min | max | moy |
|---|---|---|---|
| kick | 82 | 121 | 96,7 |
| control | 85 | 115 | 101,0 |
| technique | 83 | 116 | 97,2 |
| pressure | 83 | 105 | 91,2 |
| physical | 81 | 109 | 92,5 |
| agility | 80 | 111 | 86,8 |
| intelligence | 89 | 121 | 100,4 |

Répartition (les `?` / `???` sont les 164-165 fiches « masquées », jeu Orion / inconnu) :

| position | n | | element | n | | gender | n |
|---|---|---|---|---|---|---|---|
| MF | 1548 | | Wind | 1337 | | Male | 4217 |
| DF | 1533 | | Forest | 1334 | | Female | 989 |
| FW | 1335 | | Fire | 1310 | | ? | 165 |
| GK | 826 | | Mountain | 1261 | | Unknown | 35 |
| ? | 165 | | ? | 165 | | (vide) | 1 |

**game** (10 valeurs — répartition par opus de la franchise) :

| game | n |
|---|---|
| Inazuma Eleven | 1034 |
| Inazuma Eleven: Victory Road | 915 |
| Inazuma Eleven GO: Light / Shadow | 912 |
| Inazuma Eleven 2: Firestorm / Blizzard | 647 |
| Inazuma Eleven 3: Lightning Bolt / Bomb Blast / Team Ogre Attacks! | 637 |
| Inazuma Eleven GO Chrono Stones: Wildfire / Thunderflash | 410 |
| Inazuma Eleven GO Galaxy: Big Bang / Supernova | 387 |
| Inazuma Eleven Ares | 223 |
| ??? | 164 |
| Inazuma Eleven Orion | 78 |

Les 165 entrées `position:"?"` se rattachent à `???` (164) et `Inazuma Eleven Orion` (1) — fiches encore secrètes côté zukan.

---

## param_ja.json — 5407 personnages (JA, avec description)

Mêmes entrées que `param_en` mais en japonais, avec **deux différences** :
1. champ supplémentaire **`description`** (présent sur les **5407 / 5407** entrées) — flavor text du perso ;
2. bloc `stats` réduit à **5 axes** : `kick, control, technique, pressure, physical` (pas `agility`/`intelligence`).

Le `nickname` JA embarque les **furigana** (kanji + lecture kana accolée) : `円堂えんどう`, `豪炎寺ごうえんじ`, `風丸かぜまる`.

Descriptions (exemples réels) :
- 円堂 守 : « サッカーへの情熱は誰にも負けない。どんな時でも諦めない　強い心を持つ。 »
- 豪炎寺 修也 : « クールだが　胸の奥に秘めたサッカーへの思いは炎のようにアツい。 »
- 壁山 塀吾郎 : « その大きな体を使ってのディフェンスはまさに壁のごとし。 »

`game` (JA) miroir exact des 10 valeurs EN : `イナズマイレブン` (1034), `イナズマイレブン 英雄たちのヴィクトリーロード` (915), `イナズマイレブンGO シャイン／ダーク` (912), `イナズマイレブン2 脅威の侵略者 ファイア／ブリザード` (647), … `？？？` (164), `イナズマイレブン オリオンの刻印` (78). Genre : `男` 4217, `女` 989, `?` 165, `不明` 35.

---

## zukan_order_en.json — 5407 entrées (ordre canonique)

Version allégée pour la pagination/tri du zukan : `order, name, zukanHash, position, element, game`.
`order` est dense de **0 à 5406** (5407 valeurs). order 0 = Mark Evans, 1 = Axel Blaze, 2 = Jack Wallside, 3 = Nathan Swift. Distributions position/element/game **identiques** à `param_en.json`.

---

## zukan_mapping.json — 5948 mappings CRC → hash

Objet dont les clés sont des **CRC32 en hexadécimal** (`0xXXXXXXXX`, 5948/5948 conformes) et la valeur `{hash, order}`. Sert à résoudre un CRC de perso (id binaire du jeu) vers son `zukanHash` web. `order` vaut **0** partout dans ce fichier (l'ordre vit dans `zukan_order_en.json`).

```json
"0x3055CF22": { "hash": "k/d/w/dwho-wi8ruk", "order": 0 }   // → Mark Evans
```

**5112** hashes distincts pointés par 5948 CRC ⇒ relation **plusieurs-CRC-par-hash** (alias : variantes/évolutions d'un même perso partagent un portrait zukan). Distribution du nombre de CRC par hash :

| CRC par hash | nb de hashes |
|---|---|
| 1 | 4788 |
| 2 | 185 |
| 4 | 41 |
| 3 | 35 |
| 6 | 18 |
| 5 | 17 |
| 8 | 10 |
| 9 | 6 |
| 7 | 5 |
| 13 | 3 |
| 10 | 2 |
| 12 | 1 |
| **88** | 1 |

Le hash le plus aliasé (**88 CRC**) est `prd/assets/4/img/shared/icn_secret_character` — l'icône générique « personnage secret » mutualisée par 88 fiches encore masquées. Viennent ensuite `k/o/p/opancch54ie` et `k/t/a/tapz2x4bat8` (13 CRC chacun).

---

## skill-videos.json — 883 vidéos de techniques

Clés : `name, videoUrl, posterUrl, thumbnailUrl, type`. Médias 100 % sur le CDN, extensions homogènes : **vidéo `.wmv`**, **poster `.jpg`**, **thumbnail `.webp`** (883/883 chacun).

```json
{"name":"The Wall",
 "videoUrl":"https://dxi4wb638ujep.cloudfront.net/1/k/t/q/tqgunvnu5vk.wmv",
 "posterUrl":"…/1/k/2/e/2eczdp7s6te.jpg",
 "thumbnailUrl":"…/1/k/z/v/zvszxo9g5lk.webp",
 "type":"Defence"}
```

`type` (4 catégories de techniques) : **Shot** 360, **Success** 182, **Defence** 174, **Offence** 167.

Noms de skills (exemples réels) : The Wall, Killer Slide, Coil Turn, Earthquake, Quick Draw, Spider Web, Cyclone, Fake Ball, Shadow Stitch, Sumo Stomp, Horn Train, Hurricane Arrows, Spinning Cut, Defence Scan, Ghost Pull.

---

## unmatched-skills.json — 28 vidéos non appariées

Même schéma que `skill-videos.json` (`name, videoUrl, posterUrl, thumbnailUrl, type`) : techniques dont la vidéo n'a **pas** pu être reliée à une entrée de la DB de skills. `type` : Shot 23, Success 3, Defence 1, Offence 1.

Exemples : Formidable Fortress, Sauced-up Marinara Barrier, Diamond Arm, Super God Hand, Starstruck, Arced Diamond Ray, Off-Balance Pisa Kick, Divine Drive, Brawl of the Wild, Orion's Shade, Capoeira Kick, Cannonball, Super Megaton Head, One for All, Regal Eagle.

---

## series_audit.json — rapport d'audit du crawl

Méta du dernier crawl + qualité d'appariement par série.

```json
{"generatedAt":"2026-05-31T21:27:16.213Z",
 "totalCrawled":5133,"totalMatched":5094,
 "totalWrongSeries":0,"totalNotFound":39}
```

`bySeries` (clés = libellés courts de série) :

| série | ok | wrong_series | not_found |
|---|---|---|---|
| Inazuma Eleven | 1023 | 0 | 10 |
| Inazuma Eleven 2 | 643 | 0 | 3 |
| Inazuma Eleven 3 | 632 | 0 | 2 |
| Inazuma Eleven GO | 914 | 0 | 3 |
| Chrono Stone | 398 | 0 | 4 |
| Galaxy | 380 | 0 | 6 |
| Ares | 207 | 0 | 11 |
| Victory Road | 897 | 0 | 0 |

`anomalies` : array(**39**), toutes au statut `not_found` (aucune `wrong_series`). Clés : `name, zukanHash, appearedIn, zukanSeries, databaseSeries, databaseId, matchMethod, status`. Exemple :
```json
{"name":"Axel Blaze","zukanHash":"k/f/1/f1kh7d67sbs","appearedIn":["ie1"],
 "zukanSeries":"Inazuma Eleven","databaseSeries":null,"databaseId":null,
 "matchMethod":null,"status":"not_found"}
```
(`appearedIn` reprend les codes courts de série du sous-dossier `audit_series_cache/` : `ie1, ie2, ie3, go1, go2, go3, ares, orion`.)
