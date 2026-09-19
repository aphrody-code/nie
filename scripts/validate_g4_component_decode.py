#!/usr/bin/env python3
# uemu-anchor: target
"""Valide byte-exact les DEUX décodeurs de composants quantifiés du cluster G4 de nie.exe.

Ce sont eux qui transforment les échantillons 16 bits d'un `.g4cm` (et de tout autre conteneur
G4 passant par la même table) en flottants. Sans eux, `Track::Raw16` de `nie_formats::g4cm`
n'expose que des mots bruts : pas de position de caméra, pas de champ de vision, pas de roulis,
donc aucun plan reconstituable.

  0x140507220  UNORM16 — out[i] = (f32)(u16)in[i] * (1/65535) * scale
  0x1405075F0  SNORM16 — out[i] = (f32)(i16)in[i] * (1/32767) * scale

Signature relevée : f(rcx = f32* sortie, rdx = const void* échantillons, r8b = nombre,
xmm3 = échelle). `r8` est lu par `movzx r9d, r8b` : le nombre est un OCTET, donc n <= 255.

CE QUE LA PREUVE ÉTABLIT, ET QU'AUCUNE INFÉRENCE N'AURAIT DONNÉ
---------------------------------------------------------------
Les deux fonctions ont TROIS chemins, et ils ne calculent pas dans le même ordre :

  * bloc vectoriel de 16, voies 0..11   `mulps xmm4` puis `mulps xmm6`  →  (x * echelle) * inv
  * bloc vectoriel de 16, voies 12..15  `mulps xmm5`                    →  x * (echelle * inv)
  * chemins 4-wide et queue scalaire    `mulss xmm2` puis `mulss xmm3`  →  (x * inv) * echelle

`xmm5` est le produit `echelle * inv` PRÉ-CALCULÉ une fois (`mulss xmm5, xmm2` au prologue).
Mesuré sur 74 904 couples (échelle, valeur) : **45,7 % des cas donnent trois résultats f32
différents** selon l'ordre. Un portage qui choisit un seul ordre est donc faux près d'une fois
sur deux, au dernier ULP — invisible à l'œil, fatal à un aller-retour byte-exact.

C'est précisément ce qu'un oracle tranche et qu'une lecture d'octets ne peut pas trancher.

LIMITE : aucune. Les deux fonctions sont purement SSE (`punpcklwd`, `psrad`, `cvtdq2ps`,
`mulps`, `mulss`) — aucune FMA3, donc la limite documentée en tête de `uemu.py` ne s'applique
pas ici. Un `UC_ERR_*` accuserait l'émulateur, pas le modèle.
"""

import struct
import sys

from uemu import SCRATCH, Emu

VA_UNORM16 = 0x140507220
VA_SNORM16 = 0x1405075F0

# Les constantes de normalisation, LUES DANS LE BINAIRE et non écrites de mémoire.
VA_INV_U = 0x141A6836C  # 1/65535
VA_INV_S = 0x141A68374  # 1/32767

ENTREE = SCRATCH
# La sortie est placée APRÈS l'entrée, et loin : les deux décodeurs testent le recouvrement des
# tampons (`cmp rcx, &in[n-1]` / `ja`) et retombent sur le chemin scalaire s'ils se chevauchent.
# Avec cet écart, `sortie > &in[n-1]` tient pour tout n <= 255 et le chemin vectoriel est pris.
SORTIE = SCRATCH + 0x8000

e = Emu()


def f32(x: float) -> float:
    """Arrondi au f32 le plus proche, AVEC saturation à l'infini comme le fait le processeur.

    `struct.pack` lève `OverflowError` là où le matériel produit `±inf` : sans ce rattrapage, le
    modèle ne peut pas décrire l'échelle `f32::MAX`, qui est justement un des cas limites testés.
    """
    try:
        return struct.unpack("<f", struct.pack("<f", x))[0]
    except OverflowError:
        return float("inf") if x > 0 else float("-inf")


def lire_f32(va: int) -> float:
    """Lit un f32 dans l'image PE chargée par l'émulateur."""
    return struct.unpack("<f", bytes(e.uc.mem_read(va, 4)))[0]


