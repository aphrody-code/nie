#!/usr/bin/env python3
"""Oracle byte-exact pour FUN_140d3bac0 (nie_eacpatched.exe @ 0x140D3BAC0).

Sémantique reversée (cf. désassemblage) :
  ulonglong f(param_1 (rcx), param_2:int (edx), param_3:char (r8b))
    table = *(u64*)(param_1 + 0x1758)
    pour row r = 0..13 :
        entry e = 0..28 :
            id0 = *(i32*)(table + r*0x82c + 0x84 + e*0x10 - 4)   # +0x80 + e*0x10
            id1 = *(i32*)(table + r*0x82c + 0x84 + e*0x10)       # +0x84 + e*0x10
            si id0 == param_2 ou id1 == param_2 : return r       # (movzx eax,r9b)
    # aucun match après 14 rangées :
    si param_3 != 0 : return (last_rax & ~0xff) | 0x0e          # al=0x0e, poids forts = junk ptr
    sinon : g = *(*(u64*)0x141fa8fc0 + 0x69a0) ; b = *(u8*)(g + 0x2ca97f)
            return 0x02 si b != 2 sinon 0x00
La rangée r est calculée via r9b (0..13) : la branche global du corps (cmp r9b,0xe) est morte.

Le global 0x141fa8fc0 est un pointeur singleton runtime (zero-init dans le PE) → on le fournit
et on le fuzze (P -> +0x69a0 -> Q -> +0x2ca97f -> octet) comme une ENTRÉE.
"""
import struct
import sys

sys.path.insert(0, "/home/ubuntu/niers/scripts")
from uemu import Emu

VADDR = 0x140D3BAC0
GLOBAL_VA = 0x141FA8FC0

ROW_STRIDE = 0x82C
N_ROWS = 14
N_ENTRIES = 0x1D  # 29
ENTRY_STRIDE = 0x10
ENTRY_OFF0 = 0x80  # premier id (piVar1[-1]) du premier entry
TABLE_BYTES = N_ROWS * ROW_STRIDE  # 0x7268

# Adresses du harness
SCRATCH = 0x2000_0000          # param_1 + slot du pointeur de table
TABLE_BASE = SCRATCH + 0x1_0000  # table elle-même (dans SCRATCH, mappé)
REGION = 0x3000_0000           # chaîne du singleton global (région dédiée mappée)
REGION_SIZE = 0x40_0000        # > 0x2ca97f


def build_table_view(table_bytes):
    """retourne fn(off)->u32 sur les octets de la table."""
    def rd(off):
        return struct.unpack_from("<I", table_bytes, off)[0]
    return rd


def model_rax(table_bytes, param2, param3, region_byte):
    """Miroir Python complet -> (rax 64 bits, branche)."""
    rd = build_table_view(table_bytes)
    p2 = param2 & 0xFFFFFFFF
    last_rax = 0
    for r in range(N_ROWS):
        base_off = r * ROW_STRIDE + 0x84
        rax = (TABLE_BASE + base_off) & 0xFFFFFFFFFFFFFFFF
        off = base_off
        for _e in range(N_ENTRIES):
            id0 = rd(off - 4)
            id1 = rd(off)
            if id0 == p2 or id1 == p2:
                return r, "found"  # movzx eax, r9b -> poids forts nuls
            off += ENTRY_STRIDE
            rax = (rax + ENTRY_STRIDE) & 0xFFFFFFFFFFFFFFFF
        last_rax = rax
    if param3 & 0xFF:
        return ((last_rax & ~0xFF) | 0x0E), "ret0e"
    if (region_byte & 0xFF) != 2:
        return 0x02, "fallback2"
    return 0x00, "fallback0"


def lcg(state):
    """LCG déterministe (Numerical Recipes)."""
    return (state * 1664525 + 1013904223) & 0xFFFFFFFF


