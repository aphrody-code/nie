---
description: Porter une famille de donnees nie-data de bout en bout, jusqu'a azalee
argument-hint: <famille ou marqueur, ex. shop, kizuna, MENU_TEXT>
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
---
Famille visee : $ARGUMENTS

1. **Verifier l'existant AVANT d'ecrire une ligne** — la quasi-totalite est deja portee, et les modules sont nommes par concept, pas par nom de fichier :
   `grep -rl "<MARQUEUR>" crates/engine/nie-data/src/` ; balaye aussi `src/` (C++), `csharp/` (IECODE), `packages/` (TS).
2. **Sonder le format reel** : `target/debug/examples/probe_rdbn <prefix>` (RDBN) ou `probe_t2b <prefix>` (T2B), `NIE_GAME_DIR` pose.
   Deux formats derriere `.cfg.bin` : RDBN a listes (`cfgbin::is_rdbn` → `parse` + `read_values`) et T2B (`cfgbin::cfgbin_parse`, arbre `CfgEntry`). Tout `common/property/**` est T2B.
3. **Porter** dans `crates/engine/nie-data/src/`, en suivant l'idiome du module voisin le plus proche.
4. **Golden test** : `cargo test -p nie-data --test <fam>_golden`. Un golden qui se saute faute de dump est un faux vert — annonce le saut.
   N'appelle jamais un fichier de test `*update*`/`*setup*`/`*install*`/`*patch*` (piege d'elevation Windows, cf. `notice_maj_golden.rs`).
5. **Aller jusqu'a azalee** : une famille portee qui reste en vase clos ne compte pas. Export JSON / route `nie-model-serve` / `niers wiki`, jusqu'a une page qui l'affiche.
6. `cargo clippy -p nie-data --lib --tests` doit rendre 0 warning avant de committer.