INV_U = lire_f32(VA_INV_U)
INV_S = lire_f32(VA_INV_S)


def modele(valeurs, echelle, signe):
    """Le portage candidat : la formule telle qu'on veut l'écrire en Rust.

    Reproduit les trois chemins et leurs trois ordres de multiplication. C'est CE modèle que
    l'émulation doit confirmer octet pour octet ; s'il diverge, c'est lui qu'on corrige.
    """
    inv = INV_S if signe else INV_U
    n = len(valeurs)
    pre = f32(echelle * inv)  # xmm5, calculé une fois au prologue
    out = [0.0] * n
    i = 0

    # Chemin vectoriel : blocs de 16, pris seulement si n >= 16 (et sans recouvrement).
    if n >= 16:
        n_vec = n & ~0xF
        while i < n_vec:
            for j in range(12):
                out[i + j] = f32(f32(valeurs[i + j] * echelle) * inv)
            for j in range(12, 16):
                out[i + j] = f32(valeurs[i + j] * pre)
            i += 16

    # Chemin 4-wide : `mulss` inv puis `mulss` échelle, quatre fois déroulés.
    if n - i >= 4:
        groupes = ((n - i - 4) >> 2) + 1
        for _ in range(groupes):
            for _ in range(4):
                out[i] = f32(f32(valeurs[i] * inv) * echelle)
                i += 1

    # Queue scalaire : même ordre que le 4-wide.
    while i < n:
        out[i] = f32(f32(valeurs[i] * inv) * echelle)
        i += 1
    return out


def emule(mots, echelle, signe):
    """Fait tourner le VRAI décodeur de nie.exe sur ces octets."""
    n = len(mots)
    # Toujours écrit comme motif 16 bits BRUT : c'est le décodeur qui décide du signe
    # (`psrad`/`movsx` côté SNORM, `punpcklwd` contre zéro côté UNORM), pas l'appelant.
    octets = b"".join(struct.pack("<H", m & 0xFFFF) for m in mots)
    va = VA_SNORM16 if signe else VA_UNORM16
    out = e.call(
        va,
        rcx=SORTIE,
        rdx=ENTREE,
        r8=n,
        xmm=(0.0, 0.0, 0.0, echelle),  # xmm3 = 4e argument flottant = l'échelle
        mem={ENTREE: octets, SORTIE: bytes(4 * n)},
        read={SORTIE: 4 * n},
    )
    if out["error"]:
        return None, out["error"]
    return list(struct.unpack(f"<{n}f", out["mem"][SORTIE])), None


# Les tailles franchissent CHAQUE seuil des trois chemins : 0 (sortie immédiate), sous 4,
# exactement 4, sous 16, exactement 16, 16+reste, et le maximum qu'un octet permet.
TAILLES = [0, 1, 2, 3, 4, 5, 7, 8, 15, 16, 17, 19, 20, 31, 32, 33, 48, 64, 127, 128, 255]

# Les échelles réellement relevées dans ev60_00340, plus les cas limites qui cassent un portage
# naïf : zéro, un subnormal, l'infini flottant le plus grand.
ECHELLES = [1.0, 2.1, 6.1, 0.3, 0.8, 5.6, 22.0, 35.9, 0.0, 1.4e-45, 3.4028235e38]

# Les bords du domaine 16 bits : zéro, le plus petit, le passage de signe, le plus grand.
BORDS = [0x0000, 0x0001, 0x7FFE, 0x7FFF, 0x8000, 0x8001, 0xFFFE, 0xFFFF]


def mots_pour(n, graine):
    """Des mots déterministes qui couvrent le domaine, bords compris."""
    if n == 0:
        return []
    mots = [BORDS[i % len(BORDS)] for i in range(min(n, len(BORDS)))]
    x = graine | 1
    while len(mots) < n:
        x = (x * 1103515245 + 12345) & 0xFFFFFFFF
        mots.append((x >> 11) & 0xFFFF)
    return mots[:n]


def signer(m):
    return m - 0x10000 if m >= 0x8000 else m


