/**
 * La vue « Modèles » — la couche 3D du dépôt, vue depuis le navigateur.
 *
 * ## Pourquoi cette vue ne ressemble pas aux trois autres catalogues
 *
 * `Catalogue.tsx` liste un filtre d'extensions sur le VFS : `modeles` y retenait `.g4md`,
 * `.g4mg`, `.g4sk`, `.g4mt`, `.g4pk`. Ce sont des **pièces**, pas des modèles — un `.g4mg` seul
 * n'est qu'un tampon de géométrie, il n'a ni texture, ni squelette, ni recette d'assemblage, et
 * la grille n'en montrait donc qu'un nom de fichier et une taille. On listait 143 000 fichiers
 * dont aucun ne pouvait s'afficher.
 *
 * Ici, l'unité est le **code de modèle** — ce que le jeu assemble et ce qu'on peut regarder.
 * Le serveur en publie 6 191, répartis en six familles (`/api/v1/3d`), et il sait rendre
 * chacun sous deux formes : un GLB assemblé et une image.
 *
 * ## Deux chemins de rendu, et pourquoi les deux
 *
 * | | Vignette de la grille | Viewport |
 * |---|---|---|
 * | qui rend | `nie-render3d`, **côté serveur** (rastériseur CPU à z-buffer) | `nie-render3d` via WebAssembly/WebGPU |
 * | ce que reçoit le navigateur | un PNG de 12 ko | le GLB (jusqu'à quelques Mo) |
 * | coût pour 24 cartes | 24 `<img>` | 24 périphériques WebGPU — inacceptable |
 *
 * Une grille ne doit pas monter un périphérique GPU par carte : les navigateurs plafonnent le
 * nombre de contextes de rendu et détruisent silencieusement les plus anciens, ce qui donne
 * une grille dont la moitié des cases redeviennent noires en défilant. Le serveur, lui, rend la
 * même image une fois puis la sert depuis son cache en 0,6 ms (mesuré : 182 ms au premier
 * rendu, 0,6 ms ensuite). Le viewport interactif n'est monté que pour le modèle qu'on ouvre —
 * **un seul contexte à la fois**.
 *
 * ## Le viewport réutilise le moteur Rust
 *
 * Le navigateur ne décode plus le GLB et ne maintient plus son propre nuanceur. Le composant
 * partagé remet les octets au `WebGpuViewer` de `nie-wasm`, façade du parseur et du renderer Rust.
 * La caméra initiale reste lue sur `/api/v1/3d`, puis les interactions passent par cette façade.
 */
import { RustModelViewport } from "@niers/inacord-ui/shell/rust-model-viewport";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  browserLocationSnapshot,
  subscribeBrowserLocation,
  writeBrowserHistory,
} from "@niers/inacord-ui/lib/browser-navigation";
import { createCpuNativeViewer, createOpaqueNativeViewer } from "../game/native-viewer";
import { agree, Notice, ViewTitle } from "./screen-parts";
import "./models-3d.css";

/** 24 cartes par défaut : une grille pleine sans imposer 60 rendus à froid au serveur. */
const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 200;

/** Poids maximal d'un GLB chargé dans le viewport. Au-delà, on garde l'aperçu serveur. */
const GLB_OCTETS_MAX = 32 * 1024 * 1024;

const DEFAULT_MODEL_FAMILY = "perso";

export interface ModelFilterState {
  family: string;
  q: string;
  page: number;
  perPage: number;
}

