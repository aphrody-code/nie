"""Tests adossés au VRAI jeu — sautés, bruyamment, quand les données sont absentes.

Un test qui se saute en silence est un faux vert : la raison du saut est donc toujours dite.
"""

from __future__ import annotations

import pytest

pytest.importorskip("niepy")

from niepy import Vfs, decoder, detecter, nom_format, racine_jeu  # noqa: E402
from niepy.__main__ import FAMILLES  # noqa: E402


def _vfs_ou_saut() -> Vfs:
    """Monte le VFS, ou saute le test en disant pourquoi."""
    try:
        return Vfs()
    except FileNotFoundError as erreur:
        pytest.skip(f"jeu absent de cette machine — {erreur}")
    except RuntimeError as erreur:
        pytest.skip(f"VFS non montable — {erreur}")


def test_racine_du_jeu_resolue() -> None:
    try:
        racine = racine_jeu()
    except FileNotFoundError as erreur:
        pytest.skip(f"jeu absent — {erreur}")
    assert racine.is_dir()


def test_index_non_vide() -> None:
    with _vfs_ou_saut() as vfs:
        assert len(vfs) > 100_000, "l'index complet compte des centaines de milliers d'entrées"


def test_tranches_de_lindex() -> None:
    """`entrees` rend bien une tranche, et deux tranches consécutives ne se recouvrent pas."""
    with _vfs_ou_saut() as vfs:
        premiere = vfs.entrees(0, 10)
        seconde = vfs.entrees(10, 10)
        assert len(premiere) == 10
        assert len(seconde) == 10
        assert {e["path"] for e in premiere}.isdisjoint({e["path"] for e in seconde})
        assert all({"path", "size"} <= set(e) for e in premiere)


def test_chaque_famille_exportable_existe() -> None:
    """Chaque dossier déclaré dans `FAMILLES` porte au moins un `.cfg.bin` dans ce jeu.

    C'est le test qui attrape un chemin VFS inventé : les noms de fichiers du jeu portent un
    numéro de version (`chara_base_1.03.98.00.cfg.bin`), donc seul le DOSSIER est stable.
    """
    with _vfs_ou_saut() as vfs:
        prefixes = {famille: 0 for famille in FAMILLES}
        for entree in vfs.parcourir():
            chemin = entree.get("path", "")
            if not chemin.endswith(".cfg.bin"):
                continue
            for famille, prefixe in FAMILLES.items():
                if chemin.startswith(prefixe):
                    prefixes[famille] += 1

    vides = [famille for famille, n in prefixes.items() if n == 0]
    assert not vides, f"famille(s) sans aucun fichier : {vides} (chemin VFS faux ?)"


def test_lecture_et_decodage_dun_cfgbin() -> None:
    """Un `.cfg.bin` du jeu se lit et se décode en structure Python."""
    with _vfs_ou_saut() as vfs:
        chemin = None
        for entree in vfs.parcourir():
            candidat = entree.get("path", "")
            if candidat.startswith(FAMILLES["objets"]) and candidat.endswith(".cfg.bin"):
                chemin = candidat
                break
        if chemin is None:
            pytest.skip("aucun cfg.bin d'objets dans cette installation")

        brut = vfs.lire(chemin)
        assert brut, "fichier non vide"
        assert nom_format(detecter(brut)) != "inconnu", "format reconnu"

        decode = decoder(brut)
        assert isinstance(decode, (dict, list)), "le décodage rend une structure"


def test_fichier_absent_leve_proprement() -> None:
    with _vfs_ou_saut() as vfs:
        with pytest.raises(FileNotFoundError):
            vfs.lire("data/ceci/n/existe/pas.cfg.bin")
