# Aphrody — Byron Love / 亜風炉 照美 アフロディ

> Dossier personnage pour *Inazuma Eleven: Victory Road* (IEVR, `nie.exe`).
> Slug azalee : `byron-love-aphrody`. Suite/approfondissement de `var/rapport-byron-love.md`.
>
> **Méthode (anti-hallucination)** : chaque fait est cité `source → valeur`. *Confirmé* = observé
> dans un fichier/route réel. *Non trouvé* = absent après recherche par code interne ET par hash.
> Les suppositions sont étiquetées. Sources :
> - miroir SQLite `data/backups/supabase-2026-06-05T00-08-26.sqlite` (tables `inagle_*`) ;
> - dumps `data/common/gamedata/**.cfg.bin.json` et textes `data/common/text/{fr,en,ja}/*` ;
> - serveur live `http://127.0.0.1:8790` (`/typed`, `/raw`, `/tex`, `/audio`, `/model-full`) ;
> - base RE `var/niers.sqlite` (fonctions/strings/hash_name de `nie_eacpatched.exe`) ;
> - index CPK `rg/apps/azalee/data/cpk-index.ndjson.gz`.

---

## 0. Résolution des codes internes (CONFIRMÉ)

Un même personnage (Aphrodi / Terumi Afuro) décliné en **3 codes internes** = 3 âges/séries,
et **8 variantes de carte** (`inagle_characters`, `internal_code IN (...)`) :

| `internal_code` | `chara_id` (charaBaseId) | série | sous-dir visage | zukanHash |
|---|---|---|---|---|
| **`c01001900`** | `0x37D7ACFB` | Inazuma Eleven (IE1) | `01_ie1` | `k/d/y/dykb3jbxeis` |
| `c05026590` | `0xFC57A11C` | Inazuma Eleven GO (go2) | `05_go2` | `k/g/l/gltgpqjnrn0` |
| `c07080010` | `0xCA01BFAB` | Ares | `07_ares` | `k/6/q/6q1af7euf9m` |

Les 8 variantes (`id`, `internal_code`, `rarity_label`, `position`, `hero_type`, `zukan_order`) :

| `id` (chara_param_id) | code | rareté | poste | hero_type | zukan | primaire |
|---|---|---|---|---|---|---|
| `0x9E23A289` | c01001900 | Normal | Milieu | — | 166 | **oui** |
| `0xC68B09DE` | c01001900 | Normal | Attaquant | — | 166 | non |
| `0x339905CF` | c01001900 | Normal | Milieu | — | 166 | non |
| `0x55A3AF6E` | c05026590 | Normal | Milieu | — | 2505 | non |
| `0x63F5B1D9` | c07080010 | Normal | Milieu | — | 4161 | non |
| `0x12B74634` | c01001900 | BASARA | Milieu | — | 2507 | non |
| `0x209B996D` | c01001900 | Héros | Milieu | `pink` | 4170 | non |
| `0x09532D9F` | c01001900 | Héros | Milieu | `fire` | 166 | non |

Croisement `/typed` (`chara_param_1.03.66.00.cfg.bin`, parser `nie-data::chara_param`) — la primaire
ressort byte-exact : `chara_param_id=2653135497=0x9E23A289`, `chara_base_id=936881403=0x37D7ACFB`,
`element=2`, `main_position=3`, `sub_position=2`, `growth_pattern=0`.

---

## 1. Identité (3 langues)

Source : `data/common/text/{fr,en,ja}/chara_text.cfg.bin.json` (NOUN_INFO) + `inagle_characters.data`.

| Champ | FR | EN | JA |
|---|---|---|---|
| Nom complet | Byron Love Aphrody | Byron Love Aphrody | 亜風炉 照美 アフロディ |
| Nom de famille | Byron Love | Byron Love | `[亜風炉/あふろ] [照美/てるみ]` |
| Surnom | Aphrody | Aphrody | アフロディ |

