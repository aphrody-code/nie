#!/usr/bin/env python3
"""
Extract all AOB patterns, hook definitions, and injection payloads
from InazumaElevenVRSaveEditor (.NET assembly).
"""
import struct
import json
import os
import dnfile

pe_path = "var/ievrsaveeditor/app_extracted.dll"
dn = dnfile.dnPE(pe_path)

with open(pe_path, "rb") as f:
    raw_pe = f.read()

# Map FieldRva: field_row_index -> (rva, foff)
field_rvas = {}
if hasattr(dn.net.mdtables, "FieldRva"):
    for fr in dn.net.mdtables.FieldRva.rows:
        rid = fr.Field.row_index
        rva = fr.Rva
        for s in dn.sections:
            if s.VirtualAddress <= rva < s.VirtualAddress + s.Misc_VirtualSize:
                foff = s.PointerToRawData + (rva - s.VirtualAddress)
                field_rvas[rid] = (rva, foff)
                break

# Also find size of fields from Field table or TypeDef of <PrivateImplementationDetails>
field_sizes = {}
for idx, row in enumerate(dn.net.mdtables.Field.rows, 1):
    fname = str(row.Name)

def get_il_bytes(rva):
    if rva == 0: return b""
    for s in dn.sections:
        if s.VirtualAddress <= rva < s.VirtualAddress + s.Misc_VirtualSize:
            foff = s.PointerToRawData + (rva - s.VirtualAddress)
            break
    else: return b""
    b0 = raw_pe[foff]
    if (b0 & 3) == 2: # tiny
        sz = b0 >> 2
        return raw_pe[foff+1 : foff+1+sz]
    elif (b0 & 3) == 3: # fat
        flags_sz = struct.unpack_from("<H", raw_pe, foff)[0]
        hdr_sz = (flags_sz >> 12) * 4
        code_sz = struct.unpack_from("<I", raw_pe, foff + 4)[0]
        return raw_pe[foff + hdr_sz : foff + hdr_sz + code_sz]
    return b""

def analyze_method(m_row):
    rva = m_row.Rva
    name = str(m_row.Name)
    il = get_il_bytes(rva)
    if not il: return None

    # Decompile sequence of opcodes
    us_stream = dn.net.user_strings
    strings_found = []
    byte_arrays = []
    ints_found = []

    i = 0
    while i < len(il):
        op = il[i]
        # ldc.i4.s
        if op == 0x1f:
            val = struct.unpack_from("<b", il, i+1)[0]
            ints_found.append(val)
            i += 2
        # ldc.i4
        elif op == 0x20:
            val = struct.unpack_from("<i", il, i+1)[0]
            ints_found.append(val)
            i += 5
        # ldc.i4.0 .. ldc.i4.8
        elif 0x15 <= op <= 0x1e:
            ints_found.append(op - 0x16)
            i += 1
        # ldstr
        elif op == 0x72:
            tok = struct.unpack_from("<I", il, i+1)[0]
            s_off = tok & 0xffffff
            try:
                s = us_stream.get(s_off)
                if s and s.value:
                    strings_found.append(s.value)
            except Exception: pass
            i += 5
        # ldtoken (field)
        elif op == 0xd0:
            tok = struct.unpack_from("<I", il, i+1)[0]
            table = tok >> 24
            rid = tok & 0xffffff
            if table == 4 and rid in field_rvas:
                rva_f, foff = field_rvas[rid]
                # Look back in ints_found for array length if possible
                arr_len = ints_found[-1] if ints_found and 0 < ints_found[-1] < 2000 else 64
                data = raw_pe[foff : foff + arr_len]
                byte_arrays.append({
                    "field_rid": rid,
                    "rva": hex(rva_f),
                    "len": arr_len,
                    "hex": data.hex(),
                    "bytes": " ".join(f"{b:02X}" for b in data)
                })
            i += 5
        else:
            i += 1

    return {
        "name": name,
        "rva": hex(rva),
        "il_size": len(il),
        "strings": strings_found,
        "byte_arrays": byte_arrays,
        "ints": ints_found[-10:] if ints_found else []
    }

target_services = [
    "MemoryEditorService",
    "BadgeSlotService",
    "CustomPassivesService",
    "CustomPassivesSummonService",
    "PlayerLevelService",
    "PlayerSpiritsService",
    "UnlimitedSpiritsService",
]

report = {}
for row in dn.net.mdtables.TypeDef.rows:
    tname = str(row.TypeName)
    if any(t == tname for t in target_services):
        full_name = f"{str(row.TypeNamespace)}.{tname}"
        report[full_name] = []
        for m in row.MethodList:
            info = analyze_method(m.row)
            if info and (info["strings"] or info["byte_arrays"]):
                report[full_name].append(info)

os.makedirs("var/ievrsaveeditor/re_dump", exist_ok=True)
with open("var/ievrsaveeditor/re_dump/hooks_extracted.json", "w") as out:
    json.dump(report, out, indent=2)

print(f"Extracted hook data for {len(report)} services.")
for sname, methods in report.items():
    print(f"\n=== {sname} ({len(methods)} methods) ===")
    for m in methods:
        if any(k in m['name'] for k in ['Inject', 'Hook', 'Enable', 'Apply', 'Set']):
            print(f"  * {m['name']} (IL={m['il_size']})")
            for s in m['strings']:
                if any(x in s.lower() for x in ['failed', 'aob', 'hook', 'inject', 'pattern', 'nie.exe']):
                    print(f"      str: {s.strip()}")
            for b in m['byte_arrays']:
                print(f"      arr (len {b['len']}): {b['bytes']}")
