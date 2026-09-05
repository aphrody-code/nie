"""Manifeste des assets nécessaires pour faire entrer Astro Lor dans le jeu.

Rien n'est cité de mémoire. Le manifeste se construit en trois temps :

1. on demande au VFS les fichiers d'un personnage EXISTANT, qui sert de gabarit ;
2. on décline ces chemins pour les codes internes d'Astro, en respectant le groupe de
   dossier de sa série (`01_IE1`, `11_VICTORY`, … — la liste vient de `niers vfs ls`) ;
3. on interroge le VFS pour chaque chemin cible, et on regarde sur le disque quelles
   sources sont déjà là.

Chaque ligne du manifeste porte donc un statut mesuré, jamais supposé.

    uv run scripts/donnees/astro-lor-manifeste.py
    jq '.resume' astro/manifeste-assets.json
"""

import json
import subprocess
from pathlib import Path

RACINE = Path(__file__).resolve().parents[2]
SORTIE = RACINE / "astro" / "manifeste-assets.json"
SOURCES = RACINE / "astro" / "sources"
PUBLIC = RACINE / "apps" / "azalee" / "public" / "oc" / "astro-lor"

# Gabarit : un gardien de Raimon déjà dans le jeu. Ses fichiers donnent la forme exacte
# de ce qu'un personnage possède en propre — le corps, les uniformes et les animations
# sont partagés et ne portent pas le code du personnage.
GABARIT = "c02023290"

# Les douze groupes de `data/common/chr/_face/`, relevés par `niers vfs ls`.
GROUPES = ["01_IE1", "02_IE2", "03_IE3", "04_GO1", "05_GO2", "06_GO3",
           "07_ARES", "08_ORION", "11_VICTORY", "20_EDIT", "21_MANNEQUIN", "22_COMBO"]

VARIANTES = [
    {"code": "c99019010", "nom": "Astro Lor — Inazuma Eleven", "groupe": "01_IE1",
     "chara_param_id": "0x9983CCE2", "portrait_source": "face-og.webp",
     "planches": ["planche-og-tenue-jaune.webp", "planche-og-tenue-foot.webp",
                  "planche-og-tenue-hakuren.webp", "planche-og-anatomie.webp",
                  "planche-og-expressions.webp"]},
    {"code": "c99019020", "nom": "Astro Lor — Victory Road", "groupe": "11_VICTORY",
     "chara_param_id": "0x0C78B74B", "portrait_source": "face-go.webp",
     "planches": ["planche-go-tenue-ville.webp", "planche-go-tenue-foot.webp",
                  "planche-go-anatomie.webp", "planche-go-expressions.webp"]},
]

# Rôle de chaque fichier propre à un personnage, et l'outil du dépôt qui sait l'écrire.
# `outil = null` signale un format que le dépôt sait LIRE mais pas encore ÉCRIRE.
ROLES = [
    {"cle": "maille_tete", "gabarit": "common/chr/_face/{groupe}/{code}/{code}.g4md",
     "format": "G4MD", "role": "Maille de la tête",
     "outil": None, "note": "Le dépôt lit le G4MD (nie-formats) ; l'écriture reste à faire."},
    {"cle": "geometrie_tete", "gabarit": "common/chr/_face/{groupe}/{code}/{code}.g4mg",
     "format": "G4MG", "role": "Géométrie de la tête (sommets, poids de skinning)",
     "outil": None, "note": "Lecture validée byte-exact (extract_skin) ; écriture à faire."},
    {"cle": "texture_tete", "gabarit": "dx11/chr/_face/{groupe}/{code}/{code}.g4tx",
     "format": "G4TX", "role": "Texture de la tête",
     "outil": "niers (conversion d'image → G4TX, encodage BC7)",
     "note": "Le décodage BC7 est validé ; l'encodage passe par la voie C#/C++."},
    {"cle": "icone_portrait", "gabarit": "dx11/menu/200_icon/10_icon_chr/face/{code}_l.g4tx",
     "format": "G4TX", "role": "Icône de portrait (menus, fiche, effectif)",
     "outil": "niers (conversion d'image → G4TX)",
     "note": "Une source 512×512 existe déjà pour les deux variantes."},
    {"cle": "voix_acb", "gabarit": "common/sound_asset/ja/{code}.acb",
     "format": "ACB (CriWare)", "role": "Banque de voix",
     "outil": None, "note": "Le dépôt décode le HCA ; l'écriture d'un ACB n'est pas faite."},
    {"cle": "voix_awb", "gabarit": "common/sound_asset/ja/{code}.awb",
     "format": "AWB (CriWare)", "role": "Flux audio des voix",
     "outil": None, "note": "Facultatif : un personnage muet reste jouable."},
]

