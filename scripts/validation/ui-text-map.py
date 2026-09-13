#!/usr/bin/env python3
"""Rebuild `packages/inacord-ui/src/lib/ui-text-map.ts` from the served text corpus.

The map is a MEASUREMENT, not an editable table: every `(family, hash)` pair it carries was
read back one by one from `/api/v1/text/fr/{family}/{hash}` and the line the route returned is
what lands in `fr`. This script is the only thing allowed to write that file, so that a
correspondence can never be added by hand — which is exactly how a table of "the game says X"
starts drifting from what the game actually says.

Five stages, each cached in the work directory so a re-run costs nothing:

    inventory  the hand-written labels of `apps/nie-web/src` + `packages/inacord-ui/src`
    corpus     every French line the site serves, family by family
    map        the exact / transformed correspondences, each re-read over HTTP
    misses     for every label left over, what `/api/v1/text/search` really returns
    emit       the TypeScript module

    python3 scripts/validation/ui-text-map.py                 # all stages, cache honoured
    python3 scripts/validation/ui-text-map.py --stage emit    # re-emit from the cache alone
    python3 scripts/validation/ui-text-map.py --refresh       # ignore the cache

The default origin is the public site: this script measures what is SERVED, which is the same
thing the browser will fetch at runtime. Point `--origin` at a local `nie-site` to measure a
build before it ships.
"""

from __future__ import annotations

import argparse
import bisect
import collections
import datetime
import difflib
import json
import os
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "packages/inacord-ui/src/lib/ui-text-map.ts"
ROOTS = [REPO / "apps/nie-web/src", REPO / "packages/inacord-ui/src"]
SKIP_DIRS = ("/wasm/", "/vendor/", "/node_modules/")
# The generated map, and the module that consumes it, quote every label they carry. Sweeping
# them would make the inventory describe ITSELF: `usedAt` would point at the table instead of
# the screen, and the doc comment's French prose would enter the corpus search as a label.
SKIP_FILES = re.compile(r"\.(test|spec)\.(ts|tsx)$|\.d\.ts$|^ui-text-map\.ts$|^game-text(-context)?\.tsx?$")

# The families that carry INTERFACE text. The others hold proper nouns: finding "Forge" in
# `chara_text` means the game has a character called Forge, not that "Forge" is a button.
UI_FAMILIES = [
    "menu_text",
    "help_list_text",
    "system_text",
    "soccer_common_text",
    "shop_text",
    "craft_text",
    "rpg_battle_cmd_text",
    "team_text",
    "quest_purpose_text",
    "inacode_text",
]


# --------------------------------------------------------------------------- helpers


def norm(value: str) -> str:
    """Typographic apostrophes and non-breaking spaces collapsed — nothing else."""
    value = value.replace("’", "'").replace("‘", "'")
    value = value.replace(" ", " ").replace(" ", " ")
    return re.sub(r"\s+", " ", value).strip()


def fold(value: str) -> str:
    """`norm`, lowercased and stripped of diacritics — for NEIGHBOUR search only."""
    lowered = norm(value).lower()
    return "".join(c for c in unicodedata.normalize("NFD", lowered) if unicodedata.category(c) != "Mn")


def get_json(url: str, attempts: int = 4, timeout: int = 120):
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception:
            if attempt == attempts - 1:
                return None
    return None


def cached(work: Path, name: str, refresh: bool, build):
    path = work / name
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))
    value = build()
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    return value


def sources():
    for root in ROOTS:
        for dirpath, _dirs, files in os.walk(root):
            if any(part in dirpath + "/" for part in SKIP_DIRS):
                continue
            for name in files:
                if name.endswith((".ts", ".tsx")) and not SKIP_FILES.search(name):
                    yield Path(dirpath) / name


# --------------------------------------------------------------------------- inventory