- **Nom EN/FR** `"Byron Love"` confirmé dans `chara_text` (en : `NOUN_INFO_194 hash=0x4B2792B9`,
  plusieurs entrées dupliquées 194/1783/2502/3735). JA `アフロディ` (`NOUN_INFO_8914 hash=0x4B133235`…),
  nom de famille `[亜風炉/あふろ] [照美/てるみ]` (notation furigana `[漢字/かな]`).
- **Élément** : **Forêt** (`element="Forêt"`, `data.elementRaw=2`) — confirmé `chara_param.element=2`,
  `SkillElement::Forest`.
- **Poste** : **Milieu / MF** (`positionRaw=3`, `chara_param.main_position=3`) ;
  **sous-poste FW** (`subPosition="FW"`, `chara_param.sub_position=2`).
- **Genre** : Masculin (`gender="M"`, `data.gender=0`).
- **Série** : Inazuma Eleven (`data.seriesId=0x62E8448F`).
- **Constellation / signe** : **Éclaris** (EN *Inazumis*, JA `イナビカリ[座/ざ]`),
  `inagle_constellations` `hashId=0x2575850C`, `index=2`, **188 personnages** ; la primaire
  `0x9E23A289` figure bien dans `characterIds` (CONFIRMÉ).
- **Équipe** : **Zeus** (`世宇子中`, `data.teams[0].id=0x9BAD3311`, saisons `IE1`/`ARES`).
  `inagle_teams.members` = **vide** dans le miroir (roster non peuplé).
- **Zukan** : ordre 166 (primaire), hash `k/d/y/dykb3jbxeis`.
- **growthPattern** : 0.

### Description (CONFIRMÉ, `inagle_characters.data.descriptions` = `chara_description_text`)
- FR : « Captivant ses adversaires avec une grâce artistique, il joue avec une aura divine. »
- EN : « Captivating the opposition with artistic grace, he plays with the aura of a deity from on high. »
- JA : 「芸術的なプレイで敵をも魅了する。その姿は神のように美しい。」

---

## 2. Stats

Source : `inagle_characters.data.stats` (primaire `0x9E23A289`). Les stats **ne sont pas stockées
par perso** dans `chara_param` (`raw_variables` = IDs/niveaux/zéros) : elles sont **dérivées** par
`nie-data::growth::calculate_stats` (position, sous-position, play_style, growth_pattern,
charaRank-de-rareté → growth tables). Valeurs golden de la primaire :

| Niveau | Frappe | Contrôle | Technique | Pression | Physique | Agilité | Intelligence |
|---|---|---|---|---|---|---|---|
| **Lv1** | 13 | 14 | 12 | 10 | 10 | 9 | 11 |
| **Lv50** | 100 | 109 | 105 | 88 | 87 | 81 | 97 |
| **Lv99** | 160 | 174 | 169 | 141 | 140 | 129 | 155 |

Somme réelle Lv99 = **1068** (`inagle_characters.stat_total=0` = non rempli, à recalculer).

### Stats des variantes spéciales
- **BASARA** (`inagle_basara` char 185, *Terumi Afuro / Byron Love*, MF/FW, 林 Forest) :
  Frappe 144, Contrôle 156, Technique 151, Pression 127, Physique 127, Agilité 116, Intelligence 139.
  Passif BASARA : *« On your half of the pitch, Team Focus AT & DF +1% »*.
- **Héros** (`inagle_heroes` char 185, deux playstyles **Breach** et **Tension**, mêmes valeurs) :
  Frappe 125, Contrôle 134, Technique 131, Pression 109, Physique 110, Agilité 102, Intelligence 120.

### Gacha (CONFIRMÉ, `inagle_star_signs`)
| chara_param_id | chara_rarity | rate_default | is_remarkable |
|---|---|---|---|
| `0x9E23A289` (Normal) | 0 | 1 | 0 |
| `0x09532D9F` (Héros fire) | 5 | 1 | 1 |
| `0x209B996D` (Héros pink) | 7 | 1 | 1 |
| `0x12B74634` (BASARA) | 20 | — | 1 |

