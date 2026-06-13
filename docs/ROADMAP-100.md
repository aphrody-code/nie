# niers — roadmap vers 100 % de portage Rust (pixel-perfect)

> Document maître de la trajectoire vers l'objectif : **rejouer 100 % d'*Inazuma Eleven: Victory Road*
> (IEVR, `nie.exe`, moteur Level-5 « Lives ») en Rust pur, headless + WebAssembly, au pixel et au byte près.**
> Plan opérationnel court : `PLAN.md`. Boucle RE + découvertes : `ARCHITECTURE.md`. Suivi : `jeu-jouable-avancement.md`, `assets-wasm-avancement.md`.
>
> Règle d'or : **aucun « FAIT » sans validation end-to-end sur le réel** (byte-à-byte vs iecode/inagle, pixel-à-pixel vs le jeu). Le repo a déjà connu plusieurs *faux FAIT* (fixtures synthétiques qui passaient, vrais fichiers qui cassaient) — ils sont la dette à ne jamais recréer.

## 1. Ce que « 100 % pixel-perfect » veut dire (décomposition mesurable)

« 100 % » n'est pas un nombre unique. C'est la conjonction de cinq couvertures distinctes, chacune mesurable :

| Couverture | Définition opérationnelle | Métrique | État (mis à jour 2026-06-10) |
|---|---|---|---|
| **C1 Formats** | tout conteneur/asset du jeu est lu nativement en Rust | % des 250 800 fichiers CPK lisibles + décodés correctement | **84,06 %** lisibles ; **audio HCA décode** ✓ (clé IEVR + magic masqué) |
| **C2 Données** | toute famille de config du jeu est portée et recalculée au bit | familles `cfg.bin` portées / 58 existantes | **31/58 = 53,4 %** (+10 via workflows séquentiels disque-légers : gallery, banner, search_word, scene_archive, music_app, photo_mode, update_notice, chat_emote, user_name_plate, input — golden vérifié adversarialement) |
| **C3 Logique** | toute fonction de gameplay/moteur reversée est portée et validée | fonctions portées / 52 783 réelles ; masse `.text` portée | **~56 fn = 0,1 %** ; **boucle de match jouable** pilotée par les vraies données ; **PRNG `lives::CRand` (MT19937) porté BYTE-EXACT** (validé vs vecteur réf) — 1er primitif moteur réel |
| **C4 Rendu** | la sortie visuelle est identique au jeu | Δpixel vs capture de référence (PSNR/SSIM) sur scènes-test | **non démarré** (assemblage GLB statique seulement) |
| **C5 RE (échafaudage)** | toute fonction réelle est identifiée (classée ET nommée) | classées + **nommées** / 52 783 | **93,36 % classées** (92,45 → arêtes indirectes) ; **6 429 (12,18 %) nommées** structurellement (0 → vtable-struct) |

Le verrou stratégique : **C5 (RE) est un moyen, pas la fin.** 92 % classé ≠ 92 % compris. Le chemin vers C1–C4
(le jeu jouable) ne dépend pas d'atteindre 100 % de C5 ; il dépend d'avoir **nommé et compris** les fonctions
des sous-systèmes qu'on porte. Donc la priorité bascule de « monter le % de classification » vers
« nommer + porter par sous-système ».

Le chemin **opérationnel** vers le jeu jouable passe désormais par la **GUI native** (crate `nie-game`,
host wgpu, pilier D1/C4) : c'est la **pointe active**. Le pont **azalee** (pilier B′) redevient un
**compagnon web secondaire** (livré, plus le cap). Détail de la stack runtime : `docs/STACK.md` ;
inventaire mesuré par pilier : `docs/INVENTAIRE.md`.

## 2. Théorie de la victoire (pourquoi c'est atteignable, et comment on le prouve)

