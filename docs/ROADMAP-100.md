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
| **C2 Données** | toute famille de config du jeu est portée et recalculée au bit | familles `cfg.bin` portées / 58 existantes | **11/58 = 19,0 %** (+ formation/command/ai/party/phase/soccer/rpg_battle, golden réel) |
| **C3 Logique** | toute fonction de gameplay/moteur reversée est portée et validée | fonctions portées / 52 783 réelles ; masse `.text` portée | **~56 fn = 0,1 %** ; **boucle de match jouable** pilotée par les vraies données ; **PRNG `lives::CRand` (MT19937) porté BYTE-EXACT** (validé vs vecteur réf) — 1er primitif moteur réel |
| **C4 Rendu** | la sortie visuelle est identique au jeu | Δpixel vs capture de référence (PSNR/SSIM) sur scènes-test | **non démarré** (assemblage GLB statique seulement) |
| **C5 RE (échafaudage)** | toute fonction réelle est identifiée (classée ET nommée) | classées + **nommées** / 52 783 | **93,36 % classées** (92,45 → arêtes indirectes) ; **6 429 (12,18 %) nommées** structurellement (0 → vtable-struct) |

Le verrou stratégique : **C5 (RE) est un moyen, pas la fin.** 92 % classé ≠ 92 % compris. Le chemin vers C1–C4
(le jeu jouable) ne dépend pas d'atteindre 100 % de C5 ; il dépend d'avoir **nommé et compris** les fonctions
des sous-systèmes qu'on porte. Donc la priorité bascule de « monter le % de classification » vers
« nommer + porter par sous-système ».

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
- **B0 (FAIT 11/58)** : skill, item, growth, exp, passives, aura-cmd, chara-param, **formation, command, ai, party, phase, soccer, rpg_battle** (golden réel byte ; soccer/rpg_battle = sous-ensemble config-de-match, contenu restant documenté).
- **B1 (FAIT)** : INCOMPLET clos — `chara-param` (pairing level-first), `aura-cmd` (whs01780 réel). *Gate tenu : golden byte contre `data/common/gamedata`.*
- **B2** : porter les 47 familles restantes par lots (team, shop, gacha, story, npc, encounter, event, mission…). *Gate : pour chaque famille, round-trip parse + 1 golden réel.*
- **B3** : moteur de calcul dérivé (stats finales, formations, bonus d'équipe) recoupé inagle au bit.

### Pilier C — Logique moteur (C3) → résoudre la longue traîne par sous-système
- **C0 (FAIT, îlots)** : nie-core (FSM match, effets, action-ctrl, stats — 126 tests) ; nie-engine (~55 fn, 11 modules) **mais 434 `// EXTERN:` non portées** = îlots non connectés.
- **C1 (FAIT 2026-06-10)** : **boucle de match jouable déterministe** (`nie-headless match`) — FSM + horloge + score câblés ; séquence FSM + `final_score` confirmées byte vs C. **Désormais pilotée par les vraies données** : `TeamSetup::with_formation` place les 11 joueurs aux positions byte-exactes du dump `formation_config`, `from_chara_params_and_levels` dérive leurs stats réelles via les tables de croissance (mapping position GK=1/FW=2/MF=3/DF=4 tranché par iecode `types.h:28`). Restent nominaux : modèle de but, PRNG, pondération d'agrégation, `chara_rank` (le réel = moteur physique). 172 tests nie-core.
- **C2** : **résorber les EXTERN par sous-système** — choisir un sous-système (ex. `chara` 11 358 fn, ou `audio` runtime), le nommer (cf. pilier E), porter ses fonctions racines + leurs callees jusqu'à 0 EXTERN dans le module. *Gate : module sans EXTERN, tests par fonction.*
- **C1bis (FAIT 2026-06-10)** : **PRNG `lives::CRand` porté BYTE-EXACT** (`crate::crand`, MT19937 32-bit) — décompilé via Ghidra (`docs/recherche-modele-match-decompile.md`), validé contre le vecteur de référence MT19937 (graine 5489). Remplace le Splitmix64 nominal. **Découverte structurante** : la vraie résolution de match n'est PAS une formule inline mais **event-driven (IDs hachés) + data-driven (cfg.bin)** → le modèle de but de `match_sim` reste nominal, à reconstruire depuis le système d'événements (`FUN_1412C0970`, prochaine cible RE).
- **C3** : itérer C2 sur menu / physics(PhysX) / network / script jusqu'à couverture fonctionnelle.

### Pilier D — Rendu (C4) → pixel-perfect
- **D0 (FAIT partiel)** : assemblage GLB statique (corps+face+uniforme texturés), servi par nie-model-serve.
- **D1** : pipeline GPU **wgpu/webgpu** portant les shaders et la math de transform du moteur (le menu compositor révèle déjà des transforms à reverser). *Gate : Δpixel borné (SSIM ≥ 0,99) vs capture du jeu sur scènes-test menu.*
- **D2** : skinning g4sk + animations → modèles animés. *Gate : pose identique sur frame-test.*
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
- **Vague 7** : E2 complet (ré-export Ghidra aligné → vrais symboles) ; B2 (familles `team`/`soccer`/`party`/`phase` → enrichir le match) ; C2-logique (résorber les EXTERN par sous-système).
- **Vague 8+** : longue traîne — B2 (51 familles), D1–D3 (rendu wgpu pixel-perfect), modèle de but/PRNG réels (RE), nettoyage décodeur HCA déprécié.

**Heartbeat RE de fond** (`var/re-heartbeat.log`, PID dans `var/re-heartbeat.pid`) : rejoue le vrai pipeline
`.pdata→vtable[+ancrage+nommage]→disasm[+lea]→propagate` sur binary_id=2 et logue la couverture réelle ;
amplifie automatiquement tout nouveau lever de code au cycle suivant. (L'ancienne boucle `automl-loop`
suivait le mauvais binaire id=1 à 88 % — remplacée.)

## 5. Métriques de progression (tableau de bord honnête)

À mettre à jour à chaque vague (source = mesure réelle, jamais déclaration) :

```
                       baseline →  2026-06-10        cible
C1 fichiers lisibles : 84,06 %  →  84,06 % +audio✓   100 %
C2 familles données  : 4/58     →  11/58 (réel byte) 58/58
C3 fn logique portées: ~55      →  ~56 +match(vraies données)+CRand MT19937 byte-exact  sous-systèmes fonctionnels
C4 rendu SSIM        : —         →  —                 ≥0,99 sur scènes-test
C5 classé            : 92,45 %   →  93,36 %           croissant (lever suivant : pointeurs absolus .rdata)
C5 nommé             : 0         →  6 429 (12,18 %)   croissant (structurel → puis symboles PDB/Ghidra)
```

## 6. Honnêteté (le cadre, pas une excuse)

Reverser puis réécrire 100 % d'un jeu AAA de 31 Mo est un **effort de longue haleine** assumé. « 100 %
pixel-perfect » est la **direction**, pas une livraison de session. Ce roadmap garantit que **chaque pas est
réel et mesuré** : un format qui parse le vrai fichier, une donnée recalculée au bit, une fonction portée
validée contre le décompilé, un pixel diffé contre le jeu. La distinction *classifié ≠ nommé ≠ compris ≠
porté ≠ validé* est tenue partout — c'est elle qui empêche de confondre 92 % de cartographie avec 92 % de jeu.
