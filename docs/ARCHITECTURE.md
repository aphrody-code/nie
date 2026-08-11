# niers — architecture

Réimplémentation **Rust headless + wasm** d'*Inazuma Eleven: Victory Road* (IEVR, moteur Level-5 « Lives »), pilotée par une **boucle de reverse-engineering autonome** qui reverse `nie.exe` récursivement, indexée sur le savoir déjà fusionné de `iecode` (C# .NET 10) et `inagle` (TS).

Objectif littéral : au lancement de `niers` (en Rust), avoir **100 % du jeu** disponible en headless et en wasm — sans le binaire Windows ni le moteur propriétaire.

## Cible binaire

`nie.exe` : PE32+ x86-64, 31 Mo, 9 sections, **non strippé**, base `0x140000000`, compilé 2026-04-15, PDB de build `G:\nie1v2\...\nie.pdb` (symboles absents du dump, mais RTTI MSVC présent). Variante `nie_eacpatched.exe` (EasyAntiCheat retiré) = cible RE privilégiée. Assets : 63 Go de CPK (déjà couverts par iecode/inagle).

## La boucle RE (RE ° auto-ML ° sqlite ° redis)

```
        ┌─────────────────────────────────────────────────────────────┐
        │                    nie-index (sqlite)                        │
        │  binary · section · function · xref · str · rtti_class       │
        │  rtti_base · symbol · format · format_field · hash_name      │
        │  anchor · hypothesis · coverage · meta                       │
        └───────▲───────────────────────────────────────────▲─────────┘
                │ durable                                     │
   ┌────────────┴───────────┐                    ┌────────────┴───────────┐
   │  SEED (ground truth)   │                    │   PROPAGATE (auto-ML)  │
   │  nie-seed              │                    │   nie-re::propagate    │
   │  · formats iecode      │                    │   · label propagation  │
   │  · hash→nom inagle     │   ancres           │     sur le call-graph  │
   │  · RTTI lives::*       │ ─────────────────▶ │   · features + score   │
   └────────────▲───────────┘                    └────────────┬───────────┘
                │                                              │ frontière
   ┌────────────┴───────────┐                    ┌────────────▼───────────┐
   │  INDEX (RE brut)       │                    │   QUEUE (redis)        │
   │  nie-re::indexer       │                    │   nie-queue            │
   │  · rizin aaa (JSON)    │ ─── fonctions ────▶│   · frontière BFS      │
   │  · sections/imports    │     non résolues   │   · dédup (SET)        │
   │  · strings/xrefs       │                    │   · workers parallèles │
   │  · RTTI recovery       │                    └────────────────────────┘
   └────────────────────────┘
```

1. **INDEX** (`nie-re::indexer`) — pilote `rizin` en sous-processus (`aaa`, sorties JSON `aflj`/`izzj`/`iij`/`axtj`), peuple `nie-index` : sections, fonctions, strings, xrefs, imports. RTTI MSVC récupéré (`nie-re::rtti`) → classes `lives::*` + hiérarchie (`rtti_base`).
2. **SEED** (`nie-seed`) — importe le savoir **déjà fusionné** comme ancres de vérité :
   - catalogue des formats Level-5 / Criware documentés par `csharp/IECODE.Core/Formats/**` : magics + layouts de champs d'en-tête (offset/taille/type), exportés par iecode (`iecode export-knowledge`, JSON `schema_version`) et ingérés par `nie-seed/src/format_catalog.rs` (tables `format` + `format_field`) ;
   - tables `hash → nom` d'`inagle` (CRC32/FNV des IDs persos/skills/items — des milliers d'ancres) ;
   - noms de classes RTTI ↔ structures connues.