def main():
    e = Emu()
    # région pour la chaîne du singleton global
    e.uc.mem_map(REGION, REGION_SIZE)

    cases = 0
    mism = 0
    branch_hits = {"found": 0, "fallback0": 0, "fallback2": 0, "ret0e": 0}

    st = 0xC0FFEE01
    NCASES = 600
    for c in range(NCASES):
        # --- génère une table aléatoire (pool d'ids partagé pour provoquer des matchs) ---
        st = lcg(st)
        pool_n = 4 + (st % 30)
        pool = []
        for _ in range(pool_n):
            st = lcg(st)
            # ids dans une plage réaliste + parfois -1 (0xffffffff) "vide"
            if st & 7 == 0:
                pool.append(0xFFFFFFFF)
            else:
                st = lcg(st)
                pool.append(st % 0x4000)

        tbuf = bytearray(TABLE_BYTES)
        # remplit les paires d'ids (id0 @ +0x80+0x10e, id1 @ +0x84+0x10e) de chaque rangée
        for r in range(N_ROWS):
            for ent in range(N_ENTRIES):
                eoff = r * ROW_STRIDE + ENTRY_OFF0 + ent * ENTRY_STRIDE
                st = lcg(st)
                v0 = pool[st % pool_n]
                st = lcg(st)
                v1 = pool[st % pool_n]
                struct.pack_into("<I", tbuf, eoff, v0)
                struct.pack_into("<I", tbuf, eoff + 4, v1)
                # 8 octets restants de l'entry : bruit (non lus, mais on remplit)
                st = lcg(st)
                struct.pack_into("<I", tbuf, eoff + 8, st)

        # --- param2 : tantôt un id du pool (match probable), tantôt hors-pool (no-match) ---
        st = lcg(st)
        sel = st % 3
        if sel == 0:
            # garanti dans le pool -> match
            param2 = pool[(st >> 2) % pool_n]
        elif sel == 1:
            # garanti HORS pool/table -> no-match (force les branches fallback/ret0e)
            param2 = 0x1000_0000 + c  # > 0x4000 et != 0xffffffff, jamais dans la table
        else:
            st = lcg(st)
            param2 = st & 0xFFFFFFFF
            if st & 0x10:
                param2 |= 0x80000000  # parfois négatif (bit de signe)

        st = lcg(st)
        param3 = 1 if (st & 0x100) else 0
        st = lcg(st)
        region_byte = st & 0xFF
        # biaise vers 2 pour couvrir les deux branches du fallback
        if st & 0x10000:
            region_byte = 2

        # --- mémoire uemu ---
        mem = {
            SCRATCH + 0x1758: struct.pack("<Q", TABLE_BASE),
            TABLE_BASE: bytes(tbuf),
            GLOBAL_VA: struct.pack("<Q", REGION),
            REGION + 0x69A0: struct.pack("<Q", REGION),
            REGION + 0x2CA97F: bytes([region_byte]),
        }
        out = e.call(VADDR, rcx=SCRATCH, rdx=param2, r8=param3, mem=mem)
        if out["error"]:
            print(f"[{c}] ERREUR uemu: {out['error']}")
            mism += 1
            continue
        got = out["rax"]
        want, branch = model_rax(tbuf, param2, param3, region_byte)
        branch_hits[branch] += 1

        cases += 1
        if got != want:
            mism += 1
            if mism <= 12:
                print(f"[{c}] MISMATCH got={got:#018x} want={want:#018x} "
                      f"param2={param2:#x} param3={param3} rb={region_byte}")

    print(f"\ncas={cases} mismatch={mism} branches={branch_hits}")
    if mism == 0 and cases == NCASES:
        # vérifier qu'on a bien couvert chaque branche
        if all(branch_hits[k] > 0 for k in branch_hits):
            print("BYTE-EXACT")
            return 0
        print("ATTENTION: branches non toutes couvertes")
        return 2
    return 1


if __name__ == "__main__":
    sys.exit(main())
