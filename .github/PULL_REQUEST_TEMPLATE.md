## Ce que fait cette PR

<!-- Une à trois phrases. Le quoi et le pourquoi ; le comment est dans le diff. -->

## Ce qui a été mesuré

<!--
Coller la SORTIE, pas l'intention. Une suite qui affiche « 0 passed » n'a pas tourné ;
un test data-gated qui se saute est un faux vert et doit être signalé comme tel.
Rayer ce qui ne s'applique pas.
-->

- [ ] `cargo clippy -p <crate> --lib --tests` — 0 warning
- [ ] `cargo test -p <crate>` — N passed, 0 failed, M skipped (et pourquoi ils sautent)
- [ ] `bun run typecheck` / `bun run test`
- [ ] `nie-forge report` si la forge est touchée — part produite avant → après
- [ ] Vérification réelle (lancer le binaire, ouvrir la page) : ni clippy ni tsc ne voient
      une ressource jamais lue ou une table vide

## Périmètre

<!--
Ce dépôt est travaillé par plusieurs agents en parallèle (cf. docs/A2A-CODEX.md).
Lister les arbres touchés, et confirmer qu'aucun autre n'a été modifié.
-->

## Points d'attention

<!--
Irréversible, externe, ou hors du dépôt : migration SQL, unité systemd pointant un
chemin en dur, renommage cassant un lien, changement touchant la signature de l'updater.
Écrire « aucun » si c'est le cas.
-->
