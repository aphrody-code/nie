# `crates/` — le workspace Rust

36 crates compilées, rangées **par rôle dans la chaîne de production**, plus 2 conservées
hors build comme référence. Le workspace est déclaré à la racine (`Cargo.toml`,
`members = ["crates/forge/*", "crates/engine/*", "crates/tools/*"]`) ; `crates/archive/*`
en est exclu.

Le rangement par rôle est délibéré et diffère d'un workspace Rust classique à crates
plates : ici la question « cette crate produit-elle le binaire, le remplace-t-elle, ou
l'outille-t-elle ? » est la seule qui décide de ce qui a le droit de dépendre de quoi.
Voir [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

| Dossier | Crates | Rôle |
|---|--:|---|
| [`forge/`](forge) | 10 | produire `nie.exe` au byte près, et le reverse qui l'alimente |
| [`engine/`](engine) | 18 | le moteur — la matière que la forge doit finir par émettre |
| [`tools/`](tools) | 8 | l'outillage périphérique (CLI, serveurs, wiki, tâches) |
| [`archive/`](archive) | 2 | portages conservés en lecture seule, compilés par personne |

## `forge/` — la chaîne de production

`nie-pe` (modèle PE64 lu et réécrit au byte près) · `nie-asm` (encodeur x86-64, dialecte
MSVC) · `nie-forge` (la boucle `split → lift → cc → build → verify → report` et la mesure)
· l'échafaudage de reverse : `nie-re`, `nie-dump`, `nie-index`, `nie-seed`, `nie-queue`,
`nie-trace`, `aphrody-re`.

C'est ici que se juge le projet : `nie-forge build` échoue si le sha256 de `dist/nie.exe`
diffère de la référence. Ne jamais « corriger » ce test — c'est lui le contrat
([`docs/FORGE.md`](../docs/FORGE.md)).

## `engine/` — le moteur

`nie-formats` (les parseurs Level-5 et Criware) · `nie-data` (les familles `cfg.bin`
typées) · `nie-core` (la logique de jeu portée) · `nie-lua` (la VM Lua 5.2 du jeu) ·
`nie-render3d`, `nie-game`, `nie-play`, `nie-headless`, `nie-camera`, `nie-geom`,
`nie-runtime`, `nie-save`, `nie-viola`, `nie-app`, `nie-explore`, `nie-wasm`,
`nie-ffi` (la porte vers Bun), `nie-aphrody`.

## `tools/` — l'outillage

`nie-cli` (le binaire `niers`, **seule** CLI utilisateur) · `nie-model-serve` (le serveur
d'assets) · `nie-wiki`, `nie-zukan`, `nie-steam`, `nie-editor`, `nie-bench`, `nie-tasks`.

Une commande nouvelle s'écrit dans `nie-cli`, jamais dans un binaire de plus : les
toolchains C++ et .NET s'atteignent par `niers cpp …` et `niers cs …`.

## Vérifier

```bash
cargo clippy -p <crate> --lib --tests     # 0 warning exigé avant tout commit
cargo test -p nie-data --test <fam>_golden
```

Le gate du dépôt est `cargo clippy --all-targets`, **pas** `cargo build --workspace
--all-targets` : lier la centaine de binaires de test sature le disque du VPS. Une suite
qui affiche « 0 passed » n'a pas tourné — vérifier les features optionnelles du crate
(`nie-formats` n'active par défaut que `std` et `lua`) avant d'accuser son propre code.
