#!/usr/bin/env python3
"""Audit every menu `*_setting.cfg.bin` for the OBJBIN files it references.

A setting whose layers all point at absent OBJBIN files is a stale recipe: rendering it
produces an empty screen, which must not be mistaken for a screen that has no objects.

Inputs:
  var/outputs/menu-inventory/cfg/          (niers vfs extract data/common/gamedata/menu/cfg)
  var/outputs/menu-inventory/vfs-paths.json (niers vfs find "data/" -n 400000 --json)
Output:
  var/outputs/menu-inventory/objbin-reference-audit.json
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
BASE = ROOT / "var/outputs/menu-inventory"
CFG_DIR = BASE / "cfg"
OBJ_PREFIX = "data/common/gamedata/menu/obj/"
REF = re.compile(rb"[ -~]*gamedata/menu/obj/[ -~]+\.objbin")

vfs = {e["path"] for e in json.loads((BASE / "vfs-paths.json").read_text())}


def normalize(ref: str) -> str:
    """cfg.bin stores `common/gamedata/...`; the VFS mounts it under `data/`."""
    return ref if ref.startswith("data/") else f"data/{ref.lstrip('/')}"


settings, stale, partial = [], [], []
for path in sorted(CFG_DIR.glob("*_setting.cfg.bin")):
    refs = [normalize(m.decode()) for m in REF.findall(path.read_bytes())]
    if not refs:
        continue
    missing = [r for r in refs if r not in vfs]
    record = {
        "setting": f"data/common/gamedata/menu/cfg/{path.name}",
        "referenced": len(refs),
        "missing": len(missing),
        "missing_paths": missing,
    }
    settings.append(record)
    if missing and len(missing) == len(refs):
        stale.append(record)
    elif missing:
        partial.append(record)

missing_names = {}
for record in settings:
    for ref in record["missing_paths"]:
        missing_names.setdefault(ref[len(OBJ_PREFIX):], []).append(record["setting"])

report = {
    "schema_version": 1,
    "generated_by": "scripts/validation/menu-objbin-reference-audit.py",
    "settings_with_objbin_references": len(settings),
    "fully_stale_settings": len(stale),
    "partially_stale_settings": len(partial),
    "distinct_missing_objbins": len(missing_names),
    "stale": stale,
    "partial": partial,
    "missing_objbin_consumers": {k: sorted(set(v)) for k, v in sorted(missing_names.items())},
}
out = BASE / "objbin-reference-audit.json"
out.write_text(json.dumps(report, indent=2) + "\n")
print(
    f"settings={len(settings)} fully_stale={len(stale)} partial={len(partial)} "
    f"missing_objbins={len(missing_names)} -> {out.relative_to(ROOT)}"
)
for record in stale[:20]:
    print("  STALE", record["setting"], record["referenced"])
