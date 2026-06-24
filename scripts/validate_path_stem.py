#!/usr/bin/env python3
"""Validation byte-exact : extraction du *file-stem* moteur Level-5 (`FUN_140452820`).

Utilitaire de chemin très réutilisé (171 callers) : retire le **répertoire** (dernier `/` ou `\\`)
puis l'**extension finale** (dernier `.`, via le strrchr SSE `FUN_14098f4e0`). = basename sans
dernière extension. L'oracle uemu A CORRIGÉ une mauvaise lecture de la décompile (c'est strrchr, PAS
strchr → on coupe au DERNIER point). Pris dans le binaire réel : uemu prend le chemin SSE de base
(le flag CPU `DAT_141a69618` se lit 0 < 2 → pas de `pcmpistri` SSE4.2 non émulé).

Quirks reproduits exactement : scan du séparateur seulement si `len>2`, sur les indices `[1, len-2]`
(ni l'index 0 ni le dernier caractère ne comptent comme séparateur). Fuzz seedé de chemins variés
+ bords (vide, mono-char, point en tête, séparateur en tête/fin). Sort 0 si byte-exact. Miroir = port.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from uemu import Emu, SCRATCH  # noqa: E402

IN = SCRATCH + 0x100
OUT = SCRATCH + 0x400


def emu_stem(e, s: bytes) -> bytes:
    mem = {IN: s + b"\x00", OUT: b"\x00" * 96}
    out = e.call(0x140452820, rcx=OUT, rdx=IN, mem=mem, read={OUT: 96})
    if out.get("error"):
        raise RuntimeError(out["error"])
    return out["mem"][OUT].split(b"\x00")[0]


def mirror_stem(s: bytes) -> bytes:
    """Miroir du port Rust : basename (dernier sép. dans [1,len-2] si len>2) + strrchr('.')."""
    n = len(s)
    base = s
    if n > 2:
        for i in range(n - 2, 0, -1):  # indices len-2 .. 1
            if s[i] in (0x2F, 0x5C):  # '/' ou '\\'
                base = s[i + 1:]
                break
    dot = base.rfind(b".")
    return base if dot < 0 else base[:dot]


def lcg(state):
    while True:
        state = (state * 6364136223846793005 + 1442695040888963407) & ((1 << 64) - 1)
        yield (state >> 33) & 0x7FFFFFFF


ALPHABET = b"ab._/\\09"  # dense en séparateurs, points et alphanumérique
e = Emu()
rng = lcg(0x57E3)
fails = total = 0

# Bords explicites + cas réels d'assets.
fixed = [
    b"", b"a", b".", b"..", b"a.", b".a", b"a.b", b"x/", b"/x", b"\\", b"a/b/c",
    b"data/menu/main_menu_1.02.lua.bin", b"foo\\bar.baz.qux", b"noext",
    b"chr/k0001/k0001.g4mdl", b"a/.config", b"...", b"a..b", b"/", b"//",
]
for s in fixed:
    total += 1
    try:
        er = emu_stem(e, s)
    except RuntimeError as ex:
        fails += 1
        print(f"  ✗ ERREUR uemu sur {s!r}: {ex}")
        continue
    mr = mirror_stem(s)
    if er != bytes(mr):
        fails += 1
        print(f"  ✗ {s!r}: uemu={bytes(er)!r} ≠ miroir={bytes(mr)!r}")

# Fuzz aléatoire.
for _ in range(1200):
    ln = next(rng) % 24
    s = bytes(ALPHABET[next(rng) % len(ALPHABET)] for _ in range(ln))
    total += 1
    try:
        er = emu_stem(e, s)
    except RuntimeError as ex:
        fails += 1
        if fails <= 8:
            print(f"  ✗ ERREUR uemu sur {s!r}: {ex}")
        continue
    mr = mirror_stem(s)
    if er != bytes(mr):
        fails += 1
        if fails <= 8:
            print(f"  ✗ {s!r}: uemu={bytes(er)!r} ≠ miroir={bytes(mr)!r}")

print(f"path stem (FUN_140452820): {total} cas ; {'BYTE-EXACT' if not fails else f'{fails} DIVERGENCES'}")
sys.exit(1 if fails else 0)