# Les tables `cfg.bin` où un personnage doit être DÉCLARÉ. Sans une ligne dans chacune,
# les assets ci-dessus ne sont jamais chargés.
TABLES = [
    ("chara_base", "Fiche de base : identité, série, code interne"),
    ("chara_param", "Paramètres : poste, élément, rareté, statistiques"),
    ("chara_model", "Association code interne → modèle et texture"),
    ("chara_parts", "Pièces du modèle (tête, corps, uniforme)"),
    ("chara_scale", "Échelle et stature"),
    ("chara_motion", "Jeux d'animations"),
    ("chara_face", "Expressions du visage"),
    ("chara_name_tag", "Étiquette de nom affichée en match"),
    ("chara_costume", "Tenues disponibles"),
]


def vfs(requete: str, limite: int = 200) -> list[dict]:
    """Interroge le VFS. Une erreur de l'outil rend une liste vide, jamais une invention."""
    try:
        sortie = subprocess.run(
            ["niers", "vfs", "find", requete, "--json", "-n", str(limite)],
            capture_output=True, text=True, timeout=420, cwd=RACINE)
    except (OSError, subprocess.TimeoutExpired):
        return []
    if sortie.returncode != 0:
        return []
    try:
        return json.loads(sortie.stdout.strip() or "[]")
    except json.JSONDecodeError:
        return []


def taille_locale(chemin: Path) -> int | None:
    return chemin.stat().st_size if chemin.is_file() else None


gabarit_fichiers = vfs(GABARIT)
gabarit_chemins = [f["path"] for f in gabarit_fichiers]

# Les tables : on relève leur chemin VERSIONNÉ réel — un chemin cité sans son numéro de
# version est faux, et c'est l'erreur classique sur ce jeu.
tables = []
for nom, role in TABLES:
    trouves = [f for f in vfs(f"gamedata/character/{nom}") if f"/{nom}" in f["path"]]
    exacts = [f for f in trouves
              if Path(f["path"]).name.split(".")[0].rstrip("_0123456789") in (nom, nom + "_")
              or Path(f["path"]).name.startswith(nom + "_")
              or Path(f["path"]).name == nom + ".cfg.bin"]
    retenus = exacts or trouves
    tables.append({
        "table": nom,
        "role": role,
        "chemins": [{"chemin": f["path"], "octets": f["size"]} for f in retenus[:4]],
        "trouve": bool(retenus),
    })

cibles = []
for v in VARIANTES:
    assets = []
    for r in ROLES:
        relatif = r["gabarit"].format(groupe=v["groupe"], code=v["code"])
        chemin = f"data/{relatif}" if not relatif.startswith("common/") else f"data/{relatif}"
        present = bool(vfs(v["code"], 20))
        source = None
        if r["cle"] == "icone_portrait":
            p = PUBLIC / v["portrait_source"]
            if p.is_file():
                source = {"fichier": str(p.relative_to(RACINE)), "octets": taille_locale(p)}
        assets.append({
            "cle": r["cle"],
            "role": r["role"],
            "format": r["format"],
            "chemin_vfs": chemin,
            "present_dans_le_jeu": present,
            "statut": "present" if present else ("source_prete" if source else "a_produire"),
            "source": source,
            "outil": r["outil"],
            "note": r["note"],
        })
    planches = []
    for nom in v["planches"]:
        p = PUBLIC / nom
        if p.is_file():
            planches.append({"fichier": str(p.relative_to(RACINE)), "octets": taille_locale(p)})
    cibles.append({
        "code_interne": v["code"],
        "nom": v["nom"],
        "groupe_dossier": v["groupe"],
        "chara_param_id": v["chara_param_id"],
        "assets": assets,
        "references_artistiques": planches,
    })

