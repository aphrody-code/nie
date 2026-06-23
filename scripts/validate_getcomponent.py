#!/usr/bin/env python3
"""Modélisation ECS dans uemu : game::Entity::GetComponent<CCharaParam> (FUN_1400645e0) est une
marche de liste chaînée — node = entity[0xe8] ; suivant = node[0x10] ; match si node[0x20] == type_id.
Le garde d'init lit le TLS (gs:58) → géré par le mapping-zéro d'uemu ; le type_id (DAT_1420735a4)
est en .bss (=0 en émulation isolée). On fournit un composant node[0x20]=0 → GetComponent le retourne.
DÉBLOQUE la validation des fonctions composant-dépendantes SANS faire tourner le jeu."""
import struct, sys
from uemu import SCRATCH, Emu
e = Emu()
ENT = SCRATCH

def make_list(type_ids):
    mem = {}
    addrs = [SCRATCH + 0x1000 + i * 0x100 for i in range(len(type_ids))]
    for i, (tid, addr) in enumerate(zip(type_ids, addrs)):
        nxt = addrs[i + 1] if i + 1 < len(addrs) else 0
        nb = bytearray(0x100)
        struct.pack_into('<i', nb, 0x20, tid)
        struct.pack_into('<Q', nb, 0x10, nxt)
        mem[addr] = bytes(nb)
    ent = bytearray(0x200)
    struct.pack_into('<Q', ent, 0xe8, addrs[0] if addrs else 0)
    mem[ENT] = bytes(ent)
    return mem, addrs

errs = []
mem, addrs = make_list([5, 7, 0])           # match au 3e nœud (type_id 0 = DAT)
rax = e.call(0x1400645E0, rcx=ENT, rdx=0, mem=mem)['rax']
if rax != addrs[2]:
    errs.append('walk 3 noeuds: rax=%#x attendu %#x' % (rax, addrs[2]))
mem, addrs = make_list([0, 7, 5])           # match au 1er
rax = e.call(0x1400645E0, rcx=ENT, rdx=0, mem=mem)['rax']
if rax != addrs[0]:
    errs.append('walk 1er: rax=%#x attendu %#x' % (rax, addrs[0]))
mem, addrs = make_list([5, 7, 9])           # aucun match + create=0 -> 0
rax = e.call(0x1400645E0, rcx=ENT, rdx=0, mem=mem)['rax']
if rax != 0:
    errs.append('no-match: rax=%#x attendu 0' % rax)

if errs:
    print('ECHEC GetComponent:')
    for x in errs:
        print(' -', x)
    sys.exit(1)
print('OK VALIDE : modelisation ECS GetComponent (marche de liste byte-fidele) - composant-dependant debloque.')
