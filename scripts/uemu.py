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

LIMITE CONNUE : le TCG d'unicorn n'émule PAS la FMA3 (`vfmadd231ps`…) → « invalid instruction » sur
les fonctions physiques qui l'utilisent (ex. BallMoveLerp). Le modèle CPU Haswell est posé (active
AVX2 côté flags) mais la FMA3 n'est pas implémentée dans le TCG. Donc uemu valide byte-exact les
fonctions SSE (ex. BallMoveSimpleParabora ✓) ; les fonctions FMA restent reverse-only (décodées mais
non validables ici) jusqu'à une émulation FMA logicielle (hook UC_HOOK_INSN_INVALID + calcul f32-FMA)
ou un support unicorn. NE PAS porter une fonction FMA sans validation (règle no-faux-FAIT).
"""
import struct

import capstone
import pefile
import math

from unicorn import (
    UC_ARCH_X86,
    UC_HOOK_CODE,
    UC_HOOK_INSN_INVALID,
    UC_HOOK_MEM_FETCH_UNMAPPED,
    UC_HOOK_MEM_READ_UNMAPPED,
    UC_HOOK_MEM_WRITE_UNMAPPED,
    UC_MODE_64,
    Uc,
    UcError,
)
from unicorn.x86_const import (
    UC_CPU_X86_HASWELL,
    UC_X86_REG_RIP,
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
STUB_HEAP = 0x5000_0000  # bump-alloc pour les `call` stubbés (chaque appel → ptr frais)
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
        # Modèle CPU Haswell → active AVX2 + FMA3 (vfmadd…) ; sinon « invalid instruction » sur les
        # fonctions physiques utilisant la FMA (ex. BallMoveLerp). SSE seul ne suffit pas.
        try:
            uc.ctl_set_cpu_model(UC_CPU_X86_HASWELL)
        except Exception:
            pass
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
        uc.mem_map(STUB_HEAP, 0x10_0000)
        self._md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
        self._stub = False
        self._heap = STUB_HEAP

        def on_code(u, addr, size, _data):
            # Stub des `call` (mode stub_calls) : ne pas entrer ; rax = ptr frais (alloc/factory),
            # sauter l'instruction. Permet d'émuler ctors/fonctions appelantes (alloc, sous-inits).
            if not self._stub:
                return
            ins = next(self._md.disasm(bytes(u.mem_read(addr, size)), addr), None)
            if ins and ins.mnemonic == "call":
                self._heap += 0x1000
                u.reg_write(UC_X86_REG_RAX, self._heap)
                u.reg_write(UC_X86_REG_RIP, addr + size)

        uc.hook_add(UC_HOOK_CODE, on_code)

        # Émulation logicielle des instructions que le TCG d'unicorn n'implémente pas (FMA3, SSE3/4).
        import capstone.x86 as _x86
        import unicorn.x86_const as _xc

        self._md.detail = True  # opérandes détaillés (reg/mem/imm)
        xmm = {f"xmm{i}": getattr(_xc, f"UC_X86_REG_XMM{i}") for i in range(16)}
        gpr = {
            n: getattr(_xc, f"UC_X86_REG_{n.upper()}")
            for n in ("rax", "rbx", "rcx", "rdx", "rsi", "rdi", "rbp", "rsp", *(f"r{i}" for i in range(8, 16)))
        }

        def f32(x):
            return struct.unpack("<f", struct.pack("<f", x))[0]

        def read_op(u, ins, op):
            if op.type == _x86.X86_OP_REG:
                return list(struct.unpack("<4f", u.reg_read(xmm[self._md.reg_name(op.reg)]).to_bytes(16, "little")))
            if op.type == _x86.X86_OP_MEM:
                m = op.mem
                bn = self._md.reg_name(m.base) if m.base else None
                addr = ins.address + ins.size + m.disp if bn == "rip" else (u.reg_read(gpr[bn]) if bn else 0) + m.disp
                if m.index and bn != "rip":
                    addr += u.reg_read(gpr[self._md.reg_name(m.index)]) * m.scale
                return list(struct.unpack("<4f", bytes(u.mem_read(addr & 0xFFFFFFFFFFFFFFFF, 16))))
            return None

        def on_invalid(u, _data):
            rip = u.reg_read(UC_X86_REG_RIP)
            ins = next(self._md.disasm(bytes(u.mem_read(rip, 16)), rip), None)
            if ins is None or not ins.operands or ins.operands[0].type != _x86.X86_OP_REG:
                return False
            m, ops = ins.mnemonic, ins.operands
            dreg = xmm.get(self._md.reg_name(ops[0].reg))
            if dreg is None:
                return False
            d = list(struct.unpack("<4f", u.reg_read(dreg).to_bytes(16, "little")))
            if m.startswith("vfmadd"):
                variant, n = m[6:9], (4 if m.endswith("ps") else 1)
                s2, s3 = read_op(u, ins, ops[1]), read_op(u, ins, ops[2])
                if s2 is None or s3 is None:
                    return False
                for i in range(n):
                    a, b, c = ({"132": (d[i], s3[i], s2[i]), "213": (s2[i], d[i], s3[i])}.get(variant, (s2[i], s3[i], d[i])))
                    d[i] = f32(math.fma(a, b, c))
            elif m == "haddps":
                s = read_op(u, ins, ops[1])
                d = [f32(d[0] + d[1]), f32(d[2] + d[3]), f32(s[0] + s[1]), f32(s[2] + s[3])]
            elif m == "insertps":
                s = read_op(u, ins, ops[1])
                imm = ops[2].imm
                d[(imm >> 4) & 3] = s[(imm >> 6) & 3]
                for i in range(4):
                    if imm & (1 << i):
                        d[i] = 0.0
            elif m in ("sqrtps", "sqrtss"):
                s = read_op(u, ins, ops[1])
                for i in range(4 if m == "sqrtps" else 1):
                    d[i] = f32(math.sqrt(s[i])) if s[i] >= 0 else float("nan")
            else:
                return False
            u.reg_write(dreg, int.from_bytes(struct.pack("<4f", *d), "little"))
            u.reg_write(UC_X86_REG_RIP, rip + ins.size)
            return True

        uc.hook_add(UC_HOOK_INSN_INVALID, on_invalid)
        self.uc = uc
        self.SCRATCH = SCRATCH

    def call(self, vaddr, rcx=0, rdx=0, r8=0, r9=0, rax=0, xmm=(0.0, 0.0, 0.0, 0.0), mem=None, read=None, stop=None, stub_calls=False):
        uc = self.uc
        self._stub = stub_calls
        self._heap = STUB_HEAP
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
