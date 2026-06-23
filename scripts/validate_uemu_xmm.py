#!/usr/bin/env python3
"""Valide l'extension uemu d'injection/lecture XMM0-15 (enabler pour la math SSE inlinée).
Émule des FRAGMENTS binaires réels à résultat connu (entrées en registres XMM)."""
import struct, sys
from uemu import Emu

e = Emu()
def f32(x): return struct.unpack("<f", struct.pack("<f", x))[0]
errs = []

# (1) dist² de Goalnet : insertps(zéro-w);mulps;haddps;haddps sur xmm0=[dx,dy,dz,garbage].
# Plage 0x141338636 (insertps) → 0x141338647 (comiss, stop). Résultat xmm0[0] = (dx²+dy²)+(dz²+0).
for dx, dy, dz in [(3.0, 4.0, 0.0), (1.0, -2.0, 2.0), (5.5, 0.25, -1.5)]:
    out = e.call(0x141338636, xmm_in={0: (dx, dy, dz, 99.0)}, stop=0x141338647, read_xmm=[0])
    got = out["xmm"][0][0]
    exp = f32(f32(f32(dx*dx) + f32(dy*dy)) + f32(f32(dz*dz) + 0.0))
    if struct.pack("<f", got) != struct.pack("<f", exp):
        errs.append(f"dist² ({dx},{dy},{dz}): got {got} != {exp}")

# (2) round-trip registre haut : movaps xmm0,xmm5 (0x14133945A→0x14133945D). Inject xmm5, lire xmm0.
out = e.call(0x14133945A, xmm_in={5: (1.5, 2.5, 3.5, 4.5)}, stop=0x14133945D, read_xmm=[0])
if out["xmm"][0] != (1.5, 2.5, 3.5, 4.5):
    errs.append(f"xmm5→xmm0 roundtrip: got {out['xmm'][0]} != (1.5,2.5,3.5,4.5)")

if errs:
    print("ÉCHEC extension xmm uemu :")
    for x in errs: print("  -", x)
    sys.exit(1)
print("✓ VALIDÉ : extension uemu injection/lecture XMM0-15 (dist² Goalnet + round-trip xmm5).")
print("→ enabler pour extraire la math SSE inlinée (normalisation Rate/Dribble, etc.).")