ACCENTS = "àâäéèêëïîôöùûüçœÀÂÄÉÈÊËÏÎÔÖÙÛÜÇŒ"
FRENCH_WORDS = set(
    """
le la les un une des du de au aux et ou ne pas plus moins sur sous dans par pour avec sans
ce cet cette ces son sa ses leur leurs mon ma mes votre vos notre nos
est sont etre être avoir a ont fait faire aucun aucune tout tous toute toutes
chargement charger chargée chargé enregistrer enregistrement supprimer ajouter modifier
retour revenir valider annuler fermer ouvrir choisir sélectionner selection sélection
recherche rechercher chercher filtre filtres trier tri afficher masquer copier coller
nom noms titre titres page pages liste listes tableau ligne lignes colonne colonnes
joueur joueurs equipe équipe équipes match matchs partie parties jeu jeux
niveau niveaux paramètres parametres réglages reglages options aide
aucun erreur erreurs succès succes échec echec impossible indisponible disponible
nouveau nouvelle nouveaux nouvelles ancien précédent precedent suivant suivante
oui non peut-être quitter démarrer demarrer commencer continuer terminer
boutique magasin objet objets inventaire compétence competence compétences techniques
sauvegarde sauvegarder chargement galerie modèle modele modèles modeles texture textures
son sons vidéo video vidéos videos musique image images fichier fichiers dossier dossiers
""".split()
)

STRING = re.compile(r"""(?<![\w$])(["'])((?:\\.|(?!\1)[^\\\n])*)\1""")
TEMPLATE = re.compile(r"`([^`$\\\n]*)`")
JSX_TEXT = re.compile(r">([^<>{}\n]{2,80})<")
ATTRIBUTE = re.compile(
    r"""\b(aria-label|title|placeholder|label|alt|heading|caption|subtitle|tooltip|name|text)"""
    r"""\s*=\s*(?:\{\s*)?(["'])((?:\\.|(?!\2)[^\\\n])*)\2"""
)
PROPERTY = re.compile(
    r"""\b(label|title|caption|heading|subtitle|placeholder|text|name)\s*:\s*"""
    r"""(["'])((?:\\.|(?!\2)[^\\\n])*)\2"""
)

NOISE = re.compile(
    r"^#[0-9a-fA-F]{3,8}$"
    r"|^(image|audio|video|text|application)/"
    r"|^[@~]?[\w.\-]+/[\w.\-/]+$"
    r"|^[A-Z_]+=|^--[a-z-]+$"
)
FILE_LIKE = re.compile(
    r"https?://|^/|^\./|^\.\./"
    r"|\.(ts|tsx|js|json|png|jpg|jpeg|svg|css|webp|cfg|bin|g4tx|wasm|mp4|webm|ogg|glb|gltf|cpk)\b"
)
TAILWIND = re.compile(r"\b(flex|grid|text-|bg-|p[xytblr]?-\d|m[xytblr]?-\d|rounded|border|w-|h-|gap-|items-|justify-)")
IDENTIFIER = re.compile(r"^[a-z][a-zA-Z0-9]*$|^[a-z0-9]+([_\-][a-z0-9]+)+$|^[A-Z][a-zA-Z0-9]*$")
MARKUP = re.compile(r"[<>{}$\\]")


def looks_like_code(value: str) -> bool:
    text = value.strip()
    if not text or NOISE.search(text) or FILE_LIKE.search(text) or TAILWIND.search(text):
        return True
    if re.fullmatch(r"[\s\W\d]+", text) or re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", text):
        return True
    words = text.lower().split()
    return bool(
        re.fullmatch(r"[a-z0-9_\-]+(\s+[a-z0-9_\-:\[\]\./%]+)*", text)
        and not any(word in FRENCH_WORDS for word in words)
    )


def is_french(value: str) -> bool:
    text = value.strip()
    if not 2 <= len(text) <= 120:
        return False
    if any(c in ACCENTS for c in text):
        return True
    words = re.findall(r"[A-Za-zÀ-ÿ'\-]+", text.lower())
    if not words:
        return False
    hits = sum(1 for word in words if word in FRENCH_WORDS)
    return hits >= 1 and hits / len(words) >= 0.25


def ui_candidate(value: str) -> str | None:
    """A string sitting in an interface POSITION, whether or not it reads as French."""
    text = re.sub(r"\s+", " ", value.replace("\\n", " ").replace("\\t", " ")).strip()
    if not 2 <= len(text) <= 80 or MARKUP.search(text) or FILE_LIKE.search(text) or NOISE.search(text):
        return None
    if not re.match(r"[A-Za-zÀ-ÿ(«]", text) or TAILWIND.search(text):
        return None
    if IDENTIFIER.match(text) and not re.match(r"[A-ZÀ-Þ]", text):
        return None
    return text


