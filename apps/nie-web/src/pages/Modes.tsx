/**
 * Les modes de jeu — les onglets du menu principal, et ce dont chacun est fait.
 *
 * ## Ce que cette page ajoute au wiki qu'elle remplace
 *
 * Azalée servait `/mode` et `/mode/<slug>` en lisant les JSON de `nie mode export` : elle
 * pouvait NOMMER les écrans d'un mode, pas les montrer. Ici, chaque écran est demandé à
 * `GET /api/v1/menu/render/<ecran>`, qui compose le calque, les objets de menu et les textures
 * du jeu et rend un PNG. La page n'est donc plus une liste de noms de fichiers.
 *
 * Mesuré le 2026-09-13 sur `victory-road` : **23 de ses 24 écrans reviennent en PNG**, et
 * `victory_road_final_tournament_menu` répond `504`. L'écran qui ne revient pas le dit à sa
 * place, au lieu de laisser un cadre vide — un rendu manquant est une information sur le
 * moteur, pas un défaut d'affichage à masquer.
 *
 * ## Le nom d'un mode vient du jeu, pas d'ici
 *
 * Chaque mode porte un `label_hash` : le CRC-32 sous lequel `menu_text.cfg.bin` écrit son nom.
 * La page résout ce hash dans la langue choisie, en UN aller-retour pour les douze
 * (`fetchGameText`, route GraphQL `texts`). Mesuré le 2026-09-13 : **9 des 12 modes** rendent
 * leur nom dans les quatre langues demandées — « Modo Competición », « Modo Crónica »,
 * « キズナステーション », « Estación Kizuna ». Les trois autres (`chara-edit`, `bb-stadium`,
 * `play-guide`) n'ont PAS de `label_hash` : le catalogue rend alors le nom qu'il porte, et la
 * page ne prétend pas qu'il vient du jeu.
 *
 * Le reste des libellés passe par [`GameText`], qui substitue la ligne du jeu quand le jeu écrit
 * exactement ce mot. Mesuré sur ce corpus : « Retour », « Informations », « Ouvrir »,
 * « Détails », « Tout », « Type » y sont ; « Écrans », « Calques », « Scripts » et
 * « Composants » n'y sont pas — `nie.exe` ne nomme pas ses propres fichiers dans son interface.
 * Ces mots-là restent écrits ici, et `scripts/validation/ui-text-map.py` les compte comme
 * manquants plutôt que de les faire passer pour du texte du jeu.
 *
 * ## Ce qui vient du serveur, et rien d'autre
 *
 * - `GET /api/v1/modes` : les modes catalogués, leur note et lesquels sont officiels.
 * - `GET /api/v1/modes/<slug>` : les écrans, les calques, les `objbin`, les `g4pkm`, les `g4tx`,
 *   les composants, les scripts, et les comptes qui vont avec — tous comptés sur le VFS.
 *
 * Les comptes affichés sont ceux de la réponse. La page n'en calcule aucun : un total recalculé
 * ici pourrait s'écarter de celui que le serveur publie, et c'est le serveur qui a lu les
 * fichiers.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  GameCountBadge,
  GameHeaderBar,
  GamePanel,
  GameSearchBar,
  GameText,
  GLYPHES,
  Link,
} from "@nie/inacord-ui";
import {
  browserLocationSnapshot,
  subscribeBrowserLocation,
  writeBrowserHistory,
} from "@nie/inacord-ui/lib/browser-navigation";
import {
  fetchGameText,
  refKey,
  type GameTextRef,
} from "@nie/inacord-ui/lib/game-text";
import { useSettings } from "@nie/inacord-ui/lib/settings";
import { MODES } from "../entries";
import { fetchJson, resilientFetch, HttpError } from "@nie/asset-source";

/** La famille de texte qui porte le nom des modes. */
const LABEL_FAMILY = "menu_text";

/** Un mode tel que la liste le publie. */
interface ModeSummary {
  slug: string;
  label: string;
  official: boolean;
  prefixes: string[];
  icon_region: string | null;
  label_hash: string | null;
  note: string | null;
}

interface ModePage {
  elements: ModeSummary[];
  page: number;
  per_page: number;
  total: number;
  pages: number;
}

interface ModeCatalog {
  q: string | null;
  total_modes?: number;
  official_modes?: number;
  provenance: string;
  results: ModePage;
}

const DEFAULT_MODE_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 200;

export interface ModeListState {
  page: number;
  perPage: number;
  q: string;
}

function boundedInteger(
  raw: string | null,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1
    ? Math.min(value, maximum)
    : fallback;
}

