/**
 * apps/menu — visualiseur riche du menu principal Inazuma, alimenté par le VFS RÉEL.
 *
 * Routes servies :
 *   /                        HTML avec data-w/data-h injectés via HTMLRewriter (dims réelles)
 *   /index.html              idem
 *   /assets/:name            PNG brut décodé du g4tx
 *   /thumb/:name?w=N         WebP thumbnail (Bun.Image resize, défaut w=256)
 *   /palette                 JSON {sprite→couleur hex} (Bun.color sur pixel 1×1)
 *
 * Mode fenêtre :
 *   --window                 ouvre Bun.WebView (backend Chrome, skipé si indisponible)
 *
 * Timing :
 *   Bun.nanoseconds() encadre chaque appel decodeToPng() et resize().
 *
 * Preuve FFI :
 *   crc32("mainmenu90_00") loggué au démarrage.
 */

import type { BunRequest } from "bun";
import { crc32, vfsOpen, decodeToPng, type VfsHandle } from "nie";
import { inflateSync } from "node:zlib";

// ─── sprites RÉELS du menu → chemins VFS internes ────────────────────────────

const SPRITES: Record<string, string> = {
  background:
    "data/dx11/menu/100_mainmenu/mainmenu90/mainmenu90_00/mainmenu90_00.g4tx",
  header_strip_fr:
    "data/dx11/menu/100_mainmenu/mainmenu90/mainmenu90_02/fr/mainmenu90_02.g4tx",
  icons_atlas_fr:
    "data/dx11/menu/100_mainmenu/mainmenu90/mainmenu90_01/fr/mainmenu90_01.g4tx",
};

const REPO_ROOT    = `${import.meta.dir}/../../..`;
const FALLBACK_DIR = `${REPO_ROOT}/web/assets/menu`;
const gameDataDir  = `${process.env["NIE_GAME_DIR"] ?? REPO_ROOT}/data`;

// ─── VFS ─────────────────────────────────────────────────────────────────────

let vfs: VfsHandle | null = null;
try {
  vfs = vfsOpen(gameDataDir);
  console.log(
    vfs
      ? `[vfs] monté depuis ${gameDataDir} — décodage g4tx→PNG à la volée`
      : `[vfs] indisponible (${gameDataDir}) — repli sur ${FALLBACK_DIR}`
  );
} catch (e) {
  console.log(`[vfs] erreur (${e}) — repli sur les PNG locaux`);
}

// ─── Cache PNG bruts ──────────────────────────────────────────────────────────

const pngCache = new Map<string, Uint8Array>();

/**
 * Décode un sprite en PNG depuis le VFS.
 * Timing Bun.nanoseconds() autour de decodeToPng().
 * Repli sur les PNG locaux si le VFS est absent.
 */
async function spritePng(name: string): Promise<Uint8Array | null> {
  const cached = pngCache.get(name);
  if (cached !== undefined) return cached;

  const vfsPath = SPRITES[name];

  if (vfs && vfsPath) {
    const g4tx = vfs.read(vfsPath);
    if (g4tx) {
      const t0  = Bun.nanoseconds();
      const png = decodeToPng(g4tx);
      const t1  = Bun.nanoseconds();
      console.log(
        `[g4tx] decode "${name}": ${((t1 - t0) / 1e6).toFixed(1)} ms`
      );
      if (png) {
        pngCache.set(name, png);
        return png;
      }
    }
  }

  // Repli : PNG pré-extrait local.
  const f = Bun.file(`${FALLBACK_DIR}/${name}.png`);
  if (await f.exists()) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    pngCache.set(name, bytes);
    return bytes;
  }
  return null;
}

// ─── Métadonnées sprites (dimensions + couleur représentative) ────────────────

interface SpriteMeta {
  width: number;
  height: number;
  /** Couleur représentative en hex, via Bun.color sur un pixel 1×1. */
  color: string;
}

const metaCache = new Map<string, SpriteMeta>();

/**
 * Parse le pixel RGB du PNG 1×1 produit par Bun.Image.resize(1,1).png().
 *
 * Structure PNG : signature 8 B → chunks (4 len + 4 type + data + 4 crc).
 * IDAT = zlib-deflate d'une scanline filtrée : [filter_byte, R, G, B[, A]].
 * Décompression via node:zlib inflateSync.
 *
 * Retourne [r, g, b] ou null si le parse échoue.
 */