def inventory() -> dict[str, list[str]]:
    """Two passes: French-looking strings anywhere, then any string in a UI position."""
    labels: dict[str, list[str]] = {}
    for path in sources():
        try:
            lines = path.read_text(encoding="utf-8").split("\n")
        except OSError:
            continue
        for number, line in enumerate(lines, 1):
            if line.lstrip().startswith(("//", "*", "/*")):
                continue
            location = f"{path}:{number}"
            for match in STRING.finditer(line):
                raw = re.sub(r"\s+", " ", match.group(2).replace("\\n", " ").replace("\\t", " ")).strip()
                if raw and not looks_like_code(raw) and is_french(raw):
                    labels.setdefault(raw, []).append(location)
            for match in TEMPLATE.finditer(line):
                raw = re.sub(r"\s+", " ", match.group(1)).strip()
                if raw and not looks_like_code(raw) and is_french(raw):
                    labels.setdefault(raw, []).append(location)
            for pattern, group in ((ATTRIBUTE, 3), (PROPERTY, 3), (JSX_TEXT, 1)):
                for match in pattern.finditer(line):
                    candidate = ui_candidate(match.group(group))
                    if candidate:
                        labels.setdefault(candidate, []).append(location)
    return {label: sorted(set(locations)) for label, locations in sorted(labels.items())}


# --------------------------------------------------------------------------- corpus


def fetch_corpus(origin: str) -> dict[str, list[dict]]:
    base = f"{origin}/api/v1/text"
    catalogue = get_json(base)
    if catalogue is None:
        sys.exit(f"{base} did not answer — the corpus cannot be measured")
    families = sorted({entry["family"] for entry in catalogue["families"]})

    def fetch(family: str):
        rows, page = [], 1
        while True:
            payload = get_json(f"{base}/fr/{urllib.parse.quote(family)}?page={page}&per_page=200")
            if payload is None:
                break
            results = payload["results"]
            rows.extend(results["elements"])
            if page >= results["pages"] or not results["elements"]:
                break
            page += 1
        print(f"  {family}: {len(rows)}", file=sys.stderr)
        return family, rows

    with ThreadPoolExecutor(max_workers=8) as pool:
        return dict(pool.map(fetch, families))


# --------------------------------------------------------------------------- map


def build_map(origin: str, labels: dict, corpus: dict) -> dict:
    base = f"{origin}/api/v1/text"
    index: dict[str, list[tuple]] = collections.defaultdict(list)
    for family, rows in corpus.items():
        for row in rows:
            index[norm(row["text"])].append((family, row["hash"], row["hash_hex"], row["text"]))

    def rank(family: str) -> int:
        return UI_FAMILIES.index(family) if family in UI_FAMILIES else len(UI_FAMILIES)

    entries, variants, homonyms = [], [], []
    for label, locations in labels.items():
        key = norm(label)
        hits = index.get(key)
        if not hits:
            lowered = key.lower()
            hits = [hit for other, rows in index.items() if other.lower() == lowered for hit in rows]
        if not hits:
            continue
        ui_hits = [hit for hit in hits if hit[0] in UI_FAMILIES]
        if not ui_hits:
            homonyms.append(
                {
                    "label": label,
                    "families": sorted({hit[0] for hit in hits}),
                    "hash": sorted(hits, key=lambda hit: hit[1])[0][2],
                    "fr": hits[0][3],
                    "locations": sorted(set(locations)),
                }
            )
            continue
        ui_hits.sort(key=lambda hit: (rank(hit[0]), hit[0], hit[1]))
        record = {
            "label": label,
            "family": ui_hits[0][0],
            "hash": ui_hits[0][2],
            "fr": ui_hits[0][3],
            "occurrences": [{"family": hit[0], "hash": hit[2]} for hit in ui_hits],
            "locations": sorted(set(locations)),
        }
        (entries if record["fr"] == label else variants).append(record)

    def verify(record: dict) -> dict:
        """Re-read the pair on the route that serves it. No read-back, no entry."""
        url = f"{base}/fr/{urllib.parse.quote(record['family'])}/{record['hash']}"
        payload = get_json(url)
        record["verified"] = bool(
            payload and any(norm(o["text"]) == norm(record["fr"]) for o in payload.get("occurrences", []))
        )
        return record

    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(verify, entries + variants))

    refused = [record["label"] for record in entries + variants if not record["verified"]]
    if refused:
        print(f"refused, the route did not confirm them: {refused}", file=sys.stderr)
    keep = lambda rows: [record for record in rows if record["verified"]]
    return {"exact": keep(entries), "variants": keep(variants), "homonyms": homonyms}