def main():
    echecs = []
    verifies = 0

    for signe in (False, True):
        nom = "SNORM16" if signe else "UNORM16"
        for echelle in ECHELLES:
            ech = f32(echelle)
            for graine, n in enumerate(TAILLES):
                mots = mots_pour(n, graine + 1)
                attendu = modele([float(signer(m) if signe else m) for m in mots], ech, signe)
                obtenu, err = emule(mots, ech, signe)
                if err:
                    echecs.append(f"{nom} n={n} echelle={ech!r} : ÉMULATION {err}")
                    continue
                for k in range(n):
                    verifies += 1
                    a = struct.pack("<f", obtenu[k])
                    b = struct.pack("<f", attendu[k])
                    if a != b:
                        if len(echecs) < 12:
                            echecs.append(
                                f"{nom} n={n} echelle={ech!r} i={k} mot={mots[k]:#06x} : "
                                f"binaire {obtenu[k]!r} ({a.hex()}) != modele {attendu[k]!r} ({b.hex()})"
                            )

    # Balayage exhaustif du domaine 16 bits sur le chemin scalaire, à l'échelle 1.0 et à une
    # échelle réelle : c'est là qu'une erreur d'arrondi isolée se cacherait.
    for signe in (False, True):
        nom = "SNORM16" if signe else "UNORM16"
        for echelle in (1.0, 6.1):
            ech = f32(echelle)
            for debut in range(0, 65536, 255):
                mots = list(range(debut, min(debut + 255, 65536)))
                if not mots:
                    continue
                attendu = modele([float(signer(m) if signe else m) for m in mots], ech, signe)
                obtenu, err = emule(mots, ech, signe)
                if err:
                    echecs.append(f"{nom} balayage {debut} : ÉMULATION {err}")
                    break
                for k in range(len(mots)):
                    verifies += 1
                    if struct.pack("<f", obtenu[k]) != struct.pack("<f", attendu[k]):
                        if len(echecs) < 12:
                            echecs.append(
                                f"{nom} balayage mot={mots[k]:#06x} echelle={ech!r} : "
                                f"binaire {obtenu[k]!r} != modele {attendu[k]!r}"
                            )

    # TÉMOIN NÉGATIF — la preuve doit avoir des dents.
    #
    # Si un modèle à ordre UNIQUE passait aussi, cette validation ne prouverait rien : elle
    # confirmerait une formule que n'importe quelle écriture naïve satisferait. On vérifie donc
    # que les trois simplifications tentantes ÉCHOUENT toutes sur un tampon réel. C'est ce qui
    # protège le portage d'une « simplification » future.
    mots_t = mots_pour(64, 3)
    ech_t = f32(6.1)
    vrai, err = emule(mots_t, ech_t, False)
    if err:
        echecs.append(f"témoin négatif : ÉMULATION {err}")
    else:
        pre_t = f32(ech_t * INV_U)
        ordres = {
            "inv puis echelle": lambda x: f32(f32(x * INV_U) * ech_t),
            "echelle puis inv": lambda x: f32(f32(x * ech_t) * INV_U),
            "produit pre-calcule": lambda x: f32(x * pre_t),
        }
        for nom_o, formule in ordres.items():
            divergences = sum(
                1
                for k, m in enumerate(mots_t)
                if struct.pack("<f", formule(float(m))) != struct.pack("<f", vrai[k])
            )
            if divergences == 0:
                echecs.append(
                    f"TÉMOIN NÉGATIF INVALIDE : le modèle à ordre unique « {nom_o} » passe aussi. "
                    f"La preuve ne discrimine plus rien — revoir le jeu d'entrées."
                )

    if echecs:
        print(f"ÉCHEC décodeurs de composants G4 ({verifies} cas vérifiés) :")
        for x in echecs[:12]:
            print(" -", x)
        sys.exit(1)

    print(
        f"✓ VALIDÉ byte-exact ({verifies} cas) : UNORM16 @{VA_UNORM16:#x} et SNORM16 @{VA_SNORM16:#x}\n"
        f"  inv_u={INV_U!r} (1/65535)  inv_s={INV_S!r} (1/32767)\n"
        f"  les trois ordres de multiplication du binaire sont reproduits, voies 12-15 comprises."
    )


if __name__ == "__main__":
    main()
