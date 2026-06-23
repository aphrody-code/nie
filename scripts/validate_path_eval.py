#!/usr/bin/env python3
"""Path-eval cinématique de game::BallMoveRate (FUN_1413428b0), validé byte-exact via uemu APRÈS
résolution de la gravité runtime : DAT_142157570 = (0,1,0,0) (axe Y), copié à l'init depuis une const
.rdata (movaps à 0x140027528). On REPRODUIT l'init en posant cette const, puis on émule (param_4=accel
fourni → pas de sous-appels monde ; param_5=t>0 sur la pile Win64).

  |dir_xz| = sqrt(dir.x²+dir.z²) ; hdir = dir_xz/|dir_xz| (0 si nul)
  horiz = (accel.x·0.5·t + |dir_xz|)·t ; vert = (accel.y·0.5·t + dir.y)·t
  out = base + horiz·hdir + vert·(0,1,0,0)
"""
import struct, sys
from uemu import SCRATCH, Emu, STACK
e=Emu()
OUT=SCRATCH; BASE=SCRATCH+0x100; DIR=SCRATCH+0x200; ACC=SCRATCH+0x300
GRAV=0x142157570
RSP=STACK+0x80000-8            # rsp à l'entrée (cf. uemu.call)
P5=RSP+0x28                    # 5e param (float) = 1er slot pile Win64
def f32(x): return struct.unpack('<f', struct.pack('<f', x))[0]

def emulate(base, dir4, accel2, t):
    mem={GRAV:struct.pack('<4f',0.0,1.0,0.0,0.0),   # gravité runtime résolue
         BASE:struct.pack('<4f',*base), DIR:struct.pack('<4f',*dir4),
         ACC:struct.pack('<4f',accel2[0],accel2[1],0.0,0.0), OUT:bytes(16),
         P5:struct.pack('<f',t)}
    out=e.call(0x1413428B0, rcx=OUT, rdx=BASE, r8=DIR, r9=ACC, mem=mem, read={OUT:16})
    return struct.unpack('<4f', out['mem'][OUT]), out['error']

def formula(base, dir4, accel2, t):
    lxz = f32((f32(dir4[0]*dir4[0]) + f32(dir4[2]*dir4[2])) ** 0.5)
    if lxz>0.0:
        inv=f32(1.0/lxz); hx=f32(f32(inv*dir4[0])); hz=f32(f32(inv*dir4[2]))
    else: hx=hz=0.0
    horiz = f32(f32(f32(f32(accel2[0]*0.5)*t)+lxz)*t)
    vert  = f32(f32(f32(f32(accel2[1]*0.5)*t)+dir4[1])*t)
    return (f32(base[0]+f32(horiz*hx)), f32(base[1]+vert), f32(base[2]+f32(horiz*hz)))

errs=[]
for base,dir4,acc,t in [((0,0,0,0),(1,0,0,0),(0,0),2.0),((0,0,0,0),(0,3,0,0),(0,-10),1.0),
                         ((5,1,2,0),(0.6,1,0.8,0),(2,-9.8),0.5)]:
    (g,err)=emulate(base,dir4,acc,t); ex=formula(base,dir4,acc,t)
    if err: errs.append(f'{dir4}: émul {err}')
    elif any(struct.pack('<f',g[i])!=struct.pack('<f',ex[i]) for i in range(3)):
        errs.append(f'{(base,dir4,acc,t)}: got {g[:3]} != {ex}')
if errs:
    print('ÉCHEC path-eval:'); [print(' -',x) for x in errs]; sys.exit(1)
print(f'✓ VALIDÉ byte-exact ({3} cas) : path-eval cinématique BallMoveRate == binaire (gravité runtime résolue).')
