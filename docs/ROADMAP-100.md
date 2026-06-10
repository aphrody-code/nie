# niers — roadmap vers 100 % de portage Rust (pixel-perfect)

> Document maître de la trajectoire vers l'objectif : **rejouer 100 % d'*Inazuma Eleven: Victory Road*
> (IEVR, `nie.exe`, moteur Level-5 « Lives ») en Rust pur, headless + WebAssembly, au pixel et au byte près.**
> Plan opérationnel court : `PLAN.md`. Boucle RE + découvertes : `ARCHITECTURE.md`. Suivi : `jeu-jouable-avancement.md`, `assets-wasm-avancement.md`.
>
> Règle d'or : **aucun « FAIT » sans validation end-to-end sur le réel** (byte-à-byte vs iecode/inagle, pixel-à-pixel vs le jeu). Le repo a déjà connu plusieurs *faux FAIT* (fixtures synthétiques qui passaient, vrais fichiers qui cassaient) — ils sont la dette à ne jamais recréer.

## 1. Ce que « 100 % pixel-perfect » veut dire (décomposition mesurable)

« 100 % » n'est pas un nombre unique. C'est la conjonction de cinq couvertures distinctes, chacune mesurable :

| Couverture | Définition opérationnelle | Métrique | Baseline (2026-06-10, mesurée) |
|---|---|---|---|
| **C1 Formats** | tout conteneur/asset du jeu est lu nativement en Rust | % des 250 800 fichiers CPK lisibles + décodés correctement | **84,06 %** lisibles ; audio HCA non conforme |
| **C2 Données** | toute famille de config du jeu est portée et recalculée au bit | familles `cfg.bin` portées / 58 existantes | **4/58 = 6,9 %** |
| **C3 Logique** | toute fonction de gameplay/moteur reversée est portée et validée | fonctions portées / 52 783 réelles ; masse `.text` portée | **~55 fn = 0,1 %** ; **~0,3 %** de `.text` |
| **C4 Rendu** | la sortie visuelle est identique au jeu | Δpixel vs capture de référence (PSNR/SSIM) sur scènes-test | **non démarré** (assemblage GLB statique seulement) |
| **C5 RE (échafaudage)** | toute fonction réelle est identifiée (classée ET nommée) | classées + **nommées** / 52 783 | **92,45 % classées, 0 % nommées** |

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
- **A1** : `nxtch` deswizzle validé **pixel-à-pixel** sur un vrai NXTCH (le localiser dans les CPK) vs C#. *Gate : Δpixel = 0 sur ≥3 textures Switch réelles.*
- **A2** : **HCA conforme clHCA** (le décodeur actuel est un modèle simplifié non conforme). *Gate : PCM identique à vgmstream/cridecoder sur ≥3 `.hca`/`.awb` réels IEVR.*
- **A3** : `g4sk` hiérarchie d'os sans fallback heuristique. *Gate : arbre d'os exact vs C# sur ≥3 `.g4sk` réels.*
- **A4** : formats résiduels (`p3lip` 20 357 fichiers, `objbin` 11 920, `vfxo`, `g4cm`, `col`, `pfxo`, `ptlb`, `fxbin`, `g4nv`, `g4mt`) — parseurs réels. *Gate : 100 % des 250 800 fichiers passent en parse sans erreur.*
- **A5** : déchiffrement de toute enveloppe CPK résiduelle si le verrou existe (cf. recherche en cours). *Gate : 100 % des CPK montent dans le VFS.*

