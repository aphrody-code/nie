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

## Crates (état actuel)

| Crate | Rôle | État |
|---|---|---|
| `nie-index` | base de connaissance sqlite (schéma + accès) | fondation |
| `nie-re` | moteur RE : driver rizin, indexer, RTTI, propagation | fondation |
| `nie-queue` | frontière redis + coordination workers | fondation |
| `nie-seed` | import ground-truth iecode + inagle | fondation |
| `nie-formats` | parsers Level-5 portés en Rust | amorce (cfg.bin) |
| `nie-cli` | binaire `niers` (re/fmt/loop/coverage) | fondation |

## Honnêteté

Reverser 100 % d'un jeu AAA est un effort de longue haleine. Ce repo livre la **boucle réelle** (pas un stub) : index runnable sur le vrai `nie.exe`, seed depuis le vrai savoir iecode/inagle, propagation mesurable, et une couverture % qui progresse. Chaque livrable est classé FAIT / INCOMPLET / NON_FAIT.