1. **La vérité terrain existe et est triple** : iecode (C# .NET, formats + engine partiellement reversés),
   inagle (TS, données + formules de stats au bit), et le réel (`.pdata`, dumps `data/`, captures du jeu).
   Chaque portage se valide contre au moins une, idéalement les trois. Rien n'est « supposé ».
2. **`.pdata` borne le problème** : 52 783 fonctions réelles, pas un nombre ouvert. Le dénominateur est fini.
3. **Le RE est récursif et amorçable** : ancres (strings + RTTI) → propagation → nommage → portage →
   nouvelles ancres. Chaque fonction portée devient une ancre de haute confiance pour ses voisines.
4. **La preuve est automatisable** : tests golden byte (formats/données), diff pixel (rendu),
   recoupement `.pdata`/RTTI (RE). La progression est donc **mesurable à chaque commit**, pas déclarative.

## 3. Les cinq piliers — jalons quantifiés et *gates*

### Pilier A — Formats (C1) → 100 % des fichiers lisibles + décodés correctement
- **A0 (FAIT)** : RDBN, g4tx/g4md/g4mg/g4pk, @UTF, CRILAYLA, CPK (clé CRC32), assemblage GLB texturé.
- **A1 (N/A pour le PC — vérifié 2026-06-10)** : `nxtch` est la variante texture **Switch** ; **0/250 800** fichiers de l'IEVR PC sont NXTCH (textures = DDS dans g4tx, déjà décodées via `image_dds`). Le code deswizzle reste pour complétude/Switch mais **hors chemin critique** du pixel-perfect PC.
- **A2 (FAIT 2026-06-10)** : **HCA décode réellement** via `cridecoder` (clHCA) + clé IEVR `0x00D2997C0DC5EE72` + magic masqué + sous-clé AFS2. Vérifié sur `c00001001.awb` (48 kHz mono, non silencieux). Reste : généraliser la validation à ≥3 AWB + clé PC/Steam éventuelle (patch 1.2.2).
- **A3** : `g4sk` hiérarchie d'os sans fallback heuristique. *Gate : arbre d'os exact vs C# sur ≥3 `.g4sk` réels.*
- **A4** : formats résiduels (`p3lip` 20 357 fichiers, `objbin` 11 920, `vfxo`, `g4cm`, `col`, `pfxo`, `ptlb`, `fxbin`, `g4nv`, `g4mt`) — parseurs réels. *Gate : 100 % des 250 800 fichiers passent en parse sans erreur.*
- **A5** : déchiffrement de toute enveloppe CPK résiduelle si le verrou existe (cf. recherche en cours). *Gate : 100 % des CPK montent dans le VFS.*

### Pilier B — Données (C2) → 58/58 familles portées, recalcul au bit
- **B0 (FAIT 31/58)** : skill, item, growth, exp, passives, aura-cmd, chara-param, formation, command, ai, party, phase, soccer, rpg_battle, mission, dungeon, boost_grp, record, chronicle_top, friendmap, fast_travel, weather, light, dictionary, **+ gallery, banner, search_word, scene_archive, music_app, photo_mode, update_notice, chat_emote, user_name_plate, input** (golden réel byte ; soccer/rpg_battle/event-like = sous-ensembles, contenu restant documenté). 847 tests nie-data.
- **B1 (FAIT)** : INCOMPLET clos — `chara-param` (pairing level-first), `aura-cmd` (whs01780 réel). *Gate tenu : golden byte contre `data/common/gamedata`.*
- **B2** : porter les 27 répertoires restants par lots. *Gate : pour chaque famille, round-trip parse + 1 golden réel.* **Méthode rodée** : workflow SÉQUENTIEL sur le main tree (un seul `target/`, disque-léger) + vérif adversariale parallèle — bat le worktree parallèle quand le VPS est plein. **Cartographie du reste (scopée 2026-06-12)** :
  - *Petites/moyennes data, lot en cours* : chara_bank, skill_view, post, craft, trophy, setting_menu, vsroute, help.
  - *Grosses single-file portables* : shop (9,5M), capsule (gacha, 6,6M), trophy.
  - *Multi-fichiers à batcher* : quest (66 fichiers, 3M), system (28, 6M), team (4 : team_config/opponent_team/enjoy_mode/rpg_team_name — **nourrit le match, prioritaire**), players_universe, post.
  - *Énormes à subsetter (comme soccer/rpg_battle)* : event (54 fichiers, 272M — scripting/cutscene), character (45 sous-fichiers, 131M — **déjà partiellement couvert** : chara_param/exp/growth/passives en sont issus ; le reste est surtout config de **rendu** chara_model/mesh/texture/uniform → relève plutôt de C4).
  - *Non-data (assets/système, hors C2-données)* : font, motion, movie, live2d, staffroll, debug, common, data_file, nfc, w17, inacode, menu (rendu). Le dénominateur « 58 » est donc large ; ~40 sont de vraies familles de données.
- **B3** : moteur de calcul dérivé (stats finales, formations, bonus d'équipe) recoupé inagle au bit.

### Pilier B′ — Pont azalee : compagnon web secondaire (livré — n'est plus le cap)
> **Reprioritisé 2026-06-13** : valeur réelle livrée (route `/typed` 37 familles, `export_formations`/`export_passives`, explorateur CPK refondu), mais le **cap opérationnel est désormais D1 natif** (`nie-game`/wgpu). Ce pilier reste maintenu comme compagnon, pas comme tête de pont.

**Rappel de cap (2026-06-12)** : porter une famille avec golden ne sert à rien tant que la donnée
n'atteint pas **azalee** (`rg/apps/azalee`, proxifiée `cdn.rosegriffon.fr`). azalee lit le **miroir
SQLite/Supabase** (67 tables `inagle_*`, peuplées par le pipeline TS inagle) + quelques **JSON plats**
dans `apps/azalee/data/` (modèle `nie-data/bin/export_passives.rs` → `passives-full.json`, lu par `/passive`).
niers apporte une valeur UNIQUE sur trois leviers :
- **B′1 — Combler les trous du miroir** : tables vides/maigres qu'inagle n'a pas peuplées mais que
  niers a portées byte-exact. Cibles identifiées : `inagle_formations = 0` (← `formation`, 115
  formations portées), `inagle_missions = 1` (← `mission`), `inagle_drops_treasures = 0`.
- **B′2 — Remplacer les approximations codées en dur** : ex. `azalee/lib/formations.ts` contient des
  positions **estimées à l'œil depuis du CSS de zukan.inazuma.jp** → remplacer par les `start_pos`/
  `offense_pos`/`defense_pos` f32 **réels du jeu** (déjà décodés dans `formation.rs`).
- **B′3 — Industrialiser l'export** : un binaire `export_<famille>` (std+serde) par famille livrable →
  JSON schéma stable dans `apps/azalee/data/`, consommé par la page correspondante. *Gate : le JSON
  généré se charge dans azalee et la page rend la vraie donnée.*

**LIVRÉ (2026-06-13) — pont générique `/typed` + explorateur CPK refondu.** Plutôt qu'un binaire
d'export par famille, la route `nie-model-serve GET /typed/<vfs>.json` décode N'IMPORTE quel cfg.bin
live en structures typées nie-data (dispatch par nom de fichier, **37 familles**, RDBN-`lists` +
T2B-`entries`). Vérifié byte-exact live : formation (115, coords f32), mission (`msa999999`), aura
(387), item (4153), skill (1001), chara_param (6148). Détails dans `nie-model-serve/src/main.rs`
(`cfgbin_to_iecode_root`, `cfgbin_to_t2b_iecode_root` qui réplique le suffixe `<base>_<i>` d'iecode,
`typed_decode`) ; `/cfg` rendu lossless (Blob -> hex MAJ). **nginx** : bloc `location ^~ /typed/`
ajouté à `/etc/nginx/conf.d/cdn.rosegriffon.conf` (proxy 8790, **hors git** — re-vérifier après tout
redéploiement nginx). **azalee** : explorateur `/cpk` refondu en vrais viewers
(`app/cpk/Cpk{ConfigViewer,FormationViewer,JsonTree,HexViewer}.tsx` + `lib/cpk/shared.ts::cpkTypedUrl`) ;
`CpkFormationViewer` = terrain interactif 11 joueurs aux coords f32 réelles → **remplace B′2**
(positions CSS codées en dur de `lib/formations.ts`). Lien modèle `/model` mort -> `/model-full` réel.

**B′2/B′3 LIVRÉ (2026-06-13)** : binaire `nie-data/bin/export_formations` -> `apps/azalee/data/formations-full.json`
(115 formations, **83 valides** = 11 joueurs/1 GK ; label DF-MF-FW dérivé de `position_id` 1..10 ;
positions f32 start/offense/defense). `azalee/lib/formations.ts` expose `GAME_FORMATIONS` (83 vraies,
mappées en top/left %) en plus des 8 legacy (compat des `id` persistés) → le **My Team builder**
(`/tools/my-team`) propose désormais les vraies formations du jeu. C'est le 2e export industrialisé
après `export_passives`.
Reste B′1 : peupler les **tables miroir** `inagle_*` (lecture serveur d'azalee) ; `/typed` couvre la
lecture live mais pas l'écriture miroir/SSG. Mapping pages↔familles : `/gallery`↔gallery,
`/succes`↔trophy, `/quete`↔quest, `/capsule`↔capsule, `/boutique`↔shop, `/passive`↔passives (FAIT),
`/equipe`↔formation+team.

### Pilier C — Logique moteur (C3) → résoudre la longue traîne par sous-système
- **C0 (FAIT, îlots)** : nie-core (FSM match, effets, action-ctrl, stats — 126 tests) ; nie-engine (~55 fn, 11 modules) **mais 434 `// EXTERN:` non portées** = îlots non connectés.
- **C1 (FAIT 2026-06-10)** : **boucle de match jouable déterministe** (`nie-headless match`) — FSM + horloge + score câblés ; séquence FSM + `final_score` confirmées byte vs C. **Désormais pilotée par les vraies données** : `TeamSetup::with_formation` place les 11 joueurs aux positions byte-exactes du dump `formation_config`, `from_chara_params_and_levels` dérive leurs stats réelles via les tables de croissance (mapping position GK=1/FW=2/MF=3/DF=4 tranché par iecode `types.h:28`). Restent nominaux : modèle de but, PRNG, pondération d'agrégation, `chara_rank` (le réel = moteur physique). 172 tests nie-core.
- **C2** : **résorber les EXTERN par sous-système** — choisir un sous-système (ex. `chara` 11 358 fn, ou `audio` runtime), le nommer (cf. pilier E), porter ses fonctions racines + leurs callees jusqu'à 0 EXTERN dans le module. *Gate : module sans EXTERN, tests par fonction.*
- **C1bis (FAIT 2026-06-10)** : **PRNG `lives::CRand` porté BYTE-EXACT** (`crate::crand`, MT19937 32-bit) — décompilé via Ghidra (`docs/recherche-modele-match-decompile.md`), validé contre le vecteur de référence MT19937 (graine 5489). Remplace le Splitmix64 nominal. **Découverte structurante** : la vraie résolution de match n'est PAS une formule inline mais **event-driven (IDs hachés) + data-driven (cfg.bin)** → le modèle de but de `match_sim` reste nominal, à reconstruire depuis le système d'événements (`FUN_1412C0970`, prochaine cible RE).
- **C3** : itérer C2 sur menu / physics(PhysX) / network / script jusqu'à couverture fonctionnelle.

### Pilier D — Rendu (C4) → pixel-perfect — **LA POINTE ACTIVE**
- **D0 (FAIT partiel)** : assemblage GLB statique (corps+face+uniforme texturés), servi par nie-model-serve, **ET rendu par le host natif `crates/nie-game`** (wgpu 22 + winit 0.30, modes `--capture` PNG headless / `--window`, rend une vraie texture `.g4tx` décodée RGBA8, readback aligné 256 o **déjà bit-exact**, 1 180 LOC).
- **D1 — CHEMIN CENTRAL** : bump **wgpu 22→29.0.3** (+ winit 0.30.13, pollster 0.4 — migration vérifiée point par point dans `STACK.md`) et **retarget du port D3D11** `nie-engine/src/render.rs` (`FUN_14045ab10`/`c780`/`459110`/`459210`) vers `wgpu::Surface` + le pipeline plein écran déjà écrit dans `nie-game`. *Gate pixel-diff à deux étages : **égalité octet** (sha2/blake3 du RGBA8 dé-paddé) PUIS **SSIM ≥ 0,99 / PSNR** (image-compare) vs capture du jeu sur scènes-test menu.*
- **D-audio** : `cpal 0.18.1` en **pur transport**, mixeur **CRI Atom Ex maison** (`nie-engine/src/audio.rs`), PCM depuis `cridecoder`. *Gate : PCM bit-identique à CRI.*
- **D-vidéo** : `media-codec-vpx 0.8` (**VP9**, le décodeur du jeu) — **CORRIGER** l'étiquetage H.264 faux (`cri_audio.rs` / `cartographie-data.md` ; `nie.exe` n'a **aucun** chemin H.264). Prérequis : déchiffrement Level-5 des USM avant `usm_demux`. *Gate : YUV→RGBA via la matrice CRI Mana.*
- **D-lua** : **VM Lua réelle** via crate `nie-lua` (`mlua =0.11.6`, `lua52`+`vendored` = PUC-Rio 5.2.4, la VM exacte du jeu) en remplacement du simulateur de dispatch de `scripting.rs`. *Gate : scripts gameplay déterministes identiques.*
- **D2** : skinning g4sk + animations → modèles animés (**port maison f32 scalaire + glam `scalar-math`**, pas d'ozz). *Gate : pose identique sur frame-test.*
- **D3** : scène de match rendue. *Gate : SSIM sur séquence de match.*

### Pilier E — RE / échafaudage (C5) → nommer, pas seulement classer
- **E0 (FAIT)** : 92,45 % classé sur `.pdata`, graphe d'appels réel, RTTI (1 575 classes).
- **E1 (FAIT 2026-06-10)** : **arêtes indirectes** (`lea reg,[fn]` + slots vtable `.rdata`↔RTTI) → connecter le résidu isolé. *Gate : delta de couverture mesuré honnêtement, sans double-comptage.*
- **E2 (AMORCÉ 2026-06-10)** : **nommage**. Fait : noms **structurels** `Namespace::Classe::vmethod_N` écrits sur les méthodes de vtable des classes RTTI localisées → **6 429 fonctions nommées (12,18 %)**, 0 → non nul (name_source='vtable-struct', distincts des symboles originaux). Reste : ré-exporter un index Ghidra **aligné** (`analyzeHeadless`, dispo sur le VPS) pour récupérer les **vrais symboles** C++ (name_source='ghidra'/'pdb'). *Gate atteint (named > 0) ; gate suivant : N fonctions à nom sémantique réel.*
- **E3** : ré-ingestion du nommage comme ancres → boucle vers pilier C.

## 4. Trajectoire (vagues) et pilotage de fond

La campagne avance par **vagues** ; chaque vague = sélectionner des cibles bornées à vérité terrain →
orchestrer agents code + recherche → **vérifier (build + clippy -D warnings + tests/diff)** → mesurer → vague suivante.

**Vagues réalisées (2026-06-10)** :
- **Vague 1 — FAIT** : B1 (chara-param + aura-cmd clos, golden réel) + recherche A2/A5/E1 (clé HCA récupérée, CPK résolu, design arêtes indirectes).
- **Vague 2 — FAIT** : A2 (HCA décode réellement) ; A1 (nxtch N/A pour le PC) ; A5 (enveloppe CPK = pas un verrou).
- **Vague 3 — FAIT** : E1 (arêtes indirectes, 92,45 → 93,36 %) → heartbeat de fond réinjecté ; E2 amorcé (nommage structurel, 0 → 6 429).
- **Vague 4 — FAIT** : C1 (boucle de match jouable déterministe, 167 tests).
- **Vague 6 — FAIT** : match piloté par les **vraies données** — `with_formation` (placements byte-exacts) + `from_chara_params_and_levels` (stats réelles via croissance, mapping position tranché par iecode) ; +3 familles C2 (formation, command, ai), 4→7/58.

**Vagues suivantes** :
- **Vague 7 (cap actuel)** : **D1 natif** — bump wgpu 29 + retarget `render.rs` + **premier rendu d'une scène menu avec gate pixel-diff (SSIM + égalité octet)** ; puis B2 (familles `team`/`soccer`/`party`/`phase` → enrichir le match) ; C2-logique (résorber les EXTERN par sous-système) ; E2 complet (ré-export Ghidra aligné → vrais symboles).
- **Vague 8+** : longue traîne — **D2 skinning g4sk** (port maison + glam scalaire) puis **D3 scène de match rendue** ; D-lua (mlua) / D-audio (cpal) / D-vidéo (libvpx VP9) ; B2 (familles restantes), modèle de but/PRNG réels (RE), nettoyage décodeur HCA déprécié.

**Heartbeat RE de fond** (`var/re-heartbeat.log`, PID dans `var/re-heartbeat.pid`) : rejoue le vrai pipeline
`.pdata→vtable[+ancrage+nommage]→disasm[+lea]→propagate` sur binary_id=2 et logue la couverture réelle ;
amplifie automatiquement tout nouveau lever de code au cycle suivant. (L'ancienne boucle `automl-loop`
suivait le mauvais binaire id=1 à 88 % — remplacée.)

## 5. Métriques de progression (tableau de bord honnête)

À mettre à jour à chaque vague (source = mesure réelle, jamais déclaration) :

```
                       baseline →  2026-06-10        cible
C1 fichiers lisibles : 84,06 %  →  84,06 % +audio✓   100 %
C2 familles données  : 4/58     →  31/58 (réel byte) 58/58
C3 fn logique portées: ~55      →  ~56 +match(vraies données)+CRand MT19937 byte-exact  sous-systèmes fonctionnels
C4 rendu SSIM        : —         →  — (host en place)  ≥0,99 sur scènes-test
C5 classé            : 92,45 %   →  93,36 %           croissant (lever suivant : pointeurs absolus .rdata)
C5 nommé             : 0         →  6 429 (12,18 %)   croissant (structurel → puis symboles PDB/Ghidra)
```

> **Notes de reconciliation (2026-06-13)** :
> - **C1** : la métrique officielle reste **84,06 %** (2026-06-10) ; `docs/cartographie-data.md` mesure **92,6 %** après l'ajout de p3lip (20 357 fichiers lip-sync) — à reconcilier en métrique officielle, sans effacer le 84,06 %.
> - **C4** : le **host natif `nie-game`** est **en place** (2026-06-13, rend une vraie `.g4tx`, capture PNG bit-exacte) ; le pipeline shaders/transforms + la gate SSIM = **D1, à venir** (cap de la Vague 7). Aucune mesure SSIM encore.

## 6. Honnêteté (le cadre, pas une excuse)

Reverser puis réécrire 100 % d'un jeu AAA de 31 Mo est un **effort de longue haleine** assumé. « 100 %
pixel-perfect » est la **direction**, pas une livraison de session. Ce roadmap garantit que **chaque pas est
réel et mesuré** : un format qui parse le vrai fichier, une donnée recalculée au bit, une fonction portée
validée contre le décompilé, un pixel diffé contre le jeu. La distinction *classifié ≠ nommé ≠ compris ≠
porté ≠ validé* est tenue partout — c'est elle qui empêche de confondre 92 % de cartographie avec 92 % de jeu.
