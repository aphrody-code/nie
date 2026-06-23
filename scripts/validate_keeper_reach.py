#!/usr/bin/env python3
"""Portée d'arrêt du gardien (FUN_1413dcfe0, fragment 0x1413DD3D5) : reach = min sur les lanes de
(dive * scale). dive = champs du composant keeper (+0x170..) ; scale = DAT_142060e00*DAT_142060e10
(runtime, fourni). mulps (dive*scale) puis cmpps+blendvps (min des 3 lanes). Validé byte-exact via
uemu (vpermilps/blendvps émulés)."""
import struct, sys
from uemu import Emu
e = Emu()
def f32(x): return struct.unpack('<f', struct.pack('<f', x))[0]

def emulate(dive, scale):
    o = e.call(0x1413DD3D5, xmm_in={3: (dive[0], dive[1], dive[2], 0.0),
               1: (scale, scale, scale, scale)}, stop=0x1413DD40E, read_xmm=[2])
    return o['xmm'][2][0], o['error']

def formula(dive, scale):
    p = [f32(dive[i] * scale) for i in range(3)]
    m = p[0]
    if p[1] < m: m = p[1]
    if p[2] < m: m = p[2]
    return m

errs = []
for dive, scale in [((3.,5.,4.), 1.0), ((5.,3.,4.), 2.0), ((1.,2.,9.), 0.5), ((8.,2.,3.), 1.5)]:
    g, err = emulate(dive, scale); ex = formula(dive, scale)
    if err: errs.append('%s: %s' % (dive, err))
    elif struct.pack('<f', g) != struct.pack('<f', ex): errs.append('%s*%s: got %s != %s' % (dive, scale, g, ex))
if errs:
    print('ECHEC keeper reach:'); [print(' -', x) for x in errs]; sys.exit(1)
print('OK VALIDE byte-exact (4 cas) : portee keeper = min(dive*scale) == binaire.')
