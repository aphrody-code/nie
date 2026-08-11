/// @file iecode.ts
/// Backend **C++** de `nie` : bindings bun:ffi de `iecode_ffi` (target CMake `iecode_ffi`,
/// `OUTPUT_NAME "iecode"` → `iecode.dll` / `libiecode.so` / `libiecode.dylib`).
///
/// **Ne jamais importer ce module statiquement depuis `index.ts`** : le `dlopen` ci-dessous
/// s'exécute à l'import, et `bunfig.toml` précharge `nie-plugin` → tout `bun` du dépôt
/// mourrait quand la lib C++ n'est pas construite (cf. CLAUDE.md, « pièges d'environnement »).
/// Passer par `loadIecode()` (`./backend.ts`), qui l'importe dynamiquement et rend `null`
/// en cas d'absence.
///
/// Usage :
///   const cpp = await loadIecode()
///   if (cpp) console.log(cpp.version())
///
/// Ce fichier est l'**unique** binding C++ du dépôt : il a absorbé `bindings/bun-ffi.ts`
/// (34 symboles, sous-ensemble strict des 69 d'ici) lors de l'unification du 2026-08-11.

import { dlopen, FFIType, suffix, ptr, toArrayBuffer, CString, type Pointer } from "bun:ffi"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

// ── Chargement de la shared library ────────────────────────────────

// packages/nie/src → ../../.. = racine du dépôt.
const _root = resolve(import.meta.dir, "../../..")
// CMake dépose la lib dans build/<preset>/src/ffi/ ; le préfixe `lib` n'existe pas sous
// Windows, et le générateur Visual Studio ajoute un niveau de configuration.
const _presets = ["msvc", "debug", "release", "relwithdebinfo"]
const _dirs = _presets.flatMap((p) => [
  `${_root}/build/${p}/src/ffi`,
  `${_root}/build/${p}/src/ffi/Debug`,
  `${_root}/build/${p}/src/ffi/Release`,
])
const _names = process.platform === "win32" ? ["iecode", "libiecode"] : ["libiecode", "iecode"]

/** Chemins candidats de la bibliothèque C++, dans l'ordre d'essai (diagnostic). */
export const IECODE_LIB_CANDIDATES: readonly string[] = _dirs.flatMap((d) =>
  _names.map((n) => `${d}/${n}.${suffix}`),
)

function resolveLib(): string {
  const env = process.env["IECODE_LIB_PATH"]
  if (env) return env
  for (const c of IECODE_LIB_CANDIDATES) if (existsSync(c)) return c
  return IECODE_LIB_CANDIDATES[0]!
}

/** Chemin résolu de la bibliothèque C++ (diagnostic). */
export const LIB_PATH = resolveLib()

