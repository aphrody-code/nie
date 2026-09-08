/**
 * cdn-variants — service de variantes d'images resize+webp avec cache disque.
 *
 * PROBLÈME résolu : la galerie d'azalee servait des PNG pleine résolution (jusqu'à
 * ~12 Mo) pour des vignettes ~300px (≈570 Mo par page de 48). Ce service décline
 * chaque asset `/dx11/...` (ou `/g4tx/...`) en variantes WebP redimensionnées,
 * mises en cache sur disque, et les ressert en quelques Ko.
 *
 * Contrat :
 *   GET /dx11/<path>?w=<width>&format=webp          → WebP resize (fit inside, pas d'agrandissement)
 *   GET /g4tx/<path>?w=<width>&format=webp          → idem (chemin g4tx live)
 *   GET …&crop=bandes                               → retire d'abord les bandes noires
 *                                                     horizontales (letterbox du jeu)
 *
 * Source de l'asset (dans l'ordre) :
 *   1. fichier du dump disque `DX11_DUMP_ROOT/<path>` (rapide) — s'il existe ET non vide
 *   2. décodeur live iecode-cdn (`LIVE_ORIGIN`, :8788) — décode G4TX→PNG à la volée
 *
 * sharp resize (fit: "inside", withoutEnlargement) + webp q≈78 → écrit en cache
 * disque (`CACHE_ROOT/<sha1>.webp`) et ressert (immutable + ETag, 304 si If-None-Match).
 *
 * Largeurs whitelistées (anti-abus) : 200 / 400 / 800 / 1600. Toute autre largeur =
 * snap à la plus proche autorisée. nginx ne route ici que les requêtes AVEC `?w=` ;
 * SANS query, le serving direct nginx (dump / @cpk_live) reste inchangé.
 *
 * Prod-safe : service ISOLÉ (n'altère ni rg-cdn :8804 ni iecode-cdn :8788). Si une
 * source échoue, on renvoie 404/502 sans jamais corrompre le cache.
 */
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join as pathJoin } from "node:path";

// sharp n'est installé que sous apps/azalee (catalog). On le résout d'abord via
// l'algo standard, sinon via le store hoisté `.bun` du monorepo (chemin stable).
type SharpModule = typeof import("sharp");
async function loadSharp(): Promise<SharpModule> {
  try {
    return (await import("sharp")).default as unknown as SharpModule;
  } catch {
    // Fallback : résolution explicite depuis le store Bun hoisté de la racine.
    const glob = new Bun.Glob("sharp@*/node_modules/sharp/lib/index.js");
    const storeRoot = pathJoin(REPO_ROOT, "node_modules", ".bun");
    for await (const rel of glob.scan({ cwd: storeRoot, onlyFiles: true })) {
      const mod = await import(pathJoin(storeRoot, rel));
      return (mod.default ?? mod) as SharpModule;
    }
    throw new Error("sharp introuvable (ni standard ni store .bun)");
  }
}

const PORT = Number(process.env.VARIANTS_PORT ?? "8805");
const HOST = process.env.VARIANTS_HOST ?? "127.0.0.1";
// Racine du dépôt : deux niveaux au-dessus de `apps/cdn-variants`, jamais un chemin de
// machine en dur — le service a suivi la fusion et `/home/ubuntu/rg` désignait l'autre dépôt.
const REPO_ROOT =
  process.env.VARIANTS_REPO_ROOT ?? pathJoin(import.meta.dir, "..", "..");
// Racine du dump dx11 (mêmes alias que nginx /dx11/).
const DX11_DUMP_ROOT =
  process.env.VARIANTS_DX11_ROOT ??
  "/home/ubuntu/.local/share/Steam/iecode/inazuma/data/dx11";
// Décodeur live (iecode-cdn) — fallback quand le fichier dump est absent ou vide.
const LIVE_ORIGIN = process.env.VARIANTS_LIVE_ORIGIN ?? "http://127.0.0.1:8788";
// 2e décodeur live (niers / nie-model-serve, route `/tex/<rel>.png`) — couvre des
// formats g4tx que iecode-cdn rate (ex. textures `_animal`). Essayé si 8788 échoue.
const NIERS_ORIGIN = process.env.VARIANTS_NIERS_ORIGIN ?? "http://127.0.0.1:8790";
// Cache disque des variantes WebP.
const CACHE_ROOT = process.env.VARIANTS_CACHE_ROOT ?? "/var/cache/cdn-variants";

