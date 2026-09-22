# nie_bridge — pont natif entre l'addon Blender « nie — G4 Blender Tools » et l'écosystème
# nie : `nie.exe` (CLI Rust, VFS local and Rust-owned wiki mirror).
#
# Recherche personnage/technique par nom localisé via `nie.exe`. Le CLI appelle directement
# `nie-wiki`; Blender ne réimplémente ni SQL ni la politique de données.
#
# Côté Rust, `crates/tools/nie-cli/src/main.rs` documente `-j/--json` de `nie vfs
# find`/`chara`/`waza` comme étant destiné à ce pont.
#
# Panneau « nie — Recherche » (View3D > Sidebar > nie) : deux onglets, Fichiers (recherche VFS
# substring, `nie vfs find --json`) et Personnage/Technique (noms localisés, miroir Rust local).
# Import réel via l'opérateur `import_scene.level5_g4`. **NE PAS appeler**
# `level5_g4_port.load_original_model` (l'opérateur du wizard d'export) : il ne crée aucun
# maillage — même piège que dans `open_in_blender` côté `nie-explorer`.
#
# TOUS les opérateurs réseau/disque/subprocess sont NON BLOQUANTS (timer modal + soit
# `subprocess.Popen` soit `threading.Thread`, jamais un appel synchrone dans `execute()`) — pattern
# documenté par Blender pour garder l'UI réactive (`bpy.app.timers`).

import json
import os
import shutil
import subprocess
import threading
import traceback
from pathlib import Path

import bpy
from bpy.props import BoolProperty, EnumProperty, IntProperty, StringProperty
from bpy.types import Operator, Panel, PropertyGroup, UIList

ADDON_ID = __name__  # réécrit par `__init__.py` après import (même convention que g4_port_addon/g4_animation_addon).

# Extensions que `import_scene.level5_g4` sait charger directement — le reste (textures, audio,
# animations…) est seulement extrait, jamais « importé » à proprement parler par ce panneau.
IMPORTABLE_MODEL_EXTENSIONS = {".g4md", ".g4pkm"}

# Sous-chemins candidats du binaire CLI relatifs à la racine du jeu (`<jeu>/target/{profil}/...`),
# mêmes profils que `cargo build -p nie-cli` produit — pas de suffixe `.exe` en dur : marche aussi
# sur une addon Blender Linux/macOS pointée sur un checkout de dev du jeu.
_NIE_EXE_SUBPATHS = (
    ("target", "release", "nie.exe"),
    ("target", "debug", "nie.exe"),
    ("target", "release", "nie"),
    ("target", "debug", "nie"),
)

# Processus/threads `nie.exe`/réseau actuellement en vol, pour nettoyage forcé si l'addon est
# désactivé pendant qu'une recherche/extraction tourne (sinon le timer continuerait à tourner
# après `unregister()` et toucherait des données Blender potentiellement invalidées — piège
# documenté des addons à base de `bpy.app.timers`/process externes/threads).
_active_procs: list[subprocess.Popen] = []
_active_threads: list[threading.Thread] = []


def addon_preferences(context):
    """Préférences de CET addon (`G4ImporterPreferences`), ou `None` si non enregistré —
    mêmes garde-fous que `g4_animation_addon.addon_preferences`, dupliqués ici pour ne pas créer
    de dépendance circulaire entre les deux modules (tous deux importés par `__init__.py`)."""
    addon = context.preferences.addons.get(ADDON_ID)
    return addon.preferences if addon is not None else None


def _game_dir_from_raw_data_root(raw_data_root: str) -> Path | None:
    """`raw_data_root` pointe sur `<jeu>/data` (convention nie, cf. `inferred_raw_data_root`
    de `g4_animation_addon.py`) — la racine du jeu est son PARENT si le dossier s'appelle
    littéralement `data`, sinon on le prend tel quel (config non standard, pas de préemption)."""
    if not raw_data_root:
        return None
    root = Path(bpy.path.abspath(raw_data_root))
    return root.parent if root.name.lower() == "data" else root


