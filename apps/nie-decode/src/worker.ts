/**
 * nie-decode/worker — Worker Bun pour décodage parallèle d'assets IEVR.
 *
 * Protocole (messages) :
 *   reçoit  DecodeTask  via postMessage depuis le thread principal
 *   envoie  DecodeResult via self.postMessage — les octets décodés sont
 *   transférés (zero-copy) dans outData ; le thread principal les écrit.
 *
 * Chaque worker est un thread JS isolé :
 *   - dlopen de libnie_ffi.so indépendant (pas de partage de handle)
 *   - _OUT_SLOT de bun:ffi mono-thread → aucun conflit entre workers
 *   - un seul decode en vol par worker (séquentialité garantie par driveWorker)
 */

import { decode, decodeToPng } from "nie";
import { zstdCompress } from "@niers/util";

// Typage minimal de DedicatedWorkerGlobalScope pour ce fichier.
// "lib" du tsconfig n'inclut pas WebWorker ; on déclare ce qu'on utilise.
declare const self: {
  onmessage: ((evt: MessageEvent<DecodeTask>) => void) | null;
  postMessage(data: WorkerReply, transfer: ArrayBuffer[]): void;
  postMessage(data: WorkerReply): void;
};

// ─── types partagés (importés par main.ts via import type) ──────────────────

export interface DecodeTask {
  type: "decode";
  id: number;
  srcPath: string;
  /** Chemin de sortie de base, sans suffixe .zst (ajouté ici si compress). */
  destPath: string;
  isImage: boolean;
  compress: boolean;
}

export interface DecodeResult {
  type: "result";
  id: number;
  srcPath: string;
  /** Chemin réel écrit par le thread principal après réception. */
  destPath: string;
  sha256: string;
  bytesIn: number;
  bytesOut: number;
  ok: boolean;
  /** Avertissement non-fatal (BC7/NXTCH, format non supporté…). */
  warn?: string;
  /** Erreur fatale (exception JS, read impossible…). */
  err?: string;
}

/**
 * Message de retour vers le thread principal.
 * outData est un ArrayBuffer transféré (zero-copy) quand ok === true.
 */
export interface WorkerReply {
  result: DecodeResult;
  outData: ArrayBuffer | null;
}

// ─── handler ────────────────────────────────────────────────────────────────

self.onmessage = async (evt: MessageEvent<DecodeTask>) => {
  const reply = await processTask(evt.data);
  if (reply.outData !== null) {
    // Transférer l'ArrayBuffer (zero-copy) vers le thread principal.
    self.postMessage(reply, [reply.outData]);
  } else {
    self.postMessage(reply);
  }
};

// ─── traitement d'une tâche ──────────────────────────────────────────────────

async function processTask(task: DecodeTask): Promise<WorkerReply> {
  const { id, srcPath, destPath, isImage, compress } = task;

  const fail = (fields: Partial<DecodeResult>): WorkerReply => ({
    result: {
      type: "result", id, srcPath, destPath, sha256: "",
      bytesIn: 0, bytesOut: 0, ok: false,
      ...fields,
    },
    outData: null,
  });

  try {
    const ab = await Bun.file(srcPath).arrayBuffer();
    const raw = new Uint8Array(ab);
    const bytesIn = raw.byteLength;

    let outBytes: Uint8Array;
    let actualDest = destPath;

    if (isImage) {
      const png = decodeToPng(raw);
      if (png === null) {
        return fail({ bytesIn, warn: "BC7/NXTCH non supporté — PNG ignoré" });
      }
      outBytes = png;
    } else {
      const obj = decode(raw);
      if (obj === null) {
        return fail({ bytesIn, warn: "format non supporté — JSON ignoré" });
      }
      const jsonBytes = new TextEncoder().encode(JSON.stringify(obj, null, 2));
      if (compress) {
        outBytes = zstdCompress(jsonBytes);
        actualDest = destPath + ".zst";
      } else {
        outBytes = jsonBytes;
      }
    }

    // Hash des octets finaux (après compression éventuelle).
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(outBytes);
    const sha256 = hasher.digest("hex");
    const bytesOut = outBytes.byteLength;

    // Transférer l'ArrayBuffer sous-jacent pour éviter une copie.
    // Après transfer, outBytes.buffer est détaché — ne pas l'utiliser.
    const outData = outBytes.buffer as ArrayBuffer;

    return {
      result: {
        type: "result", id, srcPath, destPath: actualDest,
        sha256, bytesIn, bytesOut, ok: true,
      },
      outData,
    };
  } catch (e) {
    return fail({ err: String(e) });
  }
}
