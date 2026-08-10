/**
 * Client du service de décodage d'assets `nie-model-serve` (HTTP, port 8790).
 *
 * Conventions d'URL EXACTES (cf. CLAUDE.md / mémoire model-serve) :
 *  - /raw/<chemin-vfs-avec-extension>        octets bruts
 *  - /tex/<chemin-SANS-.g4tx>.png            la route REMPLACE .png par .g4tx
 *  - /cfg/<chemin-vfs>.json                  cfg.bin/objbin/fxbin/mevbin -> JSON
 *  - /audio/<chemin-vfs>                     HCA/ADX/ACB -> WAV
 *  - /model-full/<code>.glb                  modèle perso assemblé+texturé
 */

import { config } from "./config.ts";
import { assertSafeVfsPath, encodeVfsPath, ToolError } from "./security.ts";
import type { DecodeKind } from "./vfs.ts";

const DEFAULT_MAX_BYTES = 256 * 1024;

export interface AssetResult {
  path: string;
  decode: DecodeKind;
  url: string;
  http_status: number;
  content_type: string | null;
  content_length: number | null;
  /** Contenu inline si présent. */
  text?: string;
  base64?: string;
  /** Vrai si le contenu a été tronqué ou omis (trop gros) : ouvrir l'URL. */
  truncated: boolean;
  note?: string;
}

/** Construit l'URL model-serve pour un chemin VFS et un mode de décodage. */
export function buildAssetUrl(decode: DecodeKind, path: string): string {
  const base = config.modelServeUrl;
  switch (decode) {
    case "raw":
      return `${base}/raw/${encodeVfsPath(path)}`;
    case "cfg":
      return `${base}/cfg/${encodeVfsPath(path)}.json`;
    case "audio":
      return `${base}/audio/${encodeVfsPath(path)}`;
    case "tex": {
      // La route ajoute .g4tx : on passe le chemin SANS .g4tx, suffixé .png.
      let p = path;
      if (p.toLowerCase().endsWith(".g4tx")) p = p.slice(0, -5);
      else if (p.toLowerCase().endsWith(".png")) p = p.slice(0, -4);
      return `${base}/tex/${encodeVfsPath(p)}.png`;
    }
    case "model": {
      // `path` est interprété comme un code perso (ex. c01000010), .glb optionnel.
      let code = path;
      if (code.toLowerCase().endsWith(".glb")) code = code.slice(0, -4);
      const slash = code.lastIndexOf("/");
      if (slash >= 0) code = code.slice(slash + 1);
      return `${base}/model-full/${encodeURIComponent(code)}.glb`;
    }
  }
}

/** Lit un flux jusqu'à `cap` octets max ; signale s'il a été tronqué. */
async function readCapped(res: Response, cap: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      if (total + value.length > cap) {
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      total += value.length;
    }
  }
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.length;
  }
  return { bytes, truncated };
}

const TEXTUAL_CT = /^(text\/|application\/(json|xml|javascript|x-ndjson))/;

/**
 * Récupère un asset via model-serve. Pour `cfg` renvoie le JSON texte.
 * Pour le binaire : résumé (taille, content-type) + URL exacte, et le contenu
 * inline seulement s'il tient sous `maxBytes` (sinon URL seule).
 */
export async function getAsset(args: {
  path: string;
  decode?: DecodeKind | undefined;
  maxBytes?: number | undefined;
}): Promise<AssetResult> {
  const decode = args.decode ?? "raw";
  const maxBytes = clampBytes(args.maxBytes);
  const rawPath = args.path.trim();

  // `model` accepte un code nu (pas un chemin VFS) ; les autres exigent un chemin VFS.
  if (decode !== "model") assertSafeVfsPath(rawPath);
  else if (rawPath.includes("..") || rawPath.includes("\0")) {
    throw new ToolError("code modèle invalide");
  }

  const url = buildAssetUrl(decode, rawPath);
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new ToolError(`model-serve injoignable (${config.modelServeUrl}) : ${(e as Error).message}`);
  }

  const ct = res.headers.get("content-type");
  const clHeader = res.headers.get("content-length");
  const contentLength = clHeader !== null ? Number.parseInt(clHeader, 10) : null;

  const base: AssetResult = {
    path: rawPath,
    decode,
    url,
    http_status: res.status,
    content_type: ct,
    content_length: Number.isFinite(contentLength) ? contentLength : null,
    truncated: false,
  };

  if (!res.ok) {
    const { bytes } = await readCapped(res, 4096);
    return {
      ...base,
      truncated: false,
      note: `model-serve a renvoyé ${res.status} : ${new TextDecoder().decode(bytes).trim().slice(0, 300)}`,
    };
  }

  // cfg : on veut toujours le JSON texte (borné à maxBytes).
  if (decode === "cfg") {
    const { bytes, truncated } = await readCapped(res, maxBytes);
    return {
      ...base,
      text: new TextDecoder().decode(bytes),
      truncated,
      ...(truncated ? { note: `JSON tronqué à ${maxBytes} octets — ouvrir l'URL pour le contenu complet` } : {}),
    };
  }

  // Binaire : si la taille est connue et dépasse maxBytes, on n'aspire rien.
  if (base.content_length !== null && base.content_length > maxBytes) {
    await res.body?.cancel();
    return {
      ...base,
      truncated: true,
      note: `contenu ${base.content_length} octets > maxBytes ${maxBytes} — ouvrir l'URL model-serve`,
    };
  }

  // Taille inconnue ou <= maxBytes : on lit en borné.
  const { bytes, truncated } = await readCapped(res, maxBytes);
  if (truncated) {
    return {
      ...base,
      truncated: true,
      note: `contenu > maxBytes ${maxBytes} (taille non annoncée) — ouvrir l'URL model-serve`,
    };
  }
  if (ct && TEXTUAL_CT.test(ct)) {
    return { ...base, text: new TextDecoder().decode(bytes), truncated: false };
  }
  return { ...base, base64: Buffer.from(bytes).toString("base64"), truncated: false };
}

function clampBytes(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v) || v <= 0) return DEFAULT_MAX_BYTES;
  return Math.min(Math.floor(v), 8 * 1024 * 1024);
}

/** Ping `/health`. */
export async function modelServeHealth(): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const res = await fetch(`${config.modelServeUrl}/health`);
    const body = (await res.text()).trim();
    return { ok: res.ok && body.toLowerCase().startsWith("ok"), status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: (e as Error).message };
  }
}