def resolve_nie_exe(context) -> Path | None:
    """Résout `nie.exe`, dans l'ordre : préférence explicite (`nie_cli_path`) > sous-dossier
    `target/{release,debug}` de la racine du jeu (déduite de `raw_data_root`, PAS devinée) >
    `NIE_GAME_DIR` (posé par `nie-explorer` quand ce script tourne via son bootstrap) > `PATH`.
    Ne retourne JAMAIS un chemin qui n'existe pas sur disque — l'appelant doit gérer `None`."""
    prefs = addon_preferences(context)

    configured = getattr(prefs, "nie_cli_path", "") if prefs is not None else ""
    if configured:
        p = Path(bpy.path.abspath(configured))
        if p.is_file():
            return p

    game_dir = _game_dir_from_raw_data_root(getattr(prefs, "raw_data_root", "") if prefs is not None else "")
    if game_dir is None:
        env_dir = os.environ.get("NIE_GAME_DIR")
        if env_dir:
            game_dir = Path(env_dir)

    if game_dir is not None:
        for parts in _NIE_EXE_SUBPATHS:
            candidate = game_dir.joinpath(*parts)
            if candidate.is_file():
                return candidate

    which = shutil.which("nie")
    return Path(which) if which else None


def resolve_wiki_db(context) -> Path | None:
    """Résout le miroir wiki (`inagle-*.sqlite`), dans l'ordre : `NIE_WIKI_DB`/`SQLITE_DB_PATH`
    (mêmes variables que `nie-explorer`/`nie-wiki`) > préférence explicite (`wiki_db_path`) >
    fichier `inagle-*.sqlite` le plus récent sous `<racine du jeu>/var/miroir/`, selon la
    même règle que le propriétaire Rust. Returns `None` when no local mirror is available."""
    for var in ("NIE_WIKI_DB", "SQLITE_DB_PATH"):
        v = os.environ.get(var)
        if v and Path(v).is_file():
            return Path(v)

    prefs = addon_preferences(context)
    configured = getattr(prefs, "wiki_db_path", "") if prefs is not None else ""
    if configured:
        p = Path(bpy.path.abspath(configured))
        if p.is_file():
            return p

    game_dir = _game_dir_from_raw_data_root(getattr(prefs, "raw_data_root", "") if prefs is not None else "")
    if game_dir is None:
        return None
    mirror_dir = game_dir / "var" / "miroir"
    if not mirror_dir.is_dir():
        return None
    candidates = sorted(p for p in mirror_dir.glob("inagle-*.sqlite") if p.is_file() and p.stat().st_size > 0)
    return candidates[-1] if candidates else None