# --------------------------------------------------------------------------- misses


def search_misses(origin: str, labels: dict, mapped: dict) -> list[dict]:
    base = f"{origin}/api/v1/text"
    known = {record["label"] for record in mapped["exact"] + mapped["variants"]}
    homonyms = {record["label"]: record for record in mapped["homonyms"]}
    todo = sorted(label for label in labels if label not in known)
    print(f"  searching {len(todo)} labels", file=sys.stderr)

    def run(label: str) -> dict:
        payload = get_json(f"{base}/search?q={urllib.parse.quote(label)}&language=fr", timeout=180)
        elements = (payload or {}).get("results", {}).get("elements", [])
        record = {"label": label, "locations": labels[label], "search_hits": len(elements)}
        if elements:
            # The shortest line that contains the label: the closest thing to a label itself.
            best = min(elements, key=lambda element: len(element["text"]))
            record |= {"closest": best["text"], "closest_family": best["family"], "closest_hash": best["hash_hex"]}
        else:
            record |= {"closest": None, "closest_family": None, "closest_hash": None}
        if label in homonyms:
            record["homonym_families"] = homonyms[label]["families"]
        return record

    with ThreadPoolExecutor(max_workers=5) as pool:
        return list(pool.map(run, todo))


# --------------------------------------------------------------------------- emit

CODE_FRAGMENT = re.compile(r"[<>{}()\[\]=;@|/\\]|\.\w|--|\bconst\b|\breturn\b")


def label_like(value: str) -> bool:
    """A hand-written screen label, not a code fragment the sweep happened to catch."""
    return bool(
        2 <= len(value) <= 36
        and not CODE_FRAGMENT.search(value)
        and re.match(r"^[A-Za-zÀ-ÿ«0-9]", value)
        and re.search(r"[A-Za-zÀ-ÿ]{2,}", value)
    )


def transform_of(record: dict) -> str:
    """The transformation that, applied to the game's text, yields EXACTLY the label."""
    label, fr = record["label"], record["fr"]
    if label == fr.upper():
        return "upper"
    if label == fr.lower():
        return "lower"
    if label == fr[:1].upper() + fr[1:].lower():
        return "capitalize"
    if label == fr.replace("'", "’"):
        return "apostrophe"
    sys.exit(f"no transformation relates {fr!r} to {label!r}")


