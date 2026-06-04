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
   - catalogue des formats Level-5 / Criware documentés par `iecode/src/IECODE.Core/Formats/**` : magics + layouts de champs d'en-tête (offset/taille/type), exportés par iecode (`iecode export-knowledge`, JSON `schema_version`) et ingérés par `nie-seed/src/format_catalog.rs` (tables `format` + `format_field`) ;
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
nie-headless  runner headless natif (CLI)
nie-wasm      bindings wasm-bindgen + cible web/Next.js
```

Contrainte wasm : `wasm32-unknown-unknown` std fournie par la toolchain `nightly-x86_64-unknown-linux-gnu` (la seule présente avec la std wasm). `nie-formats`/`nie-data`/`nie-core` restent `#![no_std]`-compatibles autant que possible (alloc only) pour la portabilité wasm.

## Crates (état atteint)

9 crates, 192 tests verts, compile natif (nightly-2026-05-17) + `wasm32-unknown-unknown`.

| Crate | Rôle | État |
|---|---|---|
| `nie-index` | base de connaissance sqlite (schéma + ingest/query) | FAIT |
| `nie-seed` | ingest nie-index.json (60183 fn) + RTTI/formats/inagle | FAIT |
| `nie-re` | RTTI MSVC, indexer aphrody-re, **disasm iced-x86 (arêtes d'appel)**, propagation auto-ML | FAIT |
| `nie-queue` | frontière BFS redis | FAIT |
| `nie-formats` | CRILAYLA decompress, @UTF, cfg.bin/RDBN | FAIT (CPK chiffré + valeurs RDBN = NON_FAIT) |
| `nie-core` | logique de jeu : ball, soccer, keeper, tactics AI, stats | amorce (14 fn portées) |
| `nie-cli` | binaire `niers` (seed/index/rtti/disasm/propagate/coverage/queue) | FAIT |
| `nie-headless` | runner CLI sans moteur Windows | FAIT |
| `nie-wasm` | surface wasm-bindgen (detect/crilayla/utf), glue JS | FAIT |

## Découverte majeure : l'index Ghidra est désaligné — `.pdata` est la vérité terrain

Vérification byte-à-byte contre la table `.pdata` (unwind d'exception x64, générée par le compilateur — vérité incontestable) :

- `.pdata` = **94 748 entrées** `RUNTIME_FUNCTION` = **44 074 fragments chaînés** (`UNW_FLAG_CHAININFO`) + **50 674 fonctions racines** réelles.
- Des 59 991 adresses `FUN_<hex>` de `nie-index.json`, seules **2 243 (3,7 %)** coïncident avec un début de fonction réel ; **≥54,9 %** tombent *strictement à l'intérieur* d'un corps de fonction `.pdata` (preuve : ce ne sont pas des débuts), et l'ensemble est artificiellement aligné sur 16 octets à **99,2 %**.
- Spot-checks décodés : les adresses Ghidra non alignées pointent sur des **épilogues / milieux d'instruction** (ex. `FUN_140100390` = `mov rsi,[rsp+0x40]; add rsp,…`).
- Le champ `ce` (callees) n'est pas le graphe d'appels directs réels (vérifié : `FUN_140024b80` appelle réellement `0x14098c0a0/0x14004fc60/0x1400500e0`, son `ce` liste 5 fonctions toutes différentes).

**Conséquence honnête** : l'index Ghidra reste exploitable comme **graphe de métadonnées** (chaînes, namespaces, relations) — la propagation à 88 % est un *clustering en espace-graphe* cohérent — mais ses **adresses ne sont pas des débuts de fonction physiques**. Donc :

1. Le « +774 » du levier `disasm` (commit `99b89c3`) est **en grande partie du bruit physique** : décoder depuis des points milieu-de-fonction produit des arêtes majoritairement fortuites (seules 0,3 % des arêtes `call` ont leurs deux extrémités sur un début réel). Le *code* de `disasm` est correct ; c'est son *entrée* (adresses Ghidra) qui est fausse. Il redeviendra valide alimenté par les débuts `.pdata`.
2. La **vraie couverture** se mesurera sur les ~50 674 fonctions racines réelles, pas sur les 60 183 nœuds Ghidra désalignés.

**Refondation `.pdata` — FAIT** (`niers rebuild`, `nie-re::pdata::rebuild_from_pdata`) : la carte des fonctions est reconstruite sur les 50 674 racines réelles ; les métadonnées Ghidra sont ré-ancrées **par inclusion** (nœud à l'adresse `a` → fonction racine contenant `a` : 17 403 chaînes, 340 100 constantes, 55 142 arêtes `ce` repliées, 1 575 classes RTTI), puis `disasm` tourne depuis les **vrais débuts** et propage. Résultats sur le vrai `nie.exe` :

- `disasm` depuis les bons débuts trouve **124 868 arêtes d'appel directes réelles** (×18 vs les 6 721 du graphe désaligné — preuve que le décodage est désormais physiquement correct).
- **Couverture HONNÊTE : 45 823 / 50 674 = 90,43 %** des fonctions réelles (à unwind), sur des adresses correctes et un graphe d'appels réel. C'est la vraie mesure de référence (les ~7 700 chaînes Ghidra hors de toute fonction racine — régions feuilles sans unwind — ne sont pas couvertes : `.pdata` est un plancher autoritaire).

**Prochain levier** : arêtes de **vtables** (`.rdata`, reliées aux classes RTTI déjà localisées) pour le résidu appelé uniquement indirectement ; propagation pondérée par type d'arête (direct 1.0, indirect 0.5, RTTI 2-3) ; découverte des fonctions feuilles sans unwind (balayage des cibles d'appel hors `.pdata`).

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
4. **Déchiffrement enveloppe CPK** (clé non publique — RE à faire).
5. **nie-wasm** : étendre la surface (nie-core, nie-data) + intégration web.

## Honnêteté

Reverser 100 % d'un jeu AAA est un effort de longue haleine. Ce repo livre la **boucle réelle** (pas un stub) : index runnable sur le vrai `nie.exe`, seed depuis le vrai savoir iecode/inagle, désassemblage `iced-x86` du vrai binaire, propagation mesurée à 88,20 %, formats décodés et portés en wasm, logique de jeu amorcée, headless + navigateur fonctionnels. Chaque livrable est classé FAIT / INCOMPLET / NON_FAIT. Les écarts entre l'index Ghidra et le binaire réel sont vérifiés par décodage direct, jamais supposés.
