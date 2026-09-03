# `niepy` — niers vu depuis Python

La porte d'entrée Python vers le moteur et les données de *niers*. C'est ce qui permet à un
visual novel Ren'Py d'utiliser le vrai moteur et les vrais assets, sans réimplémenter quoi que
ce soit.

Trois usages, du plus simple au plus engageant :

| Usage | Objet | Ce que ça fait |
|---|---|---|
| Lire le jeu | `Vfs`, `decoder`, `g4tx_vers_png` | Le VFS (packs CPK ou dump) et les décodeurs de formats |
| Faire tourner le jeu | `Match` | La simulation 11 v 11 déterministe, tick par tick |
| Alimenter un VN | `renpy.Catalogue` | Le catalogue d'assets exporté, et la génération de `.rpy` |

## Prérequis

Tout passe par `nie_ffi`, la bibliothèque native construite depuis les crates Rust. Il faut
l'avoir construite au moins une fois :

```bash
cargo build -p nie-ffi --release
```

`niepy` la résout seule : `NIE_FFI_PATH` si elle est posée, sinon `target/release`, sinon
`target/debug`, en remontant les ancêtres jusqu'à la racine du dépôt. **Aucun chemin de
machine n'est écrit en dur.**

> Sur Windows, rustc produit `nie_ffi.dll`, **sans** préfixe `lib`. Chercher `libnie_ffi.dll`
> échoue silencieusement puis casse au premier appel, avec une erreur qui accuse l'appel et
> non la résolution du chemin.

## Faire tourner un match

```python
from niepy import Match

with Match() as m:
    m.avancer(90.0)          # 90 secondes de temps de jeu, à 60 Hz
    print(m.score)           # (domicile, extérieur)
    print(m.porteur)         # indice du joueur qui a le ballon, ou None
```

La simulation est **déterministe** : à `dt` et entrées identiques, deux exécutions donnent la
même suite d'états. C'est ce qui permet à un visual novel de rejouer une action à l'identique,
ou de calculer une issue de match hors écran puis de la raconter.

`m.instantane()` rend l'état complet en dictionnaire, en une seule traversée de frontière —
préférable à une boucle sur `m.joueur(i)` quand on veut tout.

## Lire les données du jeu

```python
from niepy import Vfs

with Vfs() as vfs:
    print(len(vfs), "entrées indexées")
    donnees = vfs.charger("data/common/…")   # lit ET décode selon le format détecté
```

La racine du jeu se résout à l'exécution : argument explicite, puis `NIE_GAME_DIR`, puis
remontée des ancêtres à la recherche de `data/cpk_list.cfg.bin`.

> `Vfs` prend la **racine**, et passe `<racine>/data` à la couche native. Lui donner
> directement le dossier `data` donne « impossible d'ouvrir cpk_list.cfg.bin », une erreur qui
> accuse le fichier.

Le montage « dump » n'indexe rien tant qu'on ne l'énumère pas : `lire()` résout par chemin,
mais `chercher()` et `parcourir()` construisent l'index — des minutes sur 255 000 entrées.

## Alimenter un projet Ren'Py

D'abord produire les assets, depuis la CLI Rust :

```bash
# Les assets : voix, portraits, musique + catalogue.json. En Rust, car il faut lire les CPK.
niers vn export --out <projet-renpy>/game/nie

# Le .rpy qui les déclare, et les données du jeu en JSON. En Python, car c'est un artefact
# du monde Ren'Py.
uv run python -m niepy renpy --out <projet-renpy>/game/nie
uv run python -m niepy data  --out <projet-renpy>/game/nie/data
```

Puis, dans un `init python:` du projet :

```python
from niepy.renpy import Catalogue

catalogue = Catalogue.charger(config.gamedir + "/nie")
perso = catalogue.par_code("c01000010")
```

Le `.rpy` généré est **régénérable** : il ne contient aucune écriture à la main et peut être
réécrit à chaque export sans rien perdre.

## Tests

```bash
uv run --with pytest pytest -q tests/
```

Les tests du moteur ne touchent pas au VFS : ils tournent sans les données du jeu. Ceux du
pont Ren'Py travaillent sur un catalogue synthétique, hors moteur Ren'Py — c'est le seul moyen
d'attraper une erreur de chemin d'asset avant de lancer le jeu.

## Pourquoi `ctypes` et aucune dépendance

Ren'Py embarque son propre Python, où installer des roues tierces est une source d'ennuis sans
fin. `niepy` n'utilise donc que la bibliothèque standard : tout le travail réel est fait par la
couche Rust.
