import { useResolvedNames, nameWithId } from "../lib/resolved-names";
import { GalleryCard } from "../components/wiki/wiki/GalleryCard";
// Vue **Galerie** — les illustrations du jeu, listées depuis le VFS.
//
// Portée depuis l'ancien wiki (`GalleryGrid`, `GalleryLightbox`,
// `filters/GalleryFilterBar`, `wikiService.getGalleryList`). La migration ne déplace pas la page :
// elle change de source. Le wiki compose deux fonds qui ne se rejoignent jamais — la table
// `inagle_gallery` (360 lignes) et un manifeste statique de 3 579 entrées — d'où sa pastille
// « Toutes » qui annonce 3 939 items pour une liste qui n'en rend que 360.
//
// Ici, la source est le VFS monté : `data/dx11/menu/220_img/` porte **17 085 `.g4tx`**, les
// catégories SONT les sous-dossiers réels (`api.ls`), et chaque compte affiché est un compte
// relevé (`api.findPaged` rend le total avant pagination, cf. `nie_explore::listing::find_paged`).
// `gallery_config` (`api.gameDataGallery`) n'énumère plus : elle enrichit — condition de
// déblocage et épisode d'histoire, là où elle en connaît.
//
// Les vignettes passent par `lib/thumbs.ts`, source UNIQUE de l'application : décodage borné à
// 128 px côté Rust, cache LRU, file de décodage. Une grille qui appellerait `api.texturePngB64`
// ferait entrer 8 Mo de bitmap par image dans le processus de rendu (les `gallery_img2` pèsent
// 8 294 752 octets pièce) — c'est exactement l'accident que `thumbs.ts` documente.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { GalleryDirectory as VfsDir, GalleryServices, GallerySort } from "./contracts";
import { ExportMenu } from "./ExportMenu";
import { GalleryFilters } from "./GalleryFilters";
import {
  EXT_GALERIE,
  LANGUES,
  RACINE_GALERIE,
  construireIllustrations,
  filtrerIllustrations,
  libelleCategorie,
  libelleSousDossier,
  prefixeCategorie,
  type EnrichissementGalerie,
  type Illustration,
} from "./gallery";
import { useSettings } from "@niers/inacord-ui/lib/settings";
import { useThumbnail } from "@niers/inacord-ui/lib/thumbs";
import { Alert, AlertDescription, AlertTitle } from "@niers/inacord-ui/components/ui/alert";
import { Badge } from "@niers/inacord-ui/components/ui/badge";
import { Icon } from "@niers/inacord-ui/components/ui/Icon";
import { Input } from "@niers/inacord-ui/components/ui/input";
import { ScrollArea } from "@niers/inacord-ui/components/ui/scroll-area";

/**
 * Illustrations affichées d'un coup — au-delà, un bouton « en afficher plus ».
 *
 * 120 et pas 200 : `/api/v1/recherche` CLIPE en silence à `PER_PAGE_MAX = 200` (cf. CLAUDE.md),
 * et une page qui demanderait la borne exacte ne laisserait aucune marge pour l'enrichissement
 * par nom, qui concatène ses propres résultats à la page de chemins. Ce qui décide vraiment du
 * confort est le défilement infini, pas la taille d'un lot.
 */
const PAR_PAGE = 120;
/** Delay between visible URL/input state and a remote gallery search. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Images PLEINE RÉSOLUTION gardées par la visionneuse.
 *
 * Volontairement minuscule : une planche du jeu pèse plusieurs mégaoctets une fois encodée en
 * base64, et la garder est autrement plus cher qu'une vignette de 128 px. Trois entrées
 * couvrent exactement ce que sert le préchargement — l'image courante et ses deux voisines —
 * sans retenir un album entier.
 */
const MAX_PLEINES = 3;