// Largeurs autorisées (anti-abus : pas de génération arbitraire à la demande).
const ALLOWED_WIDTHS = [200, 400, 800, 1600] as const;
const WEBP_QUALITY = Number(process.env.VARIANTS_WEBP_QUALITY ?? "78");
// Garde-fou : ne pas décoder/redimensionner des sources démesurées (RAM).
const MAX_SOURCE_BYTES = Number(process.env.VARIANTS_MAX_SOURCE_BYTES ?? String(64 * 1024 * 1024));
// Doit rester SOUS le `proxy_read_timeout` nginx de la location variants (30s) : sinon
// nginx renvoie 504 avant que l'abort ne libère le worker (cas d'un g4tx qui hang le
// décodeur live). À 25s, on abort proprement → 502 « source unavailable » rapide.
const LIVE_TIMEOUT_MS = Number(process.env.VARIANTS_LIVE_TIMEOUT_MS ?? "25000");

const sharp = await loadSharp();
await mkdir(CACHE_ROOT, { recursive: true });

/** Snap une largeur demandée à la plus proche largeur whitelistée. */
function snapWidth(raw: number): number {
  let best = ALLOWED_WIDTHS[0];
  let bestDelta = Math.abs(raw - best);
  for (const w of ALLOWED_WIDTHS) {
    const d = Math.abs(raw - w);
    if (d < bestDelta) {
      best = w;
      bestDelta = d;
    }
  }
  return best;
}

/**
 * Seuil au-delà duquel un pixel n'est plus « noir ».
 *
 * Mesuré, pas supposé, sur une illustration de la galerie (3840×2160,
 * `img_story_ev01_main_0010`) : le corps des bandes est à 0, mais la toute
 * PREMIÈRE et la toute DERNIÈRE ligne de la texture décodée valent 15 sur
 * toute leur largeur — un liseré de bord, pas un contenu. Un seuil à 12
 * s'arrêtait donc sur cette ligne-là et mesurait des bandes de zéro pixel sur
 * des images qui en ont deux cent quatre-vingts.
 *
 * À 24, le liseré (15) passe, la première ligne d'image (93 sur cette
 * illustration, 240 sur la ligne suivante) ne passe pas. La marge est large des
 * deux côtés.
 */
const SEUIL_NOIR = Number(process.env.VARIANTS_SEUIL_NOIR ?? "24");

/**
 * Colonnes claires tolérées dans une ligne considérée comme noire.
 *
 * Ceinture en plus du seuil : un pixel mort, un artefact de compression ou un
 * angle de texture ne doivent pas décider à eux seuls qu'une bande n'en est pas
 * une. Deux colonnes sur soixante-quatre, c'est trois pour cent — bien en
 * dessous de ce que porte n'importe quelle ligne d'illustration, même nocturne.
 */
const TOLERANCE_COLONNES = Number(process.env.VARIANTS_TOLERANCE_COLONNES ?? "2");

/**
 * Part maximale de l'image qu'un recadrage peut retirer, par côté.
 *
 * Garde-fou : une illustration réellement noire en haut (une nuit, une entrée de
 * tunnel) ne doit pas se faire amputer de sa moitié. Au-delà, on considère que
 * ce n'est pas une bande technique mais le sujet, et on ne coupe rien.
 */
const MAX_BANDE = Number(process.env.VARIANTS_MAX_BANDE ?? "0.35");

/**
 * Mesure les bandes noires HORIZONTALES d'une image.
 *
 * ── POURQUOI PAS `sharp.trim()` ────────────────────────────────────────────
 * `trim()` rogne les quatre côtés d'un coup, à partir de la couleur du pixel
 * d'angle. Sur ces illustrations, il mangerait aussi les bords GAUCHE et DROIT
 * dès que la scène s'assombrit sur les côtés — c'est-à-dire précisément sur les
 * plus belles. Les bandes du jeu sont un letterbox : elles n'existent qu'en haut
 * et en bas, et c'est tout ce qu'on retire.
 *
 * On lit l'image en niveaux de gris à taille réduite (largeur 64) : il ne s'agit
 * pas de trouver le pixel exact mais la ligne, et 64 colonnes suffisent à savoir
 * si une ligne est noire de bout en bout. Le coût reste négligeable devant le
 * décodage, et le résultat part au cache.
 */
