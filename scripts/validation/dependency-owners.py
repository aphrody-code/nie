"""Validate dependency ownership without compiling or importing project packages."""
import json
from pathlib import Path
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[2]
errors = []
assertions = 0


def require(condition, message):
    global assertions
    assertions += 1
    if not condition:
        errors.append(message)


root_package = json.loads((ROOT / "package.json").read_text())
workspaces = root_package["workspaces"]
manifests = {ROOT / "package.json": root_package}
for pattern in workspaces["packages"]:
    for directory in ROOT.glob(pattern):
        path = directory / "package.json"
        if path.is_file():
            manifests[path] = json.loads(path.read_text())
names = {manifest["name"] for manifest in manifests.values()}
require(len(names) == len(manifests), "Workspace package names must be unique")
bun_edges = 0
for path, manifest in manifests.items():
    external_manifest = not path.resolve().is_relative_to(ROOT.resolve())
    for section in ("dependencies", "devDependencies", "optionalDependencies"):
        for name, spec in manifest.get(section, {}).items():
            bun_edges += 1
            label = f"{path}:{section}.{name}"
            if external_manifest:
                # Sibling workspaces own their own catalogues. The root check only
                # enforces ownership for manifests maintained by this repository.
                continue
            if name in names:
                if spec == "workspace:*":
                    continue
                if spec.startswith("file:"):
                    target = (path.parent / spec.removeprefix("file:")).resolve()
                    target_manifest = target / "package.json"
                    require(
                        target_manifest.is_file()
                        and json.loads(target_manifest.read_text()).get("name") == name,
                        f"{label} must point at the canonical workspace owner",
                    )
                else:
                    require(False, f"{label} must use its local workspace owner")
            else:
                require(spec.startswith("catalog:"), f"{label} must use the root catalogue")
                if spec.startswith("catalog:"):
                    catalog_name = spec.removeprefix("catalog:")
                    catalog = (workspaces.get("catalogs", {}).get(catalog_name, {})
                               if catalog_name else workspaces["catalog"])
                    require(name in catalog, f"{label} has no catalogue entry")

cargo = tomllib.loads((ROOT / "Cargo.toml").read_text())
catalog = cargo["workspace"]["dependencies"]
members = set()
for pattern in cargo["workspace"]["members"]:
    members.update(path / "Cargo.toml" for path in ROOT.glob(pattern)
                   if (path / "Cargo.toml").is_file())
rust_edges = 0
for path in sorted(members):
    manifest = tomllib.loads(path.read_text())
    sections = [manifest, *manifest.get("target", {}).values()]
    for section in sections:
        for kind in ("dependencies", "dev-dependencies", "build-dependencies"):
            for name, spec in section.get(kind, {}).items():
                rust_edges += 1
                label = f"{path.relative_to(ROOT)}:{kind}.{name}"
                require(isinstance(spec, dict) and spec.get("workspace") is True,
                        f"{label} must use the workspace owner")
                require(name in catalog, f"{label} has no workspace catalogue entry")

require(not (ROOT / "apps/inacord").exists(),
        "The Inacord Tauri app was removed on 2026-09-26; the desktop is aphrody-ui aphrody-app")
require(bool(bun_edges and rust_edges), "An empty dependency inventory cannot pass")
print(json.dumps({"bunManifests": len(manifests), "bunDependencies": bun_edges,
                  "rustMembers": len(members), "rustDependencies": rust_edges,
                  "assertions": assertions, "failures": errors}, indent=2))
sys.exit(bool(errors))
