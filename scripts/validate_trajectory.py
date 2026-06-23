#!/usr/bin/env python3
"""Validation de TRAJECTOIRE multi-frames des 3 physiques de ballon, contre l'oracle uemu.

Les `scripts/validate_{parabola,lerp,targetfollow}.py` prouvent UNE frame byte-exacte. Ici on prouve
que la physique reproduit le binaire sur **toute la trajectoire** : on émule le vrai `vmethod_3` N fois
en réinjectant l'état muté (vitesse/t) et la position courante frame à frame, et on compare à CHAQUE
frame la formule reversée (f32) à la sortie du binaire — BYTE-EXACT. C'est ce que fait
`nie_core::ball::BallComponent::update` appelé en boucle : on valide donc le câblage runtime, pas juste
une formule isolée.

Émet aussi les vecteurs golden (bits f32) consommés par le test Rust `trajectory_*` de nie-core.
"""
import math
import struct
import sys

from uemu import SCRATCH, Emu

OBJ = SCRATCH
IN = SCRATCH + 0x2000
ENDOBJ = SCRATCH + 0x4000
OUT = SCRATCH + 0x6000


def f32(x):
    return struct.unpack("<f", struct.pack("<f", x))[0]


def bits(x):
    return struct.unpack("<I", struct.pack("<f", x))[0]


def v3(b):
    return struct.unpack("<4f", b)[:3]


e = Emu()
errs = []
golden = {}

# ─── Parabola : p0 réinjecté, vel@0x180 + t@0x190 mutés ──────────────────────────
def parabola():
    accel = (0.0, -9.8, 0.0, 0.0)
    vel = [4.0, 5.0, 6.0, 0.0]
    t, t_max, dt = 0.0, 100.0, 0.5
    pos = [1.0, 2.0, 3.0]
    traj_bin, traj_formula = [], []
    for _ in range(24):
        obj = bytearray(0x200)
        struct.pack_into("<4f", obj, 0x160, *accel)
        struct.pack_into("<4f", obj, 0x180, *vel)
        struct.pack_into("<f", obj, 0x190, t)
        struct.pack_into("<f", obj, 0x170, t_max)
        inp = bytearray(0x40)
        struct.pack_into("<4f", inp, 0x10, pos[0], pos[1], pos[2], 0.0)
        struct.pack_into("<f", inp, 0x38, dt)
        out = e.call(0x141334600, rcx=OBJ, rdx=OUT, r8=IN,
                     mem={OBJ: bytes(obj), IN: bytes(inp), OUT: bytes(16)},
                     read={OUT: 16, OBJ + 0x180: 16, OBJ + 0x190: 4})
        if out["error"]:
            errs.append(f"parabola émul: {out['error']}"); return
        np = list(v3(out["mem"][OUT]))
        # formule reversée (ordre SSE) sur l'état courant
        fp = [f32(f32(f32(f32(0.5 * accel[i]) * dt) * dt) + f32(f32(dt * vel[i]) + pos[i])) for i in range(3)]
        traj_bin.append(np); traj_formula.append(fp)
        # réinjection de l'état muté
        vel = list(struct.unpack("<4f", out["mem"][OBJ + 0x180]))
        t = struct.unpack("<f", out["mem"][OBJ + 0x190])[0]
        pos = np
    for f, (b, fo) in enumerate(zip(traj_bin, traj_formula)):
        for i in range(3):
            if bits(b[i]) != bits(fo[i]):
                errs.append(f"parabola frame {f} [{i}] bin {b[i]} != formule {fo[i]}")
    golden["parabola"] = traj_bin


