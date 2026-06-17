/**
 * @niers/util — utilitaires partagés basés sur les APIs natives de Bun.
 *
 * (a) stringWidth, measureGameText
 * (b) gzip / gunzip, zstdCompress / zstdDecompress
 * (c) tableFormat, inspect
 * (d) requireBunVersion, semverOrder
 * (e) escapeHTML, deepEquals, randomUUIDv7, peekPromise, which, nanoseconds
 * (f) readConfig (.toml / .yaml / .yml / .jsonl / .json5 / .json)
 */

import { vfsOpen, decode } from "nie";

// ─── (a) Largeur textuelle ────────────────────────────────────────────────────

/** Options pour {@link stringWidth}. */
export interface StringWidthOptions {
  /**
   * Compte les séquences ANSI dans la largeur visuelle.
   * @default false
   */
  countAnsiEscapeCodes?: boolean;
  /**
   * Traite les caractères ambigus East-Asian comme étroits (1 colonne).
   * @default true
   */
  ambiguousIsNarrow?: boolean;
}

/**
 * Retourne la largeur visuelle d'une chaîne en colonnes de terminal.
 *
 * Les séquences ANSI sont ignorées par défaut (`countAnsiEscapeCodes: false`).
 * Les caractères CJK larges comptent pour 2 colonnes.
 *
 * @example
 * stringWidth("hello")                      // 5
 * stringWidth("\x1b[31mhello\x1b[0m")       // 5  (ANSI ignorées)
 * stringWidth("日本語")                      // 6  (3 × CJK = 2 colonnes chacun)
 */
export function stringWidth(s: string, opts?: StringWidthOptions): number {
  return Bun.stringWidth(s, {
    countAnsiEscapeCodes: opts?.countAnsiEscapeCodes ?? false,
    ambiguousIsNarrow: opts?.ambiguousIsNarrow ?? true,
  });
}

/** Résultat de {@link measureGameText}. */
export interface GameTextMeasure {
  /** Largeur visuelle en colonnes de terminal (Bun.stringWidth). */
  terminalWidth: number;
  /**
   * Somme des avances horizontales en pixels selon la police du jeu.
   * Source : CHR.variables[7] dans data/common/font/font/font_def/font.cfg.bin.
   */
  pixelAdvance: number;
  /** Nombre de glyphes trouvés dans font.cfg.bin. */
  glyphsFound: number;
  /** Nombre de glyphes absents de font.cfg.bin (avance non comptée). */
  glyphsMissing: number;
}

/** @internal Entrée T2B générique. */
interface T2bEntry {
  name: string;
  variables: Array<{ Int?: number; Float?: number }>;
}

/** @internal Cache codepoint→advance ; null = non encore chargé. */
let _fontAdvanceMap: Map<number, number> | null = null;

/**
 * Charge (et met en cache) la map codepoint→avance depuis le VFS.
 *
 * Fonte principale du jeu :
 * VFS `data/common/font/font/font_def/font.cfg.bin` (format T2B).
 * Chaque entrée CHR expose :
 *   variables[2].Int = codepoint Unicode
 *   variables[7].Int = avance horizontale en pixels
 *
 * Requiert `NIE_GAME_DIR` (défaut : /home/aphrody/niers).
 *
 * @internal
 */
function loadFontAdvanceMap(): Map<number, number> {
  if (_fontAdvanceMap !== null) return _fontAdvanceMap;

  const gameDir = process.env["NIE_GAME_DIR"] ?? "/home/aphrody/niers";
  using vfs = vfsOpen(`${gameDir}/data`);
  if (vfs === null) {
    throw new Error(
      `measureGameText: VFS inaccessible depuis ${gameDir}/data — NIE_GAME_DIR mal configuré ?`,
    );
  }

  const bytes = vfs.read("data/common/font/font/font_def/font.cfg.bin");
  if (bytes === null) {
    throw new Error(
      "measureGameText: data/common/font/font/font_def/font.cfg.bin absent du VFS",
    );
  }

  const decoded = decode(bytes) as { format: string; entries: T2bEntry[] } | null;
  if (decoded === null) {
    throw new Error("measureGameText: décodage de font.cfg.bin échoué");
  }

  const map = new Map<number, number>();
  for (const entry of decoded.entries) {
    if (entry.name !== "CHR") continue;
    const codepoint = entry.variables[2]?.Int;
    const advance   = entry.variables[7]?.Int;
    if (codepoint !== undefined && advance !== undefined) {
      map.set(codepoint, advance);
    }
  }

  _fontAdvanceMap = map;
  return map;
}

