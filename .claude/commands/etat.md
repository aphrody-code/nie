---
description: Etat MESURE du depot — machine, git, cible RE, KB, atlas, forge, gisements, services
allowed-tools: Bash(bash .claude/hooks/etat.sh), Bash(git status:*), Bash(git log:*)
---
Lance `bash .claude/hooks/etat.sh`.

Rends un tableau de bord dense en francais. Regles :
- Aucun chiffre cite de memoire ni repris d'un document : seules les sorties de ces commandes font foi.
- Signale toute CONTRADICTION entre une mesure et ce qu'affirment CLAUDE.md, PLAN.md ou docs/FORGE.md.
- Le prochain chantier se lit dans l'atlas (`niers atlas next`), pas dans un document : la ligne
  `atlas` du hook donne deja l'ecart n1 et son score.
- Termine par le prochain chantier le plus rentable, avec sa mesure de depart et son critere de fin verifiable.
