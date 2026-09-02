/**
 * Tests d'intégration du serveur CDN (`server.ts`) — pilotés sur loopback,
 * 100 % offline (aucun réseau hors 127.0.0.1, aucune dépendance S3/DB/Redis).
 *
 * `server.ts` démarre `Bun.serve` *au moment de l'import* (effet de bord) et
 * n'exporte pas le `server`. On le lance donc en sous-process via `Bun.spawn`
 * (modèle CLAUDE.md de l'équipe Bun) avec :
 *   - `CDN_PORT=0`        → port éphémère, jamais hardcodé ;
 *   - `CDN_API_KEY`       → requis sinon `process.exit(1)` au boot ;
 *   - `CDN_REPO_ROOT`     → temp dir : on contrôle le root du scope rpb-dashboard ;
 *   - `CDN_STORAGE`       → temp dir (writes /upload) ;
 *   - `CDN_VARIANTS_ROOT` → temp dir (variants AVIF/WebP off-tree).
 * On parse la ligne `cdn listening on http://host:port` pour récupérer le port
 * réel, puis on `fetch` les vrais endpoints.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API_KEY = "test-cdn-key-" + Math.random().toString(36).slice(2);

let proc: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
let base = "";
let repoRoot = "";
let storageDir = "";
let variantsRoot = "";
// Root absolu du scope rpb-dashboard, dérivé de CDN_REPO_ROOT par server.ts :
//   pathResolve(REPO_ROOT, "apps/cdn/assets/rpb-dashboard")
let dashboardRoot = "";

const SERVER_TS = join(import.meta.dir, "server.ts");

/** Lit le port depuis le flux stdout/stderr du serveur (ligne `listening on`). */
async function waitForPort(stream: ReadableStream<Uint8Array>): Promise<number> {
  const decoder = new TextDecoder();
  let acc = "";
  for await (const chunk of stream) {
    acc += decoder.decode(chunk, { stream: true });
    const m = /listening on https?:\/\/[^:]+:(\d+)/.exec(acc);
    if (m) return Number(m[1]);
  }
  throw new Error(`server n'a jamais annoncé son port. Sortie:\n${acc}`);
}

beforeAll(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), "cdn-repo-"));
  storageDir = await mkdtemp(join(tmpdir(), "cdn-storage-"));
  variantsRoot = await mkdtemp(join(tmpdir(), "cdn-variants-"));

  // Arborescence du scope rpb-dashboard contrôlée par le test.
  dashboardRoot = join(repoRoot, "apps/cdn/assets/rpb-dashboard");
  await mkdir(dashboardRoot, { recursive: true });
  // Asset raster connu (PNG minimal 1×1) pour negotiation + ETag + 304.
  const onePxPng = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4" +
      "890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
    "hex",
  );
  await writeFile(join(dashboardRoot, "logo.png"), onePxPng);
  // Un fichier "secret" hors du scope, pour vérifier que le traversal ne sort pas.
  await writeFile(join(repoRoot, "secret.txt"), "TOP SECRET — ne doit jamais fuiter");

  proc = Bun.spawn({
    cmd: [process.execPath, SERVER_TS],
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      // Cloud Run injecte $PORT ; server.ts le lit en priorité. On le force à 0
      // (port éphémère) pour ne pas dépendre d'un $PORT ambiant hérité du shell.
      PORT: "0",
      CDN_PORT: "0",
      CDN_HOST: "127.0.0.1",
      CDN_API_KEY: API_KEY,
      CDN_REPO_ROOT: repoRoot,
      CDN_STORAGE: storageDir,
      CDN_VARIANTS_ROOT: variantsRoot,
      // Pas de manifest : on testera le 503 "not generated".
      CDN_ASSETS_MANIFEST: join(repoRoot, "no-such-manifest.json"),
    },
  });

  const port = await Promise.race([waitForPort(proc.stdout), waitForPort(proc.stderr)]);
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  proc?.kill();
  await proc?.exited;
  await Promise.all([
    rm(repoRoot, { recursive: true, force: true }),
    rm(storageDir, { recursive: true, force: true }),
    rm(variantsRoot, { recursive: true, force: true }),
  ]);
});

describe("/health", () => {
  test("200 + JSON { ok:true }", async () => {
    const res = await fetch(`${base}/health`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.storage).toBe(storageDir);
  });
});

describe("routing inconnu", () => {
  test("route inconnue → 404 (fallback fetch)", async () => {
    const res = await fetch(`${base}/nope/does-not-exist`);
    const text = await res.text();
    expect(text).toBe("Not Found");
    expect(res.status).toBe(404);
  });
});

