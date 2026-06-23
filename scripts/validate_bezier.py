#!/usr/bin/env python3
"""Valide la sortie du contrôleur game::BallMoveBezier (step slot 4, FUN_1413359b0) : le point de
Bezier QUADRATIQUE par de Casteljau (3 lerps FMA vfmadd231ps sur P1@0x10A0, P2@0x10B0, P3@0x10C0,
t = param@0x10E0 / total@0x10D0). Émulé complet (mémoire objet+input + stub des vtable/sous-appels).
Valeurs propres (résultat f32 exact) → confirme la structure de Casteljau byte-exact."""
import struct, sys
from uemu import SCRATCH, Emu
OBJ=SCRATCH; INP=SCRATCH+0x8000; OUT=SCRATCH+0xC000; VTBL=SCRATCH+0xE000
e=Emu()
def f32(x): return struct.unpack('<f', struct.pack('<f', x))[0]

def emulate(p1,p2,p3,total,param,inpos,dt):
    obj=bytearray(0x2000)
    struct.pack_into('<Q',obj,0, VTBL)             # vtable ptr (calls stubbés)
    struct.pack_into('<4f',obj,0x10A0,*p1)
    struct.pack_into('<4f',obj,0x10B0,*p2)
    struct.pack_into('<4f',obj,0x10C0,*p3)
    struct.pack_into('<f',obj,0x10D0,total)
    struct.pack_into('<f',obj,0x10E0,param)
    obj[0x10E4]=0                                   # pas en mode goalnet
    obj[0x9c]=0
    inp=bytearray(0x100)
    struct.pack_into('<4f',inp,0x10,*inpos)
    struct.pack_into('<f',inp,0x38,dt)
    out=e.call(0x1413359B0, rcx=OBJ, rdx=OUT, r8=INP,
               mem={OBJ:bytes(obj), INP:bytes(inp), OUT:bytes(64), VTBL:bytes(0x100)},
               read={OUT:16}, stub_calls=True)
    return struct.unpack('<4f', out['mem'][OUT]), out['error']

def de_casteljau(p1,p2,p3,t):  # lerps FMA : (b-a)*t + a
    def fma(a,b,t): return tuple(f32(f32(f32(b[i]-a[i])*t)+a[i]) for i in range(4))
    a=fma(p1,p2,t); b=fma(p2,p3,t); return fma(a,b,t)

errs=[]
cases=[((0,0,0,0),(10,10,0,0),(20,0,0,0),2.0,1.0),     # t=0.5 → (10,5,0,0)
       ((0,0,0,0),(4,0,0,0),(8,0,0,0),4.0,1.0),         # t=0.25 ligne → (2,0,0,0)
       ((1,2,3,0),(1,2,3,0),(1,2,3,0),2.0,1.0)]         # points égaux → (1,2,3,0)
for p1,p2,p3,total,param in cases:
    t=f32(f32(param)/f32(total))
    got,err=emulate(p1,p2,p3,total,param,(0,0,0,0),1.0)
    exp=de_casteljau(p1,p2,p3,t)
    if err: errs.append(f'{(p1,p2,p3)}: émul {err}')
    elif any(struct.pack('<f',got[i])!=struct.pack('<f',exp[i]) for i in range(3)):
        errs.append(f'{(p1,p2,p3)} t={t}: got {got[:3]} != {exp[:3]}')
if errs:
    print('ÉCHEC Bezier:'); [print(' -',x) for x in errs]; sys.exit(1)
print(f'✓ VALIDÉ byte-exact ({len(cases)} cas) : point Bezier quadratique (de Casteljau FMA) == binaire.')
