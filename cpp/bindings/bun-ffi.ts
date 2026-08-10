/**
 * @file bun-ffi.ts
 * Bindings bun:ffi pour iecode cli — utilise dans inagle.
 *
 * Usage :
 * ```typescript
 * import { Iecode } from "./bun-ffi";
 * const ie = new Iecode();
 * const json = ie.parseCfgBin(await Bun.file("config.cfg.bin").arrayBuffer());
 * const textures = ie.parseG4tx(await Bun.file("texture.g4tx").arrayBuffer());
 * ```
 */

import { dlopen, FFIType, ptr, toArrayBuffer, CString, suffix } from "bun:ffi";
import { join } from "node:path";

// Resoudre le chemin de la shared lib
const LIB_PATH = process.env.IECODE_LIB_PATH
  ?? join(import.meta.dir, `../build/release/libiecode_parsers.${suffix}`);

const lib = dlopen(LIB_PATH, {
  // Lifecycle
  iecode_version:              { args: [],                                              returns: FFIType.cstring },
  iecode_free:                 { args: [FFIType.ptr],                                   returns: FFIType.void },

  // cfg.bin
  iecode_cfgbin_parse:         { args: [FFIType.ptr, FFIType.u32],                      returns: FFIType.ptr },
  iecode_result_json:          { args: [FFIType.ptr],                                   returns: FFIType.cstring },
  iecode_result_format:        { args: [FFIType.ptr],                                   returns: FFIType.cstring },
  iecode_result_free:          { args: [FFIType.ptr],                                   returns: FFIType.void },

  // G4TX
  iecode_g4tx_parse:           { args: [FFIType.ptr, FFIType.u32],                      returns: FFIType.ptr },
  iecode_g4tx_count:           { args: [FFIType.ptr],                                   returns: FFIType.i32 },
  iecode_g4tx_export_png:      { args: [FFIType.ptr, FFIType.i32, FFIType.cstring],     returns: FFIType.bool },
  iecode_g4tx_export_webp:     { args: [FFIType.ptr, FFIType.i32, FFIType.cstring, FFIType.i32], returns: FFIType.bool },
  iecode_g4tx_decode_rgba:     { args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  iecode_g4tx_info:            { args: [FFIType.ptr, FFIType.i32],                      returns: FFIType.cstring },
  iecode_g4tx_free:            { args: [FFIType.ptr],                                   returns: FFIType.void },

  // Compression
  iecode_lz10_decompress:      { args: [FFIType.ptr, FFIType.u32, FFIType.ptr],         returns: FFIType.u32 },
  iecode_crilayla_decompress:  { args: [FFIType.ptr, FFIType.u32, FFIType.ptr],         returns: FFIType.u32 },
  iecode_lz4_decompress:       { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.u32 },

  // Crypto
  iecode_crc32:                { args: [FFIType.ptr, FFIType.u32],                      returns: FFIType.u32 },
  iecode_cri_decrypt:          { args: [FFIType.ptr, FFIType.u32, FFIType.u32],         returns: FFIType.void },
  iecode_cri_derive_key:       { args: [FFIType.cstring],                               returns: FFIType.u32 },

  // CPK
  iecode_cpk_open:             { args: [FFIType.ptr, FFIType.u32],                      returns: FFIType.ptr },
  iecode_cpk_count:            { args: [FFIType.ptr],                                   returns: FFIType.i32 },
  iecode_cpk_filename:         { args: [FFIType.ptr, FFIType.i32],                      returns: FFIType.cstring },
  iecode_cpk_extract:          { args: [FFIType.ptr, FFIType.i32, FFIType.ptr],         returns: FFIType.ptr },
  iecode_cpk_free:             { args: [FFIType.ptr],                                   returns: FFIType.void },

  // Game Database
  iecode_gamedb_load:          { args: [FFIType.cstring, FFIType.i32],                  returns: FFIType.ptr },
  iecode_gamedb_chara_count:   { args: [FFIType.ptr],                                   returns: FFIType.i32 },
  iecode_gamedb_skill_count:   { args: [FFIType.ptr],                                   returns: FFIType.i32 },
  iecode_gamedb_team_count:    { args: [FFIType.ptr],                                   returns: FFIType.i32 },
  iecode_gamedb_json:          { args: [FFIType.ptr],                                   returns: FFIType.cstring },
  iecode_gamedb_chara_json:    { args: [FFIType.ptr, FFIType.i32],                      returns: FFIType.cstring },
  iecode_gamedb_skill_json:    { args: [FFIType.ptr, FFIType.i32],                      returns: FFIType.cstring },
  iecode_gamedb_find_chara:    { args: [FFIType.ptr, FFIType.cstring],                  returns: FFIType.i32 },
  iecode_gamedb_find_skill:    { args: [FFIType.ptr, FFIType.cstring],                  returns: FFIType.i32 },
  iecode_gamedb_free:          { args: [FFIType.ptr],                                   returns: FFIType.void },
});

const { symbols } = lib;

/** High-level wrapper pour iecode cli via bun:ffi. */
export class Iecode {
  /** Version de la lib native. */
  get version(): string {
    return new CString(symbols.iecode_version() as number).toString();
  }

  // ── cfg.bin ─────────────────────────────────────────────────────

  /** Parse un cfg.bin (T2B ou RDBN) et retourne le JSON. */
  parseCfgBin(data: ArrayBuffer): { format: string; json: any } {
    const buf = new Uint8Array(data);
    const handle = symbols.iecode_cfgbin_parse(ptr(buf), buf.length);
    if (!handle) throw new Error("iecode: echec du parsing cfg.bin");

    try {
      const format = new CString(symbols.iecode_result_format(handle) as number).toString();
      const jsonStr = new CString(symbols.iecode_result_json(handle) as number).toString();
      return { format, json: JSON.parse(jsonStr) };
    } finally {
      symbols.iecode_result_free(handle);
    }
  }

  // ── G4TX ────────────────────────────────────────────────────────

  /** Parse un fichier G4TX. Retourne un handle a liberer avec closeG4tx(). */
  parseG4tx(data: ArrayBuffer): G4txHandle {
    const buf = new Uint8Array(data);
    const handle = symbols.iecode_g4tx_parse(ptr(buf), buf.length);
    if (!handle) throw new Error("iecode: echec du parsing G4TX");
    return new G4txHandle(handle);
  }

  // ── Compression ────────────────────────────────────────────────

  /** Decompresse LZ10. */
  decompressLz10(data: ArrayBuffer): Uint8Array {
    const buf = new Uint8Array(data);
    const outPtr = new BigInt64Array(1);
    const size = symbols.iecode_lz10_decompress(ptr(buf), buf.length, ptr(outPtr));
    if (size === 0) throw new Error("iecode: echec decompression LZ10");
    const result = new Uint8Array(toArrayBuffer(Number(outPtr[0]), 0, size));
    symbols.iecode_free(Number(outPtr[0]));
    return result;
  }

  /** CRC32 d'un buffer. */
  crc32(data: ArrayBuffer): number {
    const buf = new Uint8Array(data);
    return symbols.iecode_crc32(ptr(buf), buf.length) as number;
  }

  /** Derive une cle CRI depuis un nom de fichier. */
  criDeriveKey(filename: string): number {
    return symbols.iecode_cri_derive_key(Buffer.from(filename + "\0")) as number;
  }

  // ── CPK ────────────────────────────────────────────────────────

  /** Ouvre un CPK. Retourne un handle a liberer avec closeCpk(). */
  openCpk(data: ArrayBuffer): CpkHandle {
    const buf = new Uint8Array(data);
    const handle = symbols.iecode_cpk_open(ptr(buf), buf.length);
    if (!handle) throw new Error("iecode: echec ouverture CPK");
    return new CpkHandle(handle, buf);
  }

  // ── Game Database ────────────────────────────────────────────────

  /**
   * Charge une base de donnees complete du jeu depuis les fichiers cfg.bin.
   * Pipeline C++ natif : read → decrypt → parse → cross-ref → index.
   *
   * @param dataRoot Chemin vers la racine des donnees (contient common/gamedata/)
   * @param loadText Charger les textes localises (9 langues, plus lent)
   */
  loadGameDatabase(dataRoot: string, loadText = true): GameDbHandle {
    const handle = symbols.iecode_gamedb_load(
      Buffer.from(dataRoot + "\0"), loadText ? 1 : 0);
    if (!handle) throw new Error("iecode: echec chargement GameDatabase");
    return new GameDbHandle(handle);
  }

  /** Ferme la lib native. */
  close(): void {
    lib.close();
  }
}

/** Handle G4TX avec methodes d'export. */
export class G4txHandle {
  constructor(private handle: number | bigint) {}

  get count(): number { return symbols.iecode_g4tx_count(this.handle) as number; }

  info(idx: number): any {
    const json = new CString(symbols.iecode_g4tx_info(this.handle, idx) as number).toString();
    return JSON.parse(json);
  }

  exportPng(idx: number, path: string): boolean {
    return symbols.iecode_g4tx_export_png(this.handle, idx, Buffer.from(path + "\0")) as boolean;
  }

  exportWebp(idx: number, path: string, quality = 90): boolean {
    return symbols.iecode_g4tx_export_webp(this.handle, idx, Buffer.from(path + "\0"), quality) as boolean;
  }

  close(): void { symbols.iecode_g4tx_free(this.handle); }
}

/** Handle CPK avec methodes d'extraction. */
export class CpkHandle {
  constructor(private handle: number | bigint, private _data: Uint8Array) {}

  get count(): number { return symbols.iecode_cpk_count(this.handle) as number; }

  filename(idx: number): string {
    return new CString(symbols.iecode_cpk_filename(this.handle, idx) as number).toString();
  }

  extract(idx: number): Uint8Array {
    const sizePtr = new Uint32Array(1);
    const dataPtr = symbols.iecode_cpk_extract(this.handle, idx, ptr(sizePtr));
    if (!dataPtr) throw new Error(`iecode: echec extraction CPK idx=${idx}`);
    const result = new Uint8Array(toArrayBuffer(dataPtr as number, 0, sizePtr[0]));
    symbols.iecode_free(dataPtr);
    return result;
  }

  list(): string[] {
    const n = this.count;
    const files: string[] = [];
    for (let i = 0; i < n; i++) files.push(this.filename(i));
    return files;
  }

  close(): void { symbols.iecode_cpk_free(this.handle); }
}

/** Handle GameDatabase — base de donnees complete du jeu. */
export class GameDbHandle {
  constructor(private handle: number | bigint) {}

  get charaCount(): number { return symbols.iecode_gamedb_chara_count(this.handle) as number; }
  get skillCount(): number { return symbols.iecode_gamedb_skill_count(this.handle) as number; }
  get teamCount(): number { return symbols.iecode_gamedb_team_count(this.handle) as number; }

  /** JSON complet de la base (characters + skills + teams + counts). */
  toJSON(): any {
    const str = new CString(symbols.iecode_gamedb_json(this.handle) as number).toString();
    return JSON.parse(str);
  }

  /** JSON d'un personnage par index. */
  getChara(idx: number): any {
    const str = new CString(symbols.iecode_gamedb_chara_json(this.handle, idx) as number).toString();
    return JSON.parse(str);
  }

  /** JSON d'un skill par index. */
  getSkill(idx: number): any {
    const str = new CString(symbols.iecode_gamedb_skill_json(this.handle, idx) as number).toString();
    return JSON.parse(str);
  }

  /** Cherche un personnage par ID. Retourne l'index ou -1. */
  findChara(charaParamId: string): number {
    return symbols.iecode_gamedb_find_chara(this.handle, Buffer.from(charaParamId + "\0")) as number;
  }

  /** Cherche un skill par ID. Retourne l'index ou -1. */
  findSkill(skillId: string): number {
    return symbols.iecode_gamedb_find_skill(this.handle, Buffer.from(skillId + "\0")) as number;
  }

  /** Itere tous les personnages. */
  *characters(): IterableIterator<any> {
    for (let i = 0; i < this.charaCount; i++) yield this.getChara(i);
  }

  /** Itere tous les skills. */
  *skills(): IterableIterator<any> {
    for (let i = 0; i < this.skillCount; i++) yield this.getSkill(i);
  }

  close(): void { symbols.iecode_gamedb_free(this.handle); }
}

// Export par defaut
export default new Iecode();
