#!/usr/bin/env python3
"""Progression scalaire du contrôleur game::BallMoveRate (FUN_1413390d0, écrite AVANT les sous-appels).
Validée byte-exact via uemu (mémoire objet + input + stub_calls). Condition d'entrée : input[0x80]==1
ET sub[0x15] (=input[0x55]) != 0.

  rate@0x1a0 = 1.0
  rem = input[0x50] ; si input[0x56]==0 : rem -= pos(obj[0x174])
  si rem > 0 : cand = (target(obj[0x170]) - pos)/rem ; si cand>0 : rate = cand
  sinon : pos = target
  newpos = rate·dt + pos   → obj[0x174] ; (rate → obj[0x1a0])
"""
import struct, sys
from uemu import SCRATCH, Emu
OBJ=SCRATCH; INP=SCRATCH+0x8000; OUT=SCRATCH+0xC000
e=Emu()
def f32(x): return struct.unpack('<f', struct.pack('<f', x))[0]

def emulate(target, pos, rem, dt, decr=False, init_rate=0.0):
    obj=bytearray(0x2000)
    struct.pack_into('<f',obj,0x170,target); struct.pack_into('<f',obj,0x174,pos)
    struct.pack_into('<f',obj,0x1a0,init_rate)
    inp=bytearray(0x100)
    inp[0x80]=1; inp[0x55]=1; inp[0x56]=0 if decr else 1
    struct.pack_into('<f',inp,0x50,rem); struct.pack_into('<f',inp,0x38,dt)
    out=e.call(0x1413390D0, rcx=OBJ, rdx=OUT, r8=INP,
               mem={OBJ:bytes(obj),INP:bytes(inp),OUT:bytes(64)},
               read={OBJ+0x174:4, OBJ+0x1a0:4}, stub_calls=True)
    return struct.unpack('<f',out['mem'][OBJ+0x174])[0], struct.unpack('<f',out['mem'][OBJ+0x1a0])[0]

def formula(target, pos, rem, dt, decr=False):
    rate=1.0; p=pos
    r = f32(rem - pos) if decr else rem
    if r > 0.0:
        cand=f32(f32(target-p)/r)
        if cand>0.0: rate=cand
    else:
        p=target
    return f32(f32(rate*dt)+p), rate

errs=[]
for tgt,pos,rem,dt,decr in [(10.,0.,5.,0.5,False),(8.,2.,3.,0.25,False),(10.,0.,5.,0.5,True),(5.,5.,2.,0.1,False)]:
    gp,gr=emulate(tgt,pos,rem,dt,decr); ep,er=formula(tgt,pos,rem,dt,decr)
    if struct.pack('<f',gp)!=struct.pack('<f',ep): errs.append(f'{(tgt,pos,rem,dt,decr)}: pos {gp}!={ep}')
    if struct.pack('<f',gr)!=struct.pack('<f',er): errs.append(f'{(tgt,pos,rem,dt,decr)}: rate {gr}!={er}')
if errs:
    print('ÉCHEC progression Rate:'); [print(' -',x) for x in errs]; sys.exit(1)
print(f'✓ VALIDÉ byte-exact ({4} cas) : progression scalaire BallMoveRate == binaire.')
