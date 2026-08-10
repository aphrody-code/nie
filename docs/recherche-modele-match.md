# Recherche : modèle de résolution tir/blocage/but dans nie.exe

Date : 2026-06-10  
Portée : lecture seule — niers.sqlite (binary_id=2, base 0x140000000), crates nie-core,
refs/iecode-re, data/common/gamedata/soccer/*.cfg.bin.json  
Méthode : SQL sur niers.sqlite (func_str_ref, function, xref), lecture directe des
fichiers décompilés (refs/iecode-re/research/ghidra-export/decompiled/), headers
iecode-re (refs/iecode-re/cli/include/).

---

## 1. Ce qui est déjà confirmé byte-à-byte dans nie-core (et ses limites)

### 1.1 FSM de match — match_fsm.rs

Source : `refs/iecode-re/research/ghidra-export/decompiled/soccer_match_state_machine.c`
(`FUN_1412aa4a0`). Adresse de la structure `CSceneSoccer` portée depuis cette fonction.

Confirmé :
- Encodage horloge : `minutes * 10_000 + seconds` ; état FullTime code `final_score(90, 0) = 900_000`
  vérifiable à l'offset `@+0x1e080` (minutes, u16) et `@+0x1e082` (seconds, u16) dans CSceneSoccer.
- Séquence post-match (11 états internes : Init → WaitTimer → ResultUi → CheckTelop → WaitAnim →
  Transition → Fade → Cleanup → PostMatch → FadeOut → LoadNext).
- Flag training : `(*(byte*)(param + 0x6a30 + 0x14)) & 4`.
- `end_counter` à `param_1 + 0x24`.

Phase `SoccerPhase` confirmée via header iecode-re
(`refs/iecode-re/cli/include/iecode/game/soccer/soccer_state_machine.h`) :

| Valeur | Nom         |
|--------|-------------|
| 0      | Idle        |
| 1      | KickOff     |
| 2      | InPlay      |
| 3      | SetPlay     |
| 4      | Goal        |
| 5      | HalfTime    |
| 6      | FullTime    |
| 7      | Penalty     |
| 8      | FocusBattle |
| 9      | Command     |
| 10     | Tutorial    |

Durée de mi-temps : `DEFAULT_HALF_DURATION = 300.f` secondes réelles (header iecode-re) ;
HALF_COUNT = 2. Soit 600 s réels = 90 minutes jeu → compression 9:1.  
ATTENTION : cette valeur vient du header RE, pas d'une constante IEEE 754 extraite de nie.exe.

### 1.2 Gardien — keeper.rs

Source : `refs/iecode-re/research/ghidra-export/decompiled/soccer_keeper_save.c`
(`FUN_14030e5c0`, `FUN_14030e680`, `FUN_14030e770`).

Cinq constantes validées IEEE 754 :

| Champ             | Valeur f32 | Hex IEEE 754 |
|-------------------|-----------|--------------|
| save_radius       | 1.0       | 0x3F800000   |
| max_dive_dist     | 5.0       | 0x40A00000   |
| save_probability  | ≈ 0.800   | 0x3F4CCCCD   |
| reaction_time     | ≈ 4.73 fr | 0x40975C29   |
| dive_speed        | ≈ 2.67    | 0x402AE148   |

Structure `ShootSaveData` portée (constructeur + copie). Champs confirmés :
shoot_position, shoot_direction, flags (u32), state_byte (u8), keeper_position,
dive_direction, dive_lateral, aux_vector, impact_position, surface_normal.

Non portés : méthodes `evaluate()` et `update()` de `SoccerCalcKeeperSaveComponent`.

### 1.3 Balle — ball.rs

Source : `ball_component.c`, `BallComponent_ctor`, `FUN_14027ac10`.

Confirmé : gravity = 2.0f (0x40000000), scale = 1.0f (0x3F800000),
INVALID_TARGET_ID = 0xFFFF0000, INVALID_PLAYER_IDX = 0xFF, max_collisions = 5.
10 variantes `BallMoveKind`. Vtables `game::BallMoveRealSkillShootBezier` aux vaddresses
5388848112 et 5388848400.

### 1.4 SoccerCtrl — soccer_ctrl.rs

Source : `soccer_ctrl.c`, fonctions FUN_14140dd00/dd50/df20/df70.

Confirmé : triple de phase aux offsets 0x700–0x702. Phase 0 = sentinelle, Phase 1 = normal.

### 1.5 Tactiques — tactics.rs

Source : `soccer_tactics_ai.c`, FUN_14130b9e0/bd50/be30.

Confirmé : 3 contextes × 4 niveaux, mode = 2, threshold = -1.0f (0xBF800000),
flags_mask = 0x1000000, timeout_frames = 20 (0x14), counter = 5.

### 1.6 LIMITES CRITIQUES de match_sim.rs

`crates/engine/nie-core/src/match_sim.rs` est entièrement NOMINAL. Aucune de ses hypothèses
n'est étayée byte-à-byte :

- Boucle minute-par-minute sur 90 minutes : nie.exe pilote la balle par PhysX en temps réel.
- `GOAL_RATE_BASE = 0.035` : inventé.
- Formule `kc / (kc + ps)` : inventée.
- Splitmix64 : the PRNG classes de nie.exe (`lives::CRand`, `lives::CPseudoRand`) sont
  localisées mais leur algorithme n'est pas décompilé.
- Stats 7-dimensionnels agrégées dans la formule : extrapolé depuis inagle, non confirmé dans
  le flow de résolution réel.

---

## 2. Pistes concrètes vers le vrai modèle

### Piste A — game::soccerscene::FocusBtlState (confiance : HAUTE)

RTTI confirme la classe. `SoccerPhase::FocusBattle = 8` est l'état de machine d'état actif
pendant un tir hissatsu / combat de focus. C'est la phase où la résolution tir/blocage se
produit.

Vmethods localisées (binary_id = 2) :

| Nom                                          | vaddr      |
|----------------------------------------------|------------|
| game::soccerscene::FocusBtlState::vmethod_0  | 5372077296 |
| game::soccerscene::FocusBtlState::vmethod_1  | 5388425120 |
| game::soccerscene::FocusBtlState::vmethod_2  | 5388423376 |
| game::soccerscene::FocusBtlState::vmethod_3  | 5388422784 |

String `focus_btl_area_%d` à vaddr 5389064656 — probablement init des N zones du
combat (la valeur N est inconnue).

Callers de vmethod_0 (non nommés, gameplay) :
5369119600, 5369175408, 5369175968, 5378890752, 5378891456, 5383468704.

`game::soccerscene::ZoneState` partage les mêmes callers :
vmethods 1–3 à 5388415504, 5388412416, 5388412320 — indique que FocusBtlState
et ZoneState opèrent dans le même contexte de zone terrain.

Statut : LOCALISÉ, logique interne non décompilée.

### Piste B — game::SoccerCalcKeeperSaveComponent::evaluate() / update() (confiance : HAUTE)

Constructeur porté dans keeper.rs. Les méthodes de calcul ne le sont pas.

4 callers directs de vmethod_0 (gameplay, non nommés) :

| vaddr      |
|------------|
| 5371907520 |
| 5371908160 |
| 5371910112 |
| 5371911904 |

3 callers de vmethod_6 : 5386698864, 5389017504, 5389086384.

Ces callers contiennent la logique de décision "but accordé / arrêt" et transmettent le
`ShootSaveData` au composant. vmethod_0 de CRand (vaddr 5371514304) est appelée depuis
l'un d'eux — confirmation que le PRNG est imbriqué dans le calcul de parade.

Statut : LOCALISÉ, corps non décompilé.

### Piste C — Registre CMD_ et vaddr 5369243280 (confiance : HAUTE pour identification)

Fonction à vaddr 5369243280 (subsystem = chara, 833 string refs) : registre complet
des commandes de match. Strings confirmées pertinentes :

```
CMD_ACTION_SHOOT
CMD_FOCUS_BATTLE_DASH
CMD_FOCUS_BATTLE_POWER_BLOCK
CMD_FOCUS_BATTLE_POWER_CHARGE
CMD_FOCUS_BATTLE_PREP_BLOCK
CMD_ON_DEFENSE_LINE
CMD_RUN_CMDBTL
CMD_RUN_MDLBTL
CMD_ZONE_SHOOT_CHAIN_SHOOT
```

Vaddr 5369243632 (118 refs) = sous-ensemble du même registre.

Ces noms confirment une distinction entre CMD_FOCUS_BATTLE_PREP_BLOCK (préparation) et
CMD_FOCUS_BATTLE_POWER_BLOCK (exécution) — structure en deux temps du combat de focus.

Statut : LOCALISÉ comme routeur/registre de commandes, logique non décompilée.

### Piste D — Config dimensions terrain et paramètres PK (confiance : HAUTE pour les données)

Vaddr 5372474240 : fonction de chargement des dimensions physiques du terrain.
Strings confirmées : goalSizeX/Y/Z_Normal, goalSizeX/Y/Z_Battle, fieldSizeX/Z_Normal/Battle,
penaltyAreaSizeX/Z_Normal/Battle, centerCircleRadius_Normal/Battle, centerPosX/Y/Z.
Probablement l'init du contexte PhysX ; les versions _Battle et _Normal distinguent le
mode FocusBattle du jeu normal.

Vaddr 5372443760 : fonction de chargement des paramètres de tir/passe.
Strings confirmées dont les plus utiles pour la résolution :

```
fixPkWinMinPercentage
fixPkWinMaxPercentage
pkShootHitStopTime
pkShootHitStopScale
pkGkDefenseLineBaseLenRate
pkGkDefenseLineMaxLenRate
pkGkDefenseLineMinLenRate
```

`fixPkWinMinPercentage` / `fixPkWinMaxPercentage` sont des bornes de probabilité de
victoire PK — première occurrence dans nie.exe d'une probabilité explicitement nommée
dans un contexte de résolution.

Statut : LOCALISÉ comme loader de config, valeurs réelles non lues (fichier source
cfg.bin non identifié précisément parmi les 650 entrées SOCCER_GAME_INFO).

### Piste E — lives::CRand / lives::CPseudoRand / lives::IRand (confiance : MOYENNE)

Classes localisées par RTTI et vtables (binary_id = 2) :

| Classe              | vmethod    | vaddr      |
|---------------------|------------|------------|
| lives::IRand        | vmethod_0  | 5369351344 |
| lives::CPseudoRand  | vmethod_0  | 5369351520 |
| lives::CPseudoRand  | vmethod_1  | 5373439488 |
| lives::CPseudoRand  | vmethod_2  | 5371665056 |
| lives::CPseudoRand  | vmethod_3  | 5373439616 |
| lives::CPseudoRand  | vmethod_4  | 5369351392 |
| lives::CPseudoRand  | vmethod_5  | 5369351440 |
| lives::CRand        | vmethod_0  | 5371514304 |
| lives::CRand        | vmethod_1  | 5371513936 |
| lives::CRand        | vmethod_2  | 5371514032 |
| lives::CRand        | vmethod_4  | 5371514048 |
| lives::CRand        | vmethod_5  | 5371514224 |
| lives::CRand        | vmethod_6  | 5371514288 |

Vaddr 5384487296 : appelle simultanément CRand::vmethod_1, CRand::vmethod_4 ET
CPseudoRand::vmethod_1 — contexte d'usage de deux générateurs en parallèle.

Algorithme interne : NON PRÉSENT dans les 60 fichiers C décompilés disponibles.
Le namespace `lives::` indique un composant moteur (pas `game::`), utilisé aussi
dans le pipeline de rendu (`lives::CPseudoRand::vftable` vu dans
`render_pipeline_init.c`) — le PRNG est généraliste, pas spécifique au football.

---

## 3. PRNG : indices sur l'algorithme réel

Les classes `lives::CRand` et `lives::CPseudoRand` sont confirmées par RTTI avec leurs
vtables complètes. Les noms de vmethods sont positionnels (pas les symboles C++ originaux).

Indices disponibles :
- `lives::CRand` a 7 vmethods (vmethod_0 à vmethod_6) ; `lives::CPseudoRand` en a 6.
- L'héritage probable est `CRand` et `CPseudoRand` héritent tous deux de `IRand` (interface
  avec vmethod_0 unique — probablement `next_int()` ou `next_float()`).
- Vaddr 5384487296 montre un usage double CRand + CPseudoRand dans le même contexte —
  possiblement seed + génération, ou deux flux indépendants.
- Taille des fonctions vmethod_1 et vmethod_4 de CRand non mesurée ; à confirmer avec
  Ghidra. Les fonctions PRNG sont typiquement courtes (10–50 instructions).

Algorithme réel : NON LOCALISÉ dans les sources disponibles.  
Splitmix64 dans match_sim.rs est une supposition sans fondement dans le binaire.

---

## 4. Paramètres numériques du match trouvés dans les données

### 4.1 Valeurs IEEE 754 issues de nie.exe

Source : `refs/iecode-re/research/ghidra-export/decompiled/soccer_keeper_save.c`

| Paramètre        | Valeur   | Contexte                        |
|------------------|----------|---------------------------------|
| save_radius      | 1.0f     | Rayon de parade gardien         |
| max_dive_dist    | 5.0f     | Distance max plongeon           |
| save_probability | ≈ 0.800f | Probabilité initiale de parade  |
| reaction_time    | ≈ 4.73 f | Temps de réaction (frames)      |
| dive_speed       | ≈ 2.67f  | Vitesse de plongeon             |

Source : `soccer_state_machine.h` (iecode-re header, non byte-validé contre nie.exe)

| Paramètre             | Valeur  | Contexte                     |
|-----------------------|---------|------------------------------|
| DEFAULT_HALF_DURATION | 300.0f  | Durée mi-temps (s réels)     |
| HALF_COUNT            | 2       | Nombre de mi-temps           |

### 4.2 soccer_focus_battle_effect_config.cfg.bin.json

`m_soccerFocusBattleEffectRangeList` (type ScFbtlEffectRange) :
- rangeType = 0 (inactif) ou 1 (actif)
- rangeParam1 = 30
- rangeParam2 = 10
- rangeParam3 = 0

`m_soccerFocusBattleActivatedEffectList` (type ScFbtlActivatedEffect) :
- effectId (hash CRC32)
- 8 paramètres numériques par effet — signification inconnue

### 4.3 soccer_game_config_1.04.08.00.cfg.bin.json

Format RDBN `entries` (pas `lists`).

| Entrée racine        | Nb enfants | Note                        |
|----------------------|------------|-----------------------------|
| CPU_BEANS_RATE_INFO  | 7          | Ratio de ressources CPU AI  |
| SOCCER_GAME_DIFFICULTY | 1772     | ~45 champs int positionnels |
| SOCCER_GAME_INFO     | 650        | Champs inconnus             |

Schéma de SOCCER_GAME_DIFFICULTY : NON DÉCODÉ — 45 positions entières par entrée,
probablement des poids de difficulté impactant les paramètres de résolution.
Source de vérité : header GDSSoccerGameConfig dans iecode-re (à localiser).

### 4.4 soccer_game_additional_config_1.04.14.00.cfg.bin.json

- `m_SoccerTeamAIDataList` : paramData ("01010101"), strategyId.
- `m_SoccerGetExpDataTable` : ratios XP (7.8, 7.3, …).

### 4.5 soccer_command_effect.c (FUN_1403f6d60)

Slot scoring à offset [0x36E] : 4 floats = 0.0f, multiplier = 1.0f (0x3f800000),
flags = 0x100.

---

## 5. Recommandation de prochaine étape (priorisée)

### Priorité 1 — Décompiler FocusBtlState::vmethod_1 (vaddr 5388425120)

Raison : c'est le point d'entrée le plus probable de la logique update() / résolution du
combat de focus. Vmethod_2 (enter) et vmethod_3 (exit) sont des candidats secondaires.
Action : `target/release/niers disasm --db var/niers.sqlite --addr 5388425120 | head -200`
puis exporter vers Ghidra si besoin.
Incertitude : il est possible que vmethod_1 soit uniquement une phase d'animation et que
la vraie résolution soit dans un appel indirect depuis vmethod_0.

### Priorité 2 — Décompiler les callers de SoccerCalcKeeperSaveComponent (vaddrs 5371907520 et 5371908160)

Raison : ces deux fonctions courtes (gameplay, non nommées) appellent evaluate() et
tiennent probablement la logique "but accordé / arrêt". Ce sont 2 des 4 callers ; commencer
par les deux premiers pour chercher une branche commune.
Incertitude : la structure ShootSaveData passée peut être remplie plus haut dans la callchain.

### Priorité 3 — Identifier le cfg.bin source de fixPkWinMinPercentage et décoder SOCCER_GAME_DIFFICULTY

Raison : `fixPkWinMinPercentage` / `fixPkWinMaxPercentage` sont les premières probabilités
explicitement nommées dans un contexte de résolution. Le fichier source est probablement
`soccer_game_config_1.04.08.00.cfg.bin.json` (section SOCCER_GAME_INFO, 650 entrées).
Croiser avec le header C++ `GDSSoccerGameConfig` dans iecode-re pour décoder le schéma
positionnel de SOCCER_GAME_DIFFICULTY.
Incertitude : le mapping positionnel est entièrement opaque sans le header.

### Priorité 4 — Décompiler lives::CRand::vmethod_1 (vaddr 5371513936) et vmethod_4 (5371514048)

Raison : vmethod_1 et vmethod_4 sont appelées dans des contextes proches (vaddr 5384487296).
Les fonctions PRNG sont typiquement courtes. Même sans symboles, la structure de la fonction
(multiplications 64 bits, rotations, XOR) identifie l'algorithme (xoshiro256, PCG, LCG, etc.).
Incertitude : CRand peut envelopper un générateur système ou CRI Middleware.

### Priorité 5 — Aligner SoccerPhase dans nie-core

Raison : match_fsm.rs utilise 11 états internes mais ignore `SoccerPhase` (registre
confirmé à 11 valeurs). Porter l'enum + la transition Idle/KickOff/InPlay/FocusBattle/Goal/
HalfTime/FullTime est une étape bas-risque, haute cohérence, qui prépare le portage de
FocusBtlState.

---

## 6. INCONNUS

Les points suivants restent entièrement inconnus à la date de cette recherche :

- **Algorithme de lives::CRand et lives::CPseudoRand** : aucun corps de fonction disponible
  dans les 60 fichiers décompilés.
- **Logique de résolution dans FocusBtlState** : qui gagne, sur quelle formule, avec quels
  paramètres — entièrement opaque.
- **Schéma de SOCCER_GAME_DIFFICULTY** : 45 champs int positionnels × 1772 entrées, aucun
  nom de champ, aucune documentation.
- **Signification des 8 paramètres de ScFbtlActivatedEffect** : noms inconnus.
- **Lien causal entre SoccerCommandEffect (hissatsu / tactiques) et FocusBtlState** :
  les deux systèmes sont localisés mais leur interaction n'est pas tracée.
- **Condition de déclenchement de FocusBattle depuis InPlay** : seuil de distance ?
  décision IA ? triggered par commande joueur ?
- **Durée d'une FocusBattle en frames** : inconnu.
- **Formule de but valide indépendante du gardien** (tirs non contestés, penalty) :
  `fixPkWinMinPercentage` est un indice mais la formule complète est inconnue.
- **Contribution des stats (Kc, Ps, etc.) au FocusBtlState** : extrapolé depuis inagle dans
  match_sim.rs, jamais confirmé dans nie.exe.
