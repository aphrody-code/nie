// Mode ÉDITEUR — nie-explorer en logiciel type Unreal Engine.
//
// Disposition canonique d'un éditeur de moteur, chaque zone servie par ce que nie sait déjà
// faire :
//
//   ┌──────────────────────────── barre d'outils ────────────────────────────┐
//   │  viewport 3D temps réel (WebGL)              │  outliner (hiérarchie)  │
//   │  caméra libre, sélection au clic             │  détails (propriétés)   │
//   ├───────────────────────────────────────────────────────────────────────┤
//   │  navigateur de contenu (VFS, vignettes, filtres par type d'asset)      │
//   └───────────────────────────────────────────────────────────────────────┘
//
// Le backend renvoie le GLB assemblé (`vfs_glb_bytes_b64`) et le modèle vit dans le même moteur
// temps réel que les aperçus VFS et CPK brut : caméra orbitale, raycast de sélection, wireframe
// et statistiques de scène.
//
// Le panneau « Détails » est l'éditeur de propriétés déjà en place (`PropertyEditor`) : il relie
// l'objet sélectionné à ses fichiers, ses `.cfg.bin` éditables et les fonctions/adresses de
// `nie.exe` qui le manipulent. Sélectionner un modèle dans le navigateur de contenu ouvre donc à
// la fois sa géométrie dans le viewport et sa fiche complète à droite.
//
// MULTI-ASSETS : la scène porte plusieurs modèles à la fois (ctrl/cmd+clic dans le navigateur de
// contenu). `EditorViewState` ne connaît que l'asset PRINCIPAL — celui que l'Explorateur ouvre et
// que l'éditeur de propriétés décrit ; les assets ajoutés vivent ici, dans l'état local de la vue.
//
// GIZMO : il agit sur le NOEUD DE SCÈNE sélectionné et reste local à la session — aucun encodeur
// géométrique n'existe côté Rust, rien n'est écrit ni écrivable. C'est pourquoi position/rotation/
// échelle s'affichent dans la carte du noeud (référentiel « scène ») et jamais dans l'onglet
// Détails, qui décrit l'ASSET par son code (référentiel « données du jeu ») : mélanger les deux
// référentiels ferait passer une pose de session pour une propriété du jeu.
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { save } from "@tauri-apps/plugin-dialog";

import { ContentBrowser } from "@/components/editor/ContentBrowser";
import { AvatarPipelinePanel } from "@/components/editor/AvatarPipelinePanel";
import { MenuPipelinePanel } from "@/components/editor/MenuPipelinePanel";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  Viewport3D,
  type GizmoMode,
  type NodeTransform,
  type SceneNode,
  type ViewportAsset,
  type ViewportStats,
  type ViewportReferenceImage,
} from "@/components/editor/Viewport3D";
import { PropertyEditor } from "@/components/PropertyEditor";
import { CircleButton } from "@nie/inacord-ui/components/ui/circle-button";
import { Icon } from "@nie/inacord-ui/components/ui/Icon";
import { SplitPane } from "@nie/inacord-ui/components/ui/split-pane";
import { Tabs, TabsList, TabsTrigger } from "@nie/inacord-ui/components/ui/tabs";
import { api, type MotionClips } from "@/lib/api";
import { useSettings } from "@nie/inacord-ui/lib/settings";
import { codeOf } from "@/lib/vfsIndexDb";
import { b64ToBytes, bytesToB64, humanSize } from "@/lib/bytes";
import { cn } from "@nie/inacord-ui/lib/utils";
import { NATIVE_WINDOW } from "../../../host";
import { inspectModelGlb, renderModelPng, replaceModelTextureGlb, type ModelGlbInspection } from "../../../game/model-render";
import { editorExportName, importEditorGlb, importEditorPng } from "./editor-interchange";
import { importAvatarReference } from "../../../game/avatar-runtime";
import { loadOcReference as loadTrustedOcReference } from "../../../avatar/oc-reference-loader";
import {
  INITIAL_AVATAR_STATE,
  type AvatarCatalog,
  type OcAvatarDocument,
  type OcReference,
} from "@nie/inacord-ui/avatar/contract";
import { useAssetSource } from "@nie/inacord-ui/source";
import "./editor-view.css";

/** Extensions qui ouvrent réellement quelque chose dans le viewport (cf. `assemble_glb_for_preview`
 * : l'assemblage exige le G4MD **et** le G4MG de même nom, l'un ou l'autre servant de point
 * d'entrée). Le navigateur de contenu ne présente comme ouvrable que le .g4md dont le frère
 * existe ; ce jeu-ci reste plus large pour ne pas refuser une sélection venue d'ailleurs. */
const VIEWPORT_EXTS = new Set(["g4md", "g4mg"]);
const AVATAR_SCENE_KEY = "__avatar_assemble__";
const LOCAL_GLB_PREFIX = "__local_glb__:";

/** Les modes du gizmo, dans l'ordre de la barre d'outils. */
const GIZMO_MODES: readonly (readonly [GizmoMode, string, string])[] = [
  ["none", "near_me", "Sélectionner"],
  ["translate", "open_with", "Déplacer"],
  ["rotate", "rotate_ccw", "Pivoter"],
  ["scale", "scale", "Redimensionner"],
];

/**
 * Racines réellement employées par les trois sous-systèmes à faire converger dans l'éditeur.
 *
 * - `20_EDIT` porte les mailles et les couches de visage que `nie-model-serve` recompose en
 *   avatar ;
 * - `21_icon_avatar` porte les planches de vignettes du même atelier ;
 * - `common/menu` contient les layouts et les scripts que `nie-lua::menu_host` pilote.
 *
 * Ces raccourcis n'inventent donc pas de second catalogue UI. Le rendu de menu reste 2D et
 * l'assemblage d'avatar reste côté Rust ; l'Éditeur devient leur point d'entrée commun pour
 * inspecter les assets, les textures et les modèles sources.
 */
