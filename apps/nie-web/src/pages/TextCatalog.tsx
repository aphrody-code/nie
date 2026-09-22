import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  GameCountBadge,
  GameCursor,
  GameHeaderBar,
  GamePanel,
  GameSearchBar,
  GLYPHES,
} from "@nie/inacord-ui";
import {
  browserLocationSnapshot,
  subscribeBrowserLocation,
  writeBrowserHistory,
} from "@nie/inacord-ui/lib/browser-navigation";
import { useSettings } from "@nie/inacord-ui/lib/settings";
import { fetchJson } from "@nie/asset-source";

type TextFamily = {
  family: string;
  languages: string[];
  files: number;
  lines: number;
};
type TextCatalog = {
  languages: { language: string; lines: number }[];
  families: TextFamily[];
  files: number;
  lines: number;
};
type TextLine = { hash: number; hash_hex: string; text: string; file: string };
type TextPage = {
  files: string[];
  q: string | null;
  total_unfiltered: number;
  results: {
    elements: TextLine[];
    page: number;
    per_page: number;
    pages: number;
    total: number;
  };
};

const DEFAULT_TEXT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;

export interface TextCatalogState {
  family: string;
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

/** Read family and server pagination from the shareable page URL. */
export function textCatalogStateFromUrl(search: string): TextCatalogState {
  const params = new URLSearchParams(search);
  return {
    family: params.get("famille")?.trim() ?? "",
    page: boundedInteger(params.get("page"), 1),
    perPage: boundedInteger(
      params.get("per_page"),
      DEFAULT_TEXT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    ),
    q: params.get("q")?.trim() ?? "",
  };
}

/** Serialize only filters owned by the text catalogue. */
export function textCatalogHrefForState(
  location: string,
  state: TextCatalogState,
): string {
  const current = new URL(location, "http://localhost");
  const target = new URL(current.pathname, current.origin);
  if (state.family) target.searchParams.set("famille", state.family.trim());
  if (state.page > 1) target.searchParams.set("page", String(state.page));
  if (state.perPage !== DEFAULT_TEXT_PAGE_SIZE) {
    target.searchParams.set("per_page", String(state.perPage));
  }
  if (state.q) target.searchParams.set("q", state.q.trim());
  return `${target.pathname}${target.search}`;
}

function writeTextCatalogState(
  state: TextCatalogState,
  mode: "push" | "replace" = "push",
): void {
  const href = textCatalogHrefForState(window.location.href, state);
  if (`${window.location.pathname}${window.location.search}` !== href) {
    writeBrowserHistory(href, window.history.state, mode);
  }
}

/** Native text-CFG browser: it reads the measured server catalogue and never mirrors strings in JS. */
export function TextCatalog() {
  const { gameLocale } = useSettings();
  const locale = gameLocale;
  const location = useSyncExternalStore(
    subscribeBrowserLocation,
    browserLocationSnapshot,
    browserLocationSnapshot,
  );
  const filters = useMemo(
    () => textCatalogStateFromUrl(new URL(location, "http://localhost").search),
    [location],
  );
  const [catalog, setCatalog] = useState<TextCatalog | null>(null);
  const [query, setQuery] = useState(filters.q);
  const [page, setPage] = useState<TextPage | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    fetchJson<TextCatalog>("/api/v1/text", { signal: controller.signal, timeoutMs: 15_000, retries: 2 })
      .then((value) => {
        if (controller.signal.aborted) return;
        setCatalog(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [locale]);

  useEffect(() => setQuery(filters.q), [filters.q]);

  const available = useMemo(
    () =>
      catalog?.families.filter((item) => item.languages.includes(locale)) ?? [],
    [catalog, locale],
  );
  const family = available.some((item) => item.family === filters.family)
    ? filters.family
    : (available[0]?.family ?? "");

  useEffect(() => {
    if (!catalog || !family || family === filters.family) return;
    writeTextCatalogState({ ...filters, family, page: 1 }, "replace");
  }, [catalog, family, filters]);

  useEffect(() => {
    if (!family) return;
    const controller = new AbortController();
    setPage(null);
    setError(false);
    const params = new URLSearchParams({
      page: String(filters.page),
      per_page: String(filters.perPage),
    });
    if (filters.q) params.set("q", filters.q);
    fetchJson<TextPage>(
      `/api/v1/text/${encodeURIComponent(locale)}/${encodeURIComponent(family)}?${params}`,
      { signal: controller.signal, timeoutMs: 15_000, retries: 2 },
    )
      .then((value) => {
        if (!controller.signal.aborted) setPage(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [family, filters.page, filters.perPage, filters.q, locale]);

  const current = useMemo(
    () => available.find((item) => item.family === family) ?? null,
    [available, family],
  );
  const exportHref = family
    ? (() => {
        const params = new URLSearchParams({
          page: String(filters.page),
          per_page: String(filters.perPage),
          format: "txt",
        });
        if (filters.q) params.set("q", filters.q);
        return `/api/v1/text/${encodeURIComponent(locale)}/${encodeURIComponent(family)}?${params}`;
      })()
    : null;
  return (
    <section aria-label="Textes du jeu" className="space-y-4">
      {/* The game header bar, its icon and its live count: the same shape as `data/menu/options.png`. */}
      <GameHeaderBar icon={GLYPHES.livre} title="Textes du jeu">
        {catalog ? (
          <GameCountBadge
            count={catalog.lines}
            icon={GLYPHES.livre}
            unit="ligne"
          />
        ) : null}
        <span>
          {catalog ? `${catalog.files.toLocaleString(locale)} fichiers · ` : ""}
          Langue : {locale.toUpperCase()}
        </span>
      </GameHeaderBar>
      {error && (
        <p role="alert">
          Les textes du jeu ne sont pas disponibles pour le moment.
        </p>
      )}
      <GamePanel
        title="Familles"
        role="region"
        watermark={GLYPHES.livre}
        footer={
          current ? (
            <GameCountBadge
              count={current.lines}
              icon={GLYPHES.livre}
              unit="ligne"
            />
          ) : null
        }
      >
        <div
          className="flex flex-wrap gap-2"
          role="tablist"
          aria-label="Familles de texte"
        >
          {available.map((item) => (
            <button
              type="button"
              key={item.family}
              role="tab"
              aria-selected={family === item.family}
              className="game-button-secondary inline-flex items-center gap-1"
              onClick={() => {
                setQuery("");
                writeTextCatalogState({
                  ...filters,
                  family: item.family,
                  q: "",
                  page: 1,
                });
              }}
            >
              {/* The cursor only marks the family that is actually selected. */}
              {family === item.family ? <GameCursor /> : null}
              {item.family} ({item.lines.toLocaleString(locale)})
            </button>
          ))}
        </div>
      </GamePanel>
      {/* `x` focuses the field, exactly as the bank screen of the game does. */}
      <GameSearchBar
        value={query}
        onChange={setQuery}
        onSubmit={(value) =>
          writeTextCatalogState({ ...filters, family, q: value, page: 1 })
        }
        hotkey="x"
        placeholder="Chercher le texte natif…"
        label="Chercher dans cette famille"
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm">
          Lignes par page
          <input
            aria-label="Lignes par page"
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
              writeTextCatalogState({ ...filters, family, perPage, page: 1 });
            }}
          />
        </label>
        {exportHref ? (
          <a className="game-button-secondary" href={exportHref} download>
            Exporter cette page (.txt)
          </a>
        ) : null}
      </div>
      {page && (
        <>
          <p>
            {page.results.total.toLocaleString(locale)} ligne(s)
            {page.q ? ` pour « ${page.q} »` : ""} · {page.files.length}{" "}
            fichier(s) VFS
          </p>
          <ul className="space-y-2">
            {page.results.elements.map((line, index) => (
              <li key={`${line.file}:${line.hash}:${index}`}>
                <p>{line.text}</p>
                <code>
                  {line.hash_hex} · {line.file}
                </code>
              </li>
            ))}
          </ul>
          {page.results.pages > 1 ? (
            <nav
              aria-label="Pagination des textes"
              className="flex items-center gap-3"
            >
              <button
                type="button"
                className="game-button-secondary"
                disabled={page.results.page <= 1}
                onClick={() =>
                  writeTextCatalogState({
                    ...filters,
                    family,
                    page: Math.max(1, filters.page - 1),
                  })
                }
              >
                Précédent
              </button>
              <span aria-live="polite">
                Page {page.results.page} sur {page.results.pages}
              </span>
              <button
                type="button"
                className="game-button-secondary"
                disabled={page.results.page >= page.results.pages}
                onClick={() =>
                  writeTextCatalogState({
                    ...filters,
                    family,
                    page: filters.page + 1,
                  })
                }
              >
                Suivant
              </button>
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}