const lib = dlopen(LIB_PATH, {
  // Lifecycle
  iecode_version: { args: [], returns: FFIType.cstring },
  iecode_free: { args: [FFIType.ptr], returns: FFIType.void },

  // cfg.bin
  iecode_cfgbin_parse: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
  iecode_result_json: { args: [FFIType.ptr], returns: FFIType.cstring },
  iecode_result_format: { args: [FFIType.ptr], returns: FFIType.cstring },
  iecode_result_free: { args: [FFIType.ptr], returns: FFIType.void },
  iecode_cfgbin_write: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },

  // G4TX
  iecode_g4tx_parse: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
  iecode_g4tx_count: { args: [FFIType.ptr], returns: FFIType.i32 },
  iecode_g4tx_export_png: { args: [FFIType.ptr, FFIType.i32, FFIType.cstring], returns: FFIType.bool },
  iecode_g4tx_export_webp: { args: [FFIType.ptr, FFIType.i32, FFIType.cstring, FFIType.i32], returns: FFIType.bool },
  iecode_g4tx_decode_rgba: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  iecode_g4tx_info: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.cstring },
  iecode_g4tx_free: { args: [FFIType.ptr], returns: FFIType.void },

  // Compression — base
  iecode_lz10_decompress: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.u32 },
  iecode_crilayla_decompress: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.u32 },
  iecode_lz4_decompress: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.u32 },

  // Compression — Level-5 dispatcher
  iecode_level5_decompress: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.u32 },
  iecode_level5_detect_method: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u8 },
  iecode_level5_decompressed_size: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u32 },

  // Compression — InazumaLZSS
  iecode_is_inazuma_lzss: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.bool },
  iecode_inazuma_lzss_decompress: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.u32 },

  // Compression — Huffman
  iecode_huffman4_decompress: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.u32 },
  iecode_huffman8_decompress: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.u32 },

  // Compression — RLE
  iecode_rle_decompress: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.u32 },

  // Compression — ZLib
  iecode_zlib_decompress: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.u32 },

  // Crypto
  iecode_crc32: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
  iecode_cri_decrypt: { args: [FFIType.ptr, FFIType.u32, FFIType.u32], returns: FFIType.void },
  iecode_cri_derive_key: { args: [FFIType.cstring], returns: FFIType.u32 },

  // CPK
  iecode_cpk_open: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
  iecode_cpk_count: { args: [FFIType.ptr], returns: FFIType.i32 },
  iecode_cpk_filename: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.cstring },
  iecode_cpk_extract: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.ptr },
  iecode_cpk_free: { args: [FFIType.ptr], returns: FFIType.void },

  // G4PK
  iecode_g4pk_open: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
  iecode_g4pk_count: { args: [FFIType.ptr], returns: FFIType.i32 },
  iecode_g4pk_entry_name: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.cstring },
  iecode_g4pk_extract: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.ptr },
  iecode_g4pk_free: { args: [FFIType.ptr], returns: FFIType.void },

  // Format detection
  iecode_detect_format: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.cstring },

  // DDS
  iecode_dds_is_valid: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.bool },
  iecode_dds_info: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.cstring },

  // FNT
  iecode_fnt_info: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.cstring },

  // ANMx
  iecode_anm_is_valid: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.bool },
  iecode_anm_info: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.cstring },

  // EventText
  iecode_event_text_extract: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.cstring },

  // AWB
  iecode_awb_open: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
  iecode_awb_count: { args: [FFIType.ptr], returns: FFIType.i32 },
  iecode_awb_entry_info: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.cstring },
  iecode_awb_extract_all: { args: [FFIType.ptr, FFIType.cstring], returns: FFIType.i32 },
  iecode_awb_free: { args: [FFIType.ptr], returns: FFIType.void },

  // ACB
  iecode_acb_info: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.cstring },
  iecode_acb_extract_awb: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.ptr },

  // USM
  iecode_usm_info: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.cstring },
  iecode_usm_demux: { args: [FFIType.ptr, FFIType.u32, FFIType.cstring], returns: FFIType.u64 },

  // G4MD, G4CM
  iecode_g4md_parse: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.cstring },
  iecode_g4cm_list: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.cstring },
  iecode_g4cm_extract: { args: [FFIType.ptr, FFIType.u32, FFIType.cstring], returns: FFIType.i32 },

  // GameDB
  iecode_gamedb_load: { args: [FFIType.cstring, FFIType.i32], returns: FFIType.ptr },
  iecode_gamedb_chara_count: { args: [FFIType.ptr], returns: FFIType.i32 },
  iecode_gamedb_skill_count: { args: [FFIType.ptr], returns: FFIType.i32 },
  iecode_gamedb_team_count: { args: [FFIType.ptr], returns: FFIType.i32 },
  iecode_gamedb_json: { args: [FFIType.ptr], returns: FFIType.cstring },
  iecode_gamedb_chara_json: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.cstring },
  iecode_gamedb_skill_json: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.cstring },
  iecode_gamedb_find_chara: { args: [FFIType.ptr, FFIType.cstring], returns: FFIType.i32 },
  iecode_gamedb_find_skill: { args: [FFIType.ptr, FFIType.cstring], returns: FFIType.i32 },
  iecode_gamedb_free: { args: [FFIType.ptr], returns: FFIType.void },

  // Batch
  iecode_batch_convert: { args: [FFIType.cstring, FFIType.cstring, FFIType.cstring, FFIType.i32, FFIType.bool, FFIType.bool], returns: FFIType.i32 },
})

// ── Types ──────────────────────────────────────────────────────────

/** Level-5 compression method IDs. */
export const Level5Method = {
  NONE: 0,
  LZ10: 1,
  HUFFMAN4: 2,
  HUFFMAN8: 3,
  RLE: 4,
  ZLIB: 5,
} as const

export type Level5MethodId = typeof Level5Method[keyof typeof Level5Method]

/** Texture info returned by G4TX parsing. */
export interface G4txTextureInfo {
  index: number
  name: string
  width: number
  height: number
  format: string
  mipCount: number
  isDds: boolean
  dataSize: number
  subTextureCount: number
}

/** DDS header info. */
export interface DdsInfo {
  width: number
  height: number
  depth: number
  mipmapCount: number
  hasFourCC: boolean
  hasDx10Extension: boolean
  fourCC?: string
  rgbBitCount: number
  dataOffset: number
  flags: number
  caps1: number
  caps2: number
}

/** Event text entry. */
export interface EventTextEntry {
  hash: string
  key: string
  text: string
  speakerId: number
  voiceId: number
  startTime: number
  endTime: number
}

