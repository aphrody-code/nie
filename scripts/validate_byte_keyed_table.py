#!/usr/bin/env python3
"""Validation byte-exact de FUN_140d8f2b0 via l'oracle uemu.

FUN_140d8f2b0(param_1=struct*, param_2=u32* out, param_3=char key) :
  count = *(u32*)(param_1 + 0x90)
  array = *(i64*)(param_1 + 0x88)   # tableau d'enregistrements de 8 octets
  pour i in [0, count):  record = array + i*8
    si (i signé >= 0) et (i signé < count signé) et record != 0 et record[0]==key :
        *param_2 = *(u32*)(record + 4) ; return param_2
  *param_2 = 0 ; return param_2

Layout d'un enregistrement (8 octets) : [key:u8 @ +0][pad 3][value:u32 @ +4].
Sémantique = recherche linéaire keyed (clé = octet de tête), première occurrence gagne,
0 si absent. rax = param_2 (le pointeur de sortie est renvoyé).
"""
import struct
import sys

sys.path.insert(0, ".")
from uemu import Emu, SCRATCH

VA = 0x140D8F2B0
STRUCT = SCRATCH                # base de la struct
ARRAY = SCRATCH + 0x1000        # tableau d'enregistrements
OUT = SCRATCH + 0x9000          # u32 de sortie


def mirror(count, records, key):
    """Miroir Python de la sémantique. records = liste de (key_byte, pad3_bytes, value_u32).
    Renvoie la valeur u32 écrite dans *param_2. count peut différer de len(records)
    (mais on fournit toujours assez d'enregistrements). Modélise la comparaison signée
    de l'index : la boucle s'arrête (unsigned) à i >= count ; le corps n'agit que si
    (int)i >= 0 et (int)i < (int)count.  On ne fuzze que des counts raisonnables (>=0)."""
    key &= 0xFF
    i = 0
    while True:
        ii = i if i < 0x8000_0000 else i - 0x1_0000_0000   # (int)uVar3
        cc = count if count < 0x8000_0000 else count - 0x1_0000_0000  # (int)uVar2
        if ii >= 0 and ii < cc:
            rk = records[i][0] & 0xFF
            if rk == key:
                return records[i][2] & 0xFFFFFFFF
        i += 1
        if not (i < count):  # while (uVar3 < uVar2) — non signé
            break
    return 0


def build_mem(count, records):
    """Construit la struct + le tableau en mémoire uemu."""
    arr = bytearray()
    for (k, pad, val) in records:
        rec = bytes([k & 0xFF]) + pad[:3] + struct.pack("<I", val & 0xFFFFFFFF)
        assert len(rec) == 8
        arr += rec
    st = bytearray(0x100)
    struct.pack_into("<q", st, 0x88, ARRAY)
    struct.pack_into("<I", st, 0x90, count & 0xFFFFFFFF)
    return {STRUCT: bytes(st), ARRAY: bytes(arr), OUT: b"\xAA\xAA\xAA\xAA"}


class LCG:
    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFFFFFFFFFF

    def next(self):
        self.s = (self.s * 6364136223846793005 + 1442695040888963407) & 0xFFFFFFFFFFFFFFFF
        return (self.s >> 16) & 0xFFFFFFFF

    def rng(self, n):
        return self.next() % n


def main():
    e = Emu()
    rng = LCG(0xC0FFEE140D8F)
    ok = 0
    total = 0

    def run_case(count, records, key, label=""):
        nonlocal ok, total
        total += 1
        mem = build_mem(count, records)
        out = e.call(VA, rcx=STRUCT, rdx=OUT, r8=key, mem=mem, read={OUT: 4})
        if out.get("error"):
            print(f"FAIL[{label}] uemu error: {out['error']}")
            return False
        got = struct.unpack("<I", bytes(out["mem"][OUT]))[0]
        exp = mirror(count, records, key)
        rax = out["rax"]
        if got != exp:
            print(f"FAIL[{label}] count={count} key={key&0xFF:#x} got=*out={got:#x} exp={exp:#x}")
            print(f"  records={[(r[0],r[2]) for r in records]}")
            return False
        if rax != OUT:
            print(f"FAIL[{label}] rax={rax:#x} expected param_2={OUT:#x}")
            return False
        ok += 1
        return True

    # --- Cas dirigés (bords) ---
    run_case(0, [], 0x41, "count0")                               # vide → 0
    run_case(1, [(0x41, b"\x00\x00\x00", 0xDEADBEEF)], 0x41, "hit1")
    run_case(1, [(0x41, b"\x00\x00\x00", 0xDEADBEEF)], 0x42, "miss1")
    # première occurrence gagne
    run_case(3, [(7, b"\x01\x02\x03", 0x11111111),
                 (7, b"\x04\x05\x06", 0x22222222),
                 (9, b"\x07\x08\x09", 0x33333333)], 7, "first-wins")
    # clé = 0 doit matcher un octet de tête nul
    run_case(2, [(0, b"\xFF\xFF\xFF", 0x0BADF00D),
                 (1, b"\x00\x00\x00", 0xCAFEBABE)], 0, "key0")
    # seuls les 8 bits de poids faible de r8 comptent (movzx ebx, r8b)
    run_case(2, [(0x80, b"\x00\x00\x00", 0x12345678),
                 (0x81, b"\x00\x00\x00", 0x9ABCDEF0)], 0xFFFFFF00 | 0x80, "highbits")
    # value avec bit de poids fort (signe)
    run_case(1, [(0x55, b"\x00\x00\x00", 0xFFFFFFFF)], 0x55, "valneg")
    # match au dernier index
    recs = [(i + 1, bytes(rng.next().to_bytes(4, "little")[:3]), 0x1000 + i) for i in range(16)]
    run_case(16, recs, 16, "last")

    # --- Fuzz seedé ---
    for _ in range(600):
        count = rng.rng(17)  # 0..16
        records = []
        keys_present = []
        for _i in range(max(count, 1)):
            k = rng.rng(256)
            pad = bytes((rng.next() & 0xFF, rng.next() & 0xFF, rng.next() & 0xFF))
            val = rng.next() ^ (rng.next() << 1)
            records.append((k, pad, val & 0xFFFFFFFF))
            keys_present.append(k)
        # 60 % du temps, requête une clé présente (chemin found) ; sinon clé aléatoire
        if count and rng.rng(100) < 60:
            key = keys_present[rng.rng(count)]
        else:
            key = rng.rng(256)
        # parfois pollue les bits hauts de r8
        if rng.rng(2):
            key |= (rng.next() & 0xFFFFFF) << 8
        run_case(count, records, key, "fuzz")

    print(f"\n{ok}/{total} cas concordants")
    if ok == total:
        print("BYTE-EXACT")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
