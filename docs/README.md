# Documentation de niers

Neuf documents, un rôle chacun. Ce qui n'y est pas mesurable ou vérifiable n'y a pas sa place :
pas de journal, pas d'historique daté — l'état vient des outils, l'histoire vient de `git log`.

## Commencer ici

| Document | Contenu |
|---|---|
| [PLAN.md](PLAN.md) | **L'objectif et l'état chiffré** : les deux faces (moteur et forge), ce qui est mesuré, les priorités |
| [ARCHITECTURE.md](ARCHITECTURE.md) | **La carte** : les quatre arbres, qui fait autorité sur quoi, les crates, les ponts, les fusions interdites |
| [FORGE.md](FORGE.md) | Produire `nie.exe` au byte près depuis le workspace — le juge du projet |
| [../PROVENANCE.md](../PROVENANCE.md) | D'où vient chaque arbre, ce qui a été écarté à la copie |

## Le moteur

| Document | Contenu |
|---|---|
| [STACK.md](STACK.md) | Les briques runtime, ce qui est écarté et pourquoi, les règles de la boucle et de Lua |
| [DESIGN.md](DESIGN.md) | Rendu pixel-perfect des écrans START et MENU, décomposition par couche |
| [BENCHMARKS.md](BENCHMARKS.md) | Banc d'essai inter-langages des hot paths |

## Le binaire et ses données

| Document | Contenu |
|---|---|
| [RE.md](RE.md) | La cible `nie.exe`, la boucle de reverse, la couverture, ce que le RE a établi |
| [FORMATS.md](FORMATS.md) | Les formats Level-5 et Criware, et l'état du VFS |
| [modele-de-match.md](modele-de-match.md) | Le modèle tir/blocage/but : ce qui est résolu, ce qui reste opaque |
| [game-data/](game-data/) | Les familles `cfg.bin` décrites une par une |
| [nie-rtti-classes.txt](nie-rtti-classes.txt) | Les 1 234 classes RTTI extraites |
| [dll-exports/](dll-exports/) | Exports des DLL tierces (Steam, EOS, curl) |

## Ailleurs dans le dépôt

`../CLAUDE.md` (règles de travail) · `../apps/nie-explorer/ROADMAP.md` (app desktop) ·
`../plugins/niers-plugin/` (plugin et skills).
