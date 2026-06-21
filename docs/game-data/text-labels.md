# Famille de données : text-labels

Tables de texte localisées du jeu, décodées depuis les `cfg.bin` (RDBN) en JSON.
Glob : `data/common/text/**/*.json`.

**Périmètre réel mesuré** (scan Bun de l'arborescence) :

| Métrique | Valeur |
|---|---|
| Fichiers `.json` | **16 713** |
| Erreurs de parse | 0 |
| Entrées (lignes `*_n` enfants, tous blocs) | **324 128** |
| Langues | `ja`, `en`, `fr` (3) |
| Chaînes contenant des furigana `[kanji/lecture]` | 46 525 |

C'est de loin la plus grosse famille du jeu : dialogues d'événements (cutscenes du mode
histoire), libellés de carte, objectifs de quête, et toutes les tables d'UI/données.

## Structure commune d'un fichier

Tous les fichiers suivent le même squelette `cfg.bin` → JSON :

```
{ "entries": [ { "name": "<BLOC>_BEGIN_0",
                 "variables": [ {"type":"Int","value":"<N>"} ],   // N = nb d'enfants
                 "children": [ { "name":"<BLOC>_<i>",
                                 "variables":[ … ], "children":[] }, … ] } ] }
```

- La variable `Int` du nœud `*_BEGIN_0` **égale exactement le nombre d'enfants** du bloc
  (vérifié : `menu_text`=2557, `skill_text`=1240, `team_text`=108, `trophy_text`=344…).
- Un fichier peut contenir **plusieurs blocs** (ex. `TEXT_INFO_BEGIN_0` + `NOUN_INFO_BEGIN_0`).
- La 1ʳᵉ variable `Int` de chaque enfant est une **clé de hash signée Int32** (CRC32 de
  l'identifiant de texte). La 2ᵉ `Int` vaut presque toujours `0`. Puis vient le `String`.

### Les 4 noms de bloc rencontrés

| Bloc `*_BEGIN` | Fichiers | Rôle |
|---|---|---|
| `TEXT_INFO` | 12 002 | texte localisé (UI, dialogues, descriptions) |
| `TEXT_WASHA_MAP` | 4 711 | mappe hash → id de script/voix (agnostique langue) |
| `NOUN_INFO` | 75 | formes nominales/déclinaisons (bloc secondaire) |
| `TEXT_MOTION_MAP` | 47 | mappe hash → motions |

## Répartition par catégorie × langue

(`entries` = nombre de lignes enfants ; `schema` = types des variables de l'enfant)

| Catégorie \| langue | Fichiers | Entrées | Schéma enfant dominant |
|---|---|---|---|
| `common` (washa maps) | 2 | 553 | `Int,Int,Int,Int,Int,Str,Int,Str,Int,Int,Int` |
| `event_map` (`text/event/*_map`) | 4 676 | 25 471 | `Int,Int,Int,Int,Int,Str,Int,Str,Int,Int,Int,Int,Int,Int,Int,Str,Int` (17) |
| `npc_text_map` (`text/map/*_npc_text_map`) | 33 | 8 388 | idem 17 vars |
| `event \| ja` | 4 683 | 25 429 | `Int,Int,Str,Int` |
| `event \| en` | 3 521 | 17 690 | `Int,Int,Str,Int` |
| `event \| fr` | 3 518 | 17 676 | `Int,Int,Str,Int` |
| `map \| ja/en/fr` | 32 ×3 | 7 875 ×3 | `Int,Int,Str,Int` |
| `purpose \| ja/en/fr` | 15 ×3 | 106 ×3 | `Int,Int,Str` |
| `phase \| en/fr` | 2 ×2 | 6 ×2 | `Int,Int,Str` |
| `root \| ja` | 48 | 70 840 | `Int,Int,Str` (+ variantes 4-var / NOUN) |
| `root \| en` | 43 | 67 063 | `Int,Int,Str` |
| `root \| fr` | 43 | 67 063 | `Int,Int,Str` |

Le japonais a 5 tables racines en plus : `battle_skill_text`, `battle_text`,
`chara_nickname_text`, `common_talk_text`, `dictionary_text`, `ng_word_text`,
`power_site_text` (présentes uniquement sous `text/ja/`).

## Type 1 — `TEXT_INFO` : texte localisé

Schéma enfant : `[Int hash, Int (=0), String texte]` ; les **dialogues d'événements**
ajoutent un `Int` final (= `[hash, 0, texte, 0]`).

### Dialogues d'événements (`text/<lang>/event/ev*.cfg.bin.json`)

Vraie matière du mode histoire. Exemple parallèle ja/en/fr, même clé de hash :

| Langue | hash | texte |
|---|---|---|
| ja | -504407471 | やるじゃねえか　リベロ！ |
| en | -504407471 | Not bad, libero! |
| fr | -504407471 | Pas mal, le libéro ! |

Le plus gros dialogue (`fr/event/ev02_00800` = 124 lignes) — cutscene de match :

```
<FLC:SORAMIYA>... ?
Et c'est parti !
Northbright, l'étoile montante du Kyushu, pourra-t-il faire face à Raimon, l'imbattable ?
L'an dernier, ils ont reconstruit leur équipe autour de <FUL:SORAMIYA>...
Tactique : Attaque sur trois fronts !
```

### Tables racines (`text/<lang>/*.cfg.bin.json`) — libellés représentatifs

Échantillons réels (clé de hash → libellé). Sauf indication, libellés `en`.

**`menu_text`** (2607 entrées) — UI options/réglages :

| hash | libellé |
|---|---|
| 1582345025 | Text Language |
| -950404357 | Speech Bubble Dialogue Speed |
| 551671804 | Subtitles |
| 1474750314 | Minimap Rotation |
| 1325258283 | Master Volume |
| 810330774 | Character Voice |

**`system_text`** (584) — messages système (avec macros) :

| hash | libellé |
|---|---|
| 1389146809 | `You obtained [CG]<ITEM_NAME>[C].` |
| 1090280331 | `Your bond with [CG]<CHARA_NAME>[C] has grown.` |
| -1170053658 | Return to Title |
| -512785242 | Auto |

**`skill_text`** (2898) — descriptions de techniques (hissatsu) :

| hash | libellé |
|---|---|
| -2018795591 | Use a large player's body as a springboard to shoot a high ball down like lightning… |
| -924186242 | Harry the opposition with a merciless roar borne from a dragon's might. |
| -2039876210 | Slam the ball to send it crashing like a meteor straight toward the goal! |

**`item_text`** (2423) — descriptions d'objets :

| hash | libellé |
|---|---|
| -91180747 | `Spirit "<CHARA_NAME>"` |
| 648928847 | The ultimate disc containing the astonishing truth behind a certain legendary g… |
| 761022438 | Authorizes you to use Alius Masters in Competition Mode. |

**`team_text`** (371) — noms/descriptions d'équipes (Raimon, Nagumohara…) :

| hash | libellé |
|---|---|
| 1945671888 | A rising team formed recently, they used smart tactics to break into Football F… |
| -1853894344 | Led by a prodigy dubbed "Alice in Footballand," they dominate with flawless tea… |

**`trophy_text`** (344) — titres de sous-quêtes :

| hash | libellé |
|---|---|
| -2009007752 | Old Man Who Lost His Key |
| -131461641 | Hole in One |
| 300730594 | Cursed Letter |

**`map_text`** (234) — descriptions de lieux :

| hash | libellé |
|---|---|
| -74514304 | Kyushu's leading prep school in Nagasaki, with strong focus on studies and spor… |
| 1235944185 | The downtown football pitch, also a hub where locals gather and connect. |

**`help_list_text`** (1025) — entrées d'aide / noms de modes :

| hash | libellé |
|---|---|
| -1456863546 | Story Mode |
| 807622524 | Competition Mode |
| -650055095 | Kizuna Station |
| 1078567923 | Chronicle Mode |

**`chat_text`** (18) — émotes de chat multijoueur :

| hash | libellé |
|---|---|
| 1442560583 | Hello! |
| -856495107 | GLHF! |
| 1385594462 | Nice work! |

**`soccer_team_passive_text`** (21) — passifs d'équipe (libellés `ja`) :
`キャプテンのブロック`, `[風属性/かぜぞくせい][選手/せんしゅ]のテクニックMAX[値/ち]`,
`テンションMAX[値/ち]`, `[化身/けしん]を[発動中/はつどうちゅう]の[移動速度/いどうそくど]`.

**`dictionary_text`** (572, `ja`) — fiches de personnages (intrigue « Y学園/YSP ») :
ex. `ごく[普通/ふつう]の[家庭/かてい]に[育/そだ]った\nヒーローに[憧/あこが]れを[抱/いだ]く[生徒/せいと]…`.

**`setting_text`** (42, `ja`) — descriptions des réglages :
`カメラの[上下移動/じょうげいどう]の　[速度/そくど]を[調整/ちょうせい]できます`, etc.

### Tables racines présentes mais à `String` VIDE dans ce build

Fait notable (anti-hallucination) : certaines tables ont des clés de hash mais **toutes
leurs valeurs `String` sont vides** ici (noms sourcés ailleurs / placeholders) :

| Table | Enfants | Non vides |
|---|---|---|
| `chara_text` | 20 968 | 0 |
| `chara_nickname_text` (ja) | 1 188 | 0 |
| `medal_text` | 231 | 0 |
| `quest_title_text` | 166 | 0 |
| `shop_text` | 14 | 0 |
| `music_name_text` | 0 | 0 |

Plus largement, `emptyStr` est élevé sur les racines (≈ 47 800/67 000 lignes `en`) :
beaucoup de slots réservés/non remplis.

### Bloc secondaire `NOUN_INFO`

Présent dans 75 fichiers (ex. `soccer_technic_text`, `battle_skill_text`,
`chara_add_info_text`). Schéma enfant à 8 `String` + 5 `Int` :
`[Int hash, Int, Str×8, Int×5]` — créneaux de formes nominales/genre pour la localisation.
Ex. `["2069698513","0","","","","[強行突破/キョウコウトッパ]","",…]`.

## Type 2 — `TEXT_WASHA_MAP` : maps de script/voix (agnostique langue)

Schéma à **17 variables** ; la chaîne en `[15]` est un **identifiant de script/voix**, pas
du texte affiché (souvent les `String` `[5]`/`[7]` sont vides). Lie un hash (`[0]`) à une
ligne de dialogue/voix et à un id de scène. `[2]` est un second hash.

**Event speaker map** (`text/event/ev23_01210_map`) :

| idx | type | exemple |
|---|---|---|
| 0 | Int (hash) | 826761795 |
| 2 | Int (hash) | -697882838 |
| 15 | String (id script) | `ev23_01210_010_010` |

**NPC map** (`text/map/w20_npc_text_map`, begin=353) — id de talk/voix NPC :
`[15] = tlk_w20_qsb090500_umbz_student_010`.

**`common/system_text_map`** (491) — id de messages système :
`[15] = sysmes_notification_log_get_item` (hash `[0]`=1389146809, le même que
`system_text` « You obtained… » → la map relie le code système au texte localisé).

**`common/common_talk_text_map`** (62) — variante à **11 variables**, avec un id de pose
en `[5]` (ex. `p0012`).

## Macros et codes de contrôle (vraies balises in-game)

Comptés sur les 12 002 fichiers `TEXT_INFO` (ja+en+fr) :

### Substitution de noms / valeurs `<MACRO>`

| Macro | Occurrences | Sens probable |
|---|---|---|
| `<FLC:…>` | 4016 | nom (forme complète, variantes par perso) |
| `<FST:…>` | 2833 | prénom |
| `<FUL:…>` | 2470 | nom complet |
| `<MNT:…>` | 1417 | nom de lieu/équipe |
| `<LST:…>` | 965 | nom de famille |
| `<CHARA_NAME>` | 453 | nom du perso courant |
| `<VALUE>` / `<VALUE1>` | 389 / 300 | valeur numérique |
| `<ACHIEVE_COUNT>` | 297 | compteur de succès |
| `<SKILL_VAL>` / `<SKILL_NAME>` | 271 / 57 | technique |
| `<TAG_I>` / `<TAG_YOU>` | 240 / 228 | tags joueur/adversaire |
| `<ITEM_NAME>` | 66 | objet |
| `<CMD_FUNC*>` / `<CMD_ENTER>` / `<CMD_BACK>` | — | prompts de bouton |

### Codes couleur/format `[CTRL]`

| Code | Occurrences |
|---|---|
| `[C]` (reset) | 1910 |
| `[CG]` | 877 |
| `[CTACTICS01]` | 192 |
| `[CR]` | 182 |
| `[CN]` | 181 |
| `[CY]` | 87 |
| `[CFUNCBTN01]` | 66 |

Plus thématiques : `[CTEAMPARAM01]`, `[CPASSIVE01]`, `[CMODE0x]`, `[CREPORT01]`,
`[CAIMARK01]`, `[CCLEAR01]`, `[CENDCARD01]`.

### Furigana

46 525 chaînes utilisent la notation ruby `[kanji/lecture]`
(ex. `[強行突破/キョウコウトッパ]`, `[化身/けしん]`) — surtout côté `ja`.

## Notes de portage

- La clé de jointure inter-tables est le **hash Int32** (CRC32 d'un id de texte) : le même
  hash apparaît dans une `*_map` washa et dans la table `TEXT_INFO` localisée
  correspondante (cf. `system_text_map` ↔ `system_text`).
- Pour afficher un texte : résoudre `hash → String` dans la table de la langue choisie,
  puis substituer les macros `<…>` et appliquer les codes `[C…]`.
- Le contenu narratif réel (mode histoire) vit dans `text/<lang>/event/ev*` ; les
  `text/event/ev*_map` ne portent que les liens script/voix, pas le texte.