describe("auth x-api-key sur écritures", () => {
  test("POST /upload sans clé → 401", async () => {
    const res = await fetch(`${base}/upload`, {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: new Uint8Array([1, 2, 3]),
    });
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  test("POST /upload mauvaise clé → 401", async () => {
    const res = await fetch(`${base}/upload`, {
      method: "POST",
      headers: { "content-type": "image/png", "x-api-key": "wrong" },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(res.status).toBe(401);
  });

  test("POST /upload bonne clé mais content-type non supporté → 415", async () => {
    const res = await fetch(`${base}/upload`, {
      method: "POST",
      headers: { "content-type": "application/pdf", "x-api-key": API_KEY },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(res.status).toBe(415);
  });

  test("POST /upload bonne clé + body vide → 400", async () => {
    const res = await fetch(`${base}/upload`, {
      method: "POST",
      headers: { "content-type": "image/png", "x-api-key": API_KEY },
      body: new Uint8Array([]),
    });
    expect(res.status).toBe(400);
  });

  test("POST /upload OK → 201/200 avec id + url, et fichier écrit", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const res = await fetch(`${base}/upload`, {
      method: "POST",
      headers: {
        "content-type": "image/png",
        "x-api-key": API_KEY,
        // Host non autorisé → fallback public base.
        host: "localhost",
      },
      body: png,
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.id).toMatch(/^[a-f0-9]{16}\.png$/);
    // Host non whitelisté → URL = FALLBACK_PUBLIC_BASE (cdn.rosegriffon.fr par défaut).
    expect(body.url).toContain(body.id);
    // Le fichier a réellement été écrit dans CDN_STORAGE.
    expect(await Bun.file(join(storageDir, body.id)).exists()).toBe(true);
  });

  test("publicBaseFor: x-forwarded-host whitelisté → URL canonique du domaine", async () => {
    const res = await fetch(`${base}/upload`, {
      method: "POST",
      headers: {
        "content-type": "image/png",
        "x-api-key": API_KEY,
        "x-forwarded-host": "cdn.rpbey.fr",
      },
      body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.url).toBe(`https://cdn.rpbey.fr/${body.id}`);
  });

  test("DELETE /images/:id mauvais id → 400", async () => {
    const res = await fetch(`${base}/images/not-a-valid-id`, {
      method: "DELETE",
      headers: { "x-api-key": API_KEY },
    });
    expect(res.status).toBe(400);
  });

  test("DELETE /images/:id sans clé → 401", async () => {
    const res = await fetch(`${base}/images/aaaaaaaaaaaaaaaa.png`, {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });

  test("POST /api/assets/manifest/refresh sans clé → 401", async () => {
    const res = await fetch(`${base}/api/assets/manifest/refresh`, { method: "POST" });
    expect(res.status).toBe(401);
  });
});

describe("/api/assets/<scope>/<path> — résolution + anti-traversal", () => {
  test("scope inconnu → 404 JSON", async () => {
    const res = await fetch(`${base}/api/assets/unknown-scope/x.png`);
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error).toContain("unknown scope");
  });

  test("path trop court (segments < 4) → 404", async () => {
    const res = await fetch(`${base}/api/assets/rpb-dashboard`);
    expect(res.status).toBe(404);
  });

  test("asset inexistant dans scope valide → 404", async () => {
    const res = await fetch(`${base}/api/assets/rpb-dashboard/missing.png`);
    expect(res.status).toBe(404);
  });

  test("path traversal ../../secret.txt → bloqué (403 forbidden) ou 404, jamais le secret", async () => {
    // Encodé pour que le path arrive littéralement côté serveur (split manuel).
    const res = await fetch(`${base}/api/assets/rpb-dashboard/..%2f..%2f..%2fsecret.txt`);
    expect([403, 404]).toContain(res.status);
    const text = await res.text();
    expect(text).not.toContain("TOP SECRET");
  });

  test("path traversal littéral ../ → ne sort jamais du root", async () => {
    const res = await fetch(`${base}/api/assets/rpb-dashboard/../../../secret.txt`, {
      // Empêche fetch de normaliser le path côté client.
      redirect: "manual",
    });
    const text = await res.text();
    expect(text).not.toContain("TOP SECRET");
    expect([403, 404]).toContain(res.status);
  });
});


describe("manifest absent", () => {
  test("GET /api/assets/manifest sans fichier → 503", async () => {
    const res = await fetch(`${base}/api/assets/manifest`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("Manifest");
  });
});

describe("CORS — active cross origin partout", () => {
  test("OPTIONS préflight (route) → 204 + Allow-Origin *", async () => {
    const res = await fetch(`${base}/upload`, {
      method: "OPTIONS",
      headers: { origin: "https://anything.example", "access-control-request-method": "POST" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  test("OPTIONS préflight (fallback /api/assets/*) → 204 + Allow-Origin *", async () => {
    const res = await fetch(`${base}/api/assets/rpb-dashboard/logo.png`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("réponse d'erreur JSON porte aussi le CORS", async () => {
    const res = await fetch(`${base}/api/assets/unknown-scope/x.png`);
    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
