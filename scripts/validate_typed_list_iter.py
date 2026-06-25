#!/usr/bin/env python3
"""Validation byte-exact de FUN_140052040 (nie_eacpatched.exe) via uemu.

FUN_140052040 = "déréférence + avance" d'un itérateur de liste typée à 2 bits.
  param_1 (rcx) = itérateur : { +0x00: ptr conteneur (plVar3), +0x08: i32 index }
  conteneur plVar3 : { +0x00: ptr descripteur, +0x08: ptr tableau de tags 2-bits,
                       +0x10: ptr tableau de valeurs u32 }
  À chaque appel : lit le tag 2-bits à `index`, écrit `index+1` (store 32 bits), puis
  selon (tag, champs du descripteur, valeur u32) renvoie un pointeur résolu (base+offset),
  un sentinelle (&DAT 0x1416F559D pour tag3 / 0x1416F559E pour tag0, quand valeur==0xFFFFFFFF),
  ou NULL.

Lance depuis scripts/ :  cd scripts && ../.venv/bin/python validate_typed_list_iter.py
"""
import struct
import sys as _sys
from pathlib import Path as _Path
_sys.path.insert(0, str(_Path(__file__).resolve().parent))
from uemu import Emu, SCRATCH

VA = 0x140052040
# Sentinelles = &DAT (lea rip-rel) vérifiées via uemu (vérité terrain) : 0x14174559D / 0x14174559E.
SENT3 = 0x14174559D
SENT0 = 0x14174559E
MASK64 = (1 << 64) - 1

# Disposition mémoire (toutes dans la page SCRATCH déjà mappée, non chevauchantes).
ITER = SCRATCH + 0x0000
CONT = SCRATCH + 0x0100
DESC = SCRATCH + 0x0400   # descripteur, 0x100 octets
TAGS = SCRATCH + 0x0800   # tableau de tags 2-bits, 256 octets
VALS = SCRATCH + 0x0C00   # tableau de valeurs u32, 0x400 octets
BOUND = SCRATCH + 0x1000  # struct pointée par desc[0x40] ; u32 borne à +8
REGION = 0x2000           # taille totale réécrite à chaque appel (déterminisme)

UPPER_SENT = 0xCAFEBABE   # 4 octets hauts de l'index : doivent rester intacts


def to_i32(x):
    x &= 0xFFFFFFFF
    return x - 0x100000000 if x & 0x80000000 else x


def asr32(x, n):
    # décalage arithmétique 32 bits
    return to_i32(x) >> n


class LCG:
    def __init__(self, seed):
        self.s = seed & MASK64

    def nxt(self):
        self.s = (self.s * 6364136223846793005 + 1442695040888963407) & MASK64
        return self.s

    def u32(self):
        return (self.nxt() >> 17) & 0xFFFFFFFF

    def below(self, n):
        return self.u32() % n

    def addr48(self):
        # base potentielle (adresse) : 0 dans ~1/3 des cas, sinon 48 bits non nuls
        if self.below(3) == 0:
            return 0
        v = (self.u32() | (self.u32() << 32)) & ((1 << 48) - 1)
        return v if v else 1


class Desc:
    __slots__ = ("a1", "f30", "c38", "f40", "bound", "f50", "f58", "f60", "fc8", "fe8")


def read_tag(tag_bytes, index):
    adj = 3 if index < 0 else 0
    iv6 = to_i32(index + adj)
    byte_index = asr32(iv6, 2)
    v = to_i32((iv6 & 3) - adj)
    al = v & 0xFF
    cl = (al * 2) & 0xFF
    shift = cl & 0x1F
    b = tag_bytes[byte_index]  # byte_index >= 0 pour index >= -3
    return (b >> shift) & 3


def mirror(index, tag_bytes, value, d):
    """Miroir Python exact de FUN_140052040. Renvoie (rax, new_index_low32)."""
    tag = read_tag(tag_bytes, index)
    new_index = to_i32(index + 1) & 0xFFFFFFFF
    rax = 0
    if tag == 3:
        if d.a1 == 0 and d.f30 != 0 and d.c38 != 0:
            if value == 0xFFFFFFFF:
                rax = SENT3
            elif (value & 0x80000000) == 0:  # valeur >= 0 (signé)
                base = d.f60 if d.f60 != 0 else (d.fe8 if d.fe8 != 0 else d.fc8)
                rax = (base + value) & MASK64
    elif tag == 0:
        if d.a1 != 0 and d.f30 != 0 and d.c38 != 0 and d.f40 != 0 and d.f50 != 0:
            if value == 0xFFFFFFFF:
                rax = SENT0
            elif (value & 0x80000000) == 0 and value < d.bound:
                base = d.f58 if d.f58 != 0 else d.f50
                rax = (base + value) & MASK64
    return rax, new_index