async function mesurerBandes(
  source: Uint8Array,
): Promise<{ haut: number; bas: number; hauteur: number } | null> {
  const image = sharp(source, { failOn: "none" });
  const meta = await image.metadata();
  const hauteur = meta.height ?? 0;
  if (hauteur < 8) {
    return null;
  }

  const largeurAnalyse = 64;
  const { data, info } = await image
    .clone()
    .resize({ width: largeurAnalyse, fit: "fill", height: hauteur })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const ligneEstNoire = (y: number): boolean => {
    const depart = y * info.width * info.channels;
    let claires = 0;
    for (let x = 0; x < info.width; x += 1) {
      if (data[depart + x * info.channels] > SEUIL_NOIR) {
        claires += 1;
        if (claires > TOLERANCE_COLONNES) {
          return false;
        }
      }
    }
    return true;
  };

  let haut = 0;
  while (haut < info.height && ligneEstNoire(haut)) {
    haut += 1;
  }
  // Image entièrement noire : il n'y a rien à recadrer, et tout à perdre.
  if (haut >= info.height) {
    return null;
  }
  let bas = 0;
  while (bas < info.height && ligneEstNoire(info.height - 1 - bas)) {
    bas += 1;
  }

  const plafond = Math.floor(info.height * MAX_BANDE);
  return {
    bas: Math.min(bas, plafond),
    hauteur: info.height,
    haut: Math.min(haut, plafond),
  };
}

/** Clé de cache déterministe (path logique + largeur + format + qualité). */
function cacheKey(logical: string, width: number, crop: boolean): string {
  // Le recadrage fait PARTIE de la clé : sans lui, la première requête servirait
  // sa version à toutes les suivantes — image rognée à qui n'en voulait pas, ou
  // l'inverse, selon qui arrive en premier.
  const h = createHash("sha1")
    .update(`${logical}|w=${width}|webp|q=${WEBP_QUALITY}${crop ? "|crop=bandes" : ""}`)
    .digest("hex");
  return `${h}.webp`;
}

/** ETag faible mais stable basé sur la clé de cache (assets immuables par buildid). */
function etagFor(key: string): string {
  return `"${key.slice(0, 24)}"`;
}

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "cross-origin-resource-policy": "cross-origin",
  "x-content-type-options": "nosniff",
};

function webpHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "image/webp",
    "cache-control": "public, max-age=31536000, immutable",
    ...CORS_HEADERS,
    ...extra,
  };
}

/**
 * Récupère les octets source d'un asset `<surface>/<path>` (surface = dx11 ou g4tx).
 * 1) fichier dump disque non vide ; 2) décodeur live niers (`nie-model-serve`).
 * `logical` est sans le slash initial (ex. `dx11/menu/220_img/gallery_img2/x.png`).
 *
 * Le dump n'est plus qu'un cache : depuis l'archivage de `data/dx11/menu` sur le
 * stockage secondaire (12 Go, 69 624 PNG pré-décodés), la quasi-totalité des
 * requêtes passe par le décodeur. Sa sortie a été vérifiée pixel pour pixel
 * identique au dump (RMSE nul), à latence égale et pour un PNG plus compact.
 */
async function fetchSource(logical: string): Promise<Uint8Array | null> {
  // dx11/<rest> → fichier dump DX11_DUMP_ROOT/<rest>
  if (logical.startsWith("dx11/")) {
    const rest = logical.slice("dx11/".length);
    const diskPath = pathJoin(DX11_DUMP_ROOT, rest);
    // Anti-traversal : le chemin résolu doit rester sous la racine du dump.
    if (diskPath.startsWith(`${DX11_DUMP_ROOT}/`)) {
      const file = Bun.file(diskPath);
      if (await file.exists()) {
        const stat = await file.stat();
        if (stat.size > 0 && stat.size <= MAX_SOURCE_BYTES) {
          return new Uint8Array(await file.arrayBuffer());
        }
        // Fichier présent mais vide (0 octet — gap du dump) → on tente le live.
      }
    }
  }

  // Décodeur live : niers (`nie-model-serve /tex/<rel>`) décode le G4TX depuis les
  // CPK. Il est PRIMAIRE — l'ancien décodeur iecode-cdn (:8788, pont Bun→.NET) a été
  // retiré du dépôt le 11/8/2026 et le port ne répond plus ; l'appeler d'abord
  // ajoutait un aller-retour perdu sur chaque miss, devenu le cas courant.
  // Surface `dx11/…` → `/tex/dx11/…` ; surface `g4tx/<rest>` → `/tex/<rest>`
  // (même réécriture que nginx).
  const cible = logical.startsWith("g4tx/") ? logical.slice("g4tx/".length) : logical;
  const depuisNiers = await fetchLive(`${NIERS_ORIGIN}/tex/${cible}`);
  if (depuisNiers) return depuisNiers;

  // Repli historique, conservé au cas où un décodeur serait remis sur LIVE_ORIGIN.
  return await fetchLive(`${LIVE_ORIGIN}/${logical}`);
}

/** Récupère les octets d'une URL de décodeur live (timeout + bornes de taille). `null` si échec. */
async function fetchLive(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(LIVE_TIMEOUT_MS) });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_SOURCE_BYTES) return null;
    return buf;
  } catch {
    return null;
  }
}

