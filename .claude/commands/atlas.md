---
description: L'atlas — index unique des surfaces RE : chercher, mesurer la route vers les 100 %, lancer un tick de la boucle
argument-hint: [search <terme>|gaps|next|status|build|loop|docs|dupes]
allowed-tools: Bash, Read, Grep, Glob
---
L'atlas (`var/nie-atlas.sqlite`, miroir redis db4) indexe TOUTES les surfaces RE du depot :
fichiers, crates, documents et ce qu'ils affirment de la machine, digest de la base de
connaissance de 19 Go, unites de forge, binaires, outils. Doc : `docs/ATLAS.md`.

Action demandee : $ARGUMENTS (par defaut : `status` puis `gaps`).

```bash
niers atlas status | search <terme> | gaps | next | docs --orphans | dupes
just atlas                  # (re)construire l'index + le miroir redis
bash scripts/atlas-loop.sh  # un tick : mesurer -> indexer -> classer -> agir -> re-mesurer
```

Regles :
- **Chercher ici AVANT tout `rg`/`find`** : une requete couvre docs, symboles, outils, fichiers
  et crates ; `rg` a la racine depasse 60 s et ne voit ni la KB ni les unites de forge.
- Le prochain chantier se LIT (`niers atlas next`), il ne s'invente pas. Le classement est
  `(cible - courant) x poids` ; les poids sont dans `docs/ATLAS.md`.
- Aucun chiffre sans sa commande : une mesure s'enregistre avec
  `niers atlas metric <nom> <valeur> --total <t> --source '<commande>' --refresh`.
- Un ecart sans metrique mesuree N'EXISTE PAS : `refresh_gaps` n'ecrit pas de zero pour combler
  un trou. Ne jamais inventer la ligne manquante — la mesurer.
- L'index se reconstruit de zero : s'il contredit un document, c'est le document qui a vieilli.
  Signale la contradiction au lieu de la recopier.
- La boucle agit UNE fois par tick, de facon reversible, dans le depot : jamais de push, de
  suppression, de service, ni de `pkill`.
- Termine par la mesure avant/apres et le prochain ecart, jamais un pourcentage de memoire.
