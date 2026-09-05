"""Esprit guerrier et Mixi Max d'Astro Lor (personnage original).

Complète `astro-lor-oc.py` : crée le Kesshin « Morphée, le Dieu des Rêves » et les
quatre Mixi Max recensés dans le document de présentation, puis les rattache aux deux
variantes d'Astro via `inagle_characters.data->'auras'`, qui est la clé lue par
`wikiService.getCharacterAuras()`.

Aucune image n'est associée : ces auras n'existent pas dans les assets du jeu, et une
illustration empruntée à un autre personnage serait un faux. La carte s'affiche sans
visuel, ce qui est exact.

    uv run scripts/donnees/astro-lor-auras.py > /tmp/astro-auras.sql
    sudo -u postgres psql -d rg -f /tmp/astro-auras.sql
"""

import json

ELEMENT_ID = 2  # Forêt (type Bois)
ID_OG = "0x9983CCE2"
ID_VR = "0x0C78B74B"

KESSHIN = {
    "hash": "0xCFD002A0",
    "name_fr": "Morphée, le Dieu des Rêves",
    "name_en": "Morpheus, God of Dreams",
    "hissatsu": {
        "name": "Vœux Précieux",
        "name_EN": "Precious Wish",
        "type": "Arrêt",
        "element": "Forêt",
        "power": {"min": 80, "max": 420},
        "skillIdStr": "ock6006",
    },
}

MIXIMAX = [
    ("0xA5C69DB2", "Master Dragon", "Master Dragon",
     "Fusion réalisée dans Chrono Stone, par l’intermédiaire d’Heka : l’esprit d’Asta "
     "s’y mêle, ce qui donne une double force et permet de contrôler le Master Dragon."),
    ("0x056F6CFC", "Shawn Froste", "Shawn Froste", None),
    ("0xFFCE6BFF", "Celia Hills", "Celia Hills", None),
    ("0x8DC4DA83", "Asta Lor", "Asta Lor",
     "Sa sœur jumelle. Depuis Hokkaido, Astro détient deux âmes : la sienne, et celle "
     "d’Asta."),
]

ORIGINE = "Personnage original — Astro Lor"


def q(valeur):
    if valeur is None:
        return "NULL"
    if isinstance(valeur, bool):
        return "TRUE" if valeur else "FALSE"
    if isinstance(valeur, (int, float)):
        return str(valeur)
    if isinstance(valeur, (dict, list)):
        return "$j$" + json.dumps(valeur, ensure_ascii=False) + "$j$::jsonb"
    return "$t$" + str(valeur) + "$t$"


def insert(table, colonnes):
    noms = ", ".join(colonnes)
    valeurs = ", ".join(q(v) for v in colonnes.values())
    maj = ", ".join(f"{c} = EXCLUDED.{c}" for c in colonnes if c != "id")
    return (f"INSERT INTO public.{table} ({noms})\nVALUES ({valeurs})\n"
            f"ON CONFLICT (id) DO UPDATE SET {maj}, updated_at = now();")


print("BEGIN;")
print("-- Astro Lor : esprit guerrier et Mixi Max. Rejouable.")
print()

sheet_kesshin = {"hissatsu": KESSHIN["hissatsu"], "subType": "Keshin", "origin": ORIGINE}
print(insert("inagle_keshins", {
    "id": f"keshin_{KESSHIN['hash']}",
    "name_fr": KESSHIN["name_fr"], "name_en": KESSHIN["name_en"], "name_ja": None,
    "description_fr": (
        "Esprit guerrier d’Astro Lor. Sert notamment sa technique d’arrêt la plus "
        "puissante, Vœux Précieux."
    ),
    "description_en": None, "description_ja": None,
    "type": "Keshin", "sub_type": "Keshin",
    "element_id": ELEMENT_ID,
    "image_url": None, "asset_code": None, "has_asset": False,
    "sheet_data": sheet_kesshin,
    "data": {"origin": ORIGINE, "owner": "Astro Lor"},
}))
print()

for hash_, nom, nom_en, description in MIXIMAX:
    print(insert("inagle_miximax", {
        "id": f"miximax_{hash_}",
        "name_fr": f"Transfo. Miximax : {nom}",
        "name_en": f"Mix 'n' Match: {nom_en}",
        "name_ja": None,
        "description_fr": description, "description_en": None, "description_ja": None,
        "type": "Miximax", "sub_type": "Miximax",
        "element_id": ELEMENT_ID,
        "image_url": None, "icon_code": None, "asset_code": None, "has_asset": False,
        "sheet_data": {"subType": "Miximax", "origin": ORIGINE, "partner": nom},
        "data": {"origin": ORIGINE, "owner": "Astro Lor", "partner": nom},
    }))
    print()

auras = [{"skillId": KESSHIN["hash"], "type": "keshin"}]
auras += [{"skillId": h, "type": "miximax"} for h, *_ in MIXIMAX]

for id_ in (ID_OG, ID_VR):
    print(f"UPDATE public.inagle_characters\n"
          f"SET data = jsonb_set(coalesce(data, '{{}}'::jsonb), '{{auras}}', {q(auras)}),\n"
          f"    updated_at = now()\n"
          f"WHERE id = {q(id_)};")
    print()

print("COMMIT;")
print("NOTIFY pgrst, 'reload schema';")