def emit(mapped: dict, misses: list[dict], label_count: int, mesure: datetime.date) -> str:
    js = lambda value: json.dumps(value, ensure_ascii=False)
    rel = lambda location: str(Path(location).relative_to(REPO))
    order = lambda record: (-len(record["locations"]), record["label"])

    exact = sorted(mapped["exact"], key=order)
    variants = sorted(mapped["variants"], key=order)
    unnameable = [record for record in variants if transform_of(record) is None]
    if unnameable:
        print(
            f"dropped, no mechanical transformation reproduces them: "
            f"{[record['label'] for record in unnameable]}",
            file=sys.stderr,
        )
        variants = [record for record in variants if transform_of(record) is not None]
    homonym_labels = {record["label"] for record in mapped["homonyms"]}

    homonyms = sorted((m for m in misses if m["label"] in homonym_labels), key=order)
    near = sorted(
        (m for m in misses if m["closest"] and label_like(m["label"]) and m["label"] not in homonym_labels),
        key=order,
    )
    rest = [m for m in misses if label_like(m["label"]) and m["label"] not in homonym_labels and not m["closest"]]

    zones = collections.Counter()
    for miss in rest:
        for location in miss["locations"]:
            head = rel(location).split("/src/")
            zones[head[0] + "/src/" + (head[1].split("/")[0] if len(head) > 1 else "")] += 1
    top = zones.most_common(5)
    zone_block = "".join(f" *   `{z}` ({n}){'.' if i == len(top) - 1 else ','}\n" for i, (z, n) in enumerate(top))

    families = lambda rows: ", ".join(
        f"{f} ({c})" for f, c in collections.Counter(r["family"] for r in rows).most_common()
    )
    today = mesure.isoformat()

    def entry_lines(record: dict, extra: str = "") -> str:
        occurrences = ", ".join(
            f"{{ family: {js(o['family'])}, hash: {js(o['hash'])} }}" for o in record["occurrences"]
        )
        used = ", ".join(js(rel(location)) for location in record["locations"])
        return (
            "\t{\n"
            f"\t\tlabel: {js(record['label'])},\n"
            f"\t\tfamily: {js(record['family'])},\n"
            f"\t\thash: {js(record['hash'])},\n"
            f"\t\tfr: {js(record['fr'])},\n" + extra + f"\t\toccurrences: [{occurrences}],\n"
            f"\t\tusedAt: [{used}],\n"
            "\t},\n"
        )

    def miss_lines(miss: dict) -> str:
        used = ", ".join(js(rel(location)) for location in miss["locations"])
        extra = ""
        if miss.get("homonym_families"):
            extra = "\t\thomonymFamilies: [%s],\n" % ", ".join(js(f) for f in miss["homonym_families"])
        return (
            "\t{\n"
            f"\t\tlabel: {js(miss['label'])},\n"
            f"\t\tsearchHits: {miss['search_hits']},\n"
            f"\t\tclosest: {js(miss['closest']) if miss['closest'] else 'null'},\n"
            f"\t\tclosestFamily: {js(miss['closest_family']) if miss['closest_family'] else 'null'},\n"
            f"\t\tclosestHash: {js(miss['closest_hash']) if miss['closest_hash'] else 'null'},\n" + extra +
            f"\t\tusedAt: [{used}],\n"
            "\t},\n"
        )

    header = f'''/**
 * Carte MESURÉE des libellés d'interface écrits à la main vers le texte du jeu.
 *
 * ENGENDRÉE par `scripts/validation/ui-text-map.py` — ne pas éditer à la main. Chaque couple
 * (famille, hash) a été relu un par un sur `/api/v1/text/fr/{{family}}/{{hash}}`, et la ligne que
 * la route a rendue est celle recopiée dans `fr` ; une entrée que la route ne confirme pas est
 * refusée par le générateur. Aucune correspondance n'est devinée : un libellé que le corpus ne
 * contient pas reste en dur dans son composant et figure dans `UI_TEXT_NOT_FOUND`.
 *
 * ## Ce que le relevé a mesuré, le {today}
 *
 * - {label_count} chaînes distinctes balayées dans `apps/nie-web/src` et
 *   `packages/inacord-ui/src` (tests, `src/wasm/` et `vendor/` exclus).
 * - {len(exact)} correspondances au caractère près (`UI_TEXT_MAP`) et {len(variants)} à une
 *   transformation près (`UI_TEXT_VARIANTS` — « CONTRÔLE » pour « Contrôle », « Émérite » pour
 *   « ÉMÉRITE », « Éditeur d’avatar » pour « Éditeur d'avatar »).
 * - {len(homonyms)} libellés que le jeu n'écrit QUE comme nom propre : « Forge » et « Océan » sont des
 *   personnages de `chara_text`, pas des étiquettes. Refusés, et rangés avec leur raison.
 * - {len(near)} quasi-correspondances listées pour mémoire : la recherche rend un voisin
 *   (« Modèles » → « Modèle »), jamais l'égalité. La règle est l'égalité stricte.
 * - {len(rest)} autres libellés français que le corpus ignore complètement, surtout dans
{zone_block} *   L'outil de bureau parle de choses que `nie.exe` n'a jamais nommées.
 *
 * ## Comment s'en servir
 *
 * `hash` est la clé qu'attend `useNativeText(resolver, locale, family, hash)`
 * (`./native-text.ts`). `fr` n'est PAS la source : c'est la valeur
 * française observée le {today}, conservée pour que la substitution soit vérifiable et pour
 * servir de repli tant que la route texte n'a pas répondu.
 *
 * ## Le piège des hash multiples
 *
 * Un même texte est écrit plusieurs fois dans le jeu, sous des hash différents. `hash` retient
 * la première occurrence dans l'ordre (famille d'interface d'abord, puis hash croissant) ;
 * `occurrences` porte la liste entière. Quand une mise en page native désigne un hash précis,
 * c'est LUI qu'il faut prendre, pas celui-ci.
 */

/** Une correspondance vérifiée entre un libellé écrit à la main et une ligne du jeu. */
export interface UiTextEntry {{
\t/** Le libellé tel qu'il est écrit dans le composant aujourd'hui. */
\tlabel: string;
\t/** La famille de texte du jeu, telle que `/api/v1/text` la nomme. */
\tfamily: string;
\t/** Le hash de la ligne, en hexadécimal — la clé de `/api/v1/text/{{lang}}/{{family}}/{{hash}}`. */
\thash: string;
\t/** Le texte français rendu par l'API pour ce couple. */
\tfr: string;
\t/** Toutes les lignes d'interface du corpus qui portent ce même texte. */
\toccurrences: readonly {{ family: string; hash: string }}[];
\t/** Les endroits qui écrivent ce libellé à la main, `chemin:ligne`. */
\tusedAt: readonly string[];
}}

/** Une correspondance à une transformation près : le composant écrit autrement ce que le jeu écrit. */
export interface UiTextVariant extends UiTextEntry {{
\t/**
\t * La transformation qui, appliquée à `fr`, redonne EXACTEMENT `label`.
\t *
\t * Elle n'est pas approximative : le générateur refuse d'écrire une entrée dont aucune des
\t * quatre transformations ne reproduit le libellé au caractère près, et
\t * `ui-text-map.test.ts` le revérifie sur les {len(variants)} entrées.
\t */
\ttransform: "upper" | "lower" | "capitalize" | "apostrophe";
}}

/** Un libellé que le corpus du jeu ne contient pas, et ce que la recherche a rendu de plus proche. */
export interface UiTextMiss {{
\tlabel: string;
\t/** Nombre de lignes rendues par `/api/v1/text/search?q=<label>&language=fr`. */
\tsearchHits: number;
\t/** La plus courte ligne rendue par cette recherche, ou `null` si elle n'a rien rendu. */
\tclosest: string | null;
\tclosestFamily: string | null;
\tclosestHash: string | null;
\t/** Renseigné quand le texte existe, mais seulement dans une famille de noms propres. */
\thomonymFamilies?: readonly string[];
\tusedAt: readonly string[];
}}

/**
 * Les libellés dont le jeu écrit EXACTEMENT le même texte.
 *
 * Familles : {families(exact)}.
 */
export const UI_TEXT_MAP: readonly UiTextEntry[] = [
'''

    middle = f'''];

/**
 * Même texte, écriture différente — le composant écrit « CONTRÔLE », le jeu « Contrôle ».
 *
 * Séparés de `UI_TEXT_MAP` parce que la substitution y demande une transformation explicite :
 * remplacer le libellé par `fr` tel quel changerait l'apparence de l'écran.
 *
 * Familles : {families(variants)}.
 */
export const UI_TEXT_VARIANTS: readonly UiTextVariant[] = [
'''

    tail = f'''];

/**
 * Les non trouvés retenus : {len(homonyms)} homonymes de noms propres, puis {len(near)} quasi-correspondances.
 *
 * `homonymFamilies` marque les libellés que le jeu écrit bien, mais seulement comme nom propre.
 * Les prendre pour des étiquettes d'écran serait une correspondance devinée.
 *
 * `closest` est ce que `/api/v1/text/search?q=<label>&language=fr` a réellement rendu de plus
 * court, pas une approximation calculée : « Modèles » rend « Modèle », « Équipes » rend
 * « Équipe », « Rechercher… » rend « Rechercher ». Aucun de ces voisins ne remplace le libellé —
 * un singulier n'est pas un pluriel.
 *
 * La recherche plafonne à 50 lignes par requête : pour un libellé très courant, `closest` est la
 * plus courte de ces 50, pas forcément la plus proche du corpus entier.
 *
 * Les {len(rest)} libellés dont la recherche n'a RIEN rendu ne sont pas listés : il n'y a rien à en
 * dire de plus que leur absence, et les énumérer ferait un fichier plus long que la carte.
 */
export const UI_TEXT_NOT_FOUND: readonly UiTextMiss[] = [
'''

    footer = '''];

/**
 * Applique la transformation déclarée par une variante à un texte du jeu.
 *
 * Séparée de la table pour que la substitution passe par une fonction unique : un composant qui
 * écrirait `entry.fr.toUpperCase()` lui-même retrouverait « ÉMÉRITE » là où le libellé est
 * « Émérite », et la différence ne se verrait qu'à l'écran.
 */
export function applyTransform(transform: UiTextVariant["transform"], text: string): string {
\tswitch (transform) {
\t\tcase "upper":
\t\t\treturn text.toLocaleUpperCase("fr");
\t\tcase "lower":
\t\t\treturn text.toLocaleLowerCase("fr");
\t\tcase "capitalize":
\t\t\treturn text.slice(0, 1).toLocaleUpperCase("fr") + text.slice(1).toLocaleLowerCase("fr");
\t\tcase "apostrophe":
\t\t\t// Le jeu écrit l'apostrophe droite ; l'interface, la typographique.
\t\t\treturn text.replaceAll("'", "’");
\t}
}
'''

    return (
        header
        + "".join(entry_lines(record) for record in exact)
        + middle
        + "".join(entry_lines(record, extra=f"\t\ttransform: {js(transform_of(record))},\n") for record in variants)
        + tail
        + "".join(miss_lines(miss) for miss in homonyms + near)
        + footer
    )