const ESPACES_TRAVAIL: readonly { id: string; label: string; icon: string; prefix: string; title: string }[] = [
  {
    id: "avatar-modeles",
    label: "Avatar 3D",
    icon: "person",
    prefix: "data/common/chr/_face/20_EDIT",
    title: "Pièces 3D et couches de l'avatar",
  },
  {
    id: "avatar-ui",
    label: "Avatar UI",
    icon: "grid_view",
    prefix: "data/dx11/menu/200_icon/21_icon_avatar",
    title: "Vignettes et éléments de menu de l'atelier avatar",
  },
  {
    id: "menus",
    label: "Menus",
    icon: "menu",
    prefix: "data/common/menu",
    title: "Layouts et scripts des menus du jeu",
  },
];

function extOf(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
}

/** Un triplet lisible : les valeurs brutes de three.js ont 17 décimales. */
function vec3(v: readonly [number, number, number], factor = 1): string {
  return v.map((c) => (Math.abs(c * factor) < 1e-4 ? "0" : (c * factor).toFixed(3))).join("  ");
}

/** Tranche de clips d'animation montée d'un coup dans le volet droit. */
const CLIP_PAGE = 200;

/** Les entiers d'un DTO specta arrivent en `number | null` (ils transitent en `f64`). */
function num(v: number | null): number {
  return v ?? 0;
}

export interface EditorViewState {
  /** Dossier courant du navigateur de contenu. */
  prefix: string;
  /** Asset sélectionné (chemin VFS). */
  selected: string | null;
}

export interface EditorViewProps {
  state: EditorViewState;
  onStateChange: (s: EditorViewState) => void;
  /** Renvoie l'asset courant vers l'Explorateur (aperçu/extraction/mods). */
  onOpenInExplorer?: (path: string) => void;
  /** Native scene launch and RTTI/property tooling remain on explicit Inacord routes. */
  authoring?: boolean;
}

