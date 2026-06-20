#!/usr/bin/env python3
"""uemu — émulateur de fonction isolée de nie_eacpatched.exe via Unicorn.

ORACLE de validation byte-exact pour le portage de la LOGIQUE (boucles d'update C++ non reversées).
Charge l'image PE en mémoire, fixe les entrées (registres + struct mémoire), exécute la fonction
jusqu'à son `ret`, et renvoie les sorties (registres + mémoire modifiée). Sans faire tourner le jeu.

Usage (module) :
    from uemu import Emu
    e = Emu()
    out = e.call(0x14027ac10, rcx=e.SCRATCH, mem={e.SCRATCH: bytes(0x140)})
    print(out['mem'][e.SCRATCH].hex())
"""
import struct

import pefile
from unicorn import (
    UC_ARCH_X86,
    UC_HOOK_MEM_FETCH_UNMAPPED,
    UC_HOOK_MEM_READ_UNMAPPED,
    UC_HOOK_MEM_WRITE_UNMAPPED,
    UC_MODE_64,
    Uc,
    UcError,
)
from unicorn.x86_const import (
    UC_X86_REG_RAX,
    UC_X86_REG_RCX,
    UC_X86_REG_RDX,
    UC_X86_REG_R8,
    UC_X86_REG_R9,
    UC_X86_REG_RSP,
    UC_X86_REG_XMM0,
    UC_X86_REG_XMM1,
    UC_X86_REG_XMM2,
    UC_X86_REG_XMM3,
)

EXE = "/home/ubuntu/.local/share/Steam/iecode/inazuma/nie_eacpatched.exe"
STACK = 0x7000_0000
SCRATCH = 0x2000_0000
SENTINEL = 0x1_4000_0000  # adresse de retour (mappée = sûre si refetch)


class Emu:
    def __init__(self, exe=EXE):
        pe = pefile.PE(exe, fast_load=True)
        self.base = pe.OPTIONAL_HEADER.ImageBase
        size = 0
        for s in pe.sections:
            size = max(size, s.VirtualAddress + max(s.Misc_VirtualSize, len(s.get_data())))
        size = (size + 0xFFF) & ~0xFFF
        uc = Uc(UC_ARCH_X86, UC_MODE_64)
        uc.mem_map(self.base, size + 0x1000)
        uc.mem_write(self.base, pe.header)
        for s in pe.sections:
            uc.mem_write(self.base + s.VirtualAddress, s.get_data())
        uc.mem_map(STACK, 0x10_0000)
        uc.mem_map(SCRATCH, 0x10_0000)

        def on_unmapped(u, access, addr, size, value, data):
            u.mem_map(addr & ~0xFFF, 0x1000)
            return True  # mappe à la volée + réessaie

        uc.hook_add(
            UC_HOOK_MEM_READ_UNMAPPED | UC_HOOK_MEM_WRITE_UNMAPPED | UC_HOOK_MEM_FETCH_UNMAPPED,
            on_unmapped,
        )
        self.uc = uc
        self.SCRATCH = SCRATCH

    def call(self, vaddr, rcx=0, rdx=0, r8=0, r9=0, rax=0, xmm=(0.0, 0.0, 0.0, 0.0), mem=None, read=None, stop=None):
        uc = self.uc
        if mem:
            for addr, data in mem.items():
                uc.mem_write(addr, data)
        rsp = STACK + 0x8_0000
        rsp -= 8
        uc.mem_write(rsp, struct.pack("<Q", SENTINEL))
        uc.reg_write(UC_X86_REG_RSP, rsp)
        for reg, val in (
            (UC_X86_REG_RCX, rcx),
            (UC_X86_REG_RDX, rdx),
            (UC_X86_REG_R8, r8),
            (UC_X86_REG_R9, r9),
            (UC_X86_REG_RAX, rax),
        ):
            uc.reg_write(reg, val & 0xFFFFFFFFFFFFFFFF)
        for i, f in enumerate(xmm):
            data = struct.pack("<f", f) + b"\x00" * 12
            uc.reg_write((UC_X86_REG_XMM0, UC_X86_REG_XMM1, UC_X86_REG_XMM2, UC_X86_REG_XMM3)[i], int.from_bytes(data, "little"))
        err = None
        try:
            uc.emu_start(vaddr, stop or SENTINEL, count=500_000)
        except UcError as e:
            err = str(e)  # ret bancal (émulation mi-fonction) : on capture quand même la mémoire.
        out = {"rax": uc.reg_read(UC_X86_REG_RAX), "error": err, "mem": {}}
        for addr, n in (read or {}).items():
            out["mem"][addr] = uc.mem_read(addr, n)
        return out


if __name__ == "__main__":
    e = Emu()
    n = 0x140
    # Démo/oracle : l'INIT de struct du ctor ballon. Le ctor (.pdata 0x14027ab50) ALLOUE puis init ;
    # on émule la partie init (à partir de 0x14027ac00, après l'alloc) avec rax=ptr struct, jusqu'à
    # la fin .pdata. Capture le layout réel écrit par le jeu = ground-truth byte-exact.
    out = e.call(0x14027AC00, rax=SCRATCH, mem={SCRATCH: bytes(n)}, read={SCRATCH: n}, stop=0x14027ACA1)
    blob = out["mem"][SCRATCH]
    nz = [off for off in range(0, n, 4) if struct.unpack_from("<I", blob, off)[0]]
    print(f"oracle uemu : ctor-init ballon émulé (err={out['error']}) — {len(nz)} mots non nuls / {n // 4}")
    for off in nz:
        word = struct.unpack_from("<I", blob, off)[0]
        f = struct.unpack_from("<f", blob, off)[0]
        print(f"  +0x{off:03x}: {word:#010x}  (f32={f:g})")
    print("→ harness OK : émule une fonction isolée de l'exe → sortie déterministe (oracle de validation).")