# --------------------------------------------------------------------------- driver


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--origin", default="https://nie.aphrody.com", help="the nie-site to measure")
    parser.add_argument("--work", default="/tmp/ui-text-map", help="where the measured dumps are cached")
    parser.add_argument("--refresh", action="store_true", help="ignore the cache and measure again")
    parser.add_argument(
        "--stage",
        choices=["inventory", "corpus", "map", "misses", "emit"],
        default="emit",
        help="stop after this stage (each one needs the previous ones, cached or fresh)",
    )
    args = parser.parse_args()
    work = Path(args.work)
    work.mkdir(parents=True, exist_ok=True)
    order = ["inventory", "corpus", "map", "misses", "emit"]
    wanted = order.index(args.stage)

    print("inventory…", file=sys.stderr)
    labels = cached(work, "labels.json", args.refresh, inventory)
    print(f"  {len(labels)} distinct labels", file=sys.stderr)
    if wanted == 0:
        return

    print("corpus…", file=sys.stderr)
    corpus = cached(work, "corpus_fr.json", args.refresh, lambda: fetch_corpus(args.origin))
    print(f"  {sum(len(rows) for rows in corpus.values())} lines", file=sys.stderr)
    if wanted == 1:
        return

    print("map…", file=sys.stderr)
    mapped = cached(work, "map.json", args.refresh, lambda: build_map(args.origin, labels, corpus))
    print(
        f"  {len(mapped['exact'])} exact, {len(mapped['variants'])} variants, "
        f"{len(mapped['homonyms'])} homonyms",
        file=sys.stderr,
    )
    if wanted == 2:
        return

    print("misses…", file=sys.stderr)
    misses = cached(work, "misses.json", args.refresh, lambda: search_misses(args.origin, labels, mapped))
    if wanted == 3:
        return

    # La date est celle de la MESURE, pas celle de l'exécution : la prendre à l'horloge rendait
    # le fichier différent chaque jour sans qu'aucun octet mesuré n'ait changé, et `git diff`
    # cessait de pouvoir dire si la carte était à jour.
    mesure = datetime.date.fromtimestamp((work / "map.json").stat().st_mtime)
    OUT.write_text(emit(mapped, misses, len(labels), mesure), encoding="utf-8")
    print(f"written: {OUT.relative_to(REPO)}", file=sys.stderr)


if __name__ == "__main__":
    main()