manifeste = {
    "personnage": "Astro Lor",
    "nature": "personnage original (OC) — n'existe pas dans les données du jeu",
    "auteur_des_planches": "@Karumina_san",
    "gabarit": {
        "code_interne": GABARIT,
        "pourquoi": "gardien déjà présent dans le jeu ; ses fichiers donnent la forme exacte "
                    "de ce qu'un personnage possède en propre",
        "fichiers": [{"chemin": f["path"], "octets": f["size"]} for f in gabarit_fichiers],
    },
    "groupes_de_dossier": GROUPES,
    "bandes_dessinees": [
        {"page": i, "publie": str((PUBLIC / f"bd-page-{i}.webp").relative_to(RACINE)),
         "octets": taille_locale(PUBLIC / f"bd-page-{i}.webp"),
         "source": str((SOURCES / "bd" / f"page-{i}.webp").relative_to(RACINE)),
         "octets_source": taille_locale(SOURCES / "bd" / f"page-{i}.webp")}
        for i in (1, 2, 3)
    ],
    "cibles": cibles,
    "tables_a_declarer": tables,
    "verrous": [
        {
            "nom": "Réencodage fidèle des cfg.bin",
            "bloquant": True,
            "constat": "Un aller-retour à vide de cpk_list.cfg.bin change le sha et perd "
                       "16 octets, sans qu'aucune modification ait été faite, et le jeu "
                       "refuse le fichier. Sur game_param.cfg.bin, /entries/0/children "
                       "retombe de 812 à 1 élément.",
            "consequence": "Ajouter une LIGNE à chara_base ou chara_param change la taille "
                           "du fichier : le patch d'octets en place, qui suffit pour un mod "
                           "à taille constante, ne suffit pas ici.",
            "avant_de_conclure": "Ne rien déduire d'un fichier « relu correctement » : le "
                                 "parseur du dépôt est plus permissif que le jeu.",
        },
        {
            "nom": "Écriture des formats de modèle",
            "bloquant": True,
            "constat": "G4MD et G4MG se lisent (skinning validé byte-exact) ; rien ne les écrit.",
            "consequence": "Le modèle de tête doit être produit par un autre chemin, ou la "
                           "voie d'écriture doit être ouverte.",
        },
        {
            "nom": "Encodage G4TX",
            "bloquant": False,
            "constat": "Le décodage BC7 est validé ; l'encodage existe côté C# et C++, la "
                       "conversion C++ étant la moins bonne des trois.",
            "consequence": "Passer par la voie C# pour les textures et les icônes.",
        },
        {
            "nom": "Budget d'entrées loose",
            "bloquant": False,
            "constat": "`niers mod install` refuse au-delà de 64 entrées déjà loose dans "
                       "le cpk_list : le fichier a alors déjà été packé.",
        },
    ],
    "hors_perimetre_du_manifeste": [
        "Corps, uniformes, squelettes et animations : partagés entre personnages, ils ne "
        "portent pas le code interne et n'ont donc pas à être produits.",
        "Textes de nom et de description : servis par les tables de texte du jeu, pas par "
        "un fichier propre au personnage.",
    ],
}

compte = {"present": 0, "source_prete": 0, "a_produire": 0}
for c in manifeste["cibles"]:
    for a in c["assets"]:
        compte[a["statut"]] += 1
manifeste["resume"] = {
    "assets_total": sum(compte.values()),
    **compte,
    "tables_reperees": sum(1 for t in tables if t["trouve"]),
    "tables_total": len(tables),
    "references_artistiques": sum(len(c["references_artistiques"]) for c in manifeste["cibles"]),
}

SORTIE.parent.mkdir(parents=True, exist_ok=True)
SORTIE.write_text(json.dumps(manifeste, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(manifeste["resume"], ensure_ascii=False, indent=2))
print(f"→ {SORTIE.relative_to(RACINE)}")