export function EditorView({
  state,
  onStateChange,
  onOpenInExplorer,
  authoring = true,
}: EditorViewProps) {
  const settings = useSettings();
  const source = useAssetSource();
  /** Asset modèle principal effectivement à l'écran — distinct de `state.selected`, qui peut être
   * une texture ou une config. */
  const [primary, setPrimary] = useState<string | null>(null);
  /** Assets ajoutés à la scène par ctrl/cmd+clic, hors asset principal. */
  const [extras, setExtras] = useState<string[]>([]);
  const [glbs, setGlbs] = useState<Record<string, string>>({});
  const [glbRevisions, setGlbRevisions] = useState<Record<string, number>>({});
  const [avatarGlb, setAvatarGlb] = useState<string | null>(null);
  const [glbErrors, setGlbErrors] = useState<Record<string, string>>({});
  const [glbLoading, setGlbLoading] = useState(false);
  const [nodes, setNodes] = useState<SceneNode[]>([]);
  const [stats, setStats] = useState<ViewportStats>({ meshes: 0, triangles: 0, vertices: 0, materials: 0 });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [transforms, setTransforms] = useState<Record<string, NodeTransform>>({});
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>("none");
  const [wireframe, setWireframe] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [rightTab, setRightTab] = useState<"outliner" | "details" | "anims">("outliner");
  const [clips, setClips] = useState<MotionClips | null>(null);
  const [clipsFor, setClipsFor] = useState<string | null>(null);
  const [clipsError, setClipsError] = useState<string | null>(null);
  const [clipsLoading, setClipsLoading] = useState(false);
  /** Un seul `.g4pk` de personnage déclare déjà 157 clips, et il y en a des dizaines : le volet
   * n'en monte qu'une tranche dans le DOM tant que l'utilisateur n'a pas demandé le reste. */
  const [clipLimit, setClipLimit] = useState(CLIP_PAGE);
  const [extensionsOpen, setExtensionsOpen] = useState(false);
  const [localNames, setLocalNames] = useState<Record<string, string>>({});
  const [textureOverride, setTextureOverride] = useState<{
    assetKey: string;
    name: string;
    index: number;
    pngB64: string;
    baseGlbB64: string;
  } | null>(null);
  const [modelInspections, setModelInspections] = useState<Record<string, ModelGlbInspection>>({});
  const [referenceImage, setReferenceImage] = useState<ViewportReferenceImage | null>(null);
  const referenceObjectUrl = useRef<string | null>(null);
  const [interchangeBusy, setInterchangeBusy] = useState(false);
  const glbInputRef = useRef<HTMLInputElement | null>(null);
  const textureInputRef = useRef<HTMLInputElement | null>(null);
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const ocInputRef = useRef<HTMLInputElement | null>(null);
  const [ocDocument, setOcDocument] = useState<OcAvatarDocument | null>(null);

  useEffect(() => () => {
    if (referenceObjectUrl.current) URL.revokeObjectURL(referenceObjectUrl.current);
  }, []);

  function replaceReferenceImage(blob: Blob, name: string) {
    if (referenceObjectUrl.current) URL.revokeObjectURL(referenceObjectUrl.current);
    const objectUrl = URL.createObjectURL(blob);
    referenceObjectUrl.current = objectUrl;
    setReferenceImage({ dataUrl: objectUrl, name, opacity: 0.4 });
  }

  function clearReferenceImage() {
    if (referenceObjectUrl.current) URL.revokeObjectURL(referenceObjectUrl.current);
    referenceObjectUrl.current = null;
    setReferenceImage(null);
  }

  const selectedName = state.selected?.split("/").pop() ?? "";
  const selectedCode = state.selected ? codeOf(selectedName) : "";
  const canRender = state.selected ? VIEWPORT_EXTS.has(extOf(state.selected)) : false;

  // Les assets non-modèles (texture, son, config) ne vident PAS le viewport : dans un éditeur,
  // cliquer une texture ne doit pas faire disparaître le modèle qu'on est en train de regarder.
  useEffect(() => {
    if (state.selected && canRender) setPrimary(state.selected);
  }, [state.selected, canRender]);

  const scenePaths = useMemo(() => {
    const list = primary ? [primary] : [];
    for (const p of extras) if (!list.includes(p)) list.push(p);
    if (avatarGlb) list.unshift(AVATAR_SCENE_KEY);
    return list;
  }, [primary, extras, avatarGlb]);
  const scenePathsKey = scenePaths.join("\n");

  // Le GLB d'un chemin ne change pas : on ne charge que les entrées manquantes et on oublie celles
  // qui ont quitté la scène. Recharger l'ensemble à chaque ajout coûterait un assemblage complet
  // par asset déjà à l'écran.
  const glbsRef = useRef<Record<string, string>>({});
  glbsRef.current = glbs;
  useEffect(() => {
    const wanted = new Set(scenePaths);
    const loaded = glbsRef.current;
    if (Object.keys(loaded).some((p) => !wanted.has(p))) {
      setGlbs((prev) => Object.fromEntries(Object.entries(prev).filter(([p]) => wanted.has(p))));
    }
    const missing = scenePaths.filter((p) => p !== AVATAR_SCENE_KEY && !p.startsWith(LOCAL_GLB_PREFIX) && !(p in loaded));
    if (missing.length === 0) return;

    let cancelled = false;
    setGlbLoading(true);
    Promise.all(
      missing.map((path) =>
        api
          .glbBytesB64(path, settings.gameDir)
          .then((b64) => ({ path, b64, error: null as string | null }))
          .catch((e) => ({ path, b64: null as string | null, error: String(e) })),
      ),
    ).then((results) => {
      if (cancelled) return;
      setGlbs((prev) => {
        const next = { ...prev };
        for (const r of results) if (r.b64) next[r.path] = r.b64;
        return next;
      });
      setGlbErrors((prev) => {
        const next = { ...prev };
        for (const r of results) {
          if (r.error) next[r.path] = r.error;
          else delete next[r.path];
        }
        return next;
      });
      setGlbLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenePathsKey, settings.gameDir]);

  // Le GLB déjà assemblé par `nie-model-serve` suit le même chemin de rendu que les GLB VFS,
  // mais ne doit évidemment pas être redemandé au VFS local.
  useEffect(() => {
    setGlbs((prev) => avatarGlb ? { ...prev, [AVATAR_SCENE_KEY]: avatarGlb } : Object.fromEntries(Object.entries(prev).filter(([key]) => key !== AVATAR_SCENE_KEY)));
  }, [avatarGlb]);

  const assets = useMemo<ViewportAsset[]>(
    () => scenePaths.filter((p) => glbs[p]).map((p) => ({ key: p, glbB64: glbs[p]!, revision: glbRevisions[p] ?? 0 })),
    [scenePaths, glbs, glbRevisions],
  );

  // Lister les clips coûte la lecture de TOUTES les archives .g4pk du radical (des dizaines de Mo
  // décompressés) : on ne le déclenche qu'à l'ouverture de l'onglet, et une seule fois par asset.
  useEffect(() => {
    if (rightTab !== "anims" || !state.selected || clipsFor === state.selected) return;
    const path = state.selected;
    let cancelled = false;
    setClipsLoading(true);
    api
      .motionClips(path, settings.gameDir)
      .then((r) => {
        if (cancelled) return;
        setClips(r);
        setClipsError(null);
        setClipLimit(CLIP_PAGE);
      })
      .catch((e) => {
        if (cancelled) return;
        setClips(null);
        setClipsError(String(e));
      })
      .finally(() => {
        if (cancelled) return;
        setClipsFor(path);
        setClipsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rightTab, state.selected, clipsFor, settings.gameDir]);

  // Un nouvel asset principal = nouvelle scène : sélection de noeud et poses de session périmées.
  useEffect(() => {
    setSelectedNode(null);
    setTransforms({});
  }, [primary]);

  // Un noeud dont l'asset a été retiré de la scène ne doit pas rester sélectionné : le gizmo
  // resterait accroché à un objet libéré.
  useEffect(() => {
    if (selectedNode && !nodes.some((n) => n.id === selectedNode)) setSelectedNode(null);
  }, [nodes, selectedNode]);

  const selectedNodeInfo = useMemo(() => nodes.find((n) => n.id === selectedNode) ?? null, [nodes, selectedNode]);
  const selectedTransform = selectedNode ? transforms[selectedNode] : undefined;
  const activeGlb = primary ? glbs[primary] ?? null : null;
  const activeName = primary ? localNames[primary] ?? primary.split("/").pop() ?? "scene.glb" : "scene.glb";
  const activeInspection = primary ? modelInspections[primary] : undefined;

  // Un asset non assemblable ne doit pas se solder par un viewport muet : on nomme le fichier et
  // la raison exacte remontée par le backend.
  const primaryError = primary ? glbErrors[primary] : undefined;
  const notice = primaryError
    ? `${primary!.split("/").pop()} n'est pas assemblable : ${primaryError}. Le viewport exige le couple .g4md + .g4mg de même nom dans le même dossier.`
    : null;

  /** Clic dans le navigateur de contenu. `additive` (ctrl/cmd) ajoute à la scène sans toucher à
   * l'asset principal — c'est lui que décrivent l'Explorateur et l'éditeur de propriétés. */
  function handleSelect(path: string, additive: boolean) {
    if (additive) {
      setExtras((prev) => (prev.includes(path) || path === primary ? prev : [...prev, path]));
      return;
    }
    setExtras([]);
    onStateChange({ ...state, selected: path });
  }

  /** Change de corpus sans conserver une scène ou une sélection de l'espace précédent. */
  function ouvrirEspace(prefix: string) {
    setPrimary(null);
    setExtras([]);
    setNodes([]);
    setStats({ meshes: 0, triangles: 0, vertices: 0, materials: 0 });
    setSelectedNode(null);
    setTransforms({});
    setGizmoMode("none");
    onStateChange({ prefix, selected: null });
  }

  async function importGlbFile(file: File | undefined) {
    if (!file) return;
    setInterchangeBusy(true);
    try {
      const imported = await importEditorGlb(file);
      const key = `${LOCAL_GLB_PREFIX}${crypto.randomUUID()}`;
      const b64 = bytesToB64(imported.bytes);
      setGlbs((prev) => ({ ...prev, [key]: b64 }));
      setLocalNames((prev) => ({ ...prev, [key]: imported.name }));
      setModelInspections((prev) => ({ ...prev, [key]: imported.inspection }));
      setPrimary(key);
      setExtras([]);
      setSelectedNode(null);
      onStateChange({ ...state, selected: null });
      toast.success(`${imported.name} importé · ${imported.inspection.primitives} primitive(s) · ${imported.inspection.textures} texture(s)`);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setInterchangeBusy(false);
      if (glbInputRef.current) glbInputRef.current.value = "";
    }
  }

  async function importOcDocument(file: File | undefined) {
    if (!file) return;
    setInterchangeBusy(true);
    try {
      if (file.size === 0 || file.size > 100_000) throw new Error("Le document OC doit mesurer entre 1 octet et 100 Ko");
      const catalog = await api.modelServiceAvatarCatalog(settings.modelServiceUrl) as AvatarCatalog;
      const imported = await importAvatarReference(catalog, INITIAL_AVATAR_STATE, await file.text());
      if (imported.kind !== "editable" || !imported.document) {
        throw new Error("Le document choisi n'est pas un document OC éditable");
      }
      setOcDocument(imported.document);
      toast.success(`${imported.document.slug} validé par Rust · ${imported.document.references.length} référence(s)`);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setInterchangeBusy(false);
      if (ocInputRef.current) ocInputRef.current.value = "";
    }
  }

  async function loadOcReference(reference: OcReference) {
    setInterchangeBusy(true);
    try {
      const configuredBase = settings.modelServiceUrl.trim();
      const sourceProbe = source.urlFichier("data/__oc_origin_probe__.bin");
      const assetSourceUrl = configuredBase || sourceProbe;
      const loaded = await loadTrustedOcReference(reference, {
        pageUrl: window.location.href,
        assetSourceUrl,
        vfsUrl: (path) => {
          const direct = source.urlFichier(path);
          if (/^https?:\/\//iu.test(direct) || direct.startsWith("/")) return direct;
          if (configuredBase) return new URL(`/f/${path}`, configuredBase).toString();
          throw new Error("La source desktop n’a aucune origine HTTP configurée pour ce chemin VFS");
        },
      });
      const blob = new Blob([loaded.bytes.slice().buffer], {
        type: reference.kind === "glb" ? "model/gltf-binary" : "image/png",
      });
      const file = new File([blob], loaded.name);
      if (reference.kind === "glb") await importGlbFile(file);
      else {
        const imported = await importEditorPng(file);
        replaceReferenceImage(imported.blob, imported.name);
        toast.success(`${imported.name} ajouté comme référence visuelle validée`);
      }
    } catch (error) {
      toast.error(String(error));
    } finally {
      setInterchangeBusy(false);
    }
  }

  async function importPngFile(file: File | undefined, use: "texture" | "reference") {
    if (!file) return;
    setInterchangeBusy(true);
    try {
      const imported = await importEditorPng(file);
      if (use === "texture") {
        if (!primary || !activeGlb) throw new Error("Chargez un modèle avant d'appliquer une texture");
        const inspection = modelInspections[primary] ?? await inspectModelGlb(b64ToBytes(activeGlb));
        if (inspection.textures === 0) throw new Error("Ce modèle ne déclare aucune texture remplaçable");
        setModelInspections((prev) => ({ ...prev, [primary]: inspection }));
        const baseGlbB64 = textureOverride?.assetKey === primary ? textureOverride.baseGlbB64 : activeGlb;
        const pngB64 = bytesToB64(imported.bytes);
        const replaced = await replaceModelTextureGlb(b64ToBytes(baseGlbB64), 0, imported.bytes);
        const replacedB64 = bytesToB64(replaced);
        setGlbs((prev) => ({ ...prev, [primary]: replacedB64 }));
        setGlbRevisions((prev) => ({ ...prev, [primary]: (prev[primary] ?? 0) + 1 }));
        setTextureOverride({
          assetKey: primary,
          name: imported.name,
          index: 0,
          pngB64,
          baseGlbB64,
        });
        toast.success(`${imported.name} chargé comme texture du rendu Rust de session`);
      } else {
        replaceReferenceImage(imported.blob, imported.name);
        toast.success(`${imported.name} ajouté comme référence visuelle`);
      }
    } catch (error) {
      toast.error(String(error));
    } finally {
      setInterchangeBusy(false);
      if (textureInputRef.current) textureInputRef.current.value = "";
      if (referenceInputRef.current) referenceInputRef.current.value = "";
    }
  }

  async function changeTextureIndex(index: number) {
    const current = textureOverride;
    if (!current || current.assetKey !== primary) return;
    setInterchangeBusy(true);
    try {
      const replaced = await replaceModelTextureGlb(
        b64ToBytes(current.baseGlbB64),
        index,
        b64ToBytes(current.pngB64),
      );
      setGlbs((prev) => ({ ...prev, [current.assetKey]: bytesToB64(replaced) }));
      setGlbRevisions((prev) => ({ ...prev, [current.assetKey]: (prev[current.assetKey] ?? 0) + 1 }));
      setTextureOverride({ ...current, index });
    } catch (error) {
      toast.error(String(error));
    } finally {
      setInterchangeBusy(false);
    }
  }

  function removeTextureOverride() {
    const current = textureOverride;
    if (current) {
      setGlbs((prev) => ({ ...prev, [current.assetKey]: current.baseGlbB64 }));
      setGlbRevisions((prev) => ({ ...prev, [current.assetKey]: (prev[current.assetKey] ?? 0) + 1 }));
    }
    setTextureOverride(null);
  }

  async function exportActiveGlb() {
    if (!activeGlb) return;
    const name = editorExportName(activeName, "glb");
    const dest = NATIVE_WINDOW ? await save({ defaultPath: name, filters: [{ name: "GLB", extensions: ["glb"] }] }) : name;
    if (!dest) return;
    setInterchangeBusy(true);
    try {
      const written = await api.saveBytesB64(dest, activeGlb);
      toast.success(`${humanSize(written)} exportés · ${name}`);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setInterchangeBusy(false);
    }
  }

  async function exportActivePng() {
    if (!activeGlb) return;
    const name = editorExportName(activeName, "png");
    const dest = NATIVE_WINDOW ? await save({ defaultPath: name, filters: [{ name: "PNG", extensions: ["png"] }] }) : name;
    if (!dest) return;
    setInterchangeBusy(true);
    try {
      const png = await renderModelPng(b64ToBytes(activeGlb), { width: 1024, height: 1024 });
      const written = await api.saveBytesB64(dest, bytesToB64(png));
      toast.success(`${humanSize(written)} exportés · rendu PNG Rust 1024 × 1024`);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setInterchangeBusy(false);
    }
  }

  const visibleWorkspaces = authoring
    ? ESPACES_TRAVAIL
    : ESPACES_TRAVAIL.filter((espace) => espace.id === "avatar-modeles");

  return (
    <div className="inacord-editor flex h-full min-h-0 min-w-0 flex-col">
      {/* Barre d'outils */}
      <div className="inacord-editor__toolbar flex shrink-0 items-center gap-2 overflow-x-auto border-b border-app-line px-2 py-1.5">
        <span className="inacord-editor__selection min-w-0 flex-1 truncate text-xs font-medium text-ink" title={state.selected ?? undefined}>
          {state.selected ? selectedName : "Aucun asset sélectionné"}
          {extras.length > 0 && <span className="ml-2 text-tiny text-ink-faint">+{extras.length} dans la scène</span>}
          {glbLoading && <span className="ml-2 text-tiny text-ink-faint">chargement…</span>}
        </span>

        {/* Gizmo de transformation — inactif tant qu'aucun noeud n'est sélectionné, la manipulation
         * n'ayant alors aucune cible. */}
        <div className="inacord-editor__gizmos flex shrink-0 items-center gap-1.5 border-r border-app-line pr-3">
          {GIZMO_MODES.map(([mode, icon, label]) => (
            <CircleButton
              key={mode}
              icon={icon}
              size="sm"
              variant={gizmoMode === mode ? "accent" : "default"}
              title={label}
              aria-label={label}
              disabled={mode !== "none" && !selectedNode}
              onClick={() => setGizmoMode(mode)}
            />
          ))}
        </div>

        {/* Les raccourcis sont des CORPUS de travail, pas des modes graphiques concurrents :
            chaque sélection conserve le viewport, le navigateur et l'inspecteur de l'Éditeur. */}
        <div className="inacord-editor__workspaces flex shrink-0 items-center gap-1 border-r border-app-line pr-3" aria-label="Espaces de travail">
          {visibleWorkspaces.map((espace) => (
            <button
              key={espace.id}
              type="button"
              className={cn(
                "flex items-center gap-1 rounded px-1.5 py-1 text-tiny transition-colors",
                state.prefix === espace.prefix
                  ? "bg-accent text-white"
                  : "text-ink-dull hover:bg-app-hover hover:text-ink",
              )}
              title={espace.title}
              aria-label={espace.label}
              onClick={() => ouvrirEspace(espace.prefix)}
            >
              <Icon name={espace.icon} size={13} />
              <span>{espace.label}</span>
            </button>
          ))}
        </div>

        <div className="inacord-editor__view-options flex shrink-0 items-center gap-1.5">
          <CircleButton
            icon="extension"
            size="sm"
            variant={extensionsOpen ? "accent" : "default"}
            title="Import et export"
            aria-label="Import et export"
            aria-expanded={extensionsOpen}
            onClick={() => setExtensionsOpen((value) => !value)}
          />
          <CircleButton
            icon="grid_view"
            size="sm"
            variant={showGrid ? "accent" : "default"}
            title="Afficher la grille"
            aria-label="Afficher la grille"
            onClick={() => setShowGrid((v) => !v)}
          />
          <CircleButton
            icon="deployed_code"
            size="sm"
            variant={wireframe ? "accent" : "default"}
            title="Mode fil de fer"
            aria-label="Mode fil de fer"
            onClick={() => setWireframe((v) => !v)}
          />
          {/* The native editor receives the same assembled GLB in its own GPU window. */}
          {authoring ? <CircleButton
            icon="wand"
            size="sm"
            title="Ouvrir dans l'éditeur de scène natif"
            aria-label="Ouvrir dans l'éditeur de scène natif"
            onClick={() =>
              api
                .openInSceneEditor(state.selected, settings.gameDir)
                .then((m) => toast.success(m))
                .catch((e) => toast.error(String(e)))
            }
          /> : null}
          <CircleButton
            icon="open_in_new"
            size="sm"
            title="Ouvrir dans l'Explorateur"
            aria-label="Ouvrir dans l'Explorateur"
            disabled={!state.selected}
            onClick={() => state.selected && onOpenInExplorer?.(state.selected)}
          />
        </div>

        {/* Statistiques de scène — ce qu'affiche le coin d'un viewport d'éditeur. */}
        <div className="inacord-editor__stats flex shrink-0 gap-3 border-l border-app-line pl-3 font-mono text-tiny text-ink-faint">
          <span>{stats.meshes} mesh</span>
          <span>{stats.triangles.toLocaleString("fr-FR")} tris</span>
          <span>{stats.vertices.toLocaleString("fr-FR")} verts</span>
          <span>{stats.materials} mat</span>
        </div>
      </div>
      <input
        ref={glbInputRef}
        type="file"
        accept=".glb,model/gltf-binary"
        className="hidden"
        aria-label="Fichier GLB à importer"
        onChange={(event) => void importGlbFile(event.currentTarget.files?.[0])}
      />
      <input
        ref={ocInputRef}
        type="file"
        accept=".json,.oc.json,application/json"
        className="hidden"
        aria-label="Document OC à importer"
        onChange={(event) => void importOcDocument(event.currentTarget.files?.[0])}
      />
      <input
        ref={textureInputRef}
        type="file"
        accept=".png,image/png"
        className="hidden"
        aria-label="Texture PNG à importer"
        onChange={(event) => void importPngFile(event.currentTarget.files?.[0], "texture")}
      />
      <input
        ref={referenceInputRef}
        type="file"
        accept=".png,image/png"
        className="hidden"
        aria-label="Référence PNG à importer"
        onChange={(event) => void importPngFile(event.currentTarget.files?.[0], "reference")}
      />
      {extensionsOpen && (
        <section className="inacord-editor__extensions border-b border-app-line bg-app-box px-2 py-2" aria-label="Extension import et export 3D">
          <div className="inacord-editor__extension-actions flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-tiny font-semibold uppercase tracking-wide text-ink-faint">Extension locale</span>
            <button type="button" className="inacord-editor__extension-button" disabled={interchangeBusy} onClick={() => glbInputRef.current?.click()}>
              <Icon name="upload_file" size={14} /> Importer GLB
            </button>
            <button type="button" className="inacord-editor__extension-button" disabled={interchangeBusy} onClick={() => ocInputRef.current?.click()}>
              <Icon name="person_add" size={14} /> Document OC
            </button>
            <button type="button" className="inacord-editor__extension-button" disabled={interchangeBusy || !activeGlb} onClick={() => textureInputRef.current?.click()}>
              <Icon name="texture" size={14} /> Texture PNG
            </button>
            <button type="button" className="inacord-editor__extension-button" disabled={interchangeBusy} onClick={() => referenceInputRef.current?.click()}>
              <Icon name="image" size={14} /> Référence PNG
            </button>
            <button type="button" className="inacord-editor__extension-button" disabled={interchangeBusy || !activeGlb} onClick={() => void exportActiveGlb()}>
              <Icon name="download" size={14} /> Exporter GLB
            </button>
            <button type="button" className="inacord-editor__extension-button" disabled={interchangeBusy || !activeGlb} onClick={() => void exportActivePng()}>
              <Icon name="photo_camera" size={14} /> Exporter PNG
            </button>
          </div>
          {ocDocument && (
            <div className="mt-2 rounded border border-app-line p-2 text-tiny text-ink-dull" aria-label="Références du document OC">
              <div className="flex items-center justify-between gap-2">
                <strong className="truncate text-ink">OC · {ocDocument.slug}</strong>
                <span>{ocDocument.references.filter((item) => item.kind === "glb" || item.kind === "png").length} asset(s) chargeable(s)</span>
              </div>
              <ul className="mt-1 grid gap-1">
                {ocDocument.references.filter((item) => item.kind === "glb" || item.kind === "png").map((item, index) => (
                  <li key={`${item.kind}:${item.value}:${index}`} className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate" title={item.value}>{item.kind.toUpperCase()} · {item.value}</span>
                    <button type="button" className="inacord-editor__extension-button shrink-0"
                      disabled={interchangeBusy || !item.bytes || !item.sha256}
                      title={!item.bytes || !item.sha256 ? "Taille et SHA-256 requis avant chargement" : undefined}
                      onClick={() => void loadOcReference(item)}>
                      Charger
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-ink-faint">Document validé en mémoire seulement : aucune écriture dans <code>data/oc</code>.</p>
            </div>
          )}
          {(textureOverride || referenceImage) && (
            <div className="inacord-editor__extension-state mt-2 flex flex-wrap items-center gap-2 text-tiny text-ink-dull">
              {textureOverride && (
                <div className="flex min-w-0 items-center gap-1.5 rounded border border-app-line px-2 py-1">
                  <span className="truncate">Texture du rendu Rust : {textureOverride.name}</span>
                  {activeInspection && textureOverride.assetKey === primary && (
                    <select
                      aria-label="Index de texture du modèle"
                      className="rounded border border-app-line bg-app-dark-box px-1 py-0.5 text-ink"
                      value={textureOverride.index}
                      onChange={(event) => void changeTextureIndex(Number(event.currentTarget.value))}
                    >
                      {activeInspection.textureSizes.map(([width, height], index) => (
                        <option key={index} value={index}>
                          #{index}{activeInspection.textureNames[index] ? ` · ${activeInspection.textureNames[index]}` : ""} · {width}×{height}
                        </option>
                      ))}
                    </select>
                  )}
                  <button type="button" aria-label="Retirer la texture importée" onClick={removeTextureOverride}><Icon name="close" size={13} /></button>
                </div>
              )}
              {referenceImage && (
                <div className="flex min-w-0 items-center gap-1.5 rounded border border-app-line px-2 py-1">
                  <span className="truncate">Référence : {referenceImage.name}</span>
                  <button type="button" aria-label="Retirer la référence importée" onClick={clearReferenceImage}><Icon name="close" size={13} /></button>
                </div>
              )}
            </div>
          )}
          <p className="mt-1.5 text-tiny text-ink-faint">
            Le GLB et le PNG exportés concernent l’asset actif. La texture remplace réellement l’image choisie dans un nouveau GLB validé par Rust, rechargé dans le viewport. La référence et les transformations de scène ne sont pas incluses.
          </p>
        </section>
      )}
      {state.prefix === "data/common/chr/_face/20_EDIT" && (
        <AvatarPipelinePanel baseUrl={settings.modelServiceUrl} onGlb={(glb) => { setAvatarGlb(glb); setSelectedNode(null); }} />
      )}
      {authoring && state.prefix === "data/common/menu" && <MenuPipelinePanel baseUrl={settings.modelServiceUrl} />}

      {/* Corps : (viewport | panneaux droits) au-dessus du navigateur de contenu */}
      <SplitPane
        axis="y"
        side="end"
        defaultSize={220}
        min={100}
        max={600}
        storageKey="editor-content-browser"
        className="inacord-editor__body min-h-0 flex-1"
        panel={
          <ContentBrowser
            prefix={state.prefix}
            onNavigate={(prefix) => onStateChange({ ...state, prefix })}
            selected={state.selected}
            onSelect={handleSelect}
            className="h-full border-t border-app-line"
          />
        }
      >
        <SplitPane
          axis="x"
          side="end"
          defaultSize={320}
          min={240}
          max={640}
          storageKey="editor-inspector"
          className="inacord-editor__viewport-split h-full"
          panel={
            <div className="flex h-full min-h-0 flex-col border-l border-app-line bg-app-dark-box">
              <Tabs
                value={rightTab}
                onValueChange={(v) => v && setRightTab(v as "outliner" | "details" | "anims")}
              >
                <TabsList variant="line" className="px-2 pt-1.5">
                  <TabsTrigger value="outliner" className="text-xs">
                    Hiérarchie
                  </TabsTrigger>
                  <TabsTrigger
                    value="details"
                    className="text-xs"
                    disabled={authoring ? !selectedCode : !selectedNodeInfo}
                  >
                    Détails
                  </TabsTrigger>
                  <TabsTrigger value="anims" className="text-xs" disabled={!state.selected}>
                    Animations
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {rightTab === "outliner" ? (
                <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-1.5">
                  {assets.length === 0 ? (
                    <p className="p-2 text-tiny text-ink-faint">
                      Aucune scène chargée. Sélectionnez un <code>.g4md</code> assemblable ;
                      ctrl/cmd+clic ajoute un second modèle à la scène.
                    </p>
                  ) : (
                    // Un en-tête par asset : sans lui, deux modèles aux mêmes noms de noeuds
                    // donnent une hiérarchie illisible.
                    assets.map((a) => (
                      <div key={a.key} className="mb-1.5">
                        <div className="flex items-center gap-1 rounded bg-app-box/60 px-1 py-0.5 text-tiny font-semibold text-ink">
                          <Icon name="view_in_ar" size={12} className="shrink-0 text-accent" />
                          <span className="min-w-0 flex-1 truncate" title={a.key}>
                            {a.key.split("/").pop()}
                          </span>
                          {a.key !== primary && (
                            <button
                              type="button"
                              className="shrink-0 rounded p-0.5 text-ink-faint transition-colors hover:bg-app-hover hover:text-ink"
                              title="Retirer de la scène"
                              aria-label="Retirer de la scène"
                              onClick={() => setExtras((prev) => prev.filter((p) => p !== a.key))}
                            >
                              <Icon name="close" size={11} />
                            </button>
                          )}
                        </div>
                        {nodes
                          .filter((n) => n.assetKey === a.key)
                          .map((n) => (
                            <button
                              key={n.id}
                              type="button"
                              onClick={() => setSelectedNode(n.id === selectedNode ? null : n.id)}
                              className={cn(
                                "flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-tiny transition-colors",
                                n.id === selectedNode
                                  ? "bg-accent text-white"
                                  : "text-ink-dull hover:bg-app-hover hover:text-ink",
                              )}
                              style={{ paddingLeft: 4 + n.depth * 12 }}
                              title={`${n.type}${n.triangles ? ` · ${n.triangles} triangles` : ""}`}
                            >
                              <Icon name={n.triangles > 0 ? "view_in_ar" : "account_tree"} size={12} />
                              <span className="min-w-0 flex-1 truncate">{n.name}</span>
                              {n.triangles > 0 && (
                                <span className="shrink-0 font-mono opacity-60">{n.triangles}</span>
                              )}
                            </button>
                          ))}
                      </div>
                    ))
                  )}

                  {/* Carte du NOEUD DE SCÈNE : sa transformation appartient à la session, pas aux
                   * données du jeu — l'onglet Détails, lui, décrit l'asset par son code. */}
                  {selectedNodeInfo && (
                    <div className="mt-2 rounded border border-app-line bg-app-box p-2 text-tiny text-ink-dull">
                      <p className="font-semibold text-ink">{selectedNodeInfo.name}</p>
                      <p>type : {selectedNodeInfo.type}</p>
                      {selectedNodeInfo.triangles > 0 && (
                        <p>{selectedNodeInfo.triangles.toLocaleString("fr-FR")} triangles</p>
                      )}
                      {selectedTransform && (
                        <dl className="mt-1.5 space-y-0.5 border-t border-app-line pt-1.5 font-mono">
                          <div className="flex gap-2">
                            <dt className="w-14 shrink-0 text-ink-faint">position</dt>
                            <dd className="min-w-0 truncate">{vec3(selectedTransform.position)}</dd>
                          </div>
                          <div className="flex gap-2">
                            <dt className="w-14 shrink-0 text-ink-faint">rotation</dt>
                            <dd className="min-w-0 truncate">{vec3(selectedTransform.rotation, 180 / Math.PI)}°</dd>
                          </div>
                          <div className="flex gap-2">
                            <dt className="w-14 shrink-0 text-ink-faint">échelle</dt>
                            <dd className="min-w-0 truncate">{vec3(selectedTransform.scale)}</dd>
                          </div>
                        </dl>
                      )}
                      <p className="mt-1.5 text-ink-faint">
                        Transformation locale à la session : le dépôt ne sait pas réécrire une
                        géométrie G4MG/G4MD, rien n'est enregistré.
                      </p>
                    </div>
                  )}
                </div>
              ) : rightTab === "anims" ? (
                /* LECTURE SEULE, délibérément : aucun bouton lecture/pause, aucune barre de
                 * transport. Le GLB servi au viewport n'a ni `skins` ni `animations` (cf.
                 * `nie_formats::assemble`), donc rien ici ne peut être rejoué — offrir les
                 * commandes d'un lecteur promettrait une fonction inexistante. */
                <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-2 text-tiny">
                  <p className="mb-2 text-ink-faint">
                    Clips <span className="font-semibold text-ink-dull">déclarés</span> par les
                    fichiers de mouvement <code>.g4mt</code> contenus dans les archives{" "}
                    <code>.g4pk</code> de même radical. Liste seule : le modèle affiché ne porte ni
                    squelette ni animation, aucune lecture n&apos;est possible ici.
                  </p>

                  {clipsLoading && <p className="text-ink-faint">lecture des archives…</p>}
                  {clipsError && <p className="text-error">{clipsError}</p>}

                  {!clipsLoading && clips && (
                    <>
                      <p className="mb-1.5 font-mono text-ink-faint">
                        {clips.clips.length} clip(s) · {clips.archives.length} archive(s)
                      </p>
                      {clips.notice && (
                        <p className="mb-1.5 rounded border border-app-line bg-app-box p-1.5 text-ink-dull">
                          {clips.notice}
                        </p>
                      )}
                      <ul className="space-y-1">
                        {clips.clips.slice(0, clipLimit).map((c, i) => (
                          <li
                            key={`${c.archive}#${c.motion_file}#${i}`}
                            className="rounded border border-app-line bg-app-box px-1.5 py-1"
                          >
                            <div className="flex items-center gap-1.5">
                              <Icon name="animation" size={12} className="shrink-0 text-accent" />
                              <span
                                className="min-w-0 flex-1 truncate font-semibold text-ink"
                                title={c.name}
                              >
                                {c.name || "(clip sans nom)"}
                              </span>
                              {c.additive && (
                                <span
                                  className="shrink-0 rounded bg-app-hover px-1 text-ink-faint"
                                  title="Clip additif : superposé à une pose de base"
                                >
                                  additif
                                </span>
                              )}
                            </div>
                            <div className="font-mono text-ink-faint">
                              frames {num(c.start_frame)}→{num(c.end_frame)} ({num(c.frame_count)}){" "}
                              · {num(c.fps)} fps · {num(c.target_count)} cibles
                            </div>
                            <div
                              className="truncate text-ink-faint"
                              title={`${c.archive} → ${c.motion_file}`}
                            >
                              {c.motion_file}
                            </div>
                          </li>
                        ))}
                      </ul>
                      {clips.clips.length > clipLimit && (
                        <button
                          type="button"
                          className="mt-1.5 w-full rounded border border-app-line px-1.5 py-1 text-ink-dull transition-colors hover:bg-app-hover hover:text-ink"
                          onClick={() => setClipLimit((n) => n + CLIP_PAGE)}
                        >
                          Afficher {Math.min(CLIP_PAGE, clips.clips.length - clipLimit)} clips de
                          plus ({clips.clips.length - clipLimit} restants)
                        </button>
                      )}
                    </>
                  )}
                </div>
              ) : (
                authoring && selectedCode ? (
                  <PropertyEditor
                    code={selectedCode}
                    className="min-h-0 flex-1 p-2"
                    onOpenFile={(p) => onStateChange({ ...state, selected: p })}
                  />
                ) : !authoring && selectedNodeInfo ? (
                  <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs text-ink-dull" aria-label="Transformation en lecture seule">
                    <h2 className="font-semibold text-ink">{selectedNodeInfo.name}</h2>
                    <p>{selectedNodeInfo.type}{selectedNodeInfo.triangles > 0 ? ` · ${selectedNodeInfo.triangles.toLocaleString("fr-FR")} triangles` : ""}</p>
                    {selectedTransform ? (
                      <dl className="mt-3 space-y-1 border-t border-app-line pt-2 font-mono">
                        <div className="flex gap-2"><dt className="w-16 shrink-0 text-ink-faint">position</dt><dd>{vec3(selectedTransform.position)}</dd></div>
                        <div className="flex gap-2"><dt className="w-16 shrink-0 text-ink-faint">rotation</dt><dd>{vec3(selectedTransform.rotation, 180 / Math.PI)}°</dd></div>
                        <div className="flex gap-2"><dt className="w-16 shrink-0 text-ink-faint">échelle</dt><dd>{vec3(selectedTransform.scale)}</dd></div>
                      </dl>
                    ) : <p className="mt-3 text-ink-faint">Lecture de la transformation…</p>}
                    <p className="mt-3 text-ink-faint">Valeurs locales à cette session, non enregistrées dans le VFS.</p>
                  </div>
                ) : (
                  <p className="p-3 text-xs text-ink-faint">Sélectionnez un nœud du modèle pour afficher sa transformation.</p>
                )
              )}
            </div>
          }
        >
          {/* Le viewport est la zone la plus exposée de l'application : trois moteurs (WebGL,
            * three.js, le GLB du jeu) dont aucun n'est sous notre contrôle. Sa barrière propre
            * garde la panne DANS le viewport — hiérarchie, détails et navigateur de contenu
            * continuent de servir. `resetKeys` : changer d'asset réarme tout seul. */}
          <ErrorBoundary zone="Aperçu 3D" resetKeys={[scenePathsKey]}>
            <Viewport3D
              assets={assets}
              selectedId={selectedNode}
              onSelect={setSelectedNode}
              onSceneLoaded={(n, s) => {
                setNodes(n);
                setStats(s);
              }}
              onTransform={(id, trs) => setTransforms((prev) => ({ ...prev, [id]: trs }))}
              gizmoMode={gizmoMode}
              notice={notice}
              wireframe={wireframe}
              showGrid={showGrid}
              referenceImage={referenceImage}
              className="h-full w-full bg-app-darker-box"
            />
          </ErrorBoundary>
        </SplitPane>
      </SplitPane>
    </div>
  );
}