function boundedPageSize(raw: string | null): number {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1
    ? Math.min(value, MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
}

/** Read the complete model-catalogue state from its shareable URL. */
export function modelFilterStateFromUrl(search: string): ModelFilterState {
  const params = new URLSearchParams(search);
  const rawPage = Number(params.get("page"));
  const rawFamily = params.get("famille")?.trim() ?? "";
  return {
    family:
      rawFamily && rawFamily.length <= 96 ? rawFamily : DEFAULT_MODEL_FAMILY,
    q: params.get("q") ?? "",
    page: Number.isSafeInteger(rawPage) && rawPage >= 1 ? rawPage : 1,
    perPage: boundedPageSize(
      params.has("per_page") ? params.get("per_page") : params.get("par_page"),
    ),
  };
}

/** Serialize only filters that belong to the model catalogue; defaults remain implicit. */
export function modelHrefForFilters(
  location: string,
  state: ModelFilterState,
): string {
  const current = new URL(location, "http://localhost");
  const target = new URL(current.pathname, current.origin);
  if (state.family !== DEFAULT_MODEL_FAMILY)
    target.searchParams.set("famille", state.family);
  if (state.q) target.searchParams.set("q", state.q);
  if (state.page > 1) target.searchParams.set("page", String(state.page));
  if (state.perPage !== DEFAULT_PAGE_SIZE)
    target.searchParams.set("per_page", String(state.perPage));
  return `${target.pathname}${target.search}`;
}

function writeModelFilters(state: ModelFilterState): void {
  const href = modelHrefForFilters(window.location.href, state);
  if (`${window.location.pathname}${window.location.search}` !== href) {
    writeBrowserHistory(href, window.history.state, "replace");
  }
}

/** Une famille, telle que `/api/v1/3d` la décrit. */
interface Famille {
  segment: string;
  libelle: string;
  source: string;
  dossier: string | null;
  total: number | null;
  verifie: boolean;
}

/** Les conventions de caméra du rastériseur, publiées par le serveur. */
interface Moteur {
  focale: number;
  distance: number;
  tilt: number;
  taille_defaut: number;
  taille_max: number;
  simultanes: number;
}

/** Corps de `/api/v1/3d`. */
interface Capacites3d {
  amont: string;
  vfs_pret: boolean;
  miroir_present: boolean;
  moteur: Moteur;
  familles: Famille[];
}

/** Un modèle du catalogue. */
interface Modele {
  code: string;
  famille: string;
  nom: string | null;
  fichiers: number | null;
  glb: string;
  apercu: string;
}

/** Une page du catalogue. */
interface PageModeles {
  elements: Modele[];
  page: number;
  per_page: number;
  total: number;
  pages: number;
}

/** Corps de `/api/v1/3d/modeles/{famille}/{code}/analyse`. */
interface Analyse {
  glb_octets: number;
  primitives: number;
  primitives_sans_texture: number;
  sommets: number;
  triangles: number;
  textures: { largeur: number; hauteur: number }[];
  texels: number;
  boite: { min: number[]; max: number[]; centre: number[]; rayon: number };
}

/** Lit une réponse JSON, en distinguant l'abandon volontaire d'un vrai échec. */
async function json<T>(url: string, signal: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return (await r.json()) as T;
}

/** Formate un nombre à la française, sans dépendance. */
function n(x: number): string {
  return x.toLocaleString("fr");
}

/** Formate une taille en octets. */
function octets(x: number): string {
  if (x < 1024) return `${x} o`;
  if (x < 1024 * 1024) return `${(x / 1024).toFixed(1)} ko`;
  return `${(x / (1024 * 1024)).toFixed(1)} Mo`;
}

export function Modeles3D() {
  const location = useSyncExternalStore(
    subscribeBrowserLocation,
    browserLocationSnapshot,
    browserLocationSnapshot,
  );
  const filters = useMemo(
    () => modelFilterStateFromUrl(new URL(location, "http://localhost").search),
    [location],
  );
  const [capacites, setCapacites] = useState<Capacites3d | null>(null);
  const [capacitesKo, setCapacitesKo] = useState(false);
  const { family: famille, page, perPage, q: filtre } = filters;
  const setFilters = (
    update: (current: ModelFilterState) => ModelFilterState,
  ) => {
    writeModelFilters(update(modelFilterStateFromUrl(window.location.search)));
  };
  const [saisie, setSaisie] = useState(filters.q);
  const [liste, setListe] = useState<PageModeles | null>(null);
  const [listeKo, setListeKo] = useState(false);
  const [ouvert, setOuvert] = useState<Modele | null>(null);

  // Les capacités décrivent ce que la machine sait faire : familles, totaux, conventions de
  // caméra. Sans elles on n'affiche pas une liste vide, on dit que le service ne répond pas.
  useEffect(() => {
    const ac = new AbortController();
    json<Capacites3d>("/api/v1/3d", ac.signal)
      .then(setCapacites)
      .catch(() => {
        if (!ac.signal.aborted) setCapacitesKo(true);
      });
    return () => ac.abort();
  }, []);

  useEffect(() => {
    setSaisie(filters.q);
  }, [filters.q]);

  const familles = capacites?.familles ?? [];
  const familyKnown = familles.some(
    (candidate) => candidate.segment === famille,
  );
  useEffect(() => {
    if (!capacites || familles.length === 0 || familyKnown) return;
    const fallback = familles[0]?.segment ?? DEFAULT_MODEL_FAMILY;
    writeModelFilters({ ...filters, family: fallback, page: 1 });
  }, [capacites, familles, familyKnown, filters]);

  useEffect(() => {
    setOuvert(null);
  }, [famille]);

  useEffect(() => {
    if (!capacites || !familyKnown) return;
    const ac = new AbortController();
    setListe(null);
    setListeKo(false);
    const url = `/api/v1/3d/modeles?famille=${encodeURIComponent(famille)}&page=${page}&per_page=${perPage}${
      filtre ? `&q=${encodeURIComponent(filtre)}` : ""
    }`;
    json<PageModeles>(url, ac.signal)
      .then((response) => {
        if (response.pages > 0 && page > response.pages) {
          setFilters((current) => ({ ...current, page: response.pages }));
          return;
        }
        setListe(response);
      })
      .catch(() => {
        if (!ac.signal.aborted) setListeKo(true);
      });
    return () => ac.abort();
  }, [capacites, familyKnown, famille, page, perPage, filtre]);

  const familleCourante = familles.find((f) => f.segment === famille);

  if (capacitesKo) {
    return (
      <Notice tone="alerte">
        La couche 3D ne répond pas. Le service de décodage est peut-être arrêté
        ; réessayez dans un instant.
      </Notice>
    );
  }
  if (!capacites) return <Notice>Chargement…</Notice>;

  return (
    <section className="models-3d-page">
      <ViewTitle detail={liste ? agree(liste.total, "modèle") : undefined}>
        Modèles
      </ViewTitle>

      <p
        style={{
          margin: "var(--jeu-espace-m) 0",
          maxWidth: "70ch",
          lineHeight: 1.5,
        }}
      >
        Chaque vignette est un <strong>rendu réel</strong> du modèle du jeu,
        produit par le moteur du dépôt&nbsp;: les pièces sont assemblées en glTF
        puis rastérisées côté serveur. Ouvrez une carte pour manipuler le modèle
        en 3D.
      </p>

      {/* Les familles ne sont pas des dossiers : ce sont les six manières dont le jeu range
			    ses modèles, et chacune a sa propre recette d'assemblage. */}
      <nav
        aria-label="Familles de modèles"
        className="models-3d-families"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--jeu-espace-s)",
        }}
      >
        {familles.map((f) => (
          <button
            key={f.segment}
            type="button"
            aria-pressed={f.segment === famille}
            onClick={() => {
              setFilters((current) => ({
                ...current,
                family: f.segment,
                page: 1,
              }));
              setOuvert(null);
            }}
            style={f.segment === famille ? ONGLET_ACTIF : ONGLET}
          >
            {f.libelle}
            {f.total !== null ? (
              <span style={{ fontWeight: 500 }}> · {n(f.total)}</span>
            ) : null}
          </button>
        ))}
      </nav>

      <form
        className="models-3d-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters((current) => ({ ...current, q: saisie, page: 1 }));
        }}
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--jeu-espace-s)",
          margin: "var(--jeu-espace-m) 0",
        }}
      >
        <input
          className="models-3d-filters__search"
          type="search"
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          placeholder={
            familleCourante?.source === "miroir"
              ? "Chercher un personnage par nom ou par code…"
              : "Chercher un code…"
          }
          aria-label="Chercher un modèle"
          style={{ ...CHAMP, minWidth: 0, flex: "1 1 16rem" }}
        />
        <button type="submit" style={BOUTON}>
          Chercher
        </button>
        {filtre ? (
          <button
            type="button"
            onClick={() => {
              setSaisie("");
              setFilters((current) => ({ ...current, q: "", page: 1 }));
            }}
            style={BOUTON}
          >
            Effacer
          </button>
        ) : null}
        <label
          className="models-3d-filters__page-size"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--jeu-espace-s)",
            minWidth: 0,
            flex: "1 1 12rem",
          }}
        >
          <span>Modèles par page</span>
          <input
            type="number"
            min={1}
            max={MAX_PAGE_SIZE}
            value={perPage}
            aria-label="Modèles par page"
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                perPage: boundedPageSize(event.currentTarget.value),
                page: 1,
              }))
            }
            style={{ ...CHAMP, width: "6rem", flex: "0 0 6rem" }}
          />
        </label>
      </form>

      {ouvert ? (
        <Viewport
          modele={ouvert}
          moteur={capacites.moteur}
          onFermer={() => setOuvert(null)}
        />
      ) : null}

      {listeKo ? (
        <Notice tone="alerte">
          Ce catalogue n'a pas pu être chargé. Réessayez dans un instant.
        </Notice>
      ) : !liste ? (
        <Notice>Chargement…</Notice>
      ) : liste.elements.length === 0 ? (
        <Notice>Aucun modèle ne correspond à cette recherche.</Notice>
      ) : (
        <ul style={GRILLE}>
          {liste.elements.map((m) => (
            <li key={`${m.famille}/${m.code}`}>
              <Carte
                modele={m}
                ouvert={ouvert?.code === m.code && ouvert.famille === m.famille}
                onOuvrir={() => setOuvert(m)}
              />
            </li>
          ))}
        </ul>
      )}

      {liste && liste.pages > 1 ? (
        <nav
          aria-label="Pagination"
          className="models-3d-pagination"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexWrap: "wrap",
            gap: "var(--jeu-espace-m)",
          }}
        >
          <button
            type="button"
            disabled={page <= 1}
            onClick={() =>
              setFilters((current) => ({ ...current, page: current.page - 1 }))
            }
            style={BOUTON}
          >
            Précédent
          </button>
          <span aria-live="polite" style={{ fontWeight: 700 }}>
            Page {n(page)} sur {n(liste.pages)}
          </span>
          <button
            type="button"
            disabled={page >= liste.pages}
            onClick={() =>
              setFilters((current) => ({ ...current, page: current.page + 1 }))
            }
            style={BOUTON}
          >
            Suivant
          </button>
        </nav>
      ) : null}
    </section>
  );
}

