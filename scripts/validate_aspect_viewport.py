#!/usr/bin/env python3
"""Validation byte-exact : calcul de viewport letterbox/pillarbox (`FUN_14045ff50`, 35 callers).

Logique de rendu : ajuste un rectangle de viewport au ratio cible. Dims d'affichage `disp_w`
(`u16 @ mode+0x3a`), `disp_h` (`@ mode+0x3c`) ; ratio `(num=param_2, den=param_3)`. Calcule
`scaled = disp_w*den/num` (arithmétique u32) :
  - `scaled == disp_h` → AUCUN ajustement (champs viewport NON écrits, drapeau inchangé) ;
  - `scaled < disp_h`  → letterbox : rect (x=0, y=(disp_h-scaled)>>1, w=disp_w, h=scaled) ;
  - `scaled > disp_h`  → pillarbox : new_w=disp_h*num/den ; rect (x=(disp_w-new_w)>>1, y=0, w=new_w,
    h=disp_h) ; et `flag(@+0x3ea8) |= 0x100`.
Champs sortie : x@+0x28a0, y@+0x28a4, w@+0x28a8, h@+0x28ac (u32). On force le chemin simple
(drapeau `@+0x3e72 != 0` → pas de sous-struct d'override) et on fuzze (w,h,num,den). Sort 0 si
byte-exact. Miroir = port `nie_core::aspect_viewport`.
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from uemu import Emu, SCRATCH  # noqa: E402

PARAM = SCRATCH + 0x100
MODE = SCRATCH + 0x8000
SENT = 0xDEADBEEF  # sentinelle pour détecter "non écrit"
FLAG0 = 0x0021     # valeur initiale du drapeau +0x3ea8


def emu_calc(e, w, h, num, den):
    param = bytearray(0x4000)
    struct.pack_into("<Q", param, 0x2210, MODE)          # tableau ptr [idx=0] → MODE
    param[0x3e90] = 0                                      # idx = 0
    struct.pack_into("<h", param, 0x3e72, 1)              # flag != 0 → pas d'override
    struct.pack_into("<H", param, 0x3ea8, FLAG0)
    for off in (0x28a0, 0x28a4, 0x28a8, 0x28ac):
        struct.pack_into("<I", param, off, SENT)
    mode = bytearray(0x40)
    struct.pack_into("<H", mode, 0x3a, w)
    struct.pack_into("<H", mode, 0x3c, h)
    mem = {PARAM: bytes(param), MODE: bytes(mode)}
    out = e.call(0x14045FF50, rcx=PARAM, rdx=num & 0xFFFFFFFF, r8=den & 0xFFFFFFFF,
                 mem=mem, read={PARAM + 0x28a0: 16, PARAM + 0x3ea8: 2})
    if out.get("error"):
        raise RuntimeError(out["error"])
    x, y, vw, vh = struct.unpack("<4I", out["mem"][PARAM + 0x28a0])
    flag = struct.unpack("<H", out["mem"][PARAM + 0x3ea8])[0]
    return (x, y, vw, vh, flag)


def mirror_calc(w, h, num, den):
    scaled = (w * den) & 0xFFFFFFFF
    scaled //= num
    if scaled == h:
        return (SENT, SENT, SENT, SENT, FLAG0)  # rien écrit
    flag = FLAG0 | 0x100
    if scaled < h:
        return (0, (h - scaled) >> 1, w, scaled, flag)
    new_w = ((h * num) & 0xFFFFFFFF) // den
    return (((w - new_w) & 0xFFFFFFFF) >> 1, 0, new_w, h, flag)


def lcg(state):
    while True:
        state = (state * 6364136223846793005 + 1442695040888963407) & ((1 << 64) - 1)
        yield (state >> 33) & 0x7FFFFFFF


e = Emu()
rng = lcg(0xA59EC7)
fails = total = 0

# Bords + ratios réels.
fixed = [
    (1920, 1080, 16, 9), (1920, 1080, 4, 3), (1280, 720, 16, 9), (1024, 768, 16, 9),
    (800, 600, 4, 3), (1920, 1080, 1920, 1080), (100, 100, 1, 1), (640, 480, 16, 9),
    (1, 1, 1, 1), (65535, 1, 1, 1), (320, 240, 21, 9),
]
for w, h, num, den in fixed:
    total += 1
    try:
        er = emu_calc(e, w, h, num, den)
    except RuntimeError as ex:
        fails += 1
        print(f"  ✗ ERREUR ({w},{h},{num},{den}): {ex}")
        continue
    mr = mirror_calc(w, h, num, den)
    if er != mr:
        fails += 1
        print(f"  ✗ ({w},{h},{num},{den}): uemu={er} ≠ miroir={mr}")

# Fuzz (w,h u16 ; num,den petits non nuls pour éviter /0 et rester réaliste).
for _ in range(500):
    w = next(rng) % 4096 + 1
    h = next(rng) % 4096 + 1
    num = next(rng) % 64 + 1
    den = next(rng) % 64 + 1
    total += 1
    try:
        er = emu_calc(e, w, h, num, den)
    except RuntimeError as ex:
        fails += 1
        if fails <= 8:
            print(f"  ✗ ERREUR ({w},{h},{num},{den}): {ex}")
        continue
    mr = mirror_calc(w, h, num, den)
    if er != mr:
        fails += 1
        if fails <= 8:
            print(f"  ✗ ({w},{h},{num},{den}): uemu={er} ≠ miroir={mr}")

print(f"aspect viewport (FUN_14045ff50): {total} cas ; {'BYTE-EXACT' if not fails else f'{fails} DIVERGENCES'}")
sys.exit(1 if fails else 0)