/**
 * Mesure la largeur d'une chaîne via deux méthodes et les compare :
 *
 * 1. **Bun.stringWidth** — colonnes de terminal (1 par ASCII, 2 par CJK large).
 * 2. **Police du jeu** — somme des avances horizontales en pixels
 *    lues depuis `font.cfg.bin` (CHR.variables[7]).
 *
 * Pour une chaîne ASCII pure, `terminalWidth === glyphsFound`
 * et `pixelAdvance` reflète la largeur réelle à l'écran dans le jeu.
 *
 * Requiert `NIE_GAME_DIR` défini et le VFS monté (cpk_list.cfg.bin).
 *
 * @param s - Chaîne à mesurer
 */
export function measureGameText(s: string): GameTextMeasure {
  const map = loadFontAdvanceMap();
  let pixelAdvance = 0;
  let glyphsFound = 0;
  let glyphsMissing = 0;

  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    const adv = map.get(cp);
    if (adv !== undefined) {
      pixelAdvance += adv;
      glyphsFound++;
    } else {
      glyphsMissing++;
    }
  }

  return {
    terminalWidth: Bun.stringWidth(s),
    pixelAdvance,
    glyphsFound,
    glyphsMissing,
  };
}

// ─── (b) Compression ──────────────────────────────────────────────────────────