function extractPng1x1Pixel(
  bytes: Uint8Array
): [number, number, number] | null {
  if (bytes.byteLength < 33) return null;

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset   = 8; // sauter la signature PNG
  let colorType = 0;
  let idatData: Uint8Array | null = null;

  while (offset + 12 <= bytes.byteLength) {
    const chunkLen  = dv.getUint32(offset, false);       // big-endian
    const chunkType = String.fromCharCode(
      ...bytes.subarray(offset + 4, offset + 8)
    );

    if (chunkType === "IHDR") {
      // data IHDR : width(4) height(4) bitDepth(1) colorType(1) …
      // offset + 8 = début data, +9 = colorType
      colorType = bytes[offset + 17] ?? 0;
    } else if (chunkType === "IDAT") {
      idatData = bytes.slice(offset + 8, offset + 8 + chunkLen);
    } else if (chunkType === "IEND") {
      break;
    }

    offset += 12 + chunkLen;
  }

  if (!idatData) return null;

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.from(idatData));
  } catch {
    return null;
  }

  // Scanline 1×1 après décompression :
  //   colorType 2 (RGB)  → [filter, R, G, B]
  //   colorType 6 (RGBA) → [filter, R, G, B, A]
  if ((colorType === 2 || colorType === 6) && raw.length >= 4) {
    return [raw[1] ?? 0, raw[2] ?? 0, raw[3] ?? 0];
  }
  // Fallback générique si le colorType est inattendu.
  if (raw.length >= 4) {
    return [raw[1] ?? 0, raw[2] ?? 0, raw[3] ?? 0];
  }
  return null;
}

/**
 * Retourne la couleur représentative d'un sprite en hex.
 *
 * Pipeline :
 *   1. Bun.Image(pngBytes).resize(1, 1).png().bytes()  → PNG 1×1
 *   2. extractPng1x1Pixel()                            → [r, g, b]
 *   3. Bun.color([r, g, b], "hex")                     → "#rrggbb"
 */
async function sampleColor(pngBytes: Uint8Array): Promise<string> {
  try {
    const tiny = await new Bun.Image(pngBytes).resize(1, 1).png().bytes();
    const px   = extractPng1x1Pixel(tiny);
    if (px) {
      const hex = Bun.color(px, "hex");
      if (hex) return hex;
    }
  } catch {
    /* Ignorer les erreurs de décodage — retourner la couleur par défaut. */
  }
  return "#000000";
}

/**
 * Retourne (avec cache) les métadonnées d'un sprite :
 * dimensions réelles (Bun.Image.metadata) + couleur representative (sampleColor).
 */
async function spriteMetadata(name: string): Promise<SpriteMeta | null> {
  const cached = metaCache.get(name);
  if (cached !== undefined) return cached;

  const png = await spritePng(name);
  if (!png) return null;

  const imgMeta = await new Bun.Image(png).metadata();
  const color   = await sampleColor(png);

  const result: SpriteMeta = {
    width:  imgMeta.width,
    height: imgMeta.height,
    color,
  };
  metaCache.set(name, result);
  return result;
}

// ─── preuve FFI au démarrage ──────────────────────────────────────────────────

const spriteHash = crc32("mainmenu90_00");
console.log(
  `[nie FFI] crc32("mainmenu90_00") = 0x${spriteHash
    .toString(16)
    .toUpperCase()
    .padStart(8, "0")} (${spriteHash})`
);

// ─── Handlers de routes ───────────────────────────────────────────────────────

/** GET /assets/:name — PNG brut décodé du g4tx. */
async function serveAsset(name: string): Promise<Response> {
  if (!(name in SPRITES)) return new Response("Not Found", { status: 404 });
  const png = await spritePng(name);
  if (!png) return new Response("Not Found", { status: 404 });
  return new Response(png, {
    headers: { "content-type": "image/png", "cache-control": "no-cache" },
  });
}

/**
 * GET /thumb/:name?w=N — WebP thumbnail redimensionné via Bun.Image.
 *
 * .resize(w) conserve le ratio d'aspect (height inféré).
 * .webp({ quality: 85 }) encode en WebP lossy.
 * Timing Bun.nanoseconds() autour du pipeline Bun.Image.
 */