3. **QUEUE** (`nie-queue`, redis) — frontière récursive : les fonctions/structures non résolues sont poussées dans une file dédupliquée ; des workers les dépilent (parallélisme).
4. **PROPAGATE** (`nie-re::propagate`, auto-ML) — propagation de labels sur le call-graph depuis les ancres : une fonction qui référence la string `"CHARA_PARAM_INFO"` ou xref une classe connue hérite d'un nom + score de confiance. Couche ML = features (taille, n_args, strings, voisins) + classifieur semi-supervisé (label propagation d'abord, modèle entraîné ensuite).
5. **COVERAGE** — `% fonctions nommées / classifiées` vers 100 %. La boucle itère index→seed→rtti→propagate→queue jusqu'à stabilisation, puis attaque les zones non couvertes.

## Du savoir au code Rust (headless + wasm)

`nie-formats` porte en Rust les formats Level-5 (depuis iecode C# / inagle TS, vérifiés byte-à-byte) : cfg.bin, CPK, G4MG/G4MD/g4tx/g4sk/g4pkm, Criware (HCA/ACB/AWB/ADX), etc. À mesure que la boucle RE résout la logique (sim de match, IA, progression), elle est portée en crates Rust pures :

```
nie-formats   parsers binaires (no_std-friendly → wasm)
nie-data      structures de données du jeu (port inagle)
nie-core      logique de jeu reversée (sim soccer, skills, auras…)
nie-engine    port décompilé de nie.exe (render/menu/audio/anim/script)
nie-game      host GUI natif wgpu (rendu pixel-perfect, pilier D1) — CHEMIN CENTRAL
nie-headless  runner headless natif (CLI)
nie-wasm      bindings wasm-bindgen + cible web/Next.js (compagnon secondaire)
```

La **cible de rendu primaire est le natif** (`nie-game`/wgpu, pilier D1/C4 pixel-perfect) ; le wasm/web (`nie-wasm` → azalee) reste un **compagnon**.

Contrainte wasm : `wasm32-unknown-unknown` std fournie par la toolchain `nightly-x86_64-unknown-linux-gnu` (la seule présente avec la std wasm). `nie-formats`/`nie-data`/`nie-core` restent `#![no_std]`-compatibles autant que possible (alloc only) pour la portabilité wasm.

## Crates (état atteint)

**17 crates** (mesuré `ls crates/*/`, 2026-06-13), compile natif (nightly-2026-05-17) + `wasm32-unknown-unknown`. Plan maître : `docs/PLAN.md`. Stack runtime : `docs/STACK.md`. Inventaire par pilier : `docs/INVENTAIRE.md`.

| Crate | Rôle | État |
|---|---|---|
| `nie-game` | **host GUI natif wgpu (pilier D1/C4 pixel-perfect, chemin central)** — capture PNG headless + fenêtre, rend les vrais assets `.g4tx` | **FAIT (squelette, wgpu 22)** ; bump 29 + retarget `render.rs` à venir |
| `nie-formats` | lecture pure-Rust Level-5/Criware (cfg.bin/RDBN, g4tx/g4md/g4mg/g4pk, @UTF, CRILAYLA, nxtch, HCA) | g4*/RDBN/@UTF/CRILAYLA/CPK **FAIT** ; **HCA décode** ✓ ; g4sk hiérarchie INCOMPLET ; **105 tests lib** |
| `nie-data` | modèles `no_std` du jeu (port inagle) | **34 familles golden + 8 B2** ; chara-param/aura-cmd clos |
| `nie-core` | logique de jeu reversée (FSM match, effets commande, action-ctrl, stats, CRand) | **FAIT — 152 tests lib, CRand MT19937 byte-exact, match jouable, 0 stub** |
| `nie-engine` | port décompilé de `nie.exe` (render D3D11/PhysX/menu/audio/animation/scripting/network) | socle 15 070 LOC, 271 tests, **434 `// EXTERN:`** = îlot à connecter |
| `nie-model-serve` | serving live GLB/tex/audio/vidéo/lip/typed depuis les CPK (HTTP :8790) | FAIT (8 routes, `cdn.rosegriffon.fr`) |
| `nie-headless` | runner CLI headless sans moteur Windows (boucle de match jouable) | FAIT |
| `nie-wasm` | surface wasm-bindgen (detect/crilayla/@UTF, g4tx→PNG, audio→WAV, cfg.bin typé) | FAIT (compagnon, pas le cap) |
| `nie-save` | déchiffrement/lecture/édition des saves (XOR clé CRC32) | FAIT (12 tests) |
| `nie-wiki` | CLI game-data (13 sous-commandes, miroir SQLite) | FAIT |
| `nie-zukan` | ingesteur encyclopédie `zukan.inazuma.jp` (algo `?q=` reversé) | FAIT |
| `nie-steam` | download natif des dépôts Steam (port C# iecode sur steamroom) | FAIT (33 tests ; E2E live en attente creds) |
| `nie-index` | base de connaissance sqlite (schéma + ingest/query, table `coverage`) | FAIT |
| `nie-seed` | ingest index Ghidra + RTTI/formats iecode/hash→nom inagle | FAIT |
| `nie-re` | RTTI MSVC, refondation `.pdata`, **disasm iced-x86 (arêtes d'appel + LEA)**, ancrage vtable→RTTI, propagation auto-ML | FAIT (93,36 % classé, 6 429 nommées) |
| `nie-queue` | frontière BFS redis | FAIT |
| `nie-cli` | binaire `niers` (seed/rtti/rebuild/disasm/propagate/coverage/queue/textures) | FAIT |

## Découverte majeure : l'index Ghidra est désaligné — `.pdata` est la vérité terrain

Vérification byte-à-byte contre la table `.pdata` (unwind d'exception x64, générée par le compilateur — vérité incontestable) :

- `.pdata` = **94 748 entrées** `RUNTIME_FUNCTION` = **44 074 fragments chaînés** (`UNW_FLAG_CHAININFO`) + **50 674 fonctions racines** réelles.
- Des 59 991 adresses `FUN_<hex>` de `nie-index.json`, seules **2 243 (3,7 %)** coïncident avec un début de fonction réel ; **≥54,9 %** tombent *strictement à l'intérieur* d'un corps de fonction `.pdata` (preuve : ce ne sont pas des débuts), et l'ensemble est artificiellement aligné sur 16 octets à **99,2 %**.
- Spot-checks décodés : les adresses Ghidra non alignées pointent sur des **épilogues / milieux d'instruction** (ex. `FUN_140100390` = `mov rsi,[rsp+0x40]; add rsp,…`).
- Le champ `ce` (callees) n'est pas le graphe d'appels directs réels (vérifié : `FUN_140024b80` appelle réellement `0x14098c0a0/0x14004fc60/0x1400500e0`, son `ce` liste 5 fonctions toutes différentes).

**Conséquence honnête** : l'index Ghidra reste exploitable comme **graphe de métadonnées** (chaînes, namespaces, relations) — la propagation à 88 % est un *clustering en espace-graphe* cohérent — mais ses **adresses ne sont pas des débuts de fonction physiques**. Donc :

1. Le « +774 » du levier `disasm` (commit `99b89c3`) est **en grande partie du bruit physique** : décoder depuis des points milieu-de-fonction produit des arêtes majoritairement fortuites (seules 0,3 % des arêtes `call` ont leurs deux extrémités sur un début réel). Le *code* de `disasm` est correct ; c'est son *entrée* (adresses Ghidra) qui est fausse. Il redeviendra valide alimenté par les débuts `.pdata`.
2. La **vraie couverture** se mesurera sur les ~50 674 fonctions racines réelles, pas sur les 60 183 nœuds Ghidra désalignés.

**Refondation `.pdata` + vtables — FAIT** (`niers rebuild`). Pipeline complet sur des adresses **correctes** :

1. **`pdata::rebuild_from_pdata`** : carte reconstruite sur les 50 674 racines réelles ; métadonnées Ghidra ré-ancrées **par inclusion** (nœud à l'adresse `a` → fonction racine contenant `a` : 17 403 chaînes, 340 100 constantes, 55 142 arêtes `ce` repliées, 1 575 classes RTTI).
2. **`vtable::vtable_edges_into`** : pour chaque vtable localisée par RTTI (méthodes à `vtable_vaddr+8`), lecture des slots `.text` → **6 681 méthodes**, dont **2 109 fonctions feuilles** (sans unwind, absentes de `.pdata`) ajoutées comme nœuds, + **13 927 arêtes de cohésion de classe** (`kind='vtable'`) reliant les co-méthodes.
3. **`disasm`** depuis les bons débuts → **169 828 arêtes d'appel directes réelles** (≈×25 vs les 6 721 du graphe désaligné — preuve que le décodage est physiquement correct). *(L'ancien chiffre « 125 029 » d'une passe disasm antérieure n'est plus reproductible depuis `var/niers.sqlite` ; la base en contient 169 828, dédupliquées, les deux extrémités étant de vrais débuts de fonction.)*
4. **Propagation** sur le graphe `call`+`vtable`.

**Couverture HONNÊTE : 49 280 / 52 783 = 93,36 %** des fonctions **classifiées** — label de sous-système propagé, **pas un nom**. Sur adresses correctes + graphe d'appels réel + cohésion de vtable. Le dénominateur s'est **agrandi** (50 674 → 52 783, +2 109 feuilles découvertes par vtable) et la couverture a monté (90,43 % → 92,45 % → **93,36 %**).

**Lever « arêtes indirectes » — FAIT (2026-06-10), mesuré A/B.** (a) **LEA rip-relatif** (`lea reg,[rip+fn]` dont la cible est un début de fonction `.pdata`, gate strict `Mnemonic::Lea`) → 5 477 arêtes `kind='lea'` (poids propagation 0,4). (b) **Ancrage vtable→RTTI** : une méthode standalone d'une vtable de classe classifiable hérite du sous-système de sa classe (conf 0,7, saute les thunks partagés). Résultat honnête : **+484 fonctions** atteignables (92,45 → 93,36 %), dont seulement **+17 à confiance ≥ 0,3** (les ancres RTTI dures) — le reste est du label faible via LEA. La mesure double-seuil (brut + conf≥0,3) évite de gonfler le %.

**Nommage structurel — AMORCÉ (2026-06-10).** `function.name` était NULL partout (0 nommée). Chaque méthode de vtable d'une classe RTTI reçoit un nom **structurel** `Namespace::Classe::vmethod_N` (`name_source='vtable-struct'`) → **6 429 fonctions (12,18 %) nommées**. Ce sont des noms de **position** (classe + slot), **pas** les symboles C++ originaux (`Update`/`Release`/…) — distincts d'un futur import PDB/Ghidra aligné (pilier E2). Prochain levier de couverture : pointeurs absolus 8 octets en `.rdata`/`.data` (~1 651 fn estimées).

**Propagation pondérée — FAIT (levier de précision, pas de couverture).** Arêtes typées (appel direct 1.0, cohésion de vtable 0.5) + amortissement de degré anti-hub (`1/ln(deg+2)` : un utilitaire alloc/string appelé par des milliers de fonctions ne domine plus le label de ses voisins). **Couverture inchangée à 92,45 %** : la pondération change *quel* label gagne et la confiance, pas *quels* nœuds sont atteignables (la couverture est bornée par la connectivité du graphe, pas les poids). C'est une amélioration de **robustesse/justesse** des labels, utile pour le port, mais ce n'est pas un levier de couverture (estimation grok §3 « +4-5 pts » revue à la baisse, vérifiée empiriquement).

**Prochains leviers de couverture** (les vrais) : (a) plus d'**ancres** (règles strings, RTTI étendu) ; (b) **découverte de feuilles** supplémentaires (cibles d'appel directes `.text` hors `.pdata`/vtable, à enregistrer comme nœuds) ; (c) le résidu (~4 000 fonctions) est largement **isolé** (ni string, ni RTTI, ni arête vers une fonction étiquetée) → rendements décroissants. **L'axe à plus forte valeur est désormais le « jeu jouable », porté par la GUI native `nie-game` (D1/C4) en tête de pont** : bump wgpu 29, gate pixel-diff (image-compare/SSIM + égalité octet sha2), retarget des transforms du compositor (`nie-engine/render.rs`), puis skinning g4sk (D2) et scène de match (D3). Socle déjà acquis : `nie-core` (sim + CRand byte-exact), `nie-data` (34 familles golden), `nie-formats` (assets + HCA). `nie-wasm`/azalee = compagnon. Détail : `docs/STACK.md`.

## Couverture atteinte (sur l'index Ghidra — espace-graphe)

Pipeline `niers seed → rtti → disasm → propagate` sur le vrai `nie.exe` :

- **88,20 %** des 60 183 fonctions classifiées en sous-systèmes (menu, physics, chara, gameplay, audio, network, script, render, vfs, animation, level, input) via 3 112 ancres (strings + RTTI-namespace + const-magic) et label-spreading sur le call-graph **enrichi par désassemblage**.
- RTTI : 1 234/1 234 classes attendues + 6 472 relations d'héritage.
- **Levier désassemblage (`nie-re::disasm`)** : 86,92 % → **88,20 %** (+774 fonctions). Désassemble `.text` par `iced-x86` (5,81 M instructions, ~0,4 s), résout les `call`/`jmp` **directs** (rel32) et insère **6 721 arêtes d'appel réelles** absentes de l'export Ghidra (149 470 → 156 191).
- **Découverte de RE clé** : le champ `ce` de `nie-index.json` n'est **pas** le graphe d'appels directs. Vérifié byte-à-byte : `FUN_140024b80` appelle réellement `0x14098c0a0/0x14004fc60/0x1400500e0` (instructions `call` décodées) alors que son `ce` Ghidra liste 5 fonctions **toutes différentes** (callees résolus par le décompilateur). Le désassemblage direct fournit donc un graphe **orthogonal et réel** qui connecte des îlots laissés isolés par `ce`.
- **Plafond résiduel (honnête)** : le résidu (~11,8 %) est dominé par les fonctions appelées **uniquement indirectement** (vtables, tables de pointeurs de fonctions, dispatch). 308 368 cibles de branches directes ne tombent pas sur un début de fonction (sauts internes + thunks IAT, non retenus). Dépasser 88 % exige de résoudre l'**indirection** (références `lea reg,[fn]` et entrées de vtable en `.rdata`).

## Reste vers 100 %

1. **Arêtes indirectes** : références de pointeurs de fonctions (`lea reg,[fn]`, entrées de vtable `.rdata` reliées aux classes RTTI déjà localisées) → connecter les méthodes virtuelles à leur sous-système de classe. Levier le plus prometteur pour le résidu (haute précision via RTTI).
2. **nie-core** : étendre la logique de jeu portée (sim de match complète, skills/auras, IA), valider contre inagle.
3. **nie-data** : structures de données du jeu (port inagle) en Rust ; catalogue de formats iecode ingéré via `nie-seed::format_catalog`.
4. ~~**Déchiffrement enveloppe CPK**~~ — **RÉSOLU** (2026-06-10) : pas de clé non publique ni d'enveloppe ; clé = CRC32(nom de fichier), déjà portée, 921/921 CPK déchiffrés. Restant audio : câblage de la clé HCA (`cridecoder` + clé IEVR récupérée du dump il2cpp).
5. **nie-wasm** : étendre la surface (nie-core, nie-data) + intégration web.

## Honnêteté

Reverser 100 % d'un jeu AAA est un effort de longue haleine. Ce repo livre la **boucle réelle** (pas un stub) : index runnable sur le vrai `nie.exe`, seed depuis le vrai savoir iecode/inagle, désassemblage `iced-x86` du vrai binaire, propagation mesurée à 88,20 %, formats décodés et portés en wasm, logique de jeu amorcée, headless + navigateur fonctionnels. Chaque livrable est classé FAIT / INCOMPLET / NON_FAIT. Les écarts entre l'index Ghidra et le binaire réel sont vérifiés par décodage direct, jamais supposés.