### Pilier B — Données (C2) → 58/58 familles portées, recalcul au bit
- **B0 (FAIT 4/58)** : skill, item, growth, exp, passives, character (partiel).
- **B1** : clore les INCOMPLET — `chara-param` (pairing level-first), `aura-cmd` (whs01780 réel). *Gate : golden byte contre `data/common/gamedata`, test qui valide la VRAIE valeur.*
- **B2** : porter les 54 familles restantes par lots (team, soccer, shop, gacha, story, npc, encounter…). *Gate : pour chaque famille, round-trip parse + 1 golden réel.*
- **B3** : moteur de calcul dérivé (stats finales, formations, bonus d'équipe) recoupé inagle au bit.

### Pilier C — Logique moteur (C3) → résoudre la longue traîne par sous-système
- **C0 (FAIT, îlots)** : nie-core (FSM match, effets, action-ctrl, stats — 126 tests) ; nie-engine (~55 fn, 11 modules) **mais 434 `// EXTERN:` non portées** = îlots non connectés.
- **C1** : **boucle de match jouable** — câbler nie-core (FSM + slots) à nie-data dans une simulation kickoff→score→fin. *Gate : match golden recoupé au C décompilé (score `min*10000+sec`).*
- **C2** : **résorber les EXTERN par sous-système** — choisir un sous-système (ex. `chara` 11 358 fn, ou `audio` runtime), le nommer (cf. pilier E), porter ses fonctions racines + leurs callees jusqu'à 0 EXTERN dans le module. *Gate : module sans EXTERN, tests par fonction.*
- **C3** : itérer C2 sur menu / physics(PhysX) / network / script jusqu'à couverture fonctionnelle.

### Pilier D — Rendu (C4) → pixel-perfect
- **D0 (FAIT partiel)** : assemblage GLB statique (corps+face+uniforme texturés), servi par nie-model-serve.
- **D1** : pipeline GPU **wgpu/webgpu** portant les shaders et la math de transform du moteur (le menu compositor révèle déjà des transforms à reverser). *Gate : Δpixel borné (SSIM ≥ 0,99) vs capture du jeu sur scènes-test menu.*
- **D2** : skinning g4sk + animations → modèles animés. *Gate : pose identique sur frame-test.*
- **D3** : scène de match rendue. *Gate : SSIM sur séquence de match.*

### Pilier E — RE / échafaudage (C5) → nommer, pas seulement classer
- **E0 (FAIT)** : 92,45 % classé sur `.pdata`, graphe d'appels réel, RTTI (1 575 classes).
- **E1** : **arêtes indirectes** (`lea reg,[fn]` + slots vtable `.rdata`↔RTTI) → connecter le résidu isolé. *Gate : delta de couverture mesuré honnêtement, sans double-comptage.*
- **E2** : **nommage réel** — propager les noms de classes RTTI (`lives::`, `game::`) vers leurs méthodes via vtable ; ré-exporter un index Ghidra **aligné** (`analyzeHeadless`, dispo sur le VPS) pour récupérer de vrais symboles. *Gate : N fonctions avec `function.name` non nul (actuellement 0).*
- **E3** : ré-ingestion du nommage comme ancres → boucle vers pilier C.

## 4. Trajectoire (vagues) et pilotage de fond

La campagne avance par **vagues** ; chaque vague = sélectionner des cibles bornées à vérité terrain →
orchestrer agents code + recherche → **vérifier (build + clippy -D warnings + tests/diff)** → mesurer → vague suivante.

- **Vague 1** (en cours) : B1 (données INCOMPLET) + recherche A2/A5/E1.
- **Vague 2** : A1 + A2 + A3 (formats pixel/byte-perfect) — déclenchée par la recherche.
- **Vague 3** : E1 (arêtes indirectes) → relance la pipeline auto-ML de fond enrichie ; puis E2 (nommage).
- **Vague 4** : C1 (boucle de match) puis C2 (premier sous-système sans EXTERN).
- **Vague 5+** : longue traîne — B2 (familles), C3 (sous-systèmes), D1–D3 (rendu).

**Pipeline auto-ML de fond** (`var/automl-loop.log`) : tourne en continu (`propagate`/`coverage`), et sera
**réinjectée** avec le lever d'arêtes indirectes dès E1 livré — c'est là qu'elle reprendra de la valeur
(aujourd'hui la couverture est au plafond de connectivité, la boucle est un heartbeat).

## 5. Métriques de progression (tableau de bord honnête)

À mettre à jour à chaque vague (source = mesure réelle, jamais déclaration) :

```
C1 fichiers lisibles : 84,06 %      cible 100 %
C2 familles données  : 4/58         cible 58/58
C3 fn logique portées: ~55          cible (sous-systèmes fonctionnels, pas 52 783 littéral)
C4 rendu SSIM        : —            cible ≥0,99 sur scènes-test
C5 classé / nommé    : 92,45 % / 0  cible : nommage non nul puis croissant
```

## 6. Honnêteté (le cadre, pas une excuse)

Reverser puis réécrire 100 % d'un jeu AAA de 31 Mo est un **effort de longue haleine** assumé. « 100 %
pixel-perfect » est la **direction**, pas une livraison de session. Ce roadmap garantit que **chaque pas est
réel et mesuré** : un format qui parse le vrai fichier, une donnée recalculée au bit, une fonction portée
validée contre le décompilé, un pixel diffé contre le jeu. La distinction *classifié ≠ nommé ≠ compris ≠
porté ≠ validé* est tenue partout — c'est elle qui empêche de confondre 92 % de cartographie avec 92 % de jeu.