/** Read the server-backed mode-list filters from a shareable browser URL. */
export function modeListStateFromUrl(search: string): ModeListState {
  const params = new URLSearchParams(search);
  return {
    page: boundedInteger(params.get("page"), 1),
    perPage: boundedInteger(
      params.get("per_page"),
      DEFAULT_MODE_PAGE_SIZE,
      MAX_PAGE_SIZE,
    ),
    q: params.get("q")?.trim() ?? "",
  };
}

/** Serialize only the filters owned by the mode catalogue, in API order. */
export function modeListHrefForState(
  location: string,
  state: ModeListState,
): string {
  const current = new URL(location, "http://localhost");
  const target = new URL(current.pathname, current.origin);
  if (state.page > 1) target.searchParams.set("page", String(state.page));
  if (state.perPage !== DEFAULT_MODE_PAGE_SIZE) {
    target.searchParams.set("per_page", String(state.perPage));
  }
  if (state.q) target.searchParams.set("q", state.q.trim());
  return `${target.pathname}${target.search}`;
}

function writeModeListState(
  state: ModeListState,
  mode: "push" | "replace" = "push",
): void {
  const href = modeListHrefForState(window.location.href, state);
  if (`${window.location.pathname}${window.location.search}` !== href) {
    writeBrowserHistory(href, window.history.state, mode);
  }
}

/** Un écran d'un mode, avec le fichier de réglages dont il sort. */
interface ModeScreen {
  screen: string;
  cfg: string;
  bytes: number;
  layers: string[];
  focus: number;
}

/** La fiche d'un mode. Les clés des comptes sont celles du serveur. */
interface ModeSheet {
  slug: string;
  label: string;
  label_hash?: string | null;
  official: boolean;
  prefixes: string[];
  screens: ModeScreen[];
  components: { type_name: string; count: number }[];
  scripts: {
    path: string;
    bytes: number;
    instructions: number;
    functions: number;
  }[];
  counts: Record<string, number>;
}

/**
 * Les comptes, dans l'ordre où ils sont montrés, avec leur libellé.
 *
 * La liste est explicite pour que l'ordre ne dépende pas de celui d'un objet. Une clé que le
 * serveur ajouterait sans figurer ici s'affiche quand même, sous son nom brut : on ne perd pas
 * une mesure parce qu'on ne l'a pas prévue.
 */
const COUNT_LABELS: Record<string, string> = {
  screens: "écrans",
  layers: "calques",
  objbins: "objbin",
  g4pkm: "maillages g4pkm",
  g4tx: "textures g4tx",
  component_types: "types de composants",
  components: "composants",
  scripts: "scripts Lua",
  focus: "objets focalisables",
  text_slots: "emplacements de texte",
  unreadable: "fichiers illisibles",
};

/** Où en est le rendu d'un écran. */
type RenderState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "drawn"; url: string; drawn: number; skipped: number }
  | { kind: "blank"; drawn: number; skipped: number }
  | { kind: "failed"; status: string };

/** Le slug porté par la route, ou `null` sur la liste. */
function slugOf(route: string): string | null {
  const rest = route.startsWith(`${MODES}/`)
    ? route.slice(MODES.length + 1)
    : "";
  return rest.split("/")[0] || null;
}

/**
 * Le nom des modes, lu dans le texte du jeu, dans la langue choisie.
 *
 * Un hash qui rend plusieurs lignes différentes n'est PAS tranché — le catalogue garde son nom.
 * Choisir la première serait deviner, ce que `gameText` refuse déjà pour les libellés d'écran.
 */