/**
 * Une carte de la grille : l'aperçu rendu par le serveur, le nom, le code.
 *
 * `loading="lazy"` n'est pas cosmétique ici : chaque `<img>` déclenche, la première fois, une
 * rastérisation côté serveur. Charger toute la page d'un coup pendant qu'on lit le haut
 * remplirait la file de rendu pour rien.
 */
function Carte({
  modele,
  ouvert,
  onOuvrir,
}: {
  modele: Modele;
  ouvert: boolean;
  onOuvrir: () => void;
}) {
  const [echec, setEchec] = useState(false);
  return (
    <button
      type="button"
      onClick={onOuvrir}
      aria-label={`Voir ${modele.nom ?? modele.code} en 3D`}
      style={{
        ...CARTE,
        borderColor: ouvert
          ? "var(--jeu-texte-vif, #2b6cb0)"
          : "var(--jeu-tuile-bord)",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "1",
          background: FOND_RENDU,
        }}
      >
        {echec ? (
          // Un aperçu qui échoue ne laisse pas une case vide : il DIT que le rendu de ce
          // modèle n'aboutit pas. Le GLB, lui, reste souvent servable — d'où le bouton,
          // qui reste actif.
          <span style={MESSAGE_APERCU}>Aperçu indisponible</span>
        ) : (
          <img
            src={modele.apercu}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setEchec(true)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              display: "block",
            }}
          />
        )}
      </div>
      <div style={{ padding: "var(--jeu-espace-s)", textAlign: "left" }}>
        <div
          style={{
            fontSize: "0.82rem",
            fontWeight: 700,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {modele.nom ?? modele.code}
        </div>
        <div style={{ fontSize: "0.7rem", color: "var(--jeu-tuile-bas)" }}>
          {/* Le code est l'identité : il est affiché même quand un nom existe, parce que
					    c'est lui qui est dans l'URL et dans les fichiers du jeu. */}
          {modele.code}
          {modele.fichiers !== null
            ? ` · ${agree(modele.fichiers, "fichier")}`
            : ""}
        </div>
      </div>
    </button>
  );
}
/* ------------------------------------------------------------------------------------------ */
/* Le viewport Rust partagé                                                                    */
/* ------------------------------------------------------------------------------------------ */