/** Sert un fichier de cache existant (avec gestion 304). */
async function serveCached(
  cachePath: string,
  key: string,
  ifNoneMatch: string | null,
): Promise<Response> {
  const etag = etagFor(key);
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers: webpHeaders({ etag }) });
  }
  const file = Bun.file(cachePath);
  const stat = await file.stat();
  return new Response(file, {
    headers: webpHeaders({
      etag,
      "content-length": String(stat.size),
      "x-cache": "HIT",
    }),
  });
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  // Décodage + encodage sharp peut prendre plusieurs secondes via le live (G4TX).
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        cacheRoot: CACHE_ROOT,
        crop: { max: MAX_BANDE, seuilNoir: SEUIL_NOIR, tolerance: TOLERANCE_COLONNES },
        widths: ALLOWED_WIDTHS,
        quality: WEBP_QUALITY,
      });
    }

    const logical = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    // Seules les surfaces dx11/ et g4tx/ sont des sources valides.
    if (!logical.startsWith("dx11/") && !logical.startsWith("g4tx/")) {
      return new Response("not found", { status: 404, headers: CORS_HEADERS });
    }

    const wParam = url.searchParams.get("w");
    // Sans `?w=`, ce service n'a rien à faire (nginx ne devrait pas router ici) :
    // on redirige vers le serving direct du dump.
    if (!wParam) {
      return new Response("missing ?w=", { status: 400, headers: CORS_HEADERS });
    }
    const rawWidth = Number(wParam);
    if (!Number.isFinite(rawWidth) || rawWidth <= 0) {
      return new Response("bad width", { status: 400, headers: CORS_HEADERS });
    }
    const width = snapWidth(rawWidth);
    // `crop=bandes` : les illustrations du jeu sont livrées en letterbox — deux
    // bandes noires horizontales qui font perdre un cinquième de la hauteur dans
    // une vignette, et qui sautent aux yeux dès qu'on les pose en bannière.
    const crop = url.searchParams.get("crop") === "bandes";

    const key = cacheKey(logical, width, crop);
    const cachePath = pathJoin(CACHE_ROOT, key);
    const ifNoneMatch = req.headers.get("if-none-match");

    // 1) Cache HIT
    if (await Bun.file(cachePath).exists()) {
      try {
        return await serveCached(cachePath, key, ifNoneMatch);
      } catch {
        // Cache corrompu → on régénère ci-dessous.
      }
    }

    // 2) Cache MISS — récupérer la source puis resize+webp
    const src = await fetchSource(logical);
    if (!src) {
      return new Response("source unavailable", { status: 502, headers: CORS_HEADERS });
    }

    let out: Uint8Array;
    try {
      let pipeline = sharp(src, { failOn: "none" });

      if (crop) {
        // Mesure AVANT le redimensionnement : sur une vignette de 200 px, une
        // bande de trois pixels a déjà été mélangée à l'image par le
        // rééchantillonnage, et elle ne se détecte plus proprement.
        const bandes = await mesurerBandes(src);
        if (bandes && bandes.haut + bandes.bas > 0) {
          const meta = await pipeline.metadata();
          const hauteurUtile = bandes.hauteur - bandes.haut - bandes.bas;
          if (meta.width && hauteurUtile > 0) {
            pipeline = pipeline.extract({
              height: hauteurUtile,
              left: 0,
              top: bandes.haut,
              width: meta.width,
            });
          }
        }
      }

      const buf = await pipeline
        .resize({ width, fit: "inside", withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY, effort: 4 })
        .toBuffer();
      out = new Uint8Array(buf);
    } catch (err) {
      return new Response(`transcode error: ${(err as Error).message}`, {
        status: 500,
        headers: CORS_HEADERS,
      });
    }

    // Écriture atomique : tmp puis rename (évite un cache partiel servi en concurrence).
    try {
      await mkdir(dirname(cachePath), { recursive: true });
      const tmp = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
      await Bun.write(tmp, out);
      await Bun.$`mv -f ${tmp} ${cachePath}`.quiet();
    } catch {
      // Échec d'écriture cache → on sert quand même la variante calculée (best-effort).
    }

    const etag = etagFor(key);
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new Response(null, { status: 304, headers: webpHeaders({ etag }) });
    }
    return new Response(out, {
      headers: webpHeaders({
        etag,
        "content-length": String(out.byteLength),
        "x-cache": "MISS",
      }),
    });
  },
});

console.warn(`cdn-variants listening on http://${server.hostname}:${server.port}`);

function shutdown(signal: string): void {
  console.warn(`cdn-variants received ${signal}, shutting down`);
  void server.stop(false);
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