// ── Helpers internes ───────────────────────────────────────────────

// Reusable out-parameter buffers — avoid allocation on every FFI call.
// These are module-level singletons; safe because bun:ffi calls are synchronous.
const _u32Out = new Uint32Array(2)     // 2 slots for width+height etc.
const _u32Ptr = ptr(_u32Out)
const _ptrOut = new BigUint64Array(1)
const _ptrPtr = ptr(_ptrOut)

/** Returns [array, pointer] for a u32 out-param. Slot 0 by default. */
function u32Out(slot = 0): [Uint32Array, number] {
  return [_u32Out, _u32Ptr + slot * 4]
}

/** Returns [array, pointer] for a ptr out-param (ptr**). */
function ptrOut(): [BigUint64Array, number] {
  return [_ptrOut, _ptrPtr]
}

/**
 * Adresse numérique → `Pointer` de bun:ffi.
 *
 * Les handles opaques d'`iecode_ffi` circulent en `number` dans cette couche ; `bun:ffi` les
 * type `Pointer` (marque nominale). Le cast est la conversion, pas un contournement.
 */
function asPtr(p: number): Pointer {
  return p as unknown as Pointer
}

/**
 * Reads a C string returned by iecode, frees it, and returns a JS string.
 * Returns null if the pointer is null/0.
 */
function readAndFreeString(p: number | null): string | null {
  if (!p) return null
  const str = new CString(asPtr(p)).toString()
  lib.symbols.iecode_free(asPtr(p))
  return str
}

/**
 * Reads a C string returned by iecode, frees it, and parses as JSON.
 * Returns null if the pointer is null/0 or the JSON is invalid.
 */
function readAndFreeJson<T = unknown>(p: number | null): T | null {
  const str = readAndFreeString(p)
  if (!str) return null
  try {
    return JSON.parse(str) as T
  } catch {
    return null
  }
}

/**
 * Copies data from a native buffer into a Uint8Array and frees the native buffer.
 * Returns null if the pointer is null/0 or size is 0.
 */
function copyAndFreeBuffer(p: number | null, size: number): Uint8Array | null {
  if (!p || size === 0) return null
  const ab = toArrayBuffer(asPtr(p), 0, size)
  const result = new Uint8Array(ab.slice(0))
  lib.symbols.iecode_free(asPtr(p))
  return result
}

// ── RAII wrappers ──────────────────────────────────────────────────

/** RAII wrapper for a G4TX handle. Disposes on .close() or via using/Symbol.dispose. */
export class G4txHandle {
  private handle: number | null

  constructor(handle: number) {
    this.handle = handle
  }

  /** Number of textures in the G4TX. */
  get count(): number {
    if (!this.handle) return 0
    return lib.symbols.iecode_g4tx_count(asPtr(this.handle)) as number
  }

  /** Returns texture info as a parsed object. */
  info(index: number): G4txTextureInfo | null {
    if (!this.handle) return null
    const str = lib.symbols.iecode_g4tx_info(asPtr(this.handle), index) as unknown as string | null
    if (!str) return null
    try {
      return JSON.parse(str) as G4txTextureInfo
    } catch {
      return null
    }
  }

  /** Exports texture to PNG. Returns true on success. */
  exportPng(index: number, outputPath: string): boolean {
    if (!this.handle) return false
    return Boolean(lib.symbols.iecode_g4tx_export_png(asPtr(this.handle), index, Buffer.from(outputPath + "\0")))
  }

  /** Exports texture to WebP. Returns true on success. */
  exportWebp(index: number, outputPath: string, quality = 90): boolean {
    if (!this.handle) return false
    return Boolean(lib.symbols.iecode_g4tx_export_webp(asPtr(this.handle), index, Buffer.from(outputPath + "\0"), quality))
  }

  /** Decodes texture to RGBA8 buffer. Returns {data, width, height} or null. */
  decodeRgba(index: number): { data: Uint8Array, width: number, height: number } | null {
    if (!this.handle) return null
    const [arr, wPtr] = u32Out(0)
    const hPtr = _u32Ptr + 4  // slot 1
    const p = lib.symbols.iecode_g4tx_decode_rgba(asPtr(this.handle), index, wPtr, hPtr) as unknown as number | null
    if (!p) return null
    const width = arr[0]!
    const height = _u32Out[1]!
    const data = copyAndFreeBuffer(p, width * height * 4)
    if (!data) return null
    return { data, width, height }
  }

  /** Frees the underlying native handle. */
  close(): void {
    if (this.handle) {
      lib.symbols.iecode_g4tx_free(asPtr(this.handle))
      this.handle = null
    }
  }

  [Symbol.dispose](): void {
    this.close()
  }
}

