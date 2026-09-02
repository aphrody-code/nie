---
description: Etat MESURE du depot — machine, git, cible RE, KB, forge, gisements, services
allowed-tools: Bash(bash .claude/hooks/etat.sh), Bash(bun --bun packages/nie-catalog/src/cli.ts etat), Bash(git status:*), Bash(git log:*)
---
Lance `bash .claude/hooks/etat.sh`, puis `bun --bun packages/nie-catalog/src/cli.ts etat` (facade des quatre gisements).

Rends un tableau de bord dense en francais. Regles :
- Aucun chiffre cite de memoire ni repris d'un document : seules les sorties de ces commandes font foi.
- Signale toute CONTRADICTION entre une mesure et ce qu'affirment CLAUDE.md, docs/PLAN.md ou docs/FORGE.md.
- Termine par le prochain chantier le plus rentable, avec sa mesure de depart et son critere de fin verifiable.
