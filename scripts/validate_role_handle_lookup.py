#!/usr/bin/env python3
"""Validateur byte-exact pour FUN_141448040 (@0x141448040).

Sémantique (résolveur de handle vers un enregistrement d'une table globale) :

    table = DAT_141fa8f18  (qword global @0x141fa8f18 = base d'un tableau de records de 0x380 octets,
                            indices 0..0x5f ; chaque record porte une clé u32 au offset +0x368)
    if table == 0: return 0

    b = (char) virtual_call([param_1+0x378] -> vtable+0x18)(param_1+0x378)   # appel virtuel
    if b == 0:                                   # branche "fallback"
        key = u32 @ param_1+0xa4
    elif (u8 @ param_1+0x391) < 6:               # branche "rôle"
        key = u32 @ (param_1 + 0x378 + 0x34 + 8 + role_index*0x10)
    else:
        key = 0

    index = key & 0xffff
    if key != 0 and index < 0x60:
        rec = table + index*0x380
        f   = u32 @ rec+0x368
        if f != 0 and f == key:                  # validation du handle (low16=index, high16=génération)
            return rec
    return 0

L'appel virtuel renvoie un char qui ne sert qu'à choisir la source de la clé : on le traite comme une
ENTRÉE. uemu exécute la VRAIE fonction du binaire ; on injecte une cible de vtable triviale
(`mov al, imm8 ; ret`) en mémoire scratch (exécutable) pour contrôler `b`. Tout le reste (sélection de
clé, calcul d'index, validation contre la table) est exécuté par le binaire réel et comparé byte-exact.

Lancer : uv run scripts/validate_role_handle_lookup.py   (exit 0 si byte-exact)
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from uemu import Emu  # noqa: E402

VA = 0x141448040
GLOBAL = 0x141FA8F18  # DAT_141fa8f18 (base de table)
STRIDE = 0x380
KEY_OFF = 0x368
MAX_IDX = 0x60

# --- mirroir Python de la sémantique (le "port") -----------------------------------------------

def expected(b, fallback_key, role_index, role_keys, slot_value):
    """Renvoie l'index résolu (int) ou None. `slot_value` = clé du record à l'index calculé."""
    if b == 0:
        key = fallback_key & 0xFFFFFFFF
    elif role_index < 6:
        key = role_keys[role_index] & 0xFFFFFFFF
    else:
        key = 0
    index = key & 0xFFFF
    if key != 0 and index < MAX_IDX:
        f = slot_value & 0xFFFFFFFF
        if f != 0 and f == key:
            return index
    return None


# --- harnais uemu ------------------------------------------------------------------------------

def main():
    e = Emu()
    S = e.SCRATCH
    T = S + 0x10000   # base de table
    P = S + 0x40000   # param_1
    VT = S + 0x50000  # vtable
    G = S + 0x60000   # gadgets de l'appel virtuel : un par valeur d'octet (jamais réécrits)

    # Pré-écriture des 256 gadgets `mov al, imm8 ; ret` à des adresses DISTINCTES et FIGÉES.
    # (Réécrire des octets de code à la même adresse entre deux appels ne purge pas le cache de
    #  blocs traduits d'unicorn → l'ancienne traduction rejouait `mov al, 0`. On repointe juste la
    #  case data vtable[+0x18] sur le bon gadget.)
    init_mem = {}
    for bv in range(256):
        init_mem[G + bv * 0x10] = bytes([0xB0, bv, 0xC3])
    e.call(VA, rcx=P, mem={**init_mem, GLOBAL: struct.pack("<Q", 0)})  # table=0 -> retour immédiat, écrit la mémoire

    def run_case(b, fallback_key, role_index, role_keys, slot_value):
        # clé attendue pour savoir à quel index écrire le record lu
        if b == 0:
            key = fallback_key & 0xFFFFFFFF
        elif role_index < 6:
            key = role_keys[role_index] & 0xFFFFFFFF
        else:
            key = 0
        index = key & 0xFFFF

        mem = {}
        mem[GLOBAL] = struct.pack("<Q", T)            # table base
        mem[P + 0x378] = struct.pack("<Q", VT)         # vtable ptr
        mem[VT + 0x18] = struct.pack("<Q", G + (b & 0xFF) * 0x10)  # -> gadget figé renvoyant al=b
        mem[P + 0xA4] = struct.pack("<I", fallback_key & 0xFFFFFFFF)
        mem[P + 0x391] = bytes([role_index & 0xFF])
        for sel in range(6):
            mem[P + 0x3B4 + sel * 0x10] = struct.pack("<I", role_keys[sel] & 0xFFFFFFFF)
        # seul le slot d'index calculé est lu par la fonction : on l'écrit frais (anti-staleness)
        if index < MAX_IDX:
            mem[T + index * STRIDE + KEY_OFF] = struct.pack("<I", slot_value & 0xFFFFFFFF)

        out = e.call(VA, rcx=P, mem=mem)
        if out.get("error"):
            return None, f"uemu error: {out['error']}"
        rax = out["rax"]
        if rax == 0:
            got = None
        else:
            delta = rax - T
            if delta < 0 or delta % STRIDE != 0:
                return None, f"rax={rax:#x} hors table (delta={delta:#x})"
            got = delta // STRIDE
        exp = expected(b, fallback_key, role_index, role_keys, slot_value)
        return (got, exp), None

    # LCG déterministe
    state = 0x1234_5678_9ABC_DEF0

    def rnd(bits=32):
        nonlocal state
        state = (state * 6364136223846793005 + 1442695040888963407) & 0xFFFFFFFFFFFFFFFF
        return (state >> 17) & ((1 << bits) - 1)

    cases = 0
    fails = 0

    # 1) cas de bord ciblés
    bord = []
    # b=0, fallback
    bord.append((0, 0x00000000, 0, [0] * 6, 0))             # key=0 -> None
    bord.append((0, 0x00000005, 0, [0] * 6, 0x00000005))    # match index 5
    bord.append((0, 0x00000005, 0, [0] * 6, 0x00000006))    # mismatch
    bord.append((0, 0x0000005F, 0, [0] * 6, 0x0000005F))    # index 0x5f = dernier valide, match
    bord.append((0, 0x00000060, 0, [0] * 6, 0x00000060))    # index 0x60 >= max -> None
    bord.append((0, 0x00000061, 0, [0] * 6, 0x00000061))    # >= max -> None
    bord.append((0, 0xDEAD0042, 0, [0] * 6, 0xDEAD0042))    # high16 génération, match
    bord.append((0, 0xDEAD0042, 0, [0] * 6, 0x00000042))    # même index, clé différente -> None
    bord.append((0, 0x00010000, 0, [0] * 6, 0x00010000))    # index 0, clé non nulle, match
    bord.append((0, 0xFFFF0000, 0, [0] * 6, 0xFFFF0000))    # index 0, génération max, match
    # b!=0, branche rôle
    bord.append((1, 0xAAAAAAAA, 0, [0x0000000A, 0, 0, 0, 0, 0], 0x0000000A))   # role 0 match
    bord.append((1, 0xAAAAAAAA, 5, [0, 0, 0, 0, 0, 0x0000000B], 0x0000000B))   # role 5 match
    bord.append((1, 0xAAAAAAAA, 6, [0] * 6, 0))                                # role>=6 -> key 0 -> None
    bord.append((1, 0xAAAAAAAA, 7, [0] * 6, 0))                                # role>=6 -> None
    bord.append((1, 0xAAAAAAAA, 0xFF, [0] * 6, 0))                             # role 255 -> None
    bord.append((1, 0xAAAAAAAA, 3, [0, 0, 0, 0xCAFE0010, 0, 0], 0xCAFE0010))   # role 3 match w/ gen
    bord.append((1, 0xAAAAAAAA, 3, [0, 0, 0, 0xCAFE0010, 0, 0], 0x00000010))   # role 3, mismatch
    bord.append((1, 0xAAAAAAAA, 2, [0, 0, 0x00000000, 0, 0, 0], 0))            # role key 0 -> None
    bord.append((0x80, 0x00000003, 0, [0] * 6, 0x00000003))                    # b sign bit set -> true branch
    bord.append((0xFF, 0x00000003, 1, [0, 0x00000003, 0, 0, 0, 0], 0x00000003))  # b=0xff true branch role1

    for c in bord:
        res, err = run_case(*c)
        cases += 1
        if err or res[0] != res[1]:
            fails += 1
            print(f"FAIL bord case={c}: got/exp={res} err={err}")

    # 2) fuzz aléatoire seedé
    for _ in range(600):
        b = 0 if (rnd(1) == 0) else (rnd(8) | (1 if rnd(1) else 0))  # ~moitié 0, sinon non nul
        # clés : parfois petites (index valide), parfois grandes, parfois 0
        def mkkey():
            r = rnd(3)
            if r == 0:
                return 0
            if r == 1:
                return rnd(7)                       # index 0..0x7f (autour de la limite)
            if r == 2:
                return (rnd(16) << 16) | rnd(7)     # génération + petit index
            return rnd(32)
        fallback_key = mkkey()
        role_index = rnd(3) if rnd(1) else rnd(8)   # souvent < 6, parfois >= 6
        role_keys = [mkkey() for _ in range(6)]
        # slot : forcer un match la moitié du temps
        if b == 0:
            key = fallback_key
        elif role_index < 6:
            key = role_keys[role_index]
        else:
            key = 0
        if rnd(1):
            slot_value = key            # force match potentiel
        else:
            slot_value = mkkey()        # aléatoire (souvent mismatch)
        c = (b, fallback_key, role_index, role_keys, slot_value)
        res, err = run_case(*c)
        cases += 1
        if err or res[0] != res[1]:
            fails += 1
            print(f"FAIL fuzz case={c}: got/exp={res} err={err}")

    if fails:
        print(f"ÉCHEC : {fails}/{cases} divergences")
        sys.exit(1)
    print(f"OK byte-exact : {cases} cas (FUN_141448040)")
    sys.exit(0)


if __name__ == "__main__":
    main()