/** RAII wrapper for a CPK handle. */
export class CpkHandle {
  private handle: number | null

  constructor(handle: number) {
    this.handle = handle
  }

  /** Number of files in the CPK. */
  get count(): number {
    if (!this.handle) return 0
    return lib.symbols.iecode_cpk_count(asPtr(this.handle)) as number
  }

  /** Returns the filename at the given index. */
  filename(index: number): string {
    if (!this.handle) return ""
    return (lib.symbols.iecode_cpk_filename(asPtr(this.handle), index) as unknown as unknown as string) ?? ""
  }

  /** Extracts a file by index. Returns the raw buffer or null. */
  extract(index: number): Uint8Array | null {
    if (!this.handle) return null
    const [sArr, sPtr] = u32Out()
    const p = lib.symbols.iecode_cpk_extract(asPtr(this.handle), index, sPtr) as unknown as number | null
    if (!p) return null
    return copyAndFreeBuffer(p, sArr[0]!)
  }

  close(): void {
    if (this.handle) {
      lib.symbols.iecode_cpk_free(asPtr(this.handle))
      this.handle = null
    }
  }

  [Symbol.dispose](): void {
    this.close()
  }
}

/** RAII wrapper for a G4PK handle. */
export class G4pkHandle {
  private handle: number | null

  constructor(handle: number) {
    this.handle = handle
  }

  /** Number of entries in the G4PK. */
  get count(): number {
    if (!this.handle) return 0
    return lib.symbols.iecode_g4pk_count(asPtr(this.handle)) as number
  }

  /** Returns the entry name at the given index. */
  entryName(index: number): string {
    if (!this.handle) return ""
    return (lib.symbols.iecode_g4pk_entry_name(asPtr(this.handle), index) as unknown as unknown as string) ?? ""
  }

  /** Extracts data by index. Returns the raw buffer or null. */
  extract(index: number): Uint8Array | null {
    if (!this.handle) return null
    const [sArr, sPtr] = u32Out()
    const p = lib.symbols.iecode_g4pk_extract(asPtr(this.handle), index, sPtr) as unknown as number | null
    if (!p) return null
    return copyAndFreeBuffer(p, sArr[0]!)
  }

  close(): void {
    if (this.handle) {
      lib.symbols.iecode_g4pk_free(asPtr(this.handle))
      this.handle = null
    }
  }

  [Symbol.dispose](): void {
    this.close()
  }
}

/** RAII wrapper for an AWB handle. */
export class AwbHandle {
  private handle: number | null

  constructor(handle: number) {
    this.handle = handle
  }

  /** Number of entries in the AWB. */
  get count(): number {
    if (!this.handle) return 0
    return lib.symbols.iecode_awb_count(asPtr(this.handle)) as number
  }

  /** Returns entry info as parsed JSON. */
  entryInfo(index: number): { cue_id: number, offset: number, size: number } | null {
    if (!this.handle) return null
    const str = lib.symbols.iecode_awb_entry_info(asPtr(this.handle), index) as unknown as string | null
    if (!str) return null
    try {
      return JSON.parse(str)
    } catch {
      return null
    }
  }

  /** Extracts all tracks to a directory. Returns the number of files extracted. */
  extractAll(outputDir: string): number {
    if (!this.handle) return 0
    return lib.symbols.iecode_awb_extract_all(asPtr(this.handle), Buffer.from(outputDir + "\0")) as number
  }

  close(): void {
    if (this.handle) {
      lib.symbols.iecode_awb_free(asPtr(this.handle))
      this.handle = null
    }
  }

  [Symbol.dispose](): void {
    this.close()
  }
}

/** RAII wrapper for a GameDB handle. */
export class GameDbHandle {
  private handle: number | null

  constructor(handle: number) {
    this.handle = handle
  }

  /** Number of characters. */
  get charaCount(): number {
    if (!this.handle) return 0
    return lib.symbols.iecode_gamedb_chara_count(asPtr(this.handle)) as number
  }

  /** Number of skills. */
  get skillCount(): number {
    if (!this.handle) return 0
    return lib.symbols.iecode_gamedb_skill_count(asPtr(this.handle)) as number
  }

  /** Number of teams. */
  get teamCount(): number {
    if (!this.handle) return 0
    return lib.symbols.iecode_gamedb_team_count(asPtr(this.handle)) as number
  }

  /** Full database as JSON. Cached on the native side. */
  toJson(): unknown {
    if (!this.handle) return null
    const str = lib.symbols.iecode_gamedb_json(asPtr(this.handle)) as unknown as string | null
    if (!str) return null
    try {
      return JSON.parse(str)
    } catch {
      return null
    }
  }