def build(index, tag_bytes, value, d):
    buf = bytearray(REGION)

    def w64(off, v):
        struct.pack_into("<Q", buf, off, v & MASK64)

    def w32(off, v):
        struct.pack_into("<I", buf, off, v & 0xFFFFFFFF)

    # itérateur
    w64(ITER - SCRATCH, CONT)
    w32(ITER - SCRATCH + 8, index & 0xFFFFFFFF)
    w32(ITER - SCRATCH + 12, UPPER_SENT)
    # conteneur
    w64(CONT - SCRATCH + 0x00, DESC)
    w64(CONT - SCRATCH + 0x08, TAGS)
    w64(CONT - SCRATCH + 0x10, VALS)
    # tags
    buf[TAGS - SCRATCH:TAGS - SCRATCH + len(tag_bytes)] = tag_bytes
    # valeur à l'index : on écrit le slot VALS+index*4 (index in [-3,199] -> dans la zone libre)
    w32(VALS - SCRATCH + index * 4, value)
    # descripteur
    base = DESC - SCRATCH
    buf[base + 0xA1] = d.a1 & 0xFF
    w64(base + 0x30, d.f30)
    w32(base + 0x38, d.c38)
    w64(base + 0x40, BOUND if d.f40 else 0)
    w64(base + 0x50, d.f50)
    w64(base + 0x58, d.f58)
    w64(base + 0x60, d.f60)
    w64(base + 0xC8, d.fc8)
    w64(base + 0xE8, d.fe8)
    # struct borne (desc[0x40] -> BOUND ; u32 à +8)
    w32(BOUND - SCRATCH + 8, d.bound)
    return buf


def rand_desc(rng):
    d = Desc()
    d.a1 = rng.below(3)           # 0 ~1/3 du temps
    d.f30 = rng.addr48()
    d.c38 = 0 if rng.below(4) == 0 else (rng.u32() & 0x7FFF) + 1
    d.f40 = 0 if rng.below(4) == 0 else 1  # présence du pointeur 0x40
    d.bound = rng.below(64)       # borne pour tag0
    d.f50 = rng.addr48()
    d.f58 = rng.addr48()
    d.f60 = rng.addr48()
    d.fc8 = rng.addr48()
    d.fe8 = rng.addr48()
    return d


def main():
    e = Emu()
    rng = LCG(0xA17C0DE5EED)
    N = 800
    mism = 0
    seen_tags = {0: 0, 1: 0, 2: 0, 3: 0}
    seen_sent3 = seen_sent0 = seen_resolve = seen_null = 0
    for it in range(N):
        # index : surtout >=0 (domaine réel) + quelques petits négatifs (branche d'arrondi)
        if rng.below(12) == 0:
            index = -(rng.below(3) + 1)  # -1..-3 (byte_index = 0, en domaine sûr)
        else:
            index = rng.below(200)

        tag_bytes = bytes(rng.u32() & 0xFF for _ in range(64))

        # valeur : couvrir 0xffffffff, négatifs, et bornés
        roll = rng.below(5)
        if roll == 0:
            value = 0xFFFFFFFF
        elif roll == 1:
            value = 0x80000000 | (rng.u32() & 0x7FFFFFFF)  # négatif (signé)
        elif roll == 2:
            value = rng.below(64)  # petit (souvent < bound)
        else:
            value = rng.u32() & 0x7FFFFFFF

        d = rand_desc(rng)

        buf = build(index, tag_bytes, value, d)
        out = e.call(VA, rcx=ITER, mem={SCRATCH: bytes(buf)}, read={ITER + 8: 8})
        if out.get("error"):
            print(f"[{it}] ERREUR uemu: {out['error']} (index={index})")
            mism += 1
            continue
        got_rax = out["rax"] & MASK64
        got_idx8 = out["mem"][ITER + 8]
        got_lo = struct.unpack_from("<I", got_idx8, 0)[0]
        got_hi = struct.unpack_from("<I", got_idx8, 4)[0]

        exp_rax, exp_lo = mirror(index, tag_bytes, value, d)

        ok = (got_rax == exp_rax) and (got_lo == exp_lo) and (got_hi == UPPER_SENT)
        # stats de couverture
        t = read_tag(tag_bytes, index)
        seen_tags[t] += 1
        if exp_rax == SENT3:
            seen_sent3 += 1
        elif exp_rax == SENT0:
            seen_sent0 += 1
        elif exp_rax == 0:
            seen_null += 1
        else:
            seen_resolve += 1

        if not ok:
            mism += 1
            if mism <= 12:
                print(f"[{it}] MISMATCH index={index} tag={t} value={value:#x}")
                print(f"     rax got={got_rax:#x} exp={exp_rax:#x}")
                print(f"     idx_lo got={got_lo:#x} exp={exp_lo:#x}  hi got={got_hi:#x}")
                print(f"     desc a1={d.a1} f30={d.f30:#x} c38={d.c38} f40={d.f40} "
                      f"bound={d.bound} f50={d.f50:#x} f58={d.f58:#x} f60={d.f60:#x} "
                      f"fc8={d.fc8:#x} fe8={d.fe8:#x}")

    print(f"\ncas={N} tags={seen_tags} sent3={seen_sent3} sent0={seen_sent0} "
          f"resolve={seen_resolve} null={seen_null} mismatches={mism}")
    if mism == 0:
        print("BYTE-EXACT")
        return 0
    print("ECHEC")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
