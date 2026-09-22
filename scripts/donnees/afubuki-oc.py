"""SQL idempotent d'intégration du Mixi-Max Afubuki.

Le script réutilise l'identifiant runtime existant du slot remplacé.
Il ne crée donc aucune donnée binaire ni nouvel identifiant VFS. Le libellé
canonique exporté est « Mix 'n' Match: Afubuki ».

    uv run scripts/donnees/afubuki-oc.py > /tmp/afubuki.sql
"""

import json
import sys

sys.stdout.reconfigure(encoding="utf-8")

RUNTIME_ID = "0x2A80A796"  # slot runtime existant, conservé pour le VFS
LEGACY_ID = f"miximax_{RUNTIME_ID}"
PROVISIONAL_ID = "miximax_afubuki"
MIXIMAX_NAME_FR = "Transfo. Miximax : Afubuki"
MIXIMAX_NAME_EN = "Mix 'n' Match: Afubuki"
PARTNER = "Shawn Froste / Shirou Fubuki"
ORIGIN = "Référence VFS canonique Byron Love / Shawn Froste"


def q(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (dict, list)):
        return "$j$" + json.dumps(value, ensure_ascii=False) + "$j$::jsonb"
    return "$t$" + str(value) + "$t$"


def insert(table, columns):
    names = ", ".join(columns)
    values = ", ".join(q(value) for value in columns.values())
    updates = ", ".join(f"{name} = EXCLUDED.{name}" for name in columns if name != "id")
    return (
        f"INSERT INTO public.{table} ({names})\nVALUES ({values})\n"
        f"ON CONFLICT (id) DO UPDATE SET {updates}, updated_at = now();"
    )


print("BEGIN;")
print("-- Byron Love / Shawn Froste : référence Mixi-Max native VFS.")
print("-- Afubuki : aucune ligne personnage/stat/skill/aura inventée.")
print("-- Remplacement du libellé legacy, avec conservation de l'identifiant runtime.")
print(insert("inagle_miximax", {
    "id": LEGACY_ID,
    "name_fr": MIXIMAX_NAME_FR,
    "name_en": MIXIMAX_NAME_EN,
    "name_ja": None,
    "description_fr": "Référence factuelle à Shawn Froste / Shirou Fubuki; hash VFS dédié non identifié.",
    "description_en": "Factual reference to Shawn Froste / Shirou Fubuki; no dedicated VFS hash identified.",
    "description_ja": None,
    "type": "Miximax",
    "sub_type": "Miximax",
    "element_id": None,
    "image_url": None,
    "icon_code": None,
    "asset_code": None,
    "has_asset": False,
    "sheet_data": {"subType": "Miximax", "origin": ORIGIN, "partner": PARTNER, "hash": RUNTIME_ID, "source_text_hash": "0x4785C8B1", "canonical_name_en": MIXIMAX_NAME_EN, "replaces_display_name": "Mix 'n' Match Axel"},
    "data": {"origin": ORIGIN, "owner": "Byron Love / Shawn Froste", "partner": PARTNER, "runtime_id": RUNTIME_ID, "canonical_name_en": MIXIMAX_NAME_EN, "replaces_display_name": "Mix 'n' Match Axel"},
}))
print()
print(f"DELETE FROM public.inagle_miximax WHERE id = {q(PROVISIONAL_ID)} AND id <> {q(LEGACY_ID)};")
print()
print("COMMIT;")
print("NOTIFY pgrst, 'reload schema';")
