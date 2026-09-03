"""Le moteur de match : une simulation 11 v 11 déterministe, avancée tick par tick.

C'est la partie qui **tourne**, par opposition au reste de `niepy` qui lit des assets. Le
déterminisme est le contrat : à `dt` et entrées identiques, deux exécutions donnent la même
suite d'états — ce qui permet à un visual novel de rejouer une action à l'identique, ou de
calculer une issue de match hors écran puis de la raconter.

    with Match() as m:
        m.avancer(90.0)
        print(m.score)
"""

from __future__ import annotations

import ctypes
import json
from dataclasses import dataclass
from types import TracebackType
from typing import Any

from ._ffi import NieBall, NieBytes, NiePlayer, bibliotheque
from .formats import prendre_octets

__all__ = ["Ballon", "Joueur", "Match", "PAS_PAR_DEFAUT", "ROLES"]

#: Pas de simulation par défaut (secondes) — 60 Hz, la cadence à laquelle le moteur est réglé.
PAS_PAR_DEFAUT = 1.0 / 60.0

#: Rôles, dans l'ordre du discriminant rendu par la couche native.
ROLES = ("GK", "DF", "MF", "FW")


@dataclass(frozen=True, slots=True)
class Joueur:
    """Un joueur à un instant donné. Positions en mètres, origine au centre du terrain."""

    x: float
    y: float
    vx: float
    vy: float
    team: int
    role: str

    @property
    def domicile(self) -> bool:
        """`True` si le joueur est de l'équipe qui attaque vers les `x` positifs."""
        return self.team == 0


@dataclass(frozen=True, slots=True)
class Ballon:
    """Le ballon à un instant donné. `z` est la hauteur au-dessus du sol."""

    x: float
    y: float
    z: float
    vx: float
    vy: float
    vz: float


class Match:
    """Une partie en cours. À utiliser comme gestionnaire de contexte."""

    def __init__(self) -> None:
        """Crée un match au coup d'envoi."""
        handle = bibliotheque().nie_world_new()
        if not handle:
            raise RuntimeError("création du monde de match impossible")
        self._handle: int | None = handle

    def _vivant(self) -> int:
        if self._handle is None:
            raise RuntimeError("ce Match est terminé (handle libéré)")
        return self._handle

    # ── Pilotage ─────────────────────────────────────────────────────────────

    def coup_denvoi(self) -> None:
        """Remet le match au coup d'envoi, score et chronomètre compris."""
        bibliotheque().nie_world_kickoff(self._vivant())

    def pas(self, dt: float = PAS_PAR_DEFAUT) -> None:
        """Avance la simulation d'un pas de `dt` secondes."""
        bibliotheque().nie_world_step(self._vivant(), ctypes.c_float(dt))

    def avancer(self, secondes: float, dt: float = PAS_PAR_DEFAUT) -> None:
        """Avance de `secondes` de temps de jeu, par pas de `dt`.

        Le nombre de pas est calculé une fois, pour que deux appels de même durée fassent
        exactement le même nombre d'itérations — sinon le déterminisme est perdu par une
        accumulation de flottants.
        """
        if dt <= 0.0:
            raise ValueError("dt doit être strictement positif")
        for _ in range(int(round(secondes / dt))):
            self.pas(dt)

    def commander(self, dx: float = 0.0, dy: float = 0.0, tirer: bool = False) -> None:
        """Pose l'entrée du joueur contrôlé : direction souhaitée et ordre de frappe."""
        bibliotheque().nie_world_set_input(
            self._vivant(), ctypes.c_float(dx), ctypes.c_float(dy), ctypes.c_bool(tirer)
        )

    # ── Lecture d'état ───────────────────────────────────────────────────────

    @property
    def temps(self) -> float:
        """Temps de jeu écoulé, en secondes."""
        return float(bibliotheque().nie_world_time(self._vivant()))

    @property
    def tick(self) -> int:
        """Numéro du tick courant — le compteur qui atteste du déterminisme."""
        return int(bibliotheque().nie_world_tick(self._vivant()))

    @property
    def score(self) -> tuple[int, int]:
        """Score `(domicile, extérieur)`."""
        domicile = ctypes.c_uint32()
        exterieur = ctypes.c_uint32()
        bibliotheque().nie_world_score(
            self._vivant(), ctypes.byref(domicile), ctypes.byref(exterieur)
        )
        return domicile.value, exterieur.value

    @property
    def porteur(self) -> int | None:
        """Indice du joueur qui possède le ballon, ou `None` si le ballon est libre."""
        i = int(bibliotheque().nie_world_possessor(self._vivant()))
        return None if i < 0 else i

    @property
    def ballon(self) -> Ballon:
        """État du ballon."""
        brut = NieBall()
        bibliotheque().nie_world_ball(self._vivant(), ctypes.byref(brut))
        return Ballon(brut.x, brut.y, brut.z, brut.vx, brut.vy, brut.vz)

    def __len__(self) -> int:
        """Nombre de joueurs sur le terrain."""
        return int(bibliotheque().nie_world_player_count(self._vivant()))

    def joueur(self, i: int) -> Joueur:
        """Joueur d'indice `i`. Lève `IndexError` hors bornes."""
        brut = NiePlayer()
        if not bibliotheque().nie_world_player(self._vivant(), i, ctypes.byref(brut)):
            raise IndexError(f"aucun joueur d'indice {i}")
        role = ROLES[brut.role] if brut.role < len(ROLES) else "?"
        return Joueur(brut.x, brut.y, brut.vx, brut.vy, brut.team, role)

    def joueurs(self) -> list[Joueur]:
        """Tous les joueurs, dans l'ordre du moteur."""
        return [self.joueur(i) for i in range(len(self))]

    def instantane(self) -> dict[str, Any]:
        """État complet en dictionnaire — la voie pratique pour journaliser ou rejouer.

        Passe par le JSON de la couche native : une seule traversée de frontière au lieu
        d'une par joueur.
        """
        sortie = NieBytes()
        bibliotheque().nie_world_snapshot_json_out(self._vivant(), ctypes.byref(sortie))
        brut = prendre_octets(sortie)
        if not brut:
            raise RuntimeError("instantané du match indisponible")
        return json.loads(brut)

    # ── Cycle de vie ─────────────────────────────────────────────────────────

    def terminer(self) -> None:
        """Libère le handle natif. Idempotent."""
        if self._handle is not None:
            bibliotheque().nie_world_free(self._handle)
            self._handle = None

    def __enter__(self) -> "Match":
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.terminer()

    def __del__(self) -> None:
        try:
            self.terminer()
        except Exception:
            pass
