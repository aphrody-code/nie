# `scripts/` — les scripts du dépôt

Les scripts suivis sont **de la doc exécutable** : ils se rejouent à
l'identique, il se cite en `chemin:ligne`, et il ne repasse pas par le quoting du shell.

| Sous-dossier | Contenu |
|---|---|
| `donnees/` | audits et génération de données dérivées à partir du miroir local |
| `forge/` | outillage autour de la boucle `nie-forge` |
| `ghidra/` | pilotage de `analyzeHeadless`, export de fonctions |
| `validation/` | harnais de validation partagé des preuves uemu |
| `lua/`, `blender/`, `ops/` | codec Lua, extension Blender, exploitation du VPS |

À la racine du dossier se trouvent notamment les preuves `validate_*.py` — les preuves uemu, une
par fonction reversée. Elles sont référencées nommément par `justfile`,
`crates/forge/nie-pe/src/units.rs` et
`crates/forge/nie-forge/src/registry.rs` : leur nom fait partie du contrat, elles ne se
déplacent pas au fil d'un rangement.

Les fichiers de `donnees/` produisent des mesures et des exports locaux à partir du miroir.
Le miroir consommé par les services est sélectionné atomiquement sous `var/`; aucun service
de rotation n'est géré par ce dépôt.

## Python : le fichier, pas la ligne

- Toujours `uv run` ; `python` / `python3` en direct est bloqué par
  `.claude/hooks/garde-bash.sh`.
- **Plus de deux lignes de Python ⇒ un fichier.** Ce n'est pas une question de vitesse
  (l'écart avec `jq` est de quelques dizaines de millisecondes) mais de couches de
  quoting : le corps d'un `python -c` traverse bash d'abord, où `$(…)` est *exécuté* et
  où un antislash disparaît.
- **PEP 723 seulement pour un script autonome.** Un en-tête `# /// script` fait tourner le
  script dans un environnement isolé, donc **sans** le `.venv` du dépôt : un script qui
  importe la toolbox RE (`uemu`, capstone, pefile, unicorn) y meurt en
  `ModuleNotFoundError`. Les 47 `validate_*.py` n'en portent pas, et c'est voulu.

## Publier les binaires du dépôt

`just installer` (→ `scripts/installer-binaires.sh`) publie dans `~/.local/bin` les
binaires Rust de `target/release` et les lanceurs des CLI Bun — **par liens symboliques**,
jamais par copie : une copie se périmerait en silence au prochain
`cargo build --release`. Le script refuse d'écraser un exécutable étranger déjà dans le
PATH.