async function serveThumb(name: string, w: number): Promise<Response> {
  if (!(name in SPRITES)) return new Response("Not Found", { status: 404 });
  const png = await spritePng(name);
  if (!png) return new Response("Not Found", { status: 404 });

  const t0   = Bun.nanoseconds();
  const webp = await new Bun.Image(png).resize(w).webp({ quality: 85 }).bytes();
  const t1   = Bun.nanoseconds();
  console.log(
    `[thumb] "${name}" w=${w}: ${((t1 - t0) / 1e6).toFixed(1)} ms, ${webp.byteLength} B`
  );

  return new Response(webp, {
    headers: {
      "content-type":  "image/webp",
      "cache-control": "public, max-age=3600",
    },
  });
}

/**
 * GET / et /index.html — HTML avec HTMLRewriter injectant data-w/data-h/data-color réels.
 *
 * Pour chaque <img src="/assets/<sprite>"> dans public/index.html,
 * HTMLRewriter ajoute :
 *   data-w     largeur réelle du sprite (px)
 *   data-h     hauteur réelle du sprite (px)
 *   data-color couleur représentative hex (Bun.color)
 *
 * Stratégie : pré-charger toute la métadonnées + le HTML en mémoire AVANT la
 * transformation, de sorte que l'element handler soit entièrement synchrone —
 * évite les problèmes de stall avec des async handlers dans un stream lazy.
 */
async function serveIndex(): Promise<Response> {
  // 1. Assurer que toutes les métadonnées sont en cache (async).
  await Promise.all(Object.keys(SPRITES).map((n) => spriteMetadata(n)));

  // 2. Lire le HTML en mémoire (Bun.file est lazy ; on force le chargement ici).
  const html = await Bun.file(`${import.meta.dir}/../public/index.html`).text();

  // 3. Transformer avec des handlers SYNCHRONES (lecture directe de metaCache).
  return new HTMLRewriter()
    .on("img[src]", {
      element(el) {
        const src  = el.getAttribute("src") ?? "";
        // Identifier le sprite par son nom dans le chemin src.
        const name = Object.keys(SPRITES).find((n) => src.includes(n));
        if (!name) return;
        const meta = metaCache.get(name);   // lecture synchrone du cache chaud
        if (!meta) return;
        el.setAttribute("data-w",     String(meta.width));
        el.setAttribute("data-h",     String(meta.height));
        el.setAttribute("data-color", meta.color);
      },
    })
    .transform(
      new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })
    );
}

/**
 * GET /palette — JSON {spriteName: "#rrggbb", …}.
 *
 * Couleur représentative : Bun.Image.resize(1,1) → inflateSync IDAT →
 * Bun.color([r,g,b], "hex").
 */
async function servePalette(): Promise<Response> {
  const entries = await Promise.all(
    Object.keys(SPRITES).map(async (name) => {
      const meta = await spriteMetadata(name);
      return [name, meta?.color ?? "#000000"] as const;
    })
  );
  return Response.json(Object.fromEntries(entries));
}

// ─── Bun.serve (routes object + fallback fetch) ───────────────────────────────

const PORT = 4173;

const server = Bun.serve({
  port: PORT,

  routes: {
    "/":           () => serveIndex(),
    "/index.html": () => serveIndex(),

    "/assets/:name": (req: BunRequest<"/assets/:name">) =>
      serveAsset(req.params.name),

    "/thumb/:name": (req: BunRequest<"/thumb/:name">) => {
      const wParam = new URL(req.url).searchParams.get("w");
      const w      = Math.max(1, Math.min(4096, Number(wParam) || 256));
      return serveThumb(req.params.name, w);
    },

    "/palette": () => servePalette(),
  },

  // Fallback pour les routes non déclarées.
  fetch(_req: Request): Response {
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`[menu] http://localhost:${server.port}`);

// ─── Mode --window : Bun.WebView (expérimental) ───────────────────────────────

if (process.argv.includes("--window")) {
  (async () => {
    try {
      // Sur Linux/WSL, webkit n'est disponible que sur macOS → forcer chrome.
      await using view = new Bun.WebView({
        url:     `http://localhost:${server.port}`,
        backend: "chrome",
      });
      console.log(`[WebView] fenêtre ouverte → ${view.url}`);
      // Le processus reste vivant tant que le serveur Bun.serve tourne.
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[WebView] non disponible : ${msg}`);
      console.warn("[WebView] démarrer sans --window pour le mode HTTP seul.");
    }
  })().catch(() => {/* déjà loggué */});
}