/** Cache LRU des images pleine résolution : `Map` = ordre d'insertion. */
function createImageCache(services: GalleryServices) {
const cachePleines = new Map<string, string>();

/** Lit le cache en marquant l'entrée comme récemment utilisée. */
function pleineDuCache(chemin: string): string | undefined {
	const trouve = cachePleines.get(chemin);
	if (trouve === undefined) return undefined;
	cachePleines.delete(chemin);
	cachePleines.set(chemin, trouve);
	return trouve;
}

/** Range une image et évince la plus ancienne au-delà de `MAX_PLEINES`. */
function rangerPleine(chemin: string, src: string) {
	cachePleines.delete(chemin);
	cachePleines.set(chemin, src);
	while (cachePleines.size > MAX_PLEINES) {
		const plusAncien = cachePleines.keys().next();
		if (plusAncien.done) break;
		cachePleines.delete(plusAncien.value);
	}
}

/**
 * Charge une image pleine résolution, en passant par le cache.
 *
 * Les demandes concurrentes du même chemin sont partagées : sans cela, afficher une image
 * pendant que son préchargement est en vol la décoderait deux fois.
 */
const enVol = new Map<string, Promise<string>>();

function chargerPleine(chemin: string, gameDir?: string): Promise<string> {
	const key = JSON.stringify([gameDir ?? "", chemin]);
	const connu = pleineDuCache(key);
	if (connu !== undefined) return Promise.resolve(connu);

	const dejaEnVol = enVol.get(key);
	if (dejaEnVol) return dejaEnVol;

	const promesse = services
		.texturePngB64(chemin, gameDir)
		.then((b64) => {
			const src = `data:image/png;base64,${b64}`;
			rangerPleine(key, src);
			return src;
		})
		.finally(() => enVol.delete(key));

	enVol.set(key, promesse);
	return promesse;
}
return { load: chargerPleine, peek: (path: string, gameDir?: string) => pleineDuCache(JSON.stringify([gameDir ?? "", path])) };
}
type ImageCache = ReturnType<typeof createImageCache>;

/** Vignette d'une illustration — même fabrique que l'Explorateur et l'Éditeur. */
function Vignette({ chemin, gameDir }: { chemin: string; gameDir?: string }) {
  const { ref, src } = useThumbnail(chemin, EXT_GALERIE, gameDir);
  return (
    <div
      ref={ref}
      className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-surface-container-highest"
    >
      {src ? (
        // Aperçu local décodé par le backend : pas de balise image optimisée ici (app Tauri).
        <img src={src} alt="" className="h-full w-full object-contain" loading="lazy" />
      ) : (
        <Icon name="image" size={22} className="text-on-surface-variant/50" />
      )}
    </div>
  );
}

/**
 * Visionneuse plein cadre. Contrairement à la grille, elle demande la texture PLEINE
 * RÉSOLUTION (`api.texturePngB64`) — une seule à la fois, à la demande : c'est le seul endroit où
 * ce coût est justifié.
 */