/** Options de compression gzip. */
export interface GzipOptions {
  /** Niveau 1–9 (1 = rapide, 9 = meilleure compression ; -1 = défaut zlib). */
  level?: -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

/** Options de compression zstd. */
export interface ZstdOptions {
  /** Niveau 1–22 (défaut : 3). */
  level?: number;
}

/**
 * Compresse des données en gzip (RFC 1952 / zlib DEFLATE).
 *
 * @param data - Données sources
 * @param opts - Options de compression
 * @returns Buffer compressé
 */
export function gzip(data: Uint8Array, opts?: GzipOptions): Uint8Array {
  return Bun.gzipSync(data as Uint8Array<ArrayBuffer>, opts);
}

/**
 * Décompresse un buffer gzip.
 *
 * @param data - Données compressées gzip
 * @returns Données originales
 */
export function gunzip(data: Uint8Array): Uint8Array {
  return Bun.gunzipSync(data as Uint8Array<ArrayBuffer>);
}

/**
 * Compresse des données en Zstandard (zstd).
 *
 * @param data - Données sources
 * @param opts - Options de compression
 * @returns Buffer compressé
 */
export function zstdCompress(data: Uint8Array, opts?: ZstdOptions): Uint8Array {
  return Bun.zstdCompressSync(data, opts);
}

/**
 * Décompresse un buffer Zstandard.
 *
 * @param data - Données compressées zstd
 * @returns Données originales
 */
export function zstdDecompress(data: Uint8Array): Uint8Array {
  return Bun.zstdDecompressSync(data);
}

// ─── (c) Formatage ────────────────────────────────────────────────────────────

/**
 * Formate un tableau d'objets en tableau ASCII via `Bun.inspect.table`.
 *
 * @param rows - Tableau d'objets homogènes (les clés deviennent les colonnes)
 * @returns Chaîne multi-lignes avec bordures Unicode box-drawing
 *
 * @example
 * tableFormat([{ name: "foo", size: 42 }])
 * // ┌───┬──────┬──────┐
 * // │   │ name │ size │
 * // ├───┼──────┼──────┤
 * // │ 0 │ foo  │ 42   │
 * // └───┴──────┴──────┘
 */
export function tableFormat(rows: Record<string, unknown>[]): string {
  return Bun.inspect.table(rows);
}

/**
 * Retourne une représentation lisible d'une valeur via `Bun.inspect`.
 *
 * @param value - Valeur à inspecter
 * @param depth - Profondeur de récursion (défaut : 2)
 */
export function inspect(value: unknown, depth = 2): string {
  return Bun.inspect(value, { depth, colors: false });
}

// ─── (d) Semver / version gate ────────────────────────────────────────────────

/**
 * Vérifie que la version courante de Bun satisfait la contrainte `range`.
 * Lance une `Error` si ce n'est pas le cas.
 *
 * @param range - Contrainte semver (ex. `">=1.3.0"`, `"^1.2"`)
 * @throws Error si Bun.version ne satisfait pas range
 *
 * @example
 * requireBunVersion(">=1.3");  // silencieux si Bun ≥ 1.3.0
 */
export function requireBunVersion(range: string): void {
  if (!Bun.semver.satisfies(Bun.version, range)) {
    throw new Error(
      `Bun ${Bun.version} ne satisfait pas la contrainte "${range}". ` +
        "Mettez à jour avec : bun upgrade",
    );
  }
}

/**
 * Compare deux versions semver.
 *
 * @returns `-1` si a < b, `0` si a === b, `1` si a > b
 * @throws Error si une version est invalide
 */
export function semverOrder(a: string, b: string): -1 | 0 | 1 {
  return Bun.semver.order(a, b);
}

// ─── (e) Utilitaires divers ───────────────────────────────────────────────────

/**
 * Échappe les caractères HTML spéciaux dans `s`.
 *
 * `< > & " '` → `&lt; &gt; &amp; &quot; &#x27;`
 *
 * @example
 * escapeHTML('<script>alert("xss")</script>')
 * // "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
 */
export function escapeHTML(s: string): string {
  return Bun.escapeHTML(s);
}

/**
 * Comparaison profonde par valeur (structural equality).
 *
 * @param a - Première valeur
 * @param b - Seconde valeur
 * @param strict - Active le mode strict (`===` sur les primitives). Défaut : false
 */
export function deepEquals(a: unknown, b: unknown, strict = false): boolean {
  return Bun.deepEquals(a, b, strict);
}

/**
 * Génère un UUID v7 (timestamp-based, monotonique, tri lexicographique).
 *
 * @returns Chaîne au format `xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx`
 */
export function randomUUIDv7(): string {
  return Bun.randomUUIDv7();
}

/**
 * Lit synchronement la valeur d'une Promise déjà résolue.
 *
 * Si la Promise est déjà résolue, retourne sa valeur sans `await`.
 * Sinon, retourne la Promise inchangée.
 *
 * Utile pour inspecter des Promises en phase de debug ou optimiser
 * des chemins déjà résolus (ex. cache de module déjà chargé).
 *
 * @example
 * const p = Promise.resolve(42);
 * peekPromise(p);  // 42  (pas de await)
 */
export function peekPromise<T>(p: Promise<T>): T | Promise<T> {
  return Bun.peek(p);
}

/**
 * Cherche un exécutable dans les répertoires du PATH.
 *
 * @param cmd - Nom de l'exécutable (ex. `"git"`, `"bun"`)
 * @returns Chemin absolu ou `null` si absent du PATH
 */
export function which(cmd: string): string | null {
  return Bun.which(cmd);
}

/**
 * Temps monotone en nanosecondes depuis le démarrage du processus.
 * Utile pour des mesures de performance haute résolution.
 *
 * @example
 * const t0 = nanoseconds();
 * doWork();
 * console.log(`durée : ${nanoseconds() - t0} ns`);
 */
export function nanoseconds(): number {
  return Bun.nanoseconds();
}

// ─── (f) readConfig ──────────────────────────────────────────────────────────

/**
 * Lit et parse un fichier de configuration selon son extension :
 *
 * | Extension       | Parser utilisé             |
 * |-----------------|---------------------------|
 * | `.toml`         | `Bun.TOML.parse`          |
 * | `.yaml` / `.yml`| `Bun.YAML.parse`          |
 * | `.jsonl`        | `Bun.JSONL.parse` → tableau|
 * | `.json5`        | `JSON.parse` (sous-ensemble JSON valide) |
 * | `.json`         | `JSON.parse`              |
 *
 * **Note json5** : Bun n'expose pas de `Bun.json5` comme API publique.
 * `JSON.parse` couvre le sous-ensemble JSON strict du format JSON5.
 * Pour les extensions JSON5 (commentaires, virgules finales), ajouter
 * un package `json5` npm.
 *
 * @param path - Chemin du fichier (absolu ou relatif au CWD)
 * @returns Valeur parsée (`object | array | string | number | boolean | null`)
 * @throws Error si l'extension n'est pas reconnue
 */
export async function readConfig(path: string): Promise<unknown> {
  const text = await Bun.file(path).text();
  const dot = path.lastIndexOf(".");
  const ext = dot === -1 ? "" : path.slice(dot);

  switch (ext) {
    case ".toml":
      return Bun.TOML.parse(text);
    case ".yaml":
    case ".yml":
      return Bun.YAML.parse(text);
    case ".jsonl":
      return Bun.JSONL.parse(text);
    case ".json5":
      // JSON.parse accepte le sous-ensemble JSON strict de JSON5.
      return JSON.parse(text) as unknown;
    case ".json":
      return JSON.parse(text) as unknown;
    default:
      throw new Error(
        `readConfig: extension "${ext}" non reconnue dans "${path}". ` +
          "Extensions supportées : .toml .yaml .yml .jsonl .json5 .json",
      );
  }
}