function Viewport({
  modele,
  moteur,
  onFermer,
}: {
  modele: Modele;
  moteur: Moteur;
  onFermer: () => void;
}) {
  const [analyse, setAnalyse] = useState<Analyse | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setAnalyse(null);
    json<Analyse>(
      `/api/v1/3d/modeles/${modele.famille}/${modele.code}/analyse`,
      ac.signal,
    )
      .then(setAnalyse)
      .catch(() => undefined);
    return () => ac.abort();
  }, [modele.famille, modele.code]);

  const titre = modele.nom ?? modele.code;
  const loadingFallback = <div style={SURCOUCHE}>Assemblage du modèle…</div>;

  return (
    <section aria-label={`Vue 3D de ${titre}`} style={PANNEAU}>
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "var(--jeu-espace-m)",
          flexWrap: "wrap",
        }}
      >
        <h3 style={{ margin: 0, fontSize: "1.1rem" }}>{titre}</h3>
        <code style={{ fontSize: "0.8rem", opacity: 0.75 }}>
          {modele.famille}/{modele.code}
        </code>
        <span style={{ flex: 1 }} />
        <a href={modele.glb} download style={LIEN}>
          Télécharger le glTF
        </a>
        <button type="button" onClick={onFermer} style={BOUTON}>
          Fermer
        </button>
      </header>

      <div
        style={{
          position: "relative",
          marginTop: "var(--jeu-espace-m)",
          aspectRatio: "16/10",
          borderRadius: "var(--jeu-rayon)",
          background: FOND_RENDU,
          overflow: "hidden",
        }}
      >
        <RustModelViewport
          url={modele.glb}
          createViewer={createOpaqueNativeViewer}
		  createFallbackViewer={createCpuNativeViewer}
          label={`Vue 3D de ${titre}`}
          initialCamera={{
            yaw: 0.6,
            pitch: moteur.tilt,
            distance: moteur.distance,
          }}
          maxBytes={GLB_OCTETS_MAX}
          canvasStyle={{ display: "block", cursor: "grab" }}
          loadingFallback={loadingFallback}
          renderError={(error, retry) => (
            <div role="alert" style={SURCOUCHE}>
              <div style={{ marginBottom: "var(--jeu-espace-s)" }}>
                {error.message}
              </div>
              <img
                src={modele.apercu}
                alt=""
                style={{ maxWidth: 260, borderRadius: "var(--jeu-rayon)" }}
              />
              <button
                type="button"
                onClick={retry}
                style={{ ...BOUTON, marginTop: "var(--jeu-espace-s)" }}
              >
                Réessayer
              </button>
            </div>
          )}
        />
      </div>

      <p
        style={{
          fontSize: "0.78rem",
          opacity: 0.8,
          margin: "var(--jeu-espace-s) 0 0",
        }}
      >
        Glisser pour tourner, molette pour approcher.
        {analyse
          ? ` ${n(analyse.triangles)} triangles, ${n(analyse.sommets)} sommets, ${agree(
              analyse.textures.length,
              "texture",
            )}, ${octets(analyse.glb_octets)} de glTF.`
          : ""}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Habillage — les mêmes formes que le reste du site                                            */