def search_local(exe: Path, db_path: Path, kind: str, query: str) -> list[dict]:
    """Call the Rust CLI; this addon has no duplicate mirror query implementation."""
    subcommand = "chara" if kind == "CHARA" else "waza"
    completed = subprocess.run(
        [str(exe), "vfs", subcommand, query, "--no-paths", "--json", "--db", str(db_path)],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    return json.loads(completed.stdout)


def _local_chara_row_to_result(row: dict) -> dict:
    return {
        "source": "local",
        "internal_code": row.get("internal_code") or "",
        "name_fr": row.get("name_fr") or "",
        "name_en": row.get("name_en") or "",
        "name_ja": row.get("name_ja") or "",
        "element": row.get("element") or "",
        "category_or_position": row.get("category_or_position") or "",
        "is_hyper": False,
    }


def _local_waza_row_to_result(row: dict) -> dict:
    return {
        "source": "local",
        "internal_code": row.get("internal_code") or "",
        "name_fr": row.get("name_fr") or "",
        "name_en": row.get("name_en") or "",
        "name_ja": row.get("name_ja") or "",
        "element": row.get("element") or "",
        "category_or_position": row.get("category_or_position") or "",
        "is_hyper": bool(row.get("is_hyper")),
    }


class NieBridgeResult(PropertyGroup):
    path: StringProperty(name="Path")
    size: IntProperty(name="Size")
    cpk: StringProperty(name="CPK")


class NieBridgeCharaResult(PropertyGroup):
    source: StringProperty(name="Source")
    internal_code: StringProperty(name="Code")
    name_fr: StringProperty(name="FR")
    name_en: StringProperty(name="EN")
    name_ja: StringProperty(name="JA")
    element: StringProperty(name="Élément")
    category_or_position: StringProperty(name="Poste/Catégorie")
    is_hyper: BoolProperty(name="Hyper")


class _NieProcessOperator(Operator):
    """Base commune des opérateurs qui lancent `nie.exe <args>` SANS bloquer l'UI : `Popen` +
    timer modal (`wm.event_timer_add`) qui poll `proc.poll()` toutes les 0.1 s, Échap annule.
    Les sous-classes implémentent `build_args(context) -> list[str] | None` (retourne `None` +
    `self.report` déjà appelé pour annuler avant même de lancer le process) et
    `on_success(context, stdout: str)` (appelé sur le thread principal une fois le process
    terminé avec succès — un contexte Blender pleinement valide, pas de souci de thread)."""

    _timer = None
    _proc: subprocess.Popen | None = None

    def build_args(self, context) -> list[str] | None:
        raise NotImplementedError

    def on_success(self, context, stdout: str) -> None:
        raise NotImplementedError

    def invoke(self, context, event):
        nie_exe = resolve_nie_exe(context)
        if nie_exe is None:
            self.report({"ERROR"}, "nie.exe introuvable — voir Préférences > nie — G4 Blender Tools > nie.exe")
            return {"CANCELLED"}

        args = self.build_args(context)
        if args is None:
            return {"CANCELLED"}

        try:
            self._proc = subprocess.Popen(
                [str(nie_exe), *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
            )
        except Exception as exc:
            self.report({"ERROR"}, f"Échec de lancement de nie.exe : {exc}")
            return {"CANCELLED"}
        _active_procs.append(self._proc)

        context.workspace.status_text_set(f"nie : {self.bl_label}… (Échap pour annuler)")
        wm = context.window_manager
        self._timer = wm.event_timer_add(0.1, window=context.window)
        wm.modal_handler_add(self)
        return {"RUNNING_MODAL"}

    def modal(self, context, event):
        if event.type == "ESC":
            if self._proc.poll() is None:
                self._proc.terminate()
            self._cleanup(context)
            self.report({"WARNING"}, "Annulé")
            return {"CANCELLED"}
        if event.type != "TIMER":
            return {"PASS_THROUGH"}
        if self._proc.poll() is None:
            return {"RUNNING_MODAL"}

        stdout, stderr = self._proc.communicate()
        returncode = self._proc.returncode
        self._cleanup(context)

        if returncode != 0:
            detail = (stderr or stdout or "").strip()
            self.report({"ERROR"}, f"nie.exe a échoué : {detail or returncode}")
            return {"CANCELLED"}

        try:
            self.on_success(context, stdout)
        except Exception:
            traceback.print_exc()
            self.report({"ERROR"}, "Échec après nie.exe — voir la console")
            return {"CANCELLED"}
        return {"FINISHED"}

    def _cleanup(self, context):
        context.workspace.status_text_set(None)
        wm = context.window_manager
        if self._timer is not None:
            wm.event_timer_remove(self._timer)
            self._timer = None
        if self._proc in _active_procs:
            _active_procs.remove(self._proc)
        self._proc = None


class _NieThreadOperator(Operator):
    """Base for non-blocking local worker operators without
    lancer `nie.exe` — même principe non bloquant que [`_NieProcessOperator`], avec un
    `threading.Thread` à la place d'un `Popen`. `prepare(context)` tourne sur le thread PRINCIPAL
    (accès `bpy`/`context` valide, extrait les données nécessaires en Python simple) ;
    `work(prepared)` tourne sur le thread de FOND (ne doit JAMAIS toucher `bpy`/`context` — pas
    thread-safe) ; `on_result(context, result)` revient sur le thread principal. Pas d'annulation
    par Échap ici (un thread Python ne se termine pas proprement de force, contrairement à un
    process externe) — limite acceptée, documentée."""

    _thread: threading.Thread | None = None
    _result = None
    _error: str | None = None
    _timer = None

    def prepare(self, context):
        raise NotImplementedError

    def work(self, prepared):
        raise NotImplementedError

    def on_result(self, context, result) -> None:
        raise NotImplementedError

    def _run(self, prepared):
        try:
            self._result = self.work(prepared)
        except Exception as exc:
            self._error = str(exc)

    def invoke(self, context, event):
        self._result = None
        self._error = None
        prepared = self.prepare(context)
        if prepared is None:
            return {"CANCELLED"}

        self._thread = threading.Thread(target=self._run, args=(prepared,), daemon=True)
        self._thread.start()
        _active_threads.append(self._thread)

        context.workspace.status_text_set(f"nie : {self.bl_label}…")
        wm = context.window_manager
        self._timer = wm.event_timer_add(0.1, window=context.window)
        wm.modal_handler_add(self)
        return {"RUNNING_MODAL"}

    def modal(self, context, event):
        if event.type != "TIMER":
            return {"PASS_THROUGH"}
        if self._thread.is_alive():
            return {"RUNNING_MODAL"}

        self._cleanup(context)
        if self._error is not None:
            self.report({"ERROR"}, self._error)
            return {"CANCELLED"}

        try:
            self.on_result(context, self._result)
        except Exception:
            traceback.print_exc()
            self.report({"ERROR"}, "Échec après la requête — voir la console")
            return {"CANCELLED"}
        return {"FINISHED"}

    def _cleanup(self, context):
        context.workspace.status_text_set(None)
        wm = context.window_manager
        if self._timer is not None:
            wm.event_timer_remove(self._timer)
            self._timer = None
        if self._thread in _active_threads:
            _active_threads.remove(self._thread)
        self._thread = None


class NIE_BRIDGE_OT_search(_NieProcessOperator):
    bl_idname = "nie_bridge.search"
    bl_label = "Chercher"
    bl_description = "Cherche des fichiers dans le VFS du jeu (`nie vfs find --json`, sous-chaîne insensible à la casse)"

    def build_args(self, context):
        scene = context.scene
        query = scene.nie_bridge_query.strip()
        if not query:
            self.report({"ERROR"}, "Requête vide")
            return None
        args = ["vfs", "find", query, "--json", "-n", "200"]
        ext = scene.nie_bridge_ext_filter.strip().lstrip(".")
        if ext:
            args += ["--ext", ext]
        return args

    def on_success(self, context, stdout):
        entries = json.loads(stdout)
        scene = context.scene
        scene.nie_bridge_results.clear()
        for entry in entries:
            item = scene.nie_bridge_results.add()
            item.path = entry.get("path", "")
            item.size = int(entry.get("size", 0) or 0)
            item.cpk = entry.get("cpk", "")
        scene.nie_bridge_result_index = 0 if len(scene.nie_bridge_results) else -1
        self.report({"INFO"}, f"{len(entries)} résultat(s)")


class NIE_BRIDGE_OT_import_selected(_NieProcessOperator):
    bl_idname = "nie_bridge.import_selected"
    bl_label = "Importer / Extraire"
    bl_description = (
        "Extrait le résultat sélectionné via `nie vfs extract` ; l'importe directement dans la "
        "scène si c'est un modèle G4MD/G4PKM (le vrai importeur, pas le wizard d'export)"
    )

    _dest: Path | None = None
    _basename: str | None = None

    def build_args(self, context):
        scene = context.scene
        idx = scene.nie_bridge_result_index
        if idx < 0 or idx >= len(scene.nie_bridge_results):
            self.report({"ERROR"}, "Aucun résultat sélectionné")
            return None
        item = scene.nie_bridge_results[idx]
        path = item.path
        self._basename = path.rsplit("/", 1)[-1]
        # Préfixe de DOSSIER (pas le fichier seul) : `nie vfs extract` accepte un préfixe et
        # extrait tout ce qui matche — récupère au passage les frères g4mg/g4sk/g4tx/g4mt requis
        # par `import_scene.level5_g4` pour la géométrie/le squelette/les textures.
        folder = path.rsplit("/", 1)[0] if "/" in path else path
        tempdir = Path(bpy.app.tempdir) if bpy.app.tempdir else Path(__import__("tempfile").gettempdir())
        self._dest = tempdir / "nie-bridge" / str(abs(hash((path, idx))))
        self._dest.mkdir(parents=True, exist_ok=True)
        return ["vfs", "extract", folder, "--out", str(self._dest)]

    def on_success(self, context, stdout):
        extracted = self._dest / self._basename
        if not extracted.is_file():
            self.report({"ERROR"}, f"Fichier attendu introuvable après extraction : {extracted}")
            return

        if extracted.suffix.lower() not in IMPORTABLE_MODEL_EXTENSIONS:
            self.report({"INFO"}, f"Extrait (aperçu binaire uniquement, pas un modèle) : {extracted}")
            return

        # Appel DIRECT (pas de `bpy.app.timers.register`) : contrairement au bootstrap `--python`
        # de démarrage de `nie-explorer` (contexte fenêtre pas garanti prêt), ce callback tourne
        # depuis le timer modal d'une session Blender déjà pleinement initialisée.
        try:
            bpy.ops.import_scene.level5_g4(
                "EXEC_DEFAULT",
                filepath=str(extracted),
                skip_character_setup=True,
                import_character_parts=False,
                create_report_text=False,
            )
        except Exception:
            traceback.print_exc()
            self.report({"ERROR"}, f"Import de {self._basename} échoué — voir la console")
            return

        self.report({"INFO"}, f"Importé : {self._basename}")


class NIE_BRIDGE_OT_search_chara_waza(_NieThreadOperator):
    bl_idname = "nie_bridge.search_chara_waza"
    bl_label = "Chercher (perso/technique)"
    bl_description = "Search a character or skill by localized name through the Rust CLI and local mirror"

    def prepare(self, context):
        scene = context.scene
        query = scene.nie_bridge_chara_query.strip()
        if not query:
            self.report({"ERROR"}, "Requête vide")
            return None
        return {
            "kind": scene.nie_bridge_kind,
            "query": query,
            "wiki_db": resolve_wiki_db(context),
            "nie_exe": resolve_nie_exe(context),
        }

    def work(self, prepared):
        kind = prepared["kind"]
        query = prepared["query"]
        results: list[dict] = []
        notices: list[str] = []

        if prepared["wiki_db"] is not None and prepared["nie_exe"] is not None:
            try:
                rows = search_local(prepared["nie_exe"], prepared["wiki_db"], kind, query)
                mapper = _local_chara_row_to_result if kind == "CHARA" else _local_waza_row_to_result
                results.extend(mapper(r) for r in rows)
            except Exception as exc:
                notices.append(f"miroir local : {exc}")

        elif prepared["wiki_db"] is None:
            notices.append("local wiki mirror not found")
        else:
            notices.append("nie.exe not found")

        return {"results": results, "notices": notices}

    def on_result(self, context, result):
        scene = context.scene
        scene.nie_bridge_chara_results.clear()
        for r in result["results"]:
            item = scene.nie_bridge_chara_results.add()
            for key, value in r.items():
                setattr(item, key, value)
        scene.nie_bridge_chara_result_index = 0 if len(scene.nie_bridge_chara_results) else -1

        msg = f"{len(result['results'])} résultat(s)"
        if result["notices"]:
            self.report({"WARNING"}, msg + " — " + " ; ".join(result["notices"]))
        else:
            self.report({"INFO"}, msg)


class NIE_BRIDGE_OT_use_chara_as_file_query(Operator):
    bl_idname = "nie_bridge.use_chara_as_file_query"
    bl_label = "Voir les fichiers"
    bl_description = "Bascule sur l'onglet Fichiers et cherche les VRAIS fichiers VFS de ce personnage/technique (par code interne)"

    def execute(self, context):
        scene = context.scene
        idx = scene.nie_bridge_chara_result_index
        if idx < 0 or idx >= len(scene.nie_bridge_chara_results):
            self.report({"ERROR"}, "Aucun résultat sélectionné")
            return {"CANCELLED"}
        code = scene.nie_bridge_chara_results[idx].internal_code
        if not code:
            self.report({"ERROR"}, "This result has no known internal code")
            return {"CANCELLED"}

        scene.nie_bridge_kind = "FILES"
        scene.nie_bridge_query = code
        scene.nie_bridge_ext_filter = ""
        bpy.ops.nie_bridge.search("INVOKE_DEFAULT")
        return {"FINISHED"}


class NIE_BRIDGE_UL_results(UIList):
    """Filtre par nom NATIF (icône loupe dans l'en-tête de liste, cf. `UI_UL_list.
    filter_items_by_name`) — filtre les résultats DÉJÀ récupérés, côté client, sans relancer
    `nie.exe` : `nie_bridge_query`/§Chercher va chercher côté VFS, ce filtre affine
    instantanément la liste déjà en main (ex. restreindre aux `.g4tx` parmi les résultats d'une
    recherche plus large). Sans ce `filter_items`, le filtre par défaut de `UIList` chercherait
    une propriété `name` que `NieBridgeResult` n'a pas (elle a `path`) — jamais de correspondance."""

    def draw_item(self, context, layout, data, item, icon, active_data, active_propname, index):
        if self.layout_type in {"DEFAULT", "COMPACT"}:
            row = layout.row(align=True)
            ext = item.path.rsplit(".", 1)[-1].lower() if "." in item.path else ""
            row.label(text=item.path, icon="MESH_DATA" if f".{ext}" in IMPORTABLE_MODEL_EXTENSIONS else "FILE")
            row.label(text=f"{item.size:,} o".replace(",", " "))
        elif self.layout_type == "GRID":
            layout.alignment = "CENTER"
            layout.label(text=item.path.rsplit("/", 1)[-1][:12])

    def filter_items(self, context, data, propname):
        items = getattr(data, propname)
        helpers = bpy.types.UI_UL_list
        flt_flags = helpers.filter_items_by_name(
            self.filter_name, self.bitflag_filter_item, items, propname="path", reverse=self.use_filter_sort_reverse
        )
        flt_neworder = helpers.sort_items_by_name(items, "path") if self.use_filter_sort_alpha else []
        return flt_flags, flt_neworder


class NIE_BRIDGE_UL_chara_results(UIList):
    """Même principe de filtre natif que [`NIE_BRIDGE_UL_results`], sur `name_fr`."""

    def draw_item(self, context, layout, data, item, icon, active_data, active_propname, index):
        if self.layout_type in {"DEFAULT", "COMPACT"}:
            row = layout.row(align=True)
            label = item.name_fr or item.name_en or item.internal_code or "?"
            row.label(text=label, icon="ARMATURE_DATA" if item.source == "local" else "WORLD")
            if item.name_en and item.name_en != item.name_fr:
                row.label(text=item.name_en)
            if item.element:
                row.label(text=item.element)
            if item.is_hyper:
                row.label(text="", icon="SOLO_ON")
            row.label(text=item.source)
        elif self.layout_type == "GRID":
            layout.alignment = "CENTER"
            layout.label(text=(item.name_fr or item.internal_code or "?")[:12])

    def filter_items(self, context, data, propname):
        items = getattr(data, propname)
        helpers = bpy.types.UI_UL_list
        flt_flags = helpers.filter_items_by_name(
            self.filter_name, self.bitflag_filter_item, items, propname="name_fr", reverse=self.use_filter_sort_reverse
        )
        flt_neworder = helpers.sort_items_by_name(items, "name_fr") if self.use_filter_sort_alpha else []
        return flt_flags, flt_neworder


class NIE_BRIDGE_PT_panel(Panel):
    bl_label = "nie — Recherche"
    bl_idname = "NIE_BRIDGE_PT_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "nie"

    def draw(self, context):
        layout = self.layout
        scene = context.scene

        nie_exe = resolve_nie_exe(context)
        layout.row().label(
            text=f"nie.exe : {nie_exe.name}" if nie_exe else "nie.exe introuvable",
            icon="CHECKMARK" if nie_exe else "ERROR",
        )
        wiki_db = resolve_wiki_db(context)
        layout.row().label(
            text=f"miroir wiki : {wiki_db.name}" if wiki_db else "miroir wiki : non trouvé",
            icon="CHECKMARK" if wiki_db else "INFO",
        )

        layout.row().prop(scene, "nie_bridge_kind", expand=True)

        if scene.nie_bridge_kind == "FILES":
            self._draw_files(layout, scene)
        else:
            self._draw_chara_waza(layout, scene)

    def _draw_files(self, layout, scene):
        row = layout.row(align=True)
        row.prop(scene, "nie_bridge_query", text="", icon="VIEWZOOM")
        row.prop(scene, "nie_bridge_ext_filter", text="", icon="FILTER")
        layout.operator(NIE_BRIDGE_OT_search.bl_idname, icon="VIEWZOOM")

        layout.template_list(
            "NIE_BRIDGE_UL_results", "", scene, "nie_bridge_results", scene, "nie_bridge_result_index", rows=8
        )

        has_selection = 0 <= scene.nie_bridge_result_index < len(scene.nie_bridge_results)
        row = layout.row()
        row.enabled = has_selection
        row.operator(NIE_BRIDGE_OT_import_selected.bl_idname, icon="IMPORT")
        if has_selection:
            selected = scene.nie_bridge_results[scene.nie_bridge_result_index]
            layout.label(text=selected.cpk, icon="PACKAGE")

    def _draw_chara_waza(self, layout, scene):
        layout.prop(scene, "nie_bridge_chara_query", text="", icon="VIEWZOOM")
        layout.operator(NIE_BRIDGE_OT_search_chara_waza.bl_idname, icon="VIEWZOOM")

        layout.template_list(
            "NIE_BRIDGE_UL_chara_results",
            "",
            scene,
            "nie_bridge_chara_results",
            scene,
            "nie_bridge_chara_result_index",
            rows=8,
        )

        has_selection = 0 <= scene.nie_bridge_chara_result_index < len(scene.nie_bridge_chara_results)
        row = layout.row()
        row.enabled = has_selection
        row.operator(NIE_BRIDGE_OT_use_chara_as_file_query.bl_idname, icon="FILE_FOLDER")


classes = [
    NieBridgeResult,
    NieBridgeCharaResult,
    NIE_BRIDGE_OT_search,
    NIE_BRIDGE_OT_import_selected,
    NIE_BRIDGE_OT_search_chara_waza,
    NIE_BRIDGE_OT_use_chara_as_file_query,
    NIE_BRIDGE_UL_results,
    NIE_BRIDGE_UL_chara_results,
    NIE_BRIDGE_PT_panel,
]


def register():
    for cls in classes:
        bpy.utils.register_class(cls)

    bpy.types.Scene.nie_bridge_kind = EnumProperty(
        name="Type",
        items=(
            ("FILES", "📁 Fichiers", "Recherche par chemin VFS (nie.exe, substring)"),
            ("CHARA", "👤 Personnage", "Recherche par nom FR/EN/JA (miroir Rust local)"),
            ("WAZA", "⚡ Technique", "Recherche par nom FR/EN/JA (miroir Rust local)"),
        ),
        default="FILES",
    )
    bpy.types.Scene.nie_bridge_query = StringProperty(name="Requête", description="Sous-chaîne cherchée dans les chemins VFS")
    bpy.types.Scene.nie_bridge_ext_filter = StringProperty(
        name="Extension", description="Filtre optionnel par extension (ex. `g4md`, sans le point)"
    )
    bpy.types.Scene.nie_bridge_results = bpy.props.CollectionProperty(type=NieBridgeResult)
    bpy.types.Scene.nie_bridge_result_index = IntProperty(default=-1)

    bpy.types.Scene.nie_bridge_chara_query = StringProperty(
        name="Requête", description="Nom (FR/EN/JA), ID ou code interne d'un personnage/technique"
    )
    bpy.types.Scene.nie_bridge_chara_results = bpy.props.CollectionProperty(type=NieBridgeCharaResult)
    bpy.types.Scene.nie_bridge_chara_result_index = IntProperty(default=-1)


def unregister():
    # Nettoyage forcé si l'addon est désactivé pendant qu'une recherche/extraction est en vol —
    # sinon le timer modal tourne encore après `unregister()` et toucherait des données Blender
    # potentiellement invalidées (piège documenté des addons à base de process/threads externes).
    for proc in list(_active_procs):
        try:
            if proc.poll() is None:
                proc.terminate()
        except Exception:
            pass
    _active_procs.clear()
    _active_threads.clear()  # les threads en vol se terminent d'eux-mêmes (daemon=True), non tuables de force.

    del bpy.types.Scene.nie_bridge_chara_result_index
    del bpy.types.Scene.nie_bridge_chara_results
    del bpy.types.Scene.nie_bridge_chara_query
    del bpy.types.Scene.nie_bridge_result_index
    del bpy.types.Scene.nie_bridge_results
    del bpy.types.Scene.nie_bridge_ext_filter
    del bpy.types.Scene.nie_bridge_query
    del bpy.types.Scene.nie_bridge_kind
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