---

## 3. Techniques & auras

### 3.1 Les 9 slots de la primaire (CONFIRMÉ via `/typed`)

`chara_param` fusionne techniques **et** auras dans **une seule liste de 9 slots** (niveau + hash).
La primaire `0x9E23A289` (`/typed`) :

| slot | skill_id (dec → hex) | niveau | type |
|---|---|---|---|
| 1 | 1646874000 = `0x62294D90` | 0 | technique |
| 2 | 478995128 = `0x1C8CE2B8` | 1 | technique |
| 3 | 221679467 = `0x0D368F6B` | 13 | technique |
| 4 | 1970774634 = `0x7577A26A` | 20 | technique |
| 5 | 3169443499 = `0xBCE9DEAB` | 30 | technique |
| 6 | 2709273970 = `0xA17C3D72` | 38 | **aura** |
| 7 | 1643845373 = `0x61FB16FD` | 43 | technique |
| 8 | 180581512 = `0x0AC37488` | 30 | technique |
| 9 | 2786195819 = `0xA611F96B` | 38 | **aura** |

La séparation technique/aura se fait par résolution : un hash présent dans `skill_config` = technique ;
présent dans `aura_skill_config` (préfixe asset `wap*`) = aura. (`nie-data::chara_param` rend la liste
plate ; `nie-data::aphrody` re-sépare — voir §8.)

### 3.2 Techniques (7) — CONFIRMÉ byte-exact (`skill_config_5.00.07.00`, noms `skill_text/{fr,en,ja}`)

| code | skill_id | Lv | EN | FR | JA | élément | catégorie | puiss. | TP | recast | eventIDName (cut-in) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `rho10010` | `0x62294D90` | 0 | Dust Kick | Frappe poussiéreuse | ホッピングトリック | Néant (5) | Dribble | 30–200 | 40 | 60 | `techo0010` |
| `whs00340` | `0x1C8CE2B8` | 1 | God Knows | Savoir suprême | ゴッドノウズ | Vent (1) | Tir | 70–440 | 70 | 90 | `ev60_00340` |
| `who00200` | `0x0D368F6B` | 13 | Heaven's Time | Instant céleste | ヘブンズタイム | Vent (1) | Dribble | 85–540 | 80 | 60 | `ev61_00200` |
| `whs00900` | `0x7577A26A` | 20 | God Break | Tir solaire | ゴッドブレイク | Vent (1) | Tir | 85–540 | 80 | 90 | `ev60_00900` |
| `whs01250` | `0xBCE9DEAB` | 30 | Chaos Break | Tir chaotique | カオスブレイク | Forêt (2) | Tir | 100–640 | 100 | 90 | `ev60_01250` |
| `whs00310` | `0x61FB16FD` | 43 | Divine Arrows | Flèche céleste | ディバインアロー | Vent (1) | Tir | 60–360 | 60 | 90 | `ev60_00310` |
| `whs01080` | `0x0AC37488` | 30 | Heavenly Drive | Éclat divin | ヘブンドライブ | Montagne (4) | Tir | 70–440 | 70 | 90 | `ev60_01080` |

- `whs01250` Chaos Break : `partnerType=3` (technique combo/Trio) ; les 6 autres `partnerType=0` (solo).
- `rho10010` : `telopInfoId=0x00000000`, `eventID=0xA2123954`, `eventIDName=techo0010`
  (event « technique » générique, **pas de telop**). Les 6 autres ont un `telopInfoId` non nul.

#### Descriptions (exemple `whs00340` God Knows, `skill_text/{fr,en,ja}`)
- FR : « Même les lois de l'univers sombrent dans l'oubli. Une telle puissance ne peut être que l'œuvre du divin. »
- EN : « Banish even the laws of the universe into oblivion. This overwhelming power is nothing short of a divine act. »
- JA : 「[宇宙/うちゅう]の[法則/ほうそく]すらも[忘却/ぼうきゃく]の[彼方/かなた]に[消失/しょうしつ]させる。その[圧倒/あっとう][的/てき]なパワーは　まさに[神/かみ]の[所業/しょぎょう]か。」

