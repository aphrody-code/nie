#!/usr/bin/env python3
"""Outil RE du modèle de but de match (IEVR) — lit les vtables MSVC des classes soccer
event/shoot/keeper/goalnet dans le binaire courant et désassemble une méthode.

Usage :
  re_goal_model.py vtable <COL_vaddr> [n]      # liste n pointeurs de vmethod à partir de COL+8
  re_goal_model.py disasm <func_vaddr> [bytes] # désassemble une fonction (iced-x86)

Le binaire : nie_eacpatched.exe (EAC-patché, build courant du VPS). Layout MSVC : le slot
stocké comme `vtable_vaddr` dans niers.sqlite est le COL ; les pointeurs de vméthodes
commencent à COL+8 (cf. mémoire c3-modele-but-anchors)."""
import sys
import pefile
from iced_x86 import Decoder, Formatter, FormatterSyntax

EXE = "/home/ubuntu/.local/share/Steam/iecode/inazuma/nie_eacpatched.exe"
_pe = pefile.PE(EXE, fast_load=True)
IMAGE_BASE = _pe.OPTIONAL_HEADER.ImageBase  # 0x140000000 attendu


def va_to_off(va):
    rva = va - IMAGE_BASE
    for s in _pe.sections:
        if s.VirtualAddress <= rva < s.VirtualAddress + max(s.Misc_VirtualSize, s.SizeOfRawData):
            return s.PointerToRawData + (rva - s.VirtualAddress)
    return None


def read(va, n):
    off = va_to_off(va)
    if off is None:
        return None
    return _pe.__data__[off:off + n]


def read_u64(va):
    b = read(va, 8)
    return int.from_bytes(b, "little") if b else None


def cmd_vtable(col_va, n=24):
    print(f"COL @ {col_va:#x} ; vméthodes à partir de +8 :")
    for i in range(n):
        slot = col_va + 8 + i * 8
        fn = read_u64(slot)
        if fn is None or not (IMAGE_BASE <= fn < IMAGE_BASE + 0x4000000):
            print(f"  [{i:2}] {slot:#x} -> {fn:#x} (hors .text, fin de vtable)" if fn else f"  [{i:2}] (illisible)")
            break
        print(f"  vmethod_{i:<2} = {fn:#010x}")


def cmd_disasm(func_va, nbytes=400):
    code = read(func_va, nbytes)
    if not code:
        print("VA illisible")
        return
    dec = Decoder(64, code, ip=func_va)
    fmt = Formatter(FormatterSyntax.NASM)
    for ins in dec:
        if ins.is_invalid:
            break
        b = code[ins.ip - func_va: ins.ip - func_va + ins.len].hex()
        s = fmt.format(ins)
        # int3 = padding inter-fonctions → fin de fonction.
        if s == "int3":
            break
        print(f"  {ins.ip:#010x}  {b:<20} {s}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    op = sys.argv[1]
    va = int(sys.argv[2], 0)
    arg = int(sys.argv[3], 0) if len(sys.argv) > 3 else None
    if op == "vtable":
        cmd_vtable(va, arg or 24)
    elif op == "disasm":
        cmd_disasm(va, arg or 400)
    else:
        print("op inconnue:", op)