/* ------------------------------------------------------------------------------------------ */

/** Le fond des rendus, aligné sur `nie_render3d::render::couleur_fond`. */
const FOND_RENDU = "linear-gradient(180deg, rgb(24, 28, 40), rgb(50, 58, 74))";

const GRILLE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
  gap: "var(--jeu-espace-m)",
  listStyle: "none",
  margin: "var(--jeu-espace-l) 0",
  padding: 0,
};

const CARTE: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: 0,
  background: "#fff",
  border: "2px solid var(--jeu-tuile-bord)",
  borderRadius: "var(--jeu-rayon)",
  color: "var(--jeu-nuit-profonde)",
  overflow: "hidden",
  boxShadow: "var(--jeu-ombre-tuile)",
  cursor: "pointer",
  font: "inherit",
  textAlign: "left",
};

const MESSAGE_APERCU: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center",
  color: "#cbd5e1",
  fontSize: "0.78rem",
  padding: "var(--jeu-espace-s)",
  textAlign: "center",
};

const PANNEAU: React.CSSProperties = {
  background: "#fff",
  border: "2px solid var(--jeu-tuile-bord)",
  borderRadius: "var(--jeu-rayon)",
  padding: "var(--jeu-espace-m)",
  margin: "var(--jeu-espace-m) 0",
  boxShadow: "var(--jeu-ombre-tuile)",
  color: "var(--jeu-nuit-profonde)",
};

