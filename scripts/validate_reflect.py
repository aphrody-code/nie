#!/usr/bin/env python3
"""Réflexion de collision de game::BallMoveNormal (FUN_14133ae10, 0x14133B829) : v - 2·(v·n)·n.
dot via haddps (w zéro), 2·dot via addss, broadcast, mul par n, sub de v. Validé byte-exact via XMM."""
import struct, sys
from uemu import Emu
e = Emu()
def f32(x): return struct.unpack('<f', struct.pack('<f', x))[0]

def emulate(v, n):
    o = e.call(0x14133B829, xmm_in={7: (v[0], v[1], v[2], 0.0), 8: (n[0], n[1], n[2], 0.0)},
               stop=0x14133B857, read_xmm=[7])
    return o['xmm'][7], o['error']

def formula(v, n):
    dot = f32(f32(f32(v[0]*n[0]) + f32(v[1]*n[1])) + f32(f32(v[2]*n[2]) + 0.0))
    td = f32(dot + dot)
    return tuple(f32(v[i] - f32(td * n[i])) for i in range(3))

errs = []
for v, n in [((1.,2.,3.), (0.,1.,0.)), ((3.,4.,0.), (1.,0.,0.)), ((1.,-1.,2.), (0.6,0.8,0.))]:
    g, err = emulate(v, n); ex = formula(v, n)
    if err: errs.append('%s: %s' % (v, err))
    elif any(struct.pack('<f', g[i]) != struct.pack('<f', ex[i]) for i in range(3)):
        errs.append('%s,%s: got %s != %s' % (v, n, g[:3], ex))
if errs:
    print('ECHEC reflect:'); [print(' -', x) for x in errs]; sys.exit(1)
print('OK VALIDE byte-exact (3 cas) : reflexion v-2(v.n)n BallMoveNormal == binaire.')
