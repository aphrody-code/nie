---
description: Verification avant commit, ciblee sur ce qui a REELLEMENT change
argument-hint: [crate ou paquet, sinon deduit du diff]
allowed-tools: Bash, Read, Grep, Glob
---
Verifie uniquement ce que le diff touche. $ARGUMENTS restreint la cible si fourni.

1. `git status --porcelain` puis `git diff --name-only HEAD` — etablis la liste des fichiers modifies.
2. Deduis les crates Rust concernees (chemin `crates/*/<nom>/`) et les paquets Bun concernes (`packages/*`, `apps/*`).
3. Pour chaque crate touchee : `cargo clippy -p <crate> --lib --tests` — l'objectif est **0 warning** (regle du depot).
   - JAMAIS `cargo build --workspace --all-targets` (sature le disque) ni `cargo test --workspace` (depasse 600 s).
   - Si nie-data est touche : lance les golden de la famille concernee, `cargo test -p nie-data --test <fam>_golden`.
     Un golden qui se saute faute de dump est un FAUX VERT : dis-le explicitement.
4. Pour chaque paquet Bun touche : `bun run typecheck` (racine) et `bun test` cible. `build:ffi` d'abord si la couche Rust a bouge.
5. Verdict final : ce qui passe, ce qui echoue avec la sortie reelle, ce qui n'a PAS ete verifie et pourquoi.
   Ne conclus jamais « tout passe » sur une verification que tu n'as pas lancee.
