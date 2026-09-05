# `plugins/` — les extensions publiées

Deux extensions, plus le manifeste de marketplace local (`.claude-plugin/`) qui déclare la
première. Ce sont des **livrables** : elles sont installées par des outils extérieurs au
dépôt, donc leur contenu (`SKILL.md`, agents, manifestes) est versionné comme du code.

| Extension | Pour | Contenu |
|---|---|---|
| [`niers-plugin/`](niers-plugin) | Claude Code et Codex | le serveur MCP `niers-game`, 6 agents (`vfs-scout`, `re-lookup`, `forge-analyst`, `port-scout`, `build-doctor`, `bun-rs`) et 14 skills (terminologie IEVR, formats Level-5, navigation du monorepo, rendu 3D, ponts Rust ↔ Bun) |
| [`niers-blender/`](niers-blender) | Blender | import des assets G4 (modèles, personnages, maps, animations, caméras, textures) et réexport par patch de la base native plutôt que par reconstruction |

## Ce qui a déjà été perdu ici

Ces fichiers ont disparu du dépôt sans le moindre message le jour où une règle
`.gitignore` large a couvert le markdown : le plugin, ses 5 agents et ses 5 skills étaient
un livrable, et un clone frais ne les avait plus. Un fichier ignoré ne produit ni erreur ni
avertissement — il n'existe simplement pas chez le suivant.

Avant d'ajouter une règle d'exclusion qui touche ce dossier, vérifier **chaque** cas par
`git check-ignore -v <fichier>`, jamais au raisonnement : la dernière règle qui correspond
l'emporte, et une ré-inclusion posée avant une règle large ne sert à rien.

## Publier

L'extension Blender est empaquetée en `.zip` par `scripts/release-desktop.sh`, qui la joint
à la release GitHub. Le plugin Claude Code se déclare par
`plugins/.claude-plugin/marketplace.json` et se charge depuis le dépôt lui-même.
