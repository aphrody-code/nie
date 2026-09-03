"""`niepy` — la porte d'entrée Python vers le moteur et les données de *niers*.

Trois usages, du plus simple au plus engageant :

1. **Lire le jeu** — le VFS et les décodeurs de formats, via `Vfs` et `decoder`.
2. **Faire tourner le jeu** — la simulation de match déterministe, via `Match`.
3. **Alimenter un visual novel** — le catalogue d'assets exporté, via `renpy.Catalogue`.

Tout passe par `nie_ffi`, la bibliothèque native construite depuis les crates Rust du dépôt.
Il faut donc l'avoir construite au moins une fois :

    cargo build -p nie-ffi --release

Exemple complet :

    from niepy import Match, Vfs

    with Vfs() as vfs:
        print(len(vfs), "entrées indexées")

    with Match() as m:
        m.avancer(90.0)
        print("score final", m.score)
"""

from __future__ import annotations

from ._ffi import chemin_bibliotheque
from .formats import decoder, detecter, g4tx_vers_png, nom_format, version
from .match import PAS_PAR_DEFAUT, Ballon, Joueur, Match
from .rendu import ErreurRendu, Rendu, chemin_nie_game
from .renpy import Catalogue, Personnage
from .vfs import Vfs, racine_jeu

__all__ = [
    "PAS_PAR_DEFAUT",
    "Ballon",
    "Catalogue",
    "ErreurRendu",
    "Joueur",
    "Match",
    "Personnage",
    "Rendu",
    "Vfs",
    "chemin_bibliotheque",
    "chemin_nie_game",
    "decoder",
    "detecter",
    "g4tx_vers_png",
    "nom_format",
    "racine_jeu",
    "version",
]

#: Version de la bibliothèque Python. Distincte de `version()`, qui rend celle du crate natif.
__version__ = "0.1.0"