function useModeLabels(
  hashes: readonly (string | null)[],
): ReadonlyMap<string, string> {
  const { gameLocale } = useSettings();
  const [labels, setLabels] = useState<ReadonlyMap<string, string>>(new Map());
  const key = hashes.filter(Boolean).join(",");

  useEffect(() => {
    const refs: GameTextRef[] = key
      .split(",")
      .filter(Boolean)
      .map((hash) => ({ family: LABEL_FAMILY, hash }));
    if (refs.length === 0) {
      setLabels(new Map());
      return;
    }
    let cancelled = false;
    fetchGameText(gameLocale, refs)
      .then((resolved) => {
        if (cancelled) return;
        const unique = new Map<string, string>();
        for (const ref of refs) {
          const texts = resolved.get(refKey(ref.family, ref.hash));
          if (texts?.length === 1 && texts[0])
            unique.set(ref.hash.toLowerCase(), texts[0]);
        }
        setLabels(unique);
      })
      .catch(() => {
        // La route texte n'a pas répondu : le catalogue garde son nom, comme le fait
        // `gameText` quand le réseau manque. Rien ne disparaît de l'écran.
        if (!cancelled) setLabels(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [gameLocale, key]);

  return labels;
}

/** Le nom d'un mode : celui du jeu s'il est lisible, sinon celui du catalogue. */
function modeLabel(
  labels: ReadonlyMap<string, string>,
  hash: string | null | undefined,
  fallback: string,
): string {
  return (hash && labels.get(hash.toLowerCase())) || fallback;
}

/** Le catalogue des modes, et la fiche de l'un d'eux. */
export function Modes({ route, prefix }: { route: string; prefix: string }) {
  const slug = useMemo(() => slugOf(route), [route]);
  const location = useSyncExternalStore(
    subscribeBrowserLocation,
    browserLocationSnapshot,
    browserLocationSnapshot,
  );
  const filters = useMemo(
    () => modeListStateFromUrl(new URL(location, "http://localhost").search),
    [location],
  );
  const listSearch = new URL(
    modeListHrefForState(location, filters),
    "http://localhost",
  ).search;
  return slug ? (
    <ModeSheetView prefix={prefix} slug={slug} listSearch={listSearch} />
  ) : (
    <ModeListView prefix={prefix} filters={filters} listSearch={listSearch} />
  );
}

function ModeListView({
  prefix,
  filters,
  listSearch,
}: {
  prefix: string;
  filters: ModeListState;
  listSearch: string;
}) {
  const [catalog, setCatalog] = useState<ModeCatalog | null>(null);
  const [query, setQuery] = useState(filters.q);
  const [error, setError] = useState(false);

  useEffect(() => setQuery(filters.q), [filters.q]);

  useEffect(() => {
    const controller = new AbortController();
    setCatalog(null);
    setError(false);
    const params = new URLSearchParams({
      page: String(filters.page),
      per_page: String(filters.perPage),
    });
    if (filters.q) params.set("q", filters.q);
    fetchJson<ModeCatalog>(`/api/v1/modes?${params}`, {
      signal: controller.signal,
      timeoutMs: 15_000,
      retries: 2,
    })
      .then((value) => {
        if (!controller.signal.aborted) setCatalog(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [filters.page, filters.perPage, filters.q]);

  const modes = catalog?.results.elements ?? null;
  const hashes = useMemo(
    () => (modes ?? []).map((mode) => mode.label_hash),
    [modes],
  );
  const labels = useModeLabels(hashes);
  const filteredTotal = catalog
    ? Number.isFinite(catalog.results.total)
      ? catalog.results.total
      : catalog.results.elements.length
    : 0;
  const hasGlobalCounts =
    catalog &&
    Number.isFinite(catalog.official_modes) &&
    Number.isFinite(catalog.total_modes);

  return (
    <section aria-label="Modes" className="space-y-4">
      <GameHeaderBar icon={GLYPHES.livre} title={<GameText>Modes</GameText>}>
        {catalog ? (
          <GameCountBadge
            count={filteredTotal}
            icon={GLYPHES.livre}
            unit="mode"
          />
        ) : null}
        {hasGlobalCounts ? (
          <span>
            {catalog.official_modes} <GameText>officiels</GameText> sur{" "}
            {catalog.total_modes}
          </span>
        ) : null}
      </GameHeaderBar>
      <GamePanel role="region" title="Filtres" watermark={GLYPHES.livre}>
        <div className="space-y-3">
          <GameSearchBar
            value={query}
            onChange={setQuery}
            onSubmit={(value) =>
              writeModeListState({ ...filters, q: value, page: 1 })
            }
            placeholder="Chercher un mode…"
            label="Chercher un mode"
            hotkey="x"
          />
          <label className="inline-flex items-center gap-2 text-sm">
            Modes par page
            <input
              aria-label="Modes par page"
              className="game-search-bar__input"
              type="number"
              min={1}
              max={MAX_PAGE_SIZE}
              value={filters.perPage}
              onChange={(event) => {
                const perPage = boundedInteger(
                  event.currentTarget.value,
                  filters.perPage,
                  MAX_PAGE_SIZE,
                );
                writeModeListState({ ...filters, perPage, page: 1 });
              }}
            />
          </label>
        </div>
      </GamePanel>
      {error ? (
        <p role="alert">
          Le catalogue des modes n'est pas disponible pour le moment.
        </p>
      ) : null}
      {!catalog && !error ? <p>Chargement…</p> : null}
      {modes ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {modes.map((mode) => (
            <li key={mode.slug}>
              <GamePanel
                role="region"
                title={modeLabel(labels, mode.label_hash, mode.label)}
                watermark={GLYPHES.livre}
              >
                <p className="text-sm">
                  {mode.official
                    ? "Le jeu énumère lui-même ce mode."
                    : "Mode catalogué à partir de ses écrans ; le jeu ne l'énumère pas."}
                </p>
                {mode.note ? (
                  <p className="text-sm text-ink-faint">{mode.note}</p>
                ) : null}
                <p className="text-xs text-ink-faint">
                  <GameText>Type</GameText> : {mode.prefixes.join(", ")}
                </p>
                <Link href={`${prefix}/${MODES}/${mode.slug}${listSearch}`}>
                  <GameText>Ouvrir</GameText>
                </Link>
              </GamePanel>
            </li>
          ))}
        </ul>
      ) : null}
      {catalog && catalog.results.pages > 1 ? (
        <nav
          aria-label="Pagination des modes"
          className="flex items-center gap-3"
        >
          <button
            type="button"
            className="game-button-secondary"
            disabled={catalog.results.page <= 1}
            onClick={() =>
              writeModeListState({
                ...filters,
                page: Math.max(1, filters.page - 1),
              })
            }
          >
            Précédent
          </button>
          <span aria-live="polite">
            Page {catalog.results.page} sur {catalog.results.pages}
          </span>
          <button
            type="button"
            className="game-button-secondary"
            disabled={catalog.results.page >= catalog.results.pages}
            onClick={() =>
              writeModeListState({ ...filters, page: filters.page + 1 })
            }
          >
            Suivant
          </button>
        </nav>
      ) : null}
    </section>
  );
}

function ModeSheetView({
  slug,
  prefix,
  listSearch,
}: {
  slug: string;
  prefix: string;
  listSearch: string;
}) {
  const [sheet, setSheet] = useState<ModeSheet | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setSheet(null);
    setError(null);
    fetchJson<ModeSheet>(`/api/v1/modes/${encodeURIComponent(slug)}`, {
      signal: controller.signal,
      timeoutMs: 15_000,
      retries: 2,
    })
      .then((value) => {
        if (!controller.signal.aborted) setSheet(value);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof HttpError && cause.status === 404
            ? "Ce mode n'est pas au catalogue."
            : cause instanceof Error
            ? cause.message
            : "La fiche de ce mode n'est pas disponible.",
        );
      });
    return () => controller.abort();
  }, [slug]);

  const hashes = useMemo(() => [sheet?.label_hash ?? null], [sheet]);
  const labels = useModeLabels(hashes);
  const title = sheet ? modeLabel(labels, sheet.label_hash, sheet.label) : slug;
  return (
    <section aria-label={title} className="space-y-4">
      <GameHeaderBar icon={GLYPHES.livre} title={title}>
        <Link href={`${prefix}/${MODES}${listSearch}`}>
          <GameText>Retour</GameText>
        </Link>
      </GameHeaderBar>
      {error ? <p role="alert">{error}</p> : null}
      {!sheet && !error ? <p>Chargement…</p> : null}
      {sheet ? (
        <>
          <GamePanel
            role="region"
            title={<GameText>Détails</GameText>}
            watermark={GLYPHES.cube}
          >
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Object.entries(sheet.counts).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-xs text-ink-faint">
                    {COUNT_LABELS[key] ?? key}
                  </dt>
                  <dd className="text-lg">{value.toLocaleString("fr")}</dd>
                </div>
              ))}
            </dl>
          </GamePanel>
          <GamePanel role="region" title="Écrans" watermark={GLYPHES.image}>
            <ul className="space-y-6">
              {sheet.screens.map((screen) => (
                <li key={screen.screen}>
                  <ScreenRender screen={screen} />
                </li>
              ))}
            </ul>
          </GamePanel>
          <GamePanel role="region" title="Composants" watermark={GLYPHES.arbre}>
            <ul className="columns-2 text-sm sm:columns-3">
              {sheet.components.map((component) => (
                <li key={component.type_name}>
                  {component.type_name} · {component.count}
                </li>
              ))}
            </ul>
          </GamePanel>
          <GamePanel role="region" title="Scripts" watermark={GLYPHES.livre}>
            <ul className="space-y-1 text-sm">
              {sheet.scripts.map((script) => (
                <li key={script.path}>
                  <code>{script.path}</code> — {script.functions} fonctions,{" "}
                  {script.instructions.toLocaleString("fr")} instructions
                </li>
              ))}
            </ul>
          </GamePanel>
        </>
      ) : null}
    </section>
  );
}

/**
 * Un écran et son rendu — ou ce que le moteur a fait à sa place.
 *
 * ## Pourquoi un `fetch` et pas une balise `<img>`
 *
 * `GET /api/v1/menu/render/<ecran>` répond **200 avec un PNG entièrement transparent** quand la
 * composition n'a rien dessiné. Mesuré le 2026-09-13 : `victory_load_mode_menu`,
 * `victory_road_mode_menu` et `vroad_tournament_notice` rendent 1280×720, **1 seule couleur,
 * 0 pixel opaque sur 921 600**, pour 5 209 octets — la signature exacte d'une toile vide — là où
 * `victory_road_top_menu` en fait 1 248 427 avec 29 959 couleurs. Une balise `<img>` les affiche
 * comme n'importe quel rendu, et la page affirme alors trois reproductions qui n'en sont pas.
 *
 * Le serveur, lui, le DIT déjà : `x-compose-drawn` vaut `0` contre `32`, et `x-compose-sprites`,
 * `-regions`, `-texts`, `-skipped` détaillent. Une balise `<img>` ne peut pas lire un en-tête ;
 * un `fetch` le peut. La page montre donc l'image quand le moteur a dessiné, et rapporte ses
 * comptes quand il n'a rien dessiné.
 *
 * ## La paresse est conservée
 *
 * Une fiche porte jusqu'à 24 écrans et le plus lourd mesuré fait 1,2 Mio, chacun composé à la
 * demande côté serveur. Les demander tous au montage ferait payer 24 compositions pour en
 * regarder une : un `IntersectionObserver` ne déclenche la requête qu'à l'approche de l'écran,
 * ce que `loading="lazy"` faisait pour la balise.
 */
function ScreenRender({ screen }: { screen: ModeScreen }) {
  const [state, setState] = useState<RenderState>({ kind: "idle" });
  const holder = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = holder.current;
    if (!element || state.kind !== "idle") return;
    // Sans `IntersectionObserver` (environnement de test, navigateur ancien), on demande tout
    // de suite : mieux vaut une fiche coûteuse qu'une fiche vide.
    if (typeof IntersectionObserver === "undefined") {
      setState({ kind: "loading" });
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setState({ kind: "loading" });
          observer.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [state.kind]);

  useEffect(() => {
    if (state.kind !== "loading") return;
    const controller = new AbortController();
    let url: string | null = null;
    resilientFetch(`/api/v1/menu/render/${encodeURIComponent(screen.screen)}`, {
      signal: controller.signal,
      timeoutMs: 20_000,
      retries: 1,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const drawn = Number(response.headers.get("x-compose-drawn") ?? "0");
        const skipped = Number(
          response.headers.get("x-compose-skipped") ?? "0",
        );
        if (drawn === 0) return { kind: "blank", drawn, skipped } as const;
        url = URL.createObjectURL(await response.blob());
        return { kind: "drawn", url, drawn, skipped } as const;
      })
      .then((next) => {
        if (!controller.signal.aborted) setState(next);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          kind: "failed",
          status: cause instanceof Error ? cause.message : "?",
        });
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [state.kind, screen.screen]);

  return (
    <figure className="space-y-2" ref={holder}>
      <figcaption className="text-sm">
        <code>{screen.screen}</code> — {screen.layers.length} calques,{" "}
        {screen.focus} focalisables, {screen.bytes.toLocaleString("fr")} o de
        réglages
      </figcaption>
      {state.kind === "drawn" ? (
        <>
          <img
            alt={screen.screen}
            className="max-w-full rounded"
            src={state.url}
          />
          <p className="text-xs text-ink-faint">
            {state.drawn} objets dessinés
            {state.skipped > 0
              ? `, ${state.skipped} sautés faute de pixels`
              : ""}
          </p>
        </>
      ) : null}
      {state.kind === "blank" ? (
        // Le moteur a composé et n'a rien dessiné. C'est une mesure sur lui, pas un trou
        // d'affichage : montrer la toile transparente ferait passer le vide pour l'écran.
        <p className="text-sm text-ink-faint">
          Le moteur n'a dessiné aucun objet de cet écran. Les fichiers qu'il
          liste, eux, sont là.
        </p>
      ) : null}
      {state.kind === "failed" ? (
        <p className="text-sm text-ink-faint">
          Le serveur n'a pas rendu cet écran ({state.status}). Les fichiers
          qu'il liste sont là.
        </p>
      ) : null}
      {state.kind === "idle" || state.kind === "loading" ? (
        <p className="text-sm text-ink-faint">Rendu…</p>
      ) : null}
    </figure>
  );
}