# ─── Lerp : origin FIXE (end-obj@0x1410), seul t@0xa0 mute ───────────────────────
def lerp():
    target = (10.0, 20.0, 30.0, 0.0)
    origin = (1.0, 2.0, 3.0)
    t, dur, dt = 0.0, 5.0, 0.5
    traj_bin, traj_formula = [], []
    for _ in range(16):
        obj = bytearray(0x100)
        struct.pack_into("<4f", obj, 0x60, *target)
        struct.pack_into("<f", obj, 0xA0, t)
        struct.pack_into("<f", obj, 0xA4, dur)
        inp = bytearray(0x40)
        struct.pack_into("<Q", inp, 0, ENDOBJ)
        struct.pack_into("<f", inp, 0x38, dt)
        eo = bytearray(0x1420)
        struct.pack_into("<4f", eo, 0x1410, origin[0], origin[1], origin[2], 0.0)
        out = e.call(0x141339BA0, rcx=OBJ, rdx=OUT, r8=IN,
                     mem={OBJ: bytes(obj), IN: bytes(inp), ENDOBJ: bytes(eo), OUT: bytes(16)},
                     read={OUT: 16, OBJ + 0xA0: 4})
        if out["error"]:
            errs.append(f"lerp émul: {out['error']}"); return
        np = list(v3(out["mem"][OUT]))
        tn = f32(t + dt)
        s = f32(tn / dur)
        e4 = f32(f32(f32(s - 1.0) * f32(s - 1.0)) * f32(f32(s - 1.0) * f32(s - 1.0)))
        ease = f32(max(min(f32(1.0 - e4), 1.0), 0.0))
        lerped = [f32(math.fma(ease, f32(target[i] - origin[i]), origin[i])) for i in range(3)]
        # Clamp de bord + snap à la complétion (reversé 2026-06-23, bound=0 ici car obj non setté) :
        bound = 0.0
        complete = tn >= dur or ease >= 1.0
        y = bound if (complete or lerped[1] < bound) else lerped[1]
        fp = [lerped[0], y, lerped[2]]
        traj_bin.append(np); traj_formula.append(fp)
        t = struct.unpack("<f", out["mem"][OBJ + 0xA0])[0]
    for f, (b, fo) in enumerate(zip(traj_bin, traj_formula)):
        for i in range(3):
            if bits(b[i]) != bits(fo[i]):
                errs.append(f"lerp frame {f} [{i}] bin {b[i]} != formule {fo[i]}")
    golden["lerp"] = traj_bin


# ─── TargetFollow : origin = pos courante réinjectée, t@0xb4 mute ─────────────────
def targetfollow():
    target = (5.0, 8.0, 5.0)
    bound, flag, dur = 0.0, 0, 4.0
    t, dt = 0.0, 0.5
    pos = [0.0, 0.0, 0.0]
    traj_bin, traj_formula = [], []
    for _ in range(16):
        obj = bytearray(0x100)
        struct.pack_into("<4f", obj, 0x70, target[0], target[1], target[2], 0.0)
        struct.pack_into("<f", obj, 0x94, bound)
        struct.pack_into("<f", obj, 0x98, bound)
        obj[0x9C] = flag
        struct.pack_into("<f", obj, 0xAC, dur)
        struct.pack_into("<f", obj, 0xB4, t)
        inp = bytearray(0x40)
        struct.pack_into("<4f", inp, 0x10, pos[0], pos[1], pos[2], 0.0)
        struct.pack_into("<f", inp, 0x38, dt)
        out = e.call(0x14133C080, rcx=OBJ, rdx=OUT, r8=IN,
                     mem={OBJ: bytes(obj), IN: bytes(inp), OUT: bytes(16)},
                     read={OUT: 16, OBJ + 0xB4: 4}, stub_calls=True)
        if out["error"]:
            errs.append(f"targetfollow émul: {out['error']}"); return
        np = list(v3(out["mem"][OUT]))
        tn = f32(t + dt)
        ty = max(target[1], bound)
        ease = f32(min(max(f32(tn / dur), 0.0), 1.0)) if dur > 0 else 1.0
        tgt = (target[0], ty, target[2])
        fp = [f32(pos[i] + f32(math.fma(f32(tgt[i] - pos[i]), ease, 0.0))) for i in range(3)]
        traj_bin.append(np); traj_formula.append(fp)
        t = struct.unpack("<f", out["mem"][OBJ + 0xB4])[0]
        pos = np
    for f, (b, fo) in enumerate(zip(traj_bin, traj_formula)):
        for i in range(3):
            if bits(b[i]) != bits(fo[i]):
                errs.append(f"targetfollow frame {f} [{i}] bin {b[i]} != formule {fo[i]}")
    golden["targetfollow"] = traj_bin


parabola()
lerp()
targetfollow()

if errs:
    print("ÉCHEC validation trajectoire :")
    for x in errs[:20]:
        print("  -", x)
    sys.exit(1)

for name, traj in golden.items():
    print(f"✓ {name}: {len(traj)} frames byte-exact (binaire == formule reversée, état réinjecté)")

# Dump des bits golden (pour le test Rust nie-core) si --golden.
if "--golden" in sys.argv:
    print("\n// === vecteurs golden (bits f32) — collés dans le test Rust nie-core ===")
    for name, traj in golden.items():
        print(f"// {name}")
        for f, p in enumerate(traj):
            hexs = ", ".join(f"0x{bits(c):08X}" for c in p)
            print(f"    [{hexs}], // frame {f}")
print(f"\n{len(golden)}/3 trajectoires multi-frames validées byte-exact vs le binaire réel.")