  /** Character data by index as JSON. */
  charaJson(index: number): unknown {
    if (!this.handle) return null
    const str = lib.symbols.iecode_gamedb_chara_json(asPtr(this.handle), index) as unknown as string | null
    if (!str) return null
    try {
      return JSON.parse(str)
    } catch {
      return null
    }
  }

  /** Skill data by index as JSON. */
  skillJson(index: number): unknown {
    if (!this.handle) return null
    const str = lib.symbols.iecode_gamedb_skill_json(asPtr(this.handle), index) as unknown as string | null
    if (!str) return null
    try {
      return JSON.parse(str)
    } catch {
      return null
    }
  }

  /** Find character index by charaParamId. Returns -1 if not found. */
  findChara(charaParamId: string): number {
    if (!this.handle) return -1
    return lib.symbols.iecode_gamedb_find_chara(asPtr(this.handle), Buffer.from(charaParamId + "\0")) as number
  }

  /** Find skill index by skillId. Returns -1 if not found. */
  findSkill(skillId: string): number {
    if (!this.handle) return -1
    return lib.symbols.iecode_gamedb_find_skill(asPtr(this.handle), Buffer.from(skillId + "\0")) as number
  }

  close(): void {
    if (this.handle) {
      lib.symbols.iecode_gamedb_free(asPtr(this.handle))
      this.handle = null
    }
  }

  [Symbol.dispose](): void {
    this.close()
  }
}

// ── High-level wrapper ─────────────────────────────────────────────

/**
 * High-level ergonomic wrapper around the iecode FFI.
 * Handles buffer conversion (Uint8Array <-> ptr) and cleanup (iecode_free).
 */
export class IecodeLib {
  // ── Lifecycle ────────────────────────────────────────────────────

  /** Returns the iecode library version string. */
  version(): string {
    return lib.symbols.iecode_version() as unknown as string
  }

  // ── cfg.bin ──────────────────────────────────────────────────────

  /** Parses a cfg.bin buffer and returns an opaque handle for further operations. */
  cfgbinParseRaw(data: Uint8Array): number | null {
    const handle = lib.symbols.iecode_cfgbin_parse(ptr(data), data.length) as unknown as number | null
    return handle || null
  }

  /**
   * Parses a cfg.bin buffer and returns the parsed JSON object.
   * This is the most common use case -- parse + JSON in one call.
   */
  cfgbinParse(data: Uint8Array): { format: string, data: unknown } | null {
    const handle = this.cfgbinParseRaw(data)
    if (!handle) return null
    try {
      const format = (lib.symbols.iecode_result_format(asPtr(handle)) as unknown as unknown as string) ?? "unknown"
      const jsonStr = lib.symbols.iecode_result_json(asPtr(handle)) as unknown as string | null
      if (!jsonStr) return null
      return { format, data: JSON.parse(jsonStr) }
    } catch {
      return null
    } finally {
      lib.symbols.iecode_result_free(asPtr(handle))
    }
  }

  /**
   * Serializes a parsed cfg.bin handle back to binary.
   * The handle must have been obtained via cfgbinParseRaw().
   * Caller is responsible for freeing the handle via cfgbinFree().
   */
  cfgbinWrite(handle: number): Uint8Array | null {
    // `ptrOut` est la FONCTION : la passer au lieu du pointeur `ptrP` faisait échouer
    // l'appel FFI à l'exécution (bug jamais détecté — ce fichier n'était pas typechecké
    // tant qu'il vivait hors du workspace Bun, dans src/ffi/).
    const [ptrArr, ptrP] = ptrOut()
    const size = lib.symbols.iecode_cfgbin_write(asPtr(handle), asPtr(ptrP)) as number
    if (size === 0) return null
    const bufPtr = Number(ptrArr[0])
    return copyAndFreeBuffer(bufPtr, size)
  }

  /** Frees a cfg.bin result handle obtained via cfgbinParseRaw(). */
  cfgbinFree(handle: number): void {
    lib.symbols.iecode_result_free(asPtr(handle))
  }

  // ── G4TX ─────────────────────────────────────────────────────────

  /**
   * Parses a G4TX buffer and returns a G4txHandle.
   * The handle must be closed when done (call .close() or use `using`).
   */
  g4txParse(data: Uint8Array): G4txHandle | null {
    const handle = lib.symbols.iecode_g4tx_parse(ptr(data), data.length) as unknown as number | null
    if (!handle) return null
    return new G4txHandle(handle)
  }

  // ── Compression ──────────────────────────────────────────────────

