#!/usr/bin/env python3
"""Intégration de vitesse du contrôleur game::BallMoveNormal (FUN_14133ae10, lignes 144-163,
écrite AVANT collision/position). Validée byte-exact via uemu (obj[0x18]=0 saute la collision,
input[0]=0 saute la gravité, stub_calls).

  accel = obj[0x88] (si obj[0x9d]!=0) sinon obj[0x84]
  s = (dt·accel + prev_speed(obj[0x50])) · factor(input[0x3c])
  new_speed = |s|  → obj[0x50]
  si |s| > 0 : new_dir = (s/|s|)·dir(obj[0x40..])  (= sign(s)·dir) sinon dir inchangé  → obj[0x40..]
"""
import struct, sys
from uemu import SCRATCH, Emu
OBJ=SCRATCH; INP=SCRATCH+0x8000; OUT=SCRATCH+0xC000
e=Emu()
def f32(x): return struct.unpack('<f', struct.pack('<f', x))[0]

def emulate(dir4, prev_speed, accel, dt, factor):
    obj=bytearray(0x400)
    struct.pack_into('<4f',obj,0x40,*dir4)
    struct.pack_into('<f',obj,0x50,prev_speed)
    struct.pack_into('<f',obj,0x88,accel)   # obj[0x9d]!=0 → utilise 0x88
    obj[0x9d]=1; obj[0x9c]=0; obj[0x18]=0    # 0x18=0 → pas de collision
    inp=bytearray(0x100)
    struct.pack_into('<f',inp,0x38,dt); struct.pack_into('<f',inp,0x3c,factor)
    # input[0]=0 (pas de gravité) ; input[0x10..]=pos quelconque
    struct.pack_into('<4f',inp,0x10,1.0,2.0,3.0,0.0)
    out=e.call(0x14133AE10, rcx=OBJ, rdx=OUT, r8=INP,
               mem={OBJ:bytes(obj),INP:bytes(inp),OUT:bytes(0x100)},
               read={OBJ+0x40:16, OBJ+0x50:4}, stub_calls=True)
    d=struct.unpack('<4f',out['mem'][OBJ+0x40]); s=struct.unpack('<f',out['mem'][OBJ+0x50])[0]
    return d, s, out['error']

def formula(dir4, prev_speed, accel, dt, factor):
    s = f32(f32(f32(dt*accel) + prev_speed) * factor)
    spd = abs(s)
    if spd > 0.0:
        inv = f32(1.0/spd)
        d = tuple(f32(f32(inv*s)*dir4[i]) for i in range(4))
    else:
        d = dir4
    return d, spd

errs=[]
for dir4,ps,acc,dt,fac in [((0.6,0.8,0.,0.),2.0,1.0,0.5,1.0),((0.,1.,0.,0.),0.5,-3.0,0.25,2.0),
                            ((1.,0.,0.,0.),1.0,0.0,0.1,0.0)]:
    (gd,gs,err)=emulate(dir4,ps,acc,dt,fac); (ed,es)=formula(dir4,ps,acc,dt,fac)
    if err: errs.append(f'{dir4}: émul {err}')
    if struct.pack('<f',gs)!=struct.pack('<f',es): errs.append(f'speed {gs}!={es}')
    for i in range(3):
        if struct.pack('<f',gd[i])!=struct.pack('<f',ed[i]): errs.append(f'dir[{i}] {gd[i]}!={ed[i]}')
if errs:
    print('ÉCHEC intégration vitesse Normal:'); [print(' -',x) for x in errs[:8]]; sys.exit(1)
print(f'✓ VALIDÉ byte-exact ({3} cas) : intégration de vitesse BallMoveNormal == binaire.')
