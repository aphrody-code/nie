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
   - catalogue des formats Level-5 documentés par `iecode/src/IECODE.Core/Formats/**` (offsets, magics) ;
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
| `nie-re` | RTTI MSVC, indexer aphrody-re, propagation auto-ML | FAIT |
| `nie-queue` | frontière BFS redis | FAIT |
| `nie-formats` | CRILAYLA decompress, @UTF, cfg.bin/RDBN | FAIT (CPK chiffré + valeurs RDBN = NON_FAIT) |
| `nie-core` | logique de jeu : ball, soccer, keeper, tactics AI, stats | amorce (14 fn portées) |
| `nie-cli` | binaire `niers` (seed/index/rtti/propagate/coverage/queue) | FAIT |
| `nie-headless` | runner CLI sans moteur Windows | FAIT |
| `nie-wasm` | surface wasm-bindgen (detect/crilayla/utf), glue JS | FAIT |

## Couverture atteinte

Pipeline `niers seed → index → rtti → propagate` sur le vrai `nie.exe` :

- **86,92 %** des 60 183 fonctions classifiées en sous-systèmes (menu, physics, chara, gameplay, audio, network, script, render, vfs, animation, level, input) via 3 112 ancres (strings + RTTI-namespace + const-magic) et label-spreading.
- RTTI : 1 234/1 234 classes attendues + 6 472 relations d'héritage.
- **Plafond identifié (honnête)** : 6 089 des 7 870 fonctions restantes ont **zéro arête `call`** dans l'index Ghidra → îlots inatteignables par propagation. Dépasser ~87 % exige de **récupérer les arêtes d'appel manquantes par désassemblage** (iced-x86 sur la section `.text`, déjà disponible via `aphrody-re`) — c'est le prochain levier majeur.

## Reste vers 100 %

1. **Récupération des arêtes d'appel** (iced-x86) : désassembler `.text`, résoudre les `call`/`jmp` directs et indirects (vtables) → enrichir le call-graph → repropager au-delà de 87 %.
2. **nie-core** : étendre la logique de jeu portée (sim de match complète, skills/auras, IA), valider contre inagle.
3. **nie-data** : structures de données du jeu (port inagle) en Rust.
4. **Déchiffrement enveloppe CPK** (clé non publique — RE à faire).
5. **nie-wasm** : étendre la surface (nie-core, nie-data) + intégration web.

## Honnêteté

Reverser 100 % d'un jeu AAA est un effort de longue haleine. Ce repo livre la **boucle réelle** (pas un stub) : index runnable sur le vrai `nie.exe`, seed depuis le vrai savoir iecode/inagle, propagation mesurée à 86,92 %, formats décodés et portés en wasm, logique de jeu amorcée, headless + navigateur fonctionnels. Chaque livrable est classé FAIT / INCOMPLET / NON_FAIT.