  /** Decompresses LZ10 data. Returns null on failure. */
  lz10Decompress(data: Uint8Array): Uint8Array | null {
    const [ptrArr, ptrP] = ptrOut()
    const size = lib.symbols.iecode_lz10_decompress(ptr(data), data.length, ptrP) as number
    if (size === 0) return null
    return copyAndFreeBuffer(Number(ptrArr[0]), size)
  }

  /** Decompresses CRILAYLA data. Returns null on failure. */
  crilaylaDecompress(data: Uint8Array): Uint8Array | null {
    const [ptrArr, ptrP] = ptrOut()
    const size = lib.symbols.iecode_crilayla_decompress(ptr(data), data.length, ptrP) as number
    if (size === 0) return null
    return copyAndFreeBuffer(Number(ptrArr[0]), size)
  }

  /** Decompresses an LZ4 block. Requires the known decompressed size. */
  lz4Decompress(data: Uint8Array, decompressedSize: number): Uint8Array | null {
    const [ptrArr, ptrP] = ptrOut()
    const size = lib.symbols.iecode_lz4_decompress(ptr(data), data.length, decompressedSize, ptrP) as number
    if (size === 0) return null
    return copyAndFreeBuffer(Number(ptrArr[0]), size)
  }

  /**
   * Decompresses Level-5 format data with auto-detection of the method.
   * This is the recommended function for Level-5 compressed data --
   * it reads the method byte from the header and dispatches accordingly.
   */
  decompress(data: Uint8Array): Uint8Array | null {
    const [ptrArr, ptrP] = ptrOut()
    const size = lib.symbols.iecode_level5_decompress(ptr(data), data.length, ptrP) as number
    if (size === 0) return null
    return copyAndFreeBuffer(Number(ptrArr[0]), size)
  }

  /**
   * Detects the Level-5 compression method from the header byte.
   * @returns 0=NONE, 1=LZ10, 2=HUFFMAN4, 3=HUFFMAN8, 4=RLE, 5=ZLIB
   */
  level5DetectMethod(data: Uint8Array): Level5MethodId {
    return lib.symbols.iecode_level5_detect_method(ptr(data), data.length) as Level5MethodId
  }

  /** Returns the decompressed size from a Level-5 compression header. */
  level5DecompressedSize(data: Uint8Array): number {
    return lib.symbols.iecode_level5_decompressed_size(ptr(data), data.length) as number
  }

  /** Checks if data uses InazumaLZSS compression (magic "SSZL"). */
  isInazumaLzss(data: Uint8Array): boolean {
    return Boolean(lib.symbols.iecode_is_inazuma_lzss(ptr(data), data.length))
  }

  /** Decompresses InazumaLZSS data. */
  inazumaLzssDecompress(data: Uint8Array): Uint8Array | null {
    const [ptrArr, ptrP] = ptrOut()
    const size = lib.symbols.iecode_inazuma_lzss_decompress(ptr(data), data.length, ptrP) as number
    if (size === 0) return null
    return copyAndFreeBuffer(Number(ptrArr[0]), size)
  }

  /** Decompresses Huffman 4-bit data (Level-5 method #2). */
  huffman4Decompress(data: Uint8Array): Uint8Array | null {
    const [ptrArr, ptrP] = ptrOut()
    const size = lib.symbols.iecode_huffman4_decompress(ptr(data), data.length, ptrP) as number
    if (size === 0) return null
    return copyAndFreeBuffer(Number(ptrArr[0]), size)
  }

  /** Decompresses Huffman 8-bit data (Level-5 method #3). */
  huffman8Decompress(data: Uint8Array): Uint8Array | null {
    const [ptrArr, ptrP] = ptrOut()
    const size = lib.symbols.iecode_huffman8_decompress(ptr(data), data.length, ptrP) as number
    if (size === 0) return null
    return copyAndFreeBuffer(Number(ptrArr[0]), size)
  }

  /** Decompresses RLE data (Level-5 method #4). */
  rleDecompress(data: Uint8Array): Uint8Array | null {
    const [ptrArr, ptrP] = ptrOut()
    const size = lib.symbols.iecode_rle_decompress(ptr(data), data.length, ptrP) as number
    if (size === 0) return null
    return copyAndFreeBuffer(Number(ptrArr[0]), size)
  }

  /** Decompresses ZLib/deflate data (Level-5 method #5). */
  zlibDecompress(data: Uint8Array): Uint8Array | null {
    const [ptrArr, ptrP] = ptrOut()
    const size = lib.symbols.iecode_zlib_decompress(ptr(data), data.length, ptrP) as number
    if (size === 0) return null
    return copyAndFreeBuffer(Number(ptrArr[0]), size)
  }

  // ── Crypto ───────────────────────────────────────────────────────

