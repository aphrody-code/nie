#!/usr/bin/env python3
"""Validation byte-exact : décodeur de valeurs typées de l'objet-menu (`FUN_141290fc0`).

Le tick de `CMenuStateMachine` lit 9 champs typés (tag @ +0, valeur @ +4, stride 0x14 depuis
+0x28) et écrit 9 paramètres runtime en +0x590..+0x5ba. On émule la fonction sur une struct
synthétique (arrêt à 0x1412911bb, juste avant `FUN_14108d550` — tous les paramètres écrits) et on
compare la plage +0x590..+0x5bb au décodage reversé (miroir du port `nie_core::menu_setting`).

Sort 0 si byte-exact. Couvre les tags 0/1/2/3 et le chemin tag-4 garde-nulle (le tag-4 résolu
appelle `FUN_140453910`, résolveur externe non émulable en isolation).
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from uemu import Emu, SCRATCH  # noqa: E402

LV = SCRATCH
P2 = SCRATCH + 0x4000
P1 = SCRATCH + 0x8000
STOP = 0x1412911BB
SLOTS = [(0x28, 0x2C), (0x3C, 0x40), (0x50, 0x54), (0x64, 0x68), (0x78, 0x7C),
         (0x8C, 0x90), (0xA0, 0xA4), (0xB4, 0xB8), (0xC8, 0xCC)]


def reversed_decode(fields):
    """Miroir Python du port Rust (le décodage reversé attendu)."""
    def di(f):  # entier tag 1/2
        return f[1] if f[0] in (1, 2) else 0

    def dr(f):  # résolvable (garde-nulle uniquement ici)
        return f[1] if f[0] in (1, 2) else 0  # tag 4 garde-nulle → 0

    def df(f):  # flottant
        if f[0] == 3:
            return struct.unpack("<f", struct.pack("<I", f[1] & 0xFFFFFFFF))[0]
        if f[0] == 1:
            return float(struct.unpack("<i", struct.pack("<I", f[1] & 0xFFFFFFFF))[0])
        return 0.0
    s = lambda x: struct.unpack("<i", struct.pack("<I", x & 0xFFFFFFFF))[0]
    return {
        0x594: s(di(fields[0])), 0x598: s(di(fields[1])),
        0x5B4: di(fields[2]) & 0xFF, 0x59C: s(dr(fields[3])),
        0x590: s(dr(fields[4])), 0x5A0: s(dr(fields[5])),
        0x5A4: (fields[6][1] if fields[6][0] in (1, 2) else 0) & 0xFFFFFFFF,
        0x5A8: df(fields[7]), 0x5BA: 1 if di(fields[8]) != 0 else 0, 0x5B5: 0,
    }


def emulate(e, fields):
    buf = bytearray(0x2440)
    for (tag, raw), (to, vo) in zip(fields, SLOTS):
        struct.pack_into("<i", buf, to, tag)
        struct.pack_into("<I", buf, vo, raw & 0xFFFFFFFF)
    out = e.call(0x141290FC0, rcx=P1, rdx=P2,
                 mem={LV: bytes(buf), P2: struct.pack("<Q", LV)},
                 read={LV + 0x590: 0x2C}, stop=STOP)
    b = out["mem"][LV + 0x590]
    g = lambda o, f="<i": struct.unpack_from(f, b, o - 0x590)[0]
    return {0x590: g(0x590), 0x594: g(0x594), 0x598: g(0x598), 0x59C: g(0x59C),
            0x5A0: g(0x5A0), 0x5A4: g(0x5A4, "<I"), 0x5A8: g(0x5A8, "<f"),
            0x5B4: b[0x5B4 - 0x590], 0x5B5: b[0x5B5 - 0x590], 0x5BA: b[0x5BA - 0x590]}


VECTORS = [
    [(2, 0x11111111), (1, 0x22222222), (2, 0x000000AB), (2, 0x33333333), (1, 0x44444444),
     (4, 0x00000000), (2, 0xDEADBEEF), (3, struct.unpack("<I", struct.pack("<f", 2.5))[0]), (2, 5)],
    [(0, 0x99999999), (2, 0x7FFFFFFF), (1, 0x00000102), (1, 0x55555555), (2, 0x66666666),
     (2, 0x77777777), (1, 0x0000000A), (1, 7), (2, 0)],
    [(3, struct.unpack("<I", struct.pack("<f", -1.5))[0]), (0, 0), (2, 0xFFFFFF80), (0, 0),
     (0, 0), (0, 0), (2, 0x80000000), (0, 0), (1, 0xFFFFFFFF)],
]

e = Emu()
fails = 0
for i, vec in enumerate(VECTORS):
    got = emulate(e, vec)
    exp = reversed_decode(vec)
    for off, ev in exp.items():
        gv = got[off]
        same = (abs(gv - ev) < 1e-9) if off == 0x5A8 else (gv == ev)
        if not same:
            fails += 1
            print(f"  ✗ V{i} +{off:#x}: uemu={gv!r} ≠ reversé={ev!r}")
print(f"menu_setting: {len(VECTORS)} vecteurs × 10 champs ; {'BYTE-EXACT' if not fails else f'{fails} DIVERGENCES'}")
sys.exit(1 if fails else 0)