function Visionneuse({
  services,
  images,
  liste,
  index,
  onIndex,
  onFermer,
  onOuvrirDansExplorateur,
  gameDir,
}: {
  services: GalleryServices;
  images: ImageCache;
  liste: Illustration[];
  index: number;
  onIndex: (i: number) => void;
  onFermer: () => void;
  onOuvrirDansExplorateur?: (chemin: string) => void;
  gameDir?: string;
}) {
  const settings = useSettings();
  const item = liste[index];
  const [src, setSrc] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    let annule = false;

    // Une image déjà en cache s'affiche SANS repasser par `null` : sinon chaque flèche fait
    // clignoter la visionneuse alors que l'image est déjà là, ce qui annule tout le bénéfice
    // du préchargement.
    const connu = images.peek(item.chemin, gameDir);
    setSrc(connu ?? null);
    setErreur(null);

    if (connu === undefined) {
      images.load(item.chemin, gameDir)
        .then((src) => (annule ? null : setSrc(src)))
        .catch((e) => {
          if (!annule) setErreur(String(e));
        });
    }

    // Préchargement des voisines : c'est la navigation aux flèches qui en profite. Les échecs
    // sont ignorés — une voisine illisible ne doit pas parasiter l'image qu'on regarde ; elle
    // signalera son erreur quand on arrivera dessus.
    for (const voisin of [liste[index + 1], liste[index - 1]]) {
      if (voisin) void images.load(voisin.chemin, gameDir).catch(() => undefined);
    }

    return () => {
      annule = true;
    };
  }, [item, index, liste, gameDir, images]);

  useEffect(() => {
    function onTouche(e: KeyboardEvent) {
      if (e.key === "Escape") onFermer();
      else if (e.key === "ArrowRight") onIndex(Math.min(liste.length - 1, index + 1));
      else if (e.key === "ArrowLeft") onIndex(Math.max(0, index - 1));
    }
    window.addEventListener("keydown", onTouche);
    return () => window.removeEventListener("keydown", onTouche);
  }, [index, liste.length, onIndex, onFermer]);

  const exporter = useCallback(async () => {
    if (!item) return;
    await services.exportPng(item.chemin, gameDir);
  }, [item, gameDir, services]);

  if (!item) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Aperçu de l’illustration" className="absolute inset-0 z-50 flex flex-col bg-app/95 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-app-line px-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate type-title-small text-on-surface">{item.titre}</p>
          <p className="truncate type-label-small text-on-surface-variant">{item.chemin}</p>
        </div>
        <Badge variant="outline">{services.formatBytes(item.octets)}</Badge>
        {item.deblocage && <Badge variant="secondary">{item.deblocage}</Badge>}
        {item.episode !== null && <Badge variant="outline">épisode {item.episode}</Badge>}
        <button
          type="button"
          className="state-layer rounded-md px-2 py-1 type-label-medium text-on-surface-variant"
          onClick={exporter}
        >
          <Icon name="download" size={16} /> Exporter en PNG…
        </button>
        {/* Le PNG reste un raccourci d'un clic ; le menu donne TOUS les formats que l'hôte
            déclare pour ce fichier-là, y compris le fichier d'origine sans conversion. */}
        <ExportMenu
          path={item.chemin}
          listFormats={services.exportFormats && ((path) => services.exportFormats!(path, gameDir))}
          download={services.exportAs && ((path, format) => services.exportAs!(path, format, gameDir))}
        />
        {onOuvrirDansExplorateur && (
          <button
            type="button"
            className="state-layer rounded-md px-2 py-1 type-label-medium text-on-surface-variant"
            onClick={() => onOuvrirDansExplorateur(item.chemin)}
          >
            <Icon name="folder_open" size={16} /> Ouvrir
          </button>
        )}
        <button
          type="button"
          aria-label="Fermer"
          className="state-layer rounded-md px-2 py-1 text-on-surface-variant"
          onClick={onFermer}
        >
          <Icon name="close" size={18} />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        <button
          type="button"
          aria-label="Précédente"
          disabled={index === 0}
          className="state-layer absolute left-2 rounded-full p-2 text-on-surface disabled:opacity-30"
          onClick={() => onIndex(index - 1)}
        >
          <Icon name="chevron_left" size={28} />
        </button>
        {erreur ? (
          <Alert variant="destructive" className="max-w-lg">
            <AlertTitle>Décodage impossible</AlertTitle>
            <AlertDescription>{erreur}</AlertDescription>
          </Alert>
        ) : src ? (
          <img src={src} alt={item.titre} className="max-h-full max-w-full object-contain" />
        ) : (
          <p className="type-body-medium text-on-surface-variant">décodage…</p>
        )}
        <button
          type="button"
          aria-label="Suivante"
          disabled={index >= liste.length - 1}
          className="state-layer absolute right-2 rounded-full p-2 text-on-surface disabled:opacity-30"
          onClick={() => onIndex(index + 1)}
        >
          <Icon name="chevron_right" size={28} />
        </button>
      </div>

      <div className="border-t border-app-line px-4 py-1.5 text-center type-label-small text-on-surface-variant">
        {index + 1} / {liste.length.toLocaleString(settings.locale)} — ← → pour naviguer, Échap pour fermer
      </div>
    </div>
  );
}

export interface GalleryViewProps {
  services: GalleryServices;
  onOpenFile?: (path: string) => void;
  query?: string;
  category?: string | null;
  subfolder?: string | null;
  serverSearch?: boolean;
  rootPrefix?: string;
  onQueryChange?: (query: string) => void;
  onCategoryChange?: (category: string | null) => void;
  onSubfolderChange?: (subfolder: string | null) => void;
}

const resourceCode = (path: string) => path.split("/").pop()!.replace(/\.[^.]+$/, "");