  /** Computes a CRC32 of the buffer. */
  crc32(data: Uint8Array): number {
    return lib.symbols.iecode_crc32(ptr(data), data.length) as number
  }

  /**
   * Decrypts/encrypts a buffer in-place using CRI XOR cipher.
   * The operation is symmetric (encrypt = decrypt).
   */
  criDecrypt(data: Uint8Array, key: number): void {
    lib.symbols.iecode_cri_decrypt(ptr(data), data.length, key)
  }

  /** Derives a CRI encryption key from a filename. */
  criDeriveKey(filename: string): number {
    return lib.symbols.iecode_cri_derive_key(Buffer.from(filename + "\0")) as number
  }

  // ── CPK ──────────────────────────────────────────────────────────

  /**
   * Opens a CPK archive from a buffer.
   * Returns a CpkHandle that must be closed when done.
   */
  cpkOpen(data: Uint8Array): CpkHandle | null {
    const handle = lib.symbols.iecode_cpk_open(ptr(data), data.length) as unknown as number | null
    if (!handle) return null
    return new CpkHandle(handle)
  }

  // ── G4PK ─────────────────────────────────────────────────────────

  /**
   * Opens a G4PK archive from a buffer.
   * Returns a G4pkHandle that must be closed when done.
   */
  g4pkOpen(data: Uint8Array): G4pkHandle | null {
    const handle = lib.symbols.iecode_g4pk_open(ptr(data), data.length) as unknown as number | null
    if (!handle) return null
    return new G4pkHandle(handle)
  }

  // ── Format detection ─────────────────────────────────────────────

  /**
   * Detects the format of a binary file from its magic bytes.
   * Returns a human-readable format name ("CPK", "G4TX", "RDBN", etc.)
   * or "Unknown" if the format is not recognized.
   */
  detectFormat(data: Uint8Array): string {
    const p = lib.symbols.iecode_detect_format(ptr(data), data.length) as unknown as number | null
    return readAndFreeString(p) ?? "Unknown"
  }

  // ── DDS ──────────────────────────────────────────────────────────

  /** Checks if the data is a valid DDS file (has "DDS " magic). */
  ddsIsValid(data: Uint8Array): boolean {
    return Boolean(lib.symbols.iecode_dds_is_valid(ptr(data), data.length))
  }

  /** Returns DDS header info as a parsed object, or null if invalid. */
  ddsInfo(data: Uint8Array): DdsInfo | null {
    const p = lib.symbols.iecode_dds_info(ptr(data), data.length) as unknown as number | null
    return readAndFreeJson<DdsInfo>(p)
  }

  // ── FNT ──────────────────────────────────────────────────────────

  /** Returns FNT (font) metadata as a parsed JSON object, or null if invalid. */
  fntInfo(data: Uint8Array): unknown {
    const p = lib.symbols.iecode_fnt_info(ptr(data), data.length) as unknown as number | null
    return readAndFreeJson(p)
  }

  // ── ANMx ─────────────────────────────────────────────────────────

  /** Checks if the data is a valid ANMx animation file. */
  anmIsValid(data: Uint8Array): boolean {
    return Boolean(lib.symbols.iecode_anm_is_valid(ptr(data), data.length))
  }

  /** Returns ANMx animation info as a parsed JSON object, or null if invalid. */
  anmInfo(data: Uint8Array): unknown {
    const p = lib.symbols.iecode_anm_info(ptr(data), data.length) as unknown as number | null
    return readAndFreeJson(p)
  }

  // ── EventText ────────────────────────────────────────────────────

  /**
   * Extracts event text entries from a cfg.bin buffer.
   * Returns an array of EventTextEntry objects, or null on failure.
   */
  eventTextExtract(data: Uint8Array): EventTextEntry[] | null {
    const p = lib.symbols.iecode_event_text_extract(ptr(data), data.length) as unknown as number | null
    return readAndFreeJson<EventTextEntry[]>(p)
  }

  // ── AWB ──────────────────────────────────────────────────────────

  /**
   * Opens an AWB (AFS2) audio archive from a buffer.
   * Returns an AwbHandle that must be closed when done.
   */
  awbOpen(data: Uint8Array): AwbHandle | null {
    const handle = lib.symbols.iecode_awb_open(ptr(data), data.length) as unknown as number | null
    if (!handle) return null
    return new AwbHandle(handle)
  }

  // ── ACB ──────────────────────────────────────────────────────────

  /** Returns ACB metadata as a parsed JSON object, or null if invalid. */
  acbInfo(data: Uint8Array): unknown {
    const p = lib.symbols.iecode_acb_info(ptr(data), data.length) as unknown as number | null
    return readAndFreeJson(p)
  }