### 3.3 Auras (2, Lv38) — CONFIRMÉ (`aura_skill_config_1.04.09.00`, `inagle_auras`)

| asset | aura_id | EN | FR | JA | sous-type | élément |
|---|---|---|---|---|---|---|
| `wap01005` | `0xA17C3D72` | Instant Burst | Boost chrono | タイムブースト | Aura | 0 |
| `wap01001` | `0xA611F96B` | Burning Overdrive | Passion ardente | 熱血オーバードライブ | Aura | 0 |

Variables brutes (`AURA_CMD_INFO`) :
- `wap01005` : `[var0=-1585693326 (0xA17C3D72), "wap01005", nameId=-982752921, descId=1932039139,
  var4=30, var5=90, skillId1=0, skillId2=0, var8=5, …, buff=-1816922197 (0x93BFCA6B), …, rank=3005]`.
- `wap01001` : `[var0=-1508771477 (0xA611F96B), "wap01001", …, var4=30, var5=90, skillId1=0,
  skillId2=0, var8=5, …, buff=0x93BFCA6B, …, rank=3001]`.

Notes vérifiées :
- **`skillId1=0` et `skillId2=0`** → `resolve_aura_hissatsu` renvoie `None` : ces auras ne sont **pas
  liées à un hissatsu** ; ce sont des buffs purs (Instant Burst = vitesse, Burning Overdrive =
  éveil de la puissance de l'attaquant).
- **`var8=5`** → hors plage `[0,4]`, donc `get_element` clampe à **0** (cohérent avec
  `inagle_auras.element_id=0`).
- `buff_id = 0x93BFCA6B` partagé par les deux auras ; `rank` 3005 / 3001.

Descriptions FR/JA (`inagle_auras`) :
- `wap01005` FR « Au top de sa concentration, le joueur traverse le terrain à toute vitesse. »
  / JA 「集中力が研ぎ澄まされ俊敏にフィールドを駆け抜ける。」
- `wap01001` FR « La passion de l'attaquant s'enflamme, et éveille son vrai pouvoir. »
  / JA 「勝利への闘魂が燃え上がりストライカーの力が覚醒する。」

---

## 4. Passifs / Keshin / Soul / Miximax

- **Passif propre** : *Non trouvé* dans `inagle_passives` / `inagle_custom_passives` /
  `inagle_manager_passives` par code et par hash. (Le seul passif observé est celui de la carte
  **BASARA**, voir §2.)
- **Keshin / Soul / Awakening / Mode Change / Miximax** : *Non trouvé* — aucune entrée liant
  `c01001900`/`0x37D7ACFB` dans `inagle_keshins`, `inagle_souls`, `inagle_awakenings`,
  `inagle_mode_changes`, `inagle_miximax`. Aphrody n'a pas de transformation propre.
- **Override skills** : *Non trouvé* (`inagle_override_skills` ne contient pas le hash/code).

---

## 5. Assets 2D / 3D (par code, chemins VFS exacts)

Index CPK : exactement **6 fichiers par code** (le hash hex `0x37D7ACFB` n'apparaît dans **aucun**
nom de fichier CPK — les assets sont nommés par code interne). Toutes les routes live → HTTP 200.

### Visage (g4md / g4mg / g4tx)
| code | g4md (CPK `…`) | g4mg | g4tx (dx11) |
|---|---|---|---|
| `c01001900` | `data/common/chr/_face/01_ie1/c01001900/c01001900.g4md` | `…/c01001900.g4mg` | `data/dx11/chr/_face/01_ie1/c01001900/c01001900.g4tx` |
| `c05026590` | `data/common/chr/_face/05_go2/c05026590/c05026590.g4md` | idem `.g4mg` | `data/dx11/chr/_face/05_go2/c05026590/c05026590.g4tx` |
| `c07080010` | `data/common/chr/_face/07_ares/c07080010/c07080010.g4md` | idem `.g4mg` | `data/dx11/chr/_face/07_ares/c07080010/c07080010.g4tx` |

`/tex/.../c01001900.g4tx` → **PNG 2048×1024 RGBA** (decode DDS BC OK).

### Icône menu
- `data/dx11/menu/200_icon/10_icon_chr/face/c01001900_l.g4tx` → `/tex` = **PNG 256×256 RGBA**.
  Unique icône sous ce code (pas de `_s`, pas de bustup/CG). Idem `c05026590_l`, `c07080010_l`.
- Dérivé azalee : `200_icon/10_icon_chr/face/0x37D7ACFB_l_0x37D7ACFB_1_l00.webp` (webp dérivé du g4tx).

### Modèle complet (corps + visage + uniforme, assemblé à la volée)
- **Aucun** modèle corps/uniforme nommé `c01001900*` : corps + kit = **modèles génériques partagés**,
  fusionnés par `nie-model-serve` (`assemble.rs`).
- `GET /model-full/c01001900.glb` → **GLB valide 546 336 o** (`glTF` v2). CONFIRMÉ.
- `GET /model-full/c05026590.glb` → 380 784 o ; `/model-full/c07080010.glb` → 256 944 o.

### Voix (audio CRI)
- `data/common/sound_asset/ja/c01001900.acb` + `.awb` → `/audio/.../c01001900.acb` = **WAV PCM
  16-bit mono 48 kHz** (decode HCA OK, 20 268 o). Idem `c05026590` (18 220 o), `c07080010` (20 268 o).
- **Voix japonaise uniquement** : `/audio/data/common/sound_asset/{en,fr}/c01001900.acb` → **404**
  (CONFIRMÉ — pas de doublage occidental). *Non trouvé* : `en`, `fr`.

### Vidéo (.usm)
- *Non trouvé* : aucun `.usm` sous code/hash (les cut-ins vivent au niveau skill, pas perso).

---

## 6. Voix & cut-ins (hissatsu)

### Telop (nom du skill rendu) — CONFIRMÉ live
Les 6 techniques nommées ont une **telop FR** (`/tex` → 200) :
`data/dx11/menu/220_img/telop_waza/fr/{whs00340,who00200,whs00900,whs01250,whs00310,whs01080}.g4tx`
(168–251 Ko chacune). `rho10010` n'a **pas** de telop (`telopInfoId=0`).
Langues telop générées par `SkillInfo::cutin_assets()` : `de,en,es,fr,it,pt,zh_hans,zh_hant`
(le `ja` retombe sur la base).

### Modèle 3D de cut-in (`_waza/<ev>/`) — CONFIRMÉ live, présence **partielle**
| eventIDName | `/raw/.../_waza/<ev>/<ev>.g4mg` |
|---|---|
| `ev60_00340` (God Knows) | **200** (278 656 o) |
| `ev60_00900` (God Break) | **200** (300 864 o) |
| `ev61_00200`, `ev60_01250`, `ev60_00310`, `ev60_01080`, `techo0010` | **404** |

→ Dans le VFS live, seuls **God Knows** et **God Break** ont un modèle de cut-in dédié sous
`_waza/<ev>/` ; les 5 autres events réutilisent un rig partagé (pas de g4mg par-event). Les vidéos
de cut-in côté azalee (`inagle_skills.video_url`) existent pour les 6 nommées :
ex. God Knows `…/fjsbt89vqiu.webm` (poster `…/e-xnwdtpju0.jpg`).

`SkillInfo::cutin_assets()` dérive pour chaque event : `model_g4mg`/`g4md`
(`data/common/chr/_waza/<ev>/<ev>.g4*`), `texture_g4tx` (`data/dx11/chr/_waza/<ev>/<ev>.g4tx`),
`sound_cfg` (`data/common/event_cfg/snd/<ev>_snd.cfg.bin`), `effects_dir`
(`data/common/event/<grp>/<ev>/`), telop par langue. Le caller vérifie l'existence réelle.

---

## 7. Mentions dans le code C (RE) & scripts Lua

### Code décompilé (`var/niers.sqlite`)
- **Aucune string littérale** `aphrod` / `afuro` / `c01001900` / `c05026590` / `c07080010` dans la
  table `str` (0 résultat). Le hash `0x37D7ACFB` (= `936881403`) **n'apparaît pas** dans `hash_name`.
  → **Aphrody est purement data-driven** : le binaire ne le référence pas en clair.
- Il est chargé via des classes **génériques** (table `function`, RE structurel) :
  - `game::CCharaParam::*`, `game::GDSCharaParam::*`, `game::GDSCharaParamLotteryTable::*`
    (chargement des `CHARA_PARAM_INFO`) ;
  - `game::GDSSkillConfig`, `game::GDSRealSkillConfig`, `game::GDSAuraSkillConfig`,
    `game::GDSChangeAuraSkillConfig`, `game::GDSOverrideSkillConfig` (skills/auras) ;
  - `game::CMenuListViewEquipAuraSkill::*` (UI d'équipement des auras).
- Conclusion : *Non trouvé* en tant que symbole nommé ; *Confirmé* que le pipeline générique qui le
  consomme est porté/identifié.

### Scripts Lua (`inagle_lua_scripts`, 666 scripts ; `data/common/script/`)
- *Non trouvé* : aucun script ne mentionne `c01001900` / `aphrod` / `afuro` / `936881403` /
  `c05026590` / `c07080010` (colonnes `strings`, `crc32_numbers`, `name`, `calls`).
- Les scripts pertinents sont **génériques** (UI/menus), ex. `chara_pack_result_menu`
  (`p0`, v1.03.41.00) référence `chara_param` ; `chara_edit_parts_menu_*` (éditeur d'avatar).
  Aucun script spécifique au personnage.

---

## 8. Module Rust `nie-data::aphrody`

Le parseur dédié `crates/nie-data/src/aphrody.rs` agrège un **dossier** d'Aphrody en croisant les
parseurs existants :
- `chara_param::parse_all_chara_params` → filtre les `CharaParam` dont `chara_base_id ∈
  {0x37D7ACFB, 0xFC57A11C, 0xCA01BFAB}` (les 8 variantes) ;
- `skill::parse_skill_config` → carte `skillID → SkillInfo` ; chaque slot résolu comme **technique**
  porte ses `CutinAssets` (`SkillInfo::cutin_assets()`) ;
- `aura::parse_all_aura_cmds` → carte `auraId → AuraCmd` ; les slots résolus ici = **auras**.

`build_aphrody_dossier(chara_param_root, skill_root, aura_root) -> AphrodyDossier` rend identité
(constantes vérifiées), les 3 séries, les variantes avec techniques/auras séparées + assets par code.
Voir doc-comments du module pour les valeurs golden.

---

## 9. Sources

- `inagle_characters` (8 lignes), `inagle_skills`, `inagle_auras`, `inagle_basara`, `inagle_heroes`,
  `inagle_constellations`, `inagle_star_signs`, `inagle_teams`, `inagle_lua_scripts` —
  `data/backups/supabase-2026-06-05T00-08-26.sqlite`.
- `chara_param_1.03.66.00.cfg.bin`, `skill_config_5.00.07.00.cfg.bin`,
  `aura_skill_config_1.04.09.00.cfg.bin` — `data/common/gamedata/`.
- `chara_text`, `chara_description_text`, `skill_text` (`fr`/`en`/`ja`) — `data/common/text/`.
- `var/niers.sqlite` (tables `str`, `hash_name`, `function`).
- `rg/apps/azalee/data/cpk-index.ndjson.gz`.
- Serveur live `http://127.0.0.1:8790` (`/typed`, `/raw`, `/tex`, `/audio`, `/model-full`).

*Confirmé = observé dans un fichier/route réel et cité. « Non trouvé » = absent après recherche par
code interne ET par hash. Aucune supposition non étiquetée.*
</content>