export function GalleryView({
  services, onOpenFile, query, category, subfolder, serverSearch = false, rootPrefix,
  onQueryChange, onCategoryChange, onSubfolderChange,
}: GalleryViewProps) {
  const root = rootPrefix ?? RACINE_GALERIE;
  const images = useMemo(() => createImageCache(services), [services]);
  const settings = useSettings();
  const [categories, setCategories] = useState<VfsDir[]>([]);
  const [localCategory, setLocalCategory] = useState<string | null>(null);
  const [sousDossiers, setSousDossiers] = useState<VfsDir[]>([]);
  const [subfoldersLoadedFor, setSubfoldersLoadedFor] = useState<string | null>(null);
  const [localSubfolder, setLocalSubfolder] = useState<string | null>(null);
  const [items, setItems] = useState<Illustration[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [localQuery, setLocalQuery] = useState("");
  const categorie = category === undefined ? localCategory : category;
  const sousDossier = subfolder === undefined ? localSubfolder : subfolder;
  const recherche = query === undefined ? localQuery : query;
  const [serverQuery, setServerQuery] = useState(recherche);
  const selectCategory = (value: string | null) => {
    setLocalCategory(value);
    if (value !== categorie) {
      setLocalSubfolder(null);
      onSubfolderChange?.(null);
    }
    onCategoryChange?.(value);
  };
  const selectSubfolder = (value: string | null) => { setLocalSubfolder(value); onSubfolderChange?.(value); };
  const changeQuery = (value: string) => { setLocalQuery(value); onQueryChange?.(value); };
  const [tri, setTri] = useState<GallerySort>({ by: "name", order: "asc" });
  const [chargement, setChargement] = useState(true);
  const [chargementSuite, setChargementSuite] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState<number | null>(null);
  /** `gallery_config` indexé par nom de fichier — chargé une fois, réutilisé par toutes les pages. */
  const [enrichissements, setEnrichissements] = useState<Map<string, EnrichissementGalerie>>(
    new Map(),
  );
  /** Invalidates a late page when the selected prefix changes. */
  const requestGeneration = useRef(0);
  /** Cancels whichever server page or cross-index search currently owns the grid. */
  const activeRequest = useRef<AbortController | null>(null);

  // The input and URL remain immediate, while the remote query waits for a short pause. This
  // prevents one cross-index search per keystroke and leaves local desktop filtering immediate.
  useEffect(() => {
    if (!serverSearch) {
      setServerQuery(recherche);
      return;
    }
    // Invalidate and abort old results immediately; only issuing the replacement request is
    // debounced. A slow response can therefore never flash after the visible query changed.
    activeRequest.current?.abort();
    activeRequest.current = null;
    requestGeneration.current += 1;
    const timer = setTimeout(() => setServerQuery(recherche), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [recherche, serverSearch]);

  // Catégories = sous-dossiers RÉELS de la racine. Aucune liste écrite d'avance : un dossier
  // ajouté par une mise à jour du jeu apparaît de lui-même.
  useEffect(() => {
    let active = true;
    setChargement(true);
    setErreur(null);
    services
      .ls(root, settings.gameDir)
      .then((l) => {
        if (!active) return;
        setCategories(l.dirs);
        // Une catégorie inconnue retombe sur « Toutes » (`null`), jamais sur la PREMIÈRE du
        // dossier : ce repli-là forçait un dossier au montage, si bien que la galerie complète
        // n'était atteignable par aucune combinaison de filtres et qu'une recherche ne portait
        // que sur `activity_photo`.
        if (categorie && !l.dirs.some((d) => d.name === categorie)) selectCategory(null);
        return null;
      })
      .catch((e) => { if (active) setErreur(String(e)); })
      .finally(() => { if (active) setChargement(false); });
    return () => { active = false; };
  }, [settings.gameDir, services, root]);

  // `gallery_config` : ce que le jeu sait des illustrations qu'il expose dans son menu Galerie.
  // Best-effort — la galerie liste le VFS avec ou sans lui.
  useEffect(() => {
    let active = true;
    services
      .gameDataGallery(settings.gameDir)
      .then((lignes) => {
        if (!active) return;
        const m = new Map<string, EnrichissementGalerie>();
        for (const g of lignes) {
          if (g.img_path) m.set(g.img_path, { deblocage: g.unlock_kind, episode: g.story_episode });
          if (g.thumb_path)
            m.set(g.thumb_path, { deblocage: g.unlock_kind, episode: g.story_episode });
        }
        setEnrichissements(m);
        return null;
      })
      .catch(() => { if (active) setEnrichissements(new Map()); });
    return () => { active = false; };
  }, [settings.gameDir, services]);

  // Sous-dossiers de la catégorie courante (langues de `telop_waza`/`hlp`/`stamp_img`, variantes
  // de `ev_pic`/`ev_telop`).
  useEffect(() => {
    let active = true;
    setSousDossiers([]);
    setSubfoldersLoadedFor(null);
    if (!categorie) return;
    services
      .ls(`${root}/${categorie}`, settings.gameDir)
      .then((l) => {
        if (!active) return;
        setSousDossiers(l.dirs);
        setSubfoldersLoadedFor(categorie);
      })
      .catch(() => {
        if (active) {
          setSousDossiers([]);
          setSubfoldersLoadedFor(categorie);
        }
      });
    return () => { active = false; };
  }, [categorie, settings.gameDir, services, root]);

  // A controlled URL subfolder survives mount, reload and popstate when the VFS confirms it.
  // Only an invalid value is removed after that category's directory list has actually loaded.
  useEffect(() => {
    if (subfoldersLoadedFor !== categorie || !sousDossier) return;
    if (!sousDossiers.some((folder) => folder.name === sousDossier)) selectSubfolder(null);
  }, [categorie, sousDossier, sousDossiers, subfoldersLoadedFor]);

  // First bounded page of the current category (or subfolder). Further pages are requested only
  // when the sentinel is reached; a 12,460-entry folder no longer becomes one 30,000-row query.
  useEffect(() => {
    let annule = false;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const generation = ++requestGeneration.current;
    setChargement(true);
    setChargementSuite(false);
    setErreur(null);
    setItems([]);
    setTotalItems(0);
    services
      .findPaged(
        prefixeCategorie(categorie, sousDossier, root),
        EXT_GALERIE,
        PAR_PAGE,
        0,
        settings.gameDir,
        serverSearch ? serverQuery : undefined,
        controller.signal,
        tri,
      )
      .then((page) => {
        if (!annule && generation === requestGeneration.current) {
          setItems(construireIllustrations(page.files, enrichissements, root));
          setTotalItems(page.total);
        }
        return null;
      })
      .catch((e) => {
        if (!annule && !controller.signal.aborted) setErreur(String(e));
      })
      .finally(() => {
        if (activeRequest.current === controller) activeRequest.current = null;
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
      controller.abort();
    };
  }, [categorie, sousDossier, enrichissements, settings.gameDir, services, serverSearch, serverQuery, tri, root]);

  const chargerSuite = useCallback(() => {
    if (chargement || chargementSuite || items.length >= totalItems) return;
    const generation = requestGeneration.current;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const offset = items.length;
    setChargementSuite(true);
    setErreur(null);
    services
      .findPaged(
        prefixeCategorie(categorie, sousDossier, root),
        EXT_GALERIE,
        PAR_PAGE,
        offset,
        settings.gameDir,
        serverSearch ? serverQuery : undefined,
        controller.signal,
        tri,
      )
      .then((page) => {
        if (generation !== requestGeneration.current) return null;
        setItems((current) => [
          ...current,
          ...construireIllustrations(page.files, enrichissements, root),
        ]);
        setTotalItems(page.total);
        return null;
      })
      .catch((e) => {
        if (generation === requestGeneration.current && !controller.signal.aborted) setErreur(String(e));
      })
      .finally(() => {
        if (activeRequest.current === controller) activeRequest.current = null;
        if (generation === requestGeneration.current) setChargementSuite(false);
      });
  }, [categorie, chargement, chargementSuite, enrichissements, items.length, settings.gameDir, services, sousDossier, totalItems, serverSearch, serverQuery, tri, root]);

  const codes = useMemo(() => items.map(item => resourceCode(item.chemin)), [items]);
  const names = useResolvedNames(services.resolveNames, services.nameSource ?? "", settings.gameLocale, codes);
  const namedItems = items.map(item => {
    const name = names.get(resourceCode(item.chemin));
    return name ? { ...item, titre: nameWithId(name.name, name.id ?? resourceCode(item.chemin)) } : item;
  });
  const filtres = serverSearch ? namedItems : filtrerIllustrations(namedItems, recherche);
  const affiches = filtres;

  /** Sentinelle de fin de grille : sa venue à l'écran déclenche la page suivante. */
  const sentinelle = useRef<HTMLButtonElement | null>(null);
  const reste = items.length < totalItems;

  // Chargement automatique au défilement. La marge de 300 px déclenche AVANT que la sentinelle
  // n'entre réellement dans le champ : les vignettes suivantes sont donc déjà demandées quand
  // l'utilisateur arrive dessus, au lieu d'apparaître en retard sous ses yeux.
  //
  // La boucle se referme d'elle-même : chaque déclenchement augmente `visibles`, ce qui
  // recalcule `reste` et réattache un observateur ; quand tout est affiché, `reste` passe à
  // faux et l'effet ne se remonte plus. `setVisibles` est appelé sous forme fonctionnelle pour
  // que deux déclenchements rapprochés s'additionnent au lieu de s'écraser.
  useEffect(() => {
    if (!reste) return;
    const el = sentinelle.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          chargerSuite();
        }
      },
      { rootMargin: "300px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [reste, chargerSuite]);
  const total = useMemo(
    () => categories.reduce((somme, d) => somme + d.count, 0),
    [categories],
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="type-title-small text-on-surface">Galerie</h2>
        <Badge variant="secondary">
          {total.toLocaleString(settings.locale)} {root === RACINE_GALERIE ? "illustrations" : "textures"}
        </Badge>
        <Input
          className="w-full sm:ml-auto sm:w-64"
          placeholder={root === RACINE_GALERIE ? "Rechercher une illustration…" : "Rechercher une texture…"}
          value={recherche}
          onChange={(e) => changeQuery(e.target.value)}
        />
        {/* Le tri est demandé au serveur d'index (`tri`/`ordre`), pas appliqué à la page déjà
            reçue : trier ici ne toucherait que les 120 lignes chargées tout en affichant un
            ordre sur un total de 17 085. */}
        <div className="flex items-center gap-1" role="group" aria-label="Trier">
          {([
            { by: "name", label: "Nom" },
            { by: "size", label: "Taille" },
          ] as const).map((option) => (
            <button
              key={option.by}
              type="button"
              aria-pressed={tri.by === option.by}
              className={`state-layer rounded-full border px-3 py-1.5 type-label-medium ${
                tri.by === option.by
                  ? "border-primary bg-primary text-on-primary"
                  : "border-outline-variant/30 text-on-surface-variant"
              }`}
              onClick={() =>
                setTri((current) =>
                  current.by === option.by
                    ? { by: option.by, order: current.order === "asc" ? "desc" : "asc" }
                    : { by: option.by, order: "asc" },
                )
              }
            >
              {option.label}
              {tri.by === option.by && (
                <Icon name={tri.order === "asc" ? "arrow_upward" : "arrow_downward"} size={14} />
              )}
            </button>
          ))}
        </div>
      </div>

      {erreur && (
        <Alert variant="destructive">
          <AlertTitle>Galerie indisponible</AlertTitle>
          <AlertDescription>{erreur}</AlertDescription>
        </Alert>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[8rem_minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(180px,220px)_minmax(0,1fr)] sm:grid-rows-1">
        <ScrollArea className="h-32 min-h-0 rounded-2xl border border-app-line bg-app-dark-box sm:h-auto">
          <div className="divide-y divide-app-line">
            {/* « Toutes » est une VRAIE entrée, pas un effacement de filtre : elle interroge la
                racine, donc son compte est le total du VFS et la recherche porte sur les 26
                dossiers d'un coup. */}
            <button
              type="button"
              className={`state-layer flex w-full items-center justify-between gap-2 px-3 py-2 text-left type-body-medium ${
                categorie === null
                  ? "bg-secondary-container text-on-secondary-container"
                  : "text-on-surface"
              }`}
              onClick={() => selectCategory(null)}
            >
              <span className="min-w-0 flex-1 truncate font-medium">Toutes les catégories</span>
              <span className="tabular-nums type-label-small text-on-surface-variant">
                {total.toLocaleString(settings.locale)}
              </span>
            </button>
            {categories.map((c) => (
              <button
                key={c.name}
                type="button"
                className={`state-layer flex w-full items-center justify-between gap-2 px-3 py-2 text-left type-body-medium ${
                  categorie === c.name
                    ? "bg-secondary-container text-on-secondary-container"
                    : "text-on-surface"
                }`}
                onClick={() => selectCategory(c.name)}
              >
                <span className="min-w-0 flex-1 truncate">{libelleCategorie(c.name)}</span>
                <span className="tabular-nums type-label-small text-on-surface-variant">
                  {c.count.toLocaleString(settings.locale)}
                </span>
              </button>
            ))}
            {categories.length === 0 && !chargement && (
              <p className="p-4 type-body-small text-on-surface-variant">
                Aucun dossier sous {root} — le VFS est-il monté ?
              </p>
            )}
          </div>
        </ScrollArea>

        <div className="flex min-h-0 min-w-0 flex-col gap-2">
          {sousDossiers.length > 0 && (
            <GalleryFilters
              currentCategory={sousDossier ?? ""}
              onCategoryChange={(value) => selectSubfolder(value || null)}
              categories={[
                { value: "", label: "Tout", count: items.length },
                ...sousDossiers.map((folder) => ({
                  value: folder.name,
                  label: libelleSousDossier(folder.name),
                  count: folder.count,
                  title: LANGUES.has(folder.name) ? "Variante de langue" : undefined,
                })),
              ]}
            />
          )}

          <div className="flex items-center gap-2 type-label-small text-on-surface-variant">
            {chargement
              ? "chargement…"
              : `${filtres.length.toLocaleString(settings.locale)} ${root === RACINE_GALERIE ? "illustration(s)" : "texture(s)"} affichée(s) sur ${
                  totalItems.toLocaleString(settings.locale)
                }${recherche.trim() && !serverSearch ? ` · recherche dans ${items.length.toLocaleString(settings.locale)} chargée(s)` : ""}`}
          </div>

          <ScrollArea className="min-h-0 flex-1 rounded-2xl border border-app-line bg-app-dark-box p-2">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
              {affiches.map((it, i) => (
                <GalleryCard key={it.chemin} id={it.chemin} title={it.titre} thumb={null}
                  onOpen={() => setOuvert(i)} onDoubleClick={() => onOpenFile?.(it.chemin)}
                  thumbnail={<Vignette chemin={it.cheminVignette} gameDir={settings.gameDir} />}
                  metadata={<span className="truncate type-label-small text-on-surface-variant">
                    <code className="block">{resourceCode(it.chemin)}</code>
                    {services.formatBytes(it.octets)}{it.deblocage ? ` · ${it.deblocage}` : ""}
                  </span>}
                />
              ))}
            </div>
            {reste && (
              // La sentinelle EST le bouton, et c'est délibéré : le défilement la déclenche
              // seul, mais elle reste actionnable au clavier — et sert de repli si un
              // conteneur exotique empêchait l'observateur de se déclencher.
              <button
                ref={sentinelle}
                type="button"
                className="state-layer mt-2 w-full rounded-lg py-2 type-label-medium text-on-surface-variant"
                disabled={chargementSuite}
                onClick={chargerSuite}
              >
                {chargementSuite ? "Chargement…" : "Afficher la suite"} ({
                  (totalItems - items.length).toLocaleString(settings.locale)
                } restantes)
              </button>
            )}
            {!chargement && filtres.length === 0 && (
              <p className="p-4 type-body-small text-on-surface-variant">
                {root === RACINE_GALERIE ? "Aucune illustration ne correspond." : "Aucune texture ne correspond."}
              </p>
            )}
          </ScrollArea>
        </div>
      </div>

      {ouvert !== null && (
        <Visionneuse
          services={services}
          images={images}
          liste={affiches}
          index={ouvert}
          onIndex={setOuvert}
          onFermer={() => setOuvert(null)}
          onOuvrirDansExplorateur={onOpenFile}
          gameDir={settings.gameDir}
        />
      )}
    </div>
  );
}