  /** Extracts the embedded AWB from an ACB. Returns the raw buffer or null. */
  acbExtractAwb(data: Uint8Array): Uint8Array | null {
    const [sArr, sPtr] = u32Out()
    const p = lib.symbols.iecode_acb_extract_awb(ptr(data), data.length, sPtr) as unknown as number | null
    if (!p) return null
    return copyAndFreeBuffer(p, sArr[0]!)
  }

  // ── USM ──────────────────────────────────────────────────────────

  /** Returns USM (video) metadata as a parsed JSON object, or null if invalid. */
  usmInfo(data: Uint8Array): unknown {
    const p = lib.symbols.iecode_usm_info(ptr(data), data.length) as unknown as number | null
    return readAndFreeJson(p)
  }

  /**
   * Demuxes a USM video to a directory, splitting streams into separate files.
   * Returns the number of bytes written, or 0 on failure.
   */
  usmDemux(data: Uint8Array, outputDir: string): bigint {
    return lib.symbols.iecode_usm_demux(ptr(data), data.length, Buffer.from(outputDir + "\0")) as bigint
  }

  // ── G4MD ─────────────────────────────────────────────────────────

  /** Parses a G4MD (model metadata) buffer and returns the info as JSON, or null. */
  g4mdParse(data: Uint8Array): unknown {
    const p = lib.symbols.iecode_g4md_parse(ptr(data), data.length) as unknown as number | null
    return readAndFreeJson(p)
  }

  // ── G4CM ─────────────────────────────────────────────────────────

  /** Lists sub-files in a G4CM (character model) container. Returns a JSON array. */
  g4cmList(data: Uint8Array): unknown[] | null {
    const p = lib.symbols.iecode_g4cm_list(ptr(data), data.length) as unknown as number | null
    return readAndFreeJson<unknown[]>(p)
  }

  /** Extracts all sub-files from a G4CM to a directory. Returns number of files extracted. */
  g4cmExtract(data: Uint8Array, outputDir: string): number {
    return lib.symbols.iecode_g4cm_extract(ptr(data), data.length, Buffer.from(outputDir + "\0")) as number
  }

  // ── GameDB ───────────────────────────────────────────────────────

  /**
   * Loads the complete game database from a data root directory.
   * @param dataRoot path containing common/gamedata/, common/text/
   * @param loadText if true, loads localized text (9 locales, slower)
   */
  gamedbLoad(dataRoot: string, loadText = false): GameDbHandle | null {
    const handle = lib.symbols.iecode_gamedb_load(
      Buffer.from(dataRoot + "\0"),
      loadText ? 1 : 0,
    ) as unknown as number | null
    if (!handle) return null
    return new GameDbHandle(handle)
  }

  // ── Batch conversion ─────────────────────────────────────────────

  /**
   * Batch-converts all G4TX files in a directory to PNG/WebP/DDS.
   * @param inputDir source directory
   * @param outputDir destination directory
   * @param format "png", "webp", or "dds"
   * @param threads number of threads (0 = auto)
   * @param recursive search subdirectories
   * @param flat flat output (no subdirectories)
   * @returns number of files converted
   */
  batchConvert(
    inputDir: string,
    outputDir: string,
    format: "png" | "webp" | "dds" = "png",
    threads = 0,
    recursive = true,
    flat = false,
  ): number {
    return lib.symbols.iecode_batch_convert(
      Buffer.from(inputDir + "\0"),
      Buffer.from(outputDir + "\0"),
      Buffer.from(format + "\0"),
      threads,
      recursive,
      flat,
    ) as number
  }

  // ── Zero-copy helpers (advanced) ──────────────────────────────────

  /**
   * Decompresses Level-5 data and returns a zero-copy ArrayBuffer view.
   * WARNING: The returned buffer is owned by C++ — you MUST call freeNative(ptr)
   * when done, or the memory will leak. Use decompress() for automatic cleanup.
   */
  decompressZeroCopy(data: Uint8Array): { buffer: ArrayBuffer, ptr: number, size: number } | null {
    const [ptrArr, ptrP] = ptrOut()
    const size = lib.symbols.iecode_level5_decompress(ptr(data), data.length, ptrP) as number
    if (size === 0) return null
    const nativePtr = Number(ptrArr[0])
    return {
      buffer: toArrayBuffer(nativePtr as unknown as Pointer, 0, size),
      ptr: nativePtr,
      size,
    }
  }

  /** Frees a native pointer obtained via zero-copy methods. */
  freeNative(p: number): void {
    lib.symbols.iecode_free(p as unknown as Pointer)
  }
}

// ── Default export ─────────────────────────────────────────────────

/** Singleton instance for convenience. */
export const iecode = new IecodeLib()

export default iecode
