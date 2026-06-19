#!/usr/bin/env python3
"""Triage unported funcLuaMenuCommand handlers by STRUCTURAL pattern (deterministic, no LLM guess).

For each menu cmdId that the decompiled Lua calls but nie-lua/menu_host.rs does not yet port, this
disassembles its handler in the CURRENT nie.exe (iced-x86, the same engine nie-re uses in Rust) and
classifies the return-value logic — the one thing the Lua driver branches on:

  APPLY_TRUE_NOARG  : reads no args, every ret path sets al/eax=1  -> safe to add to REVERSED_RETURN1
  ARG_GUARD_TRUE    : `cmp edx,N; jb -> al=0; ret` then al=1 on the main path -> setter returning 1
  HAS_FLOAT_ARG     : reads float args (cvtsd2ss/movss) -> complex float setter (port carefully)
  GETTER            : returns a computed/engine value (not a constant 0/1) -> default may be wrong
  OTHER             : needs manual reversing

Uses the recovered data/re/funclua-cmdid-handlers.json (cmdId->handler VA for THIS build). Run after
scripts/extract_funclua_table.py. Requires the RE venv: `.venv/bin/python scripts/triage_funclua_handlers.py`
(iced-x86, pefile).
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

import pefile
from iced_x86 import Decoder, FlowControl, Formatter, FormatterSyntax, Mnemonic, OpKind, Register

ROOT = Path(__file__).resolve().parent.parent
EXE = Path.home() / ".local/share/Steam/iecode/inazuma/nie_eacpatched.exe"
HANDLERS = ROOT / "data/re/funclua-cmdid-handlers.json"
MENU_HOST = ROOT / "crates/nie-lua/src/menu_host.rs"
LUA = ROOT / "data/lua_scripts/decompiled"
TOP_N = int(sys.argv[1]) if len(sys.argv) > 1 else 24


def ported_cmdids():
    src = MENU_HOST.read_text()
    p = set()
    for m in re.finditer(r"const CMD_[A-Z0-9_]+: u32\s*=\s*0x([0-9A-Fa-f_]+)", src):
        p.add(int(m.group(1).replace("_", ""), 16))
    for arr_name in ("REVERSED_RETURN1", "ARG_GUARDED_RETURN1"):
        m = re.search(arr_name + r": &\[u32\] = &\[(.*?)\];", src, re.S)
        if m:
            for h in re.finditer(r"0x([0-9A-Fa-f_]+)", m.group(1)):
                p.add(int(h.group(1).replace("_", ""), 16))
    return p


def used_counts():
    used = Counter()
    pat = re.compile(r"funcLuaMenuCommand\)\(\s*(\d{3,})\s*[,)]")
    for f in LUA.rglob("*.lua"):
        for m in pat.finditer(f.read_text(errors="ignore")):
            used[int(m.group(1)) & 0xFFFFFFFF] += 1
    return used


def main():
    pe = pefile.PE(str(EXE))  # full load: parses .pdata exception directory
    image_base = pe.OPTIONAL_HEADER.ImageBase

    # .pdata is the ground truth for function bounds (the whole RE thesis). BUT large funcLua
    # handlers are CHUNKED: a function with a cold early-out splits into several RUNTIME_FUNCTION
    # entries. A continuation chunk is flagged UNW_FLAG_CHAININFO (0x4) in its unwind info — merging
    # on mere contiguity would wrongly fuse adjacent SEPARATE functions, so we merge only chained
    # chunks. This reconstructs the WHOLE handler (prologue + arg-guard early-out + main body).
    def is_chained(unwind_rva):
        try:
            return bool((pe.get_data(unwind_rva, 1)[0] >> 3) & 0x4)
        except Exception:
            return False

    ends = {}  # begin_va -> (end_va, chained)
    for rf in pe.DIRECTORY_ENTRY_EXCEPTION:
        b = image_base + rf.struct.BeginAddress
        ends[b] = (image_base + rf.struct.EndAddress, is_chained(rf.struct.UnwindData))
    bounds = {}
    for b, (e, _) in ends.items():
        end = e
        while end in ends and ends[end][1]:  # extend only across CHAINED continuation chunks
            end = ends[end][0]
        bounds[b] = end

    def read_va(va, n):
        return pe.get_data(va - image_base, n)

    tbl = {int(k, 16): int(v, 16) for k, v in json.loads(HANDLERS.read_text()).items()}
    ported = ported_cmdids()
    used = used_counts()
    targets = [(c, n) for c, n in used.most_common() if c not in ported and c in tbl][:TOP_N]

    fmt = Formatter(FormatterSyntax.INTEL)
    print(f"{'cmdId':>12} {'freq':>4} {'handler':>11}  class            return")
    counts = Counter()
    for cid, freq in targets:
        h = tbl[cid]
        end = bounds.get(h)
        size = (end - h) if end else 0x120
        code = read_va(h, size)
        dec = Decoder(64, code, ip=h)
        insns = list(dec)
        # scan patterns
        # cvtsd2ss (double->float) or movss (store float field) = genuine float arg/field.
        # NOT cvttsd2si: that's double->int, present in EVERY handler since Lua args arrive as doubles.
        reads_float = any(i.mnemonic in (Mnemonic.CVTSD2SS, Mnemonic.MOVSS) for i in insns)
        has_argguard = any(
            ins.mnemonic == Mnemonic.CMP and ins.op0_register == Register.EDX
            for ins in insns[:6]
        )
        # return-value analysis: for each ret, walk backward to the LAST instruction that DEFINES the
        # return register (al/eax/rax), skipping the epilogue (pop / add rsp / movaps xmm / restoring
        # callee-saved via `mov reg,[rsp+..]`) which never touches al. This is what makes the verdict
        # reliable — a naive "look back N" stops inside the epilogue and misreads the return.
        RETREG = (Register.AL, Register.EAX, Register.RAX)
        ret_vals = []
        for idx, ins in enumerate(insns):
            if ins.mnemonic != Mnemonic.RET:
                continue
            val = "?"
            for j in range(idx - 1, -1, -1):
                p = insns[j]
                if p.mnemonic == Mnemonic.CALL:  # return value flows from the callee in al/eax
                    val = "call"; break
                if p.op0_register not in RETREG:
                    continue  # does not define the return reg (epilogue / other regs) -> keep walking
                if p.mnemonic == Mnemonic.XOR and p.op1_register in RETREG:
                    val = "0"; break
                if p.mnemonic == Mnemonic.MOV and p.op1_kind in (OpKind.IMMEDIATE8, OpKind.IMMEDIATE32):
                    val = str(p.immediate(1)); break
                val = "computed"; break  # movzx/setcc/lea/and/or… -> non-constant
            ret_vals.append(val)
        uniq = set(ret_vals)
        # count arg-reader-style calls (handlers read args via a helper returning xmm0)
        n_calls = sum(1 for i in insns if i.mnemonic == Mnemonic.CALL)

        # al/eax=0 definitions (xor eax,eax | mov al/eax,0): potential return-0 paths.
        def is_zero_def(i):
            return i.op0_register in RETREG and (
                (i.mnemonic == Mnemonic.XOR and i.op1_register in RETREG)
                or (i.mnemonic == Mnemonic.MOV and i.op1_kind in (OpKind.IMMEDIATE8, OpKind.IMMEDIATE32)
                    and i.immediate(1) == 0)
            )
        zero_ips = [i.ip for i in insns if is_zero_def(i)]

        # Arg-count guard fail block: `cmp edx,N ; jcc TARGET` — the insufficient-args early-out lives
        # between the jcc and TARGET. Shipped scripts ALWAYS pass the documented args (the real game
        # works), so this block is dead at runtime. A return-0 confined to it is therefore never taken.
        guard_fail_ips = set()
        guard_n = None
        for gi, ins in enumerate(insns):
            if ins.mnemonic == Mnemonic.CMP and ins.op0_register == Register.EDX \
               and ins.op1_kind not in (OpKind.REGISTER, OpKind.MEMORY):
                guard_n = ins.immediate(1)
                for jj in range(gi + 1, min(gi + 4, len(insns))):
                    if insns[jj].flow_control == FlowControl.CONDITIONAL_BRANCH:
                        target = insns[jj].near_branch_target
                        for k in range(jj + 1, len(insns)):
                            if insns[k].ip >= target:
                                break
                            guard_fail_ips.add(insns[k].ip)
                        break
                break

        no_zero = not zero_ips
        guard_only_zero = bool(zero_ips) and all(ip in guard_fail_ips for ip in zero_ips)
        # safe to port as "return 1": no float field, returns only 0/1 with a 1, and every 0 is either
        # absent or confined to the (runtime-dead) arg-guard fail block.
        port_safe = (not reads_float) and uniq <= {"0", "1"} and "1" in uniq and (no_zero or guard_only_zero)

        if reads_float:
            cls = "HAS_FLOAT_ARG"
        elif port_safe:
            cls = "RETURN_1_SAFE"
        elif uniq <= {"0", "1"} and "1" in uniq:
            cls = "ARG_GUARD_TRUE"   # has a return-0 NOT confined to the arg-guard -> needs manual CF
        elif "computed" in uniq or "call" in uniq:
            cls = "GETTER"
        else:
            cls = "OTHER"
        counts[cls] += 1
        flag = " <- PORT" if port_safe else ""
        gz = "none" if no_zero else ("guard" if guard_only_zero else "BODY")
        print(f"  0x{cid:08X} {freq:>4} 0x{h:09X}  {cls:<14} rets={ret_vals} zero={gz} n={guard_n} calls={n_calls}{flag}")
    print("\nrésumé:", dict(counts))


if __name__ == "__main__":
    main()