const SURCOUCHE: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center",
  alignContent: "center",
  textAlign: "center",
  color: "#e2e8f0",
  padding: "var(--jeu-espace-m)",
  fontSize: "0.85rem",
};

const BOUTON: React.CSSProperties = {
  padding: "var(--jeu-espace-s) var(--jeu-espace-l)",
  border: 0,
  borderRadius: "var(--jeu-rayon)",
  background:
    "linear-gradient(180deg, var(--jeu-tuile-haut), var(--jeu-tuile-bas))",
  color: "var(--jeu-texte-vif)",
  font: "inherit",
  fontWeight: 800,
  cursor: "pointer",
};

const ONGLET: React.CSSProperties = {
  padding: "var(--jeu-espace-s) var(--jeu-espace-m)",
  border: "2px solid var(--jeu-tuile-bord)",
  borderRadius: "var(--jeu-rayon)",
  background: "#fff",
  color: "var(--jeu-nuit-profonde)",
  font: "inherit",
  fontWeight: 700,
  cursor: "pointer",
};

const ONGLET_ACTIF: React.CSSProperties = {
  ...ONGLET,
  border: 0,
  background:
    "linear-gradient(180deg, var(--jeu-tuile-haut), var(--jeu-tuile-bas))",
  color: "var(--jeu-texte-vif)",
};

const CHAMP: React.CSSProperties = {
  flex: 1,
  padding: "var(--jeu-espace-s) var(--jeu-espace-m)",
  background: "#fff",
  border: "2px solid var(--jeu-tuile-bord)",
  borderRadius: "var(--jeu-rayon)",
  color: "var(--jeu-nuit-profonde)",
  font: "inherit",
};

const LIEN: React.CSSProperties = {
  color: "var(--jeu-nuit-profonde)",
  fontWeight: 700,
  fontSize: "0.85rem",
};
