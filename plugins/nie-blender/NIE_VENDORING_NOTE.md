# Note de provenance — `plugins/nie-blender`

Ce dossier vendorise **Level-5 G4 Blender Tools** (auteur : Bobi, dépôt amont
[`The-RealBobi/G4_Blender`](https://github.com/The-RealBobi/G4_Blender), commit `7ac55b7`) comme
fichiers réguliers du dépôt `nie`, plutôt qu'en submodule Git externe.

- Le dépôt amont ne déclare aucune licence (`license: null` côté API GitHub, aucun fichier
  `LICENSE`). La republication de son code dans l'historique de `nie` a été confirmée
  autorisée par le propriétaire du projet `nie` le 2026-08-08 (permission de l'auteur
  obtenue séparément, hors de ce dépôt).
- **`nie_bridge.py`** est un ajout propre à `nie` (pas du code amont) : panneau de
  recherche/import de fichiers VFS via `nie.exe`, cf. son en-tête pour le détail.
- Toute mise à jour du dossier amont doit repasser par la même vérification de permission avant
  d'être vendorisée ici.
