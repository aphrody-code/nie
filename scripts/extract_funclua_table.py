#!/usr/bin/env python3
"""Extract the funcLuaMenuCommand dispatch table (cmdId -> handler) from nie.exe.

The game registers every menu command in a contiguous table of 16-byte entries
`{ handler: u64, cmdId: u32, pad: u32 }` in `.rdata`. This script parses the PE,
locates the table via a known cmdId anchor (SetIconSprite = 0x214DA123), walks the
contiguous run, validates against known reversed handlers, and writes the full map
to `data/re/funclua-cmdid-handlers.json`.

Why: that map (cmdId -> handler VA) unblocks reversing any funcLua command — look up
its handler, then disassemble it (r2 on nie.exe, image base 0x140000000). It had been
lost; this regenerates it from the binary. No external deps (pure stdlib).

Usage: python3 scripts/extract_funclua_table.py [path/to/nie.exe]
"""
import json
import struct
import sys
from pathlib import Path

# Anchor: SetIconSprite cmdId — unique 4-byte immediate in .rdata, sits 8 bytes after its
# handler code-pointer in the dispatch table. Used to LOCATE the table (its handler VA is NOT
# hard-coded here on purpose: the handler addresses shift between game builds — see note below).
ANCHOR_CMDID = 0x214DA123

# NOTE (binary drift, 2026-06-19): the funcLua handler VAs documented in nie-lua/menu_host.rs
# (e.g. SetIconSprite -> 0x140CE74D0, table @ 0x141BDFD90) were reversed against an OLDER build of
# nie.exe. The current `nie_eacpatched.exe` on the VPS is a different build: the SAME cmdId
# (0x214DA123) now lives at table entry 0x141A85350 with handler 0x140CA3210. cmdId values are
# stable across builds (they are hashes of the command name), but every handler/table VA shifts.
# Therefore this extractor validates the table STRUCTURALLY (contiguous well-formed entries around
# the unique anchor) rather than against frozen VAs, and the map it emits is build-specific: always
# regenerate it for the exact exe you intend to disassemble.


def parse_pe(data):
    """Return (image_base, [(va_start, va_end, raw_off)]) from the PE section table."""
    pe_off = struct.unpack_from("<I", data, 0x3C)[0]
    assert data[pe_off:pe_off + 4] == b"PE\0\0", "not a PE"
    num_sections = struct.unpack_from("<H", data, pe_off + 6)[0]
    opt_size = struct.unpack_from("<H", data, pe_off + 20)[0]
    opt_off = pe_off + 24
    # PE32+ optional header: ImageBase is a u64 at offset 24 of the optional header.
    image_base = struct.unpack_from("<Q", data, opt_off + 24)[0]
    sec_off = opt_off + opt_size
    sections = []
    for i in range(num_sections):
        s = sec_off + i * 40
        vsize = struct.unpack_from("<I", data, s + 8)[0]
        vaddr = struct.unpack_from("<I", data, s + 12)[0]
        raw = struct.unpack_from("<I", data, s + 20)[0]
        sections.append((image_base + vaddr, image_base + vaddr + vsize, raw, vaddr))
    return image_base, sections


def va_to_off(va, sections):
    for vstart, vend, raw, vaddr in sections:
        if vstart <= va < vend:
            return raw + (va - vstart)
    return None


def off2va(off, sections):
    for vstart, vend, raw, vaddr in sections:
        if raw <= off < raw + (vend - vstart):
            return vstart + (off - raw)
    return 0


def main():
    default_exe = Path.home() / ".local/share/Steam/iecode/inazuma/nie_eacpatched.exe"
    exe = Path(sys.argv[1]) if len(sys.argv) > 1 else default_exe
    data = exe.read_bytes()
    image_base, sections = parse_pe(data)
    code_lo, code_hi = image_base, image_base + 0x1000000  # handlers live in the code image

    # Find the anchor cmdId as a 4-byte LE immediate within the table's data section.
    needle = struct.pack("<I", ANCHOR_CMDID)
    anchor_off = None
    pos = 0
    while True:
        i = data.find(needle, pos)
        if i < 0:
            break
        # A table entry has the cmdId 8 bytes after a code-pointer handler.
        if i >= 8:
            h = struct.unpack_from("<Q", data, i - 8)[0]
            if code_lo <= h < code_hi and struct.unpack_from("<I", data, i + 4)[0] == 0:
                anchor_off = i - 8  # start of the 16-byte entry
                break
        pos = i + 1
    assert anchor_off is not None, "anchor cmdId not found as a table entry"

    def valid(off):
        if off < 0 or off + 16 > len(data):
            return False
        h, q2 = struct.unpack_from("<QQ", data, off)
        return code_lo <= h < code_hi and 0 < q2 < 0x100000000

    start = anchor_off
    while valid(start - 16):
        start -= 16
    end = anchor_off
    while valid(end + 16):
        end += 16
    end += 16

    table = {}
    for off in range(start, end, 16):
        h, cid = struct.unpack_from("<QI", data, off)
        table[f"0x{cid:08X}"] = f"0x{h:09X}"

    # Structural validation (build-agnostic): the walked run must contain the anchor and span a
    # plausible number of entries (the table holds ~1.1k menu commands). A run of a handful would
    # mean we latched onto a stray code-ptr+u32 coincidence, not the real dispatch table.
    anchor_handler = struct.unpack_from("<Q", data, anchor_off)[0]
    assert table.get(f"0x{ANCHOR_CMDID:08X}") == f"0x{anchor_handler:09X}", "anchor not in walked run"
    assert len(table) >= 500, f"table too small ({len(table)} entries) — likely a false anchor"

    out = Path("data/re/funclua-cmdid-handlers.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(table, indent=0))
    print(f"funcLua dispatch table: {len(table)} entries -> {out}")
    print(f"  anchor 0x{ANCHOR_CMDID:08X} (SetIconSprite) -> handler 0x{anchor_handler:09X} "
          f"@ entry VA 0x{off2va(anchor_off, sections):09X}")
    print(f"  build-specific: handler VAs are valid ONLY for this exe ({exe.name})")


if __name__ == "__main__":
    main()
