/**
 * nie — **la** porte d'entrée TypeScript vers la bibliothèque native du dépôt.
 *
 * Un seul backend : **Rust** (`nie_ffi`), autorité byte-exact. Le pont C++ (`iecode_ffi`)
 * a été retiré avec la couche FFI du toolkit — le C++ ne sert plus que le jeu jouable.
 *
 * Partage des rôles : `docs/ARCHITECTURE.md`.
 *
 * Symboles exposés (low-level et haut niveau) :
 *   crc32, CRand, version, callOut, cstr,
 *   detectFormat, decode, decodeFile, decodeToPng, decodeToPngFile,
 *   wiki, vfsOpen, VfsHandle, FontHandle, RgbaColor, SO_PATH, FormatInfo, VfsEntry,
 *   SO_CANDIDATES, nativeAvailable, NativeLibraryError
 *
 * Résolution de la bibliothèque partagée `iecode` :
 *   1. NIE_FFI_PATH (override absolu)
 *   2. <workspace-root>/target/debug/libiecode.{suffix}    (dev)
 *   3. <workspace-root>/target/release/libiecode.{suffix}  (release)
 *   4. <workspace-root>/target/<host-triple>/{debug,release}/…  (`cargo build --target …`,
 *      e.g. `x86_64-pc-windows-gnu` on a Windows host without MSVC)
 *
 * Chemin depuis packages/nie/src/ vers nie/ : 3 niveaux (../../..)
 *
 * **The library is opened lazily**, on the first call that needs a native symbol — never at
 * import. `bunfig.toml` preloads `@nie/plugin`, which imports this module, so an eager `dlopen`
 * turned a missing or stale `iecode` into a failure of EVERY `bun` command in the repository
 * (typecheck, docs:check, lint, unrelated tests). Importing is now free; calling a native
 * function without the library throws {@link NativeLibraryError}, which names the build command.
 */

import {
  dlopen,
  FFIType,
  ptr,
  CString,
  toArrayBuffer,
  suffix,
  type Pointer,
} from "bun:ffi";
import { existsSync, readFileSync } from "node:fs";

// ─── résolution du .so ──────────────────────────────────────────────────────

// import.meta.dir = packages/nie/src → ../../.. = nie/
const _wsRoot = process.env["NIE_ROOT"] ?? `${import.meta.dir}/../../..`;

// Le préfixe `lib` n'existe pas sur Windows : rustc y produit `iecode.dll`.
// On teste les deux formes pour chaque profil, debug d'abord.
const _prefixes = process.platform === "win32" ? ["", "lib"] : ["lib", ""];
const _profiles = ["debug", "release"] as const;

/**
 * Target triples a `cargo build --target <triple>` may have written for this host. Cargo puts
 * such builds under `target/<triple>/<profile>/`, not `target/<profile>/`: the windows-gnu recipe
 * this repository documents for hosts without MSVC lands in `target/x86_64-pc-windows-gnu/`.
 */
function hostTriples(): string[] {
  const arch = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : process.arch;
  switch (process.platform) {
    case "win32":
      return [`${arch}-pc-windows-msvc`, `${arch}-pc-windows-gnu`, `${arch}-pc-windows-gnullvm`];
    case "darwin":
      return [`${arch}-apple-darwin`];
    case "linux":
      return [`${arch}-unknown-linux-gnu`];
    default:
      return [];
  }
}

const _library = (dir: string): string[] =>
  _prefixes.map((prefix) => `${dir}/${prefix}iecode.${suffix}`);

/**
 * Every path searched for `iecode`, in priority order. The host-default `target/<profile>/`
 * locations come first and keep their historical order, so a checkout that already had a
 * library there resolves exactly as before; `target/<triple>/<profile>/` builds come after.
 */
export const SO_CANDIDATES: readonly string[] = Object.freeze([
  ..._profiles.flatMap((profile) => _library(`${_wsRoot}/target/${profile}`)),
  ...hostTriples().flatMap((triple) =>
    _profiles.flatMap((profile) => _library(`${_wsRoot}/target/${triple}/${profile}`)),
  ),
]);

function resolveSo(): string {
  const env = process.env["NIE_FFI_PATH"];
  if (env) return env;
  for (const c of SO_CANDIDATES) if (existsSync(c)) return c;
  return SO_CANDIDATES[0]!;
}

/** Chemin résolu de la bibliothèque partagée iecode (diagnostic). Résolu à l'import, jamais ouvert. */
export const SO_PATH = resolveSo();

// ─── dlopen (paresseux) ─────────────────────────────────────────────────────

const symbolsDef = {
  nie_crc32:            { args: [FFIType.ptr, FFIType.u64], returns: FFIType.u32 },
  nie_crand_new:        { args: [FFIType.u32],              returns: FFIType.ptr },
  nie_crand_from_u64:   { args: [FFIType.u64],              returns: FFIType.ptr },
  nie_crand_next_u32:   { args: [FFIType.ptr],              returns: FFIType.u32 },
  nie_crand_bounded:    { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
  nie_crand_next_f32:   { args: [FFIType.ptr],              returns: FFIType.f32 },
  nie_crand_free:       { args: [FFIType.ptr],              returns: FFIType.void },
  nie_version:          { args: [],                         returns: FFIType.ptr  },
  nie_bytes_free_fields:{ args: [FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.void },
  nie_detect:           { args: [FFIType.ptr, FFIType.u64], returns: FFIType.u32 },
  nie_format_name:      { args: [FFIType.u32],              returns: FFIType.ptr  },
  nie_decode_json_out:  { args: [FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.void },
  nie_menu_setting_json_out:
                        { args: [FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.void },
  nie_g4tx_to_png_out:  { args: [FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.void },
  nie_vfs_open:         { args: [FFIType.cstring],          returns: FFIType.ptr  },
  nie_vfs_read_out:     { args: [FFIType.ptr, FFIType.cstring, FFIType.ptr], returns: FFIType.void },
  nie_vfs_list_json_out:{ args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void },
  nie_vfs_count:        { args: [FFIType.ptr],              returns: FFIType.u64  },
  nie_vfs_list_range_json_out:
                        { args: [FFIType.ptr, FFIType.u64, FFIType.u64, FFIType.ptr], returns: FFIType.void },
  nie_vfs_free:         { args: [FFIType.ptr],              returns: FFIType.void },
  nie_font_open:        { args: [FFIType.ptr],              returns: FFIType.ptr  },
  nie_font_render_text_out: {
    args: [FFIType.ptr, FFIType.cstring, FFIType.u8, FFIType.u8, FFIType.u8, FFIType.u8, FFIType.ptr],
    returns: FFIType.void,
  },
  nie_font_free:        { args: [FFIType.ptr],              returns: FFIType.void },
  nie_emu_registry_json_out: { args: [FFIType.ptr],         returns: FFIType.void },
} as const;

/**
 * The build command to print, computed only on the failure path. On Windows the pinned channel
 * is read from `rust-toolchain.toml` so the windows-gnu command can be pasted as is: a host
 * without MSVC cannot link with the default `-msvc` toolchain.
 */
function buildHint(): string {
  const generic = "Build it with `bun run build:ffi` (cargo build -p nie-ffi).";
  if (process.platform !== "win32") return generic;
  let channel = "<channel>";
  try {
    const toml = readFileSync(`${_wsRoot}/rust-toolchain.toml`, "utf8");
    channel = /^\s*channel\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? channel;
  } catch {
    // Outside a checkout: keep the placeholder rather than guess a version.
  }
  return (
    `${generic} On a Windows host without MSVC, build with the windows-gnu toolchain (from PowerShell): ` +
    `\`cargo +${channel}-x86_64-pc-windows-gnu build -p nie-ffi --release --target x86_64-pc-windows-gnu\`.`
  );
}

/**
 * Thrown by the first native call when `iecode` cannot be opened. Importing `@aphrody/nie`
 * never throws it: only functions that actually reach the Rust library do.
 */
export class NativeLibraryError extends Error {
  override readonly name = "NativeLibraryError";
  /** Path that was handed to `dlopen`. */
  readonly path: string;

  constructor(path: string, cause: unknown) {
    const reason = existsSync(path)
      ? `dlopen failed: ${cause instanceof Error ? cause.message : String(cause)}`
      : "the file does not exist.";
    const searched = process.env["NIE_FFI_PATH"]
      ? "NIE_FFI_PATH is set, so no other location was searched."
      : `Searched: ${SO_CANDIDATES.join(", ")}.`;
    super(
      `@aphrody/nie: cannot load the native library \`iecode\` from ${path}: ${reason} ` +
        `${buildHint()} Set NIE_FFI_PATH to use a library elsewhere. ${searched}`,
      { cause },
    );
    this.path = path;
  }
}

function openLibrary(path: string) {
  try {
    return dlopen(path, {
      ...symbolsDef,
      nie_wiki_json_out: { args: [FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.void },
    });
  } catch {
    return dlopen(path, symbolsDef as any);
  }
}

let _symbols: any;

/**
 * Symbols of `iecode`, opened on first use. A failure is not cached: a library that appears at
 * {@link SO_PATH} while the process runs is picked up by the next call.
 */
function native(): any {
  if (_symbols !== undefined) return _symbols;
  try {
    _symbols = openLibrary(SO_PATH).symbols;
  } catch (cause) {
    throw new NativeLibraryError(SO_PATH, cause);
  }
  return _symbols;
}

/** `true` when `iecode` can be opened (opening it if it was not yet). Never throws. */
export function nativeAvailable(): boolean {
  try {
    native();
    return true;
  } catch {
    return false;
  }
}

// ─── encodeurs partagés ──────────────────────────────────────────────────────
const _enc = new TextEncoder();
const _dec = new TextDecoder();

// ─── utilitaire NieBytes _out ────────────────────────────────────────────────

/**
 * Slot de sortie réutilisable (24 octets = sizeof NieBytes sur x86-64).
 * Mono-thread JS : sûr à réutiliser entre appels synchrones.
 *
 * Important : ptr(_OUT_SLOT) est appelé à CHAQUE appel de callOut, pas pré-calculé.
 * Bun FFI exige que ptr() soit appelé juste avant l'appel pour pincer le buffer contre GC.
 */
const _OUT_SLOT = new Uint8Array(24);
const _OUT_DV   = new DataView(_OUT_SLOT.buffer);

/**
 * Appelle une fonction FFI `_out(args..., outPtr)` et retourne une copie
 * JS-owned des octets produits, ou `null` si vide.
 *
 * Gère : lecture NieBytes via DataView LE u64, copie avant free, free via
 * nie_bytes_free_fields.
 */
export function callOut(call: (outPtr: Pointer) => void): Uint8Array | null {
  _OUT_SLOT.fill(0);
  // Appeler ptr() ici (pas en dehors) pour pincer _OUT_SLOT pendant l'appel FFI.
  call(ptr(_OUT_SLOT));

  const dataPtr = _OUT_DV.getBigUint64(0,  true);
  const dataLen = _OUT_DV.getBigUint64(8,  true);
  const dataCap = _OUT_DV.getBigUint64(16, true);

  if (dataPtr === 0n || dataLen === 0n) return null;

  // toArrayBuffer prend un Pointer ; Number(bigint) produit un number qu'on cast.
  const rawBuf = toArrayBuffer(
    Number(dataPtr) as unknown as Pointer,
    0,
    Number(dataLen),
  );
  const copy = new Uint8Array(Number(dataLen));
  copy.set(new Uint8Array(rawBuf));

  // Libérer l'allocation Rust (3 × u64 = bigint OK pour FFIType.u64).
  native().nie_bytes_free_fields(dataPtr, dataLen, dataCap);
  return copy;
}

/**
 * Encode une chaîne en Buffer null-terminé pour FFIType.cstring.
 * Conserver la référence pendant la durée de l'appel FFI.
 */
export function cstr(s: string): Buffer {
  return Buffer.from(s + "\0", "utf8");
}

/** Retourne la matrice unique des backends et capacités de `nie-emu`. */
export function emuRegistry(): unknown {
  const bytes = callOut((out) => native().nie_emu_registry_json_out(out));
  if (!bytes) return null;
  return JSON.parse(_dec.decode(bytes));
}

// ─── CRC32 ───────────────────────────────────────────────────────────────────

/**
 * CRC32 IEEE 802.3 (init 0xFFFFFFFF, poly 0xEDB88320, XOR final).
 * Identique à nie_formats::cfgbin::crc32.
 *
 * @param s - chaîne UTF-8 ou Uint8Array
 * @returns u32 (0..4 294 967 295)
 */
export function crc32(s: string | Uint8Array): number {
  const buf: Uint8Array = typeof s === "string" ? _enc.encode(s) : s;
  if (buf.byteLength === 0) return 0;
  return (native().nie_crc32(ptr(buf), BigInt(buf.byteLength)) as number) >>> 0;
}

// ─── CRand ───────────────────────────────────────────────────────────────────

const _registry = new FinalizationRegistry<Pointer>((handle: Pointer) => {
  native().nie_crand_free(handle);
});

/** @internal */
const _FROM_PTR: unique symbol = Symbol("CRand._from_ptr");

/**
 * PRNG MT19937 opaque — sémantique byte-exacte du moteur nie.exe.
 * Libérer via `.free()`, `.dispose()`, ou `using`.
 */
export class CRand {
  #ptr: Pointer | null;

  constructor(seed: number);
  /** @internal */
  constructor(sentinel: typeof _FROM_PTR, rawPtr: Pointer);
  constructor(seedOrSentinel: number | typeof _FROM_PTR, rawPtr?: Pointer) {
    if (seedOrSentinel === _FROM_PTR) {
      this.#ptr = rawPtr!;
    } else {
      this.#ptr = native().nie_crand_new(seedOrSentinel as number) as Pointer | null;
    }
    if (this.#ptr !== null) _registry.register(this, this.#ptr, this);
  }

  /** Crée un PRNG depuis une graine 64 bits (BigInt → u64). */
  static fromU64(seed: bigint): CRand {
    const handle = native().nie_crand_from_u64(seed) as Pointer;
    return new CRand(_FROM_PTR, handle);
  }

  #guard(): Pointer {
    if (this.#ptr === null) throw new Error("CRand: handle already freed");
    return this.#ptr;
  }

  /** Tire le prochain u32 (0..2^32-1). */
  nextU32(): number {
    return (native().nie_crand_next_u32(this.#guard()) as number) >>> 0;
  }

  /** Tire un entier dans [0, n) via Lemire+rejet. n===0 → tirage brut. */
  bounded(n: number): number {
    return (native().nie_crand_bounded(this.#guard(), n) as number) >>> 0;
  }

  /** Tire un f32 dans [0.0, 1.0). */
  nextF32(): number {
    return native().nie_crand_next_f32(this.#guard()) as number;
  }

  /** Libère le handle Rust. Idempotent. */
  free(): void {
    if (this.#ptr === null) return;
    _registry.unregister(this);
    native().nie_crand_free(this.#ptr);
    this.#ptr = null;
  }

  /** Protocole ECMAScript Explicit Resource Management (`using`). */
  [Symbol.dispose](): void { this.free(); }
}

// ─── version ─────────────────────────────────────────────────────────────────

/** Retourne la version du crate nie-ffi (ex. "0.1.0"). */
export function version(): string {
  const raw = native().nie_version() as Pointer;
  return new CString(raw).toString();
}

// ─── détection de format ─────────────────────────────────────────────────────

/** Résultat de détection de format. */
export interface FormatInfo {
  /** Discriminant u32 stable (0=Unknown, 8=cfg.bin, 11=G4TX, 13=G4PK, 15=LIP…). */
  kind: number;
  /** Nom court lisible ("G4TX", "cfg.bin", "LIP"…). */
  name: string;
}

/**
 * Détecte le format d'un tampon binaire à partir de ses octets magiques.
 */
export function detectFormat(bytes: Uint8Array): FormatInfo {
  if (bytes.byteLength === 0) return { kind: 0, name: "Unknown" };
  const kind = (native().nie_detect(ptr(bytes), BigInt(bytes.byteLength)) as number) >>> 0;
  const nameRaw = native().nie_format_name(kind) as Pointer;
  const name = new CString(nameRaw).toString();
  return { kind, name };
}

// ─── décodage JSON ───────────────────────────────────────────────────────────

/**
 * Auto-détecte et décode un tampon en objet JSON.
 * Retourne `null` si le format n'est pas supporté ou si le parse échoue.
 */
export function decode(bytes: Uint8Array): unknown | null {
  if (bytes.byteLength === 0) return null;
  const json = callOut((outPtr) => {
    native().nie_decode_json_out(ptr(bytes), BigInt(bytes.byteLength), outPtr);
  });
  if (json === null) return null;
  return JSON.parse(_dec.decode(json)) as unknown;
}

/**
 * Décode un `*_menu_setting.cfg.bin` en structure sémantique de menu.
 *
 * Contrairement à {@link decode}, cette fonction active le parseur `nie-data` et retourne
 * directement les layers, ressources, commandes et groupes de focus. `null` indique un tampon
 * vide, un T2B invalide ou un fichier qui ne contient pas de structure exploitable.
 */
export function decodeMenuSetting(bytes: Uint8Array): MenuSetting | null {
  if (bytes.byteLength === 0) return null;
  const json = callOut((outPtr) => {
    native().nie_menu_setting_json_out(ptr(bytes), BigInt(bytes.byteLength), outPtr);
  });
  if (json === null) return null;
  return JSON.parse(_dec.decode(json)) as MenuSetting;
}

/**
 * Lit un fichier et décode son format en objet JSON.
 */
export async function decodeFile(path: string): Promise<unknown | null> {
  const ab = await Bun.file(path).arrayBuffer();
  return decode(new Uint8Array(ab));
}

/** Public request shape for the Rust-owned read-only IEVR wiki. */
export interface WikiRequest {
  /** Operation name accepted by `nie_wiki_json_out`. */
  op: string;
  /** Operation-specific fields. */
  [key: string]: unknown;
}

/**
 * Execute one IEVR wiki operation in Rust and return its decoded JSON value.
 *
 * This is intentionally a transport binding: SQL, mirror access, joins,
 * parsing and game rules are implemented by `nie-wiki`, never by TypeScript.
 * The native library must be built before calling it (importing the module does not open it).
 */
export function wiki<T = unknown>(request: WikiRequest): T {
  if (typeof native().nie_wiki_json_out !== "function") {
    throw new Error("Rust wiki operation requires a native library with nie_wiki_json_out exported.");
  }
  const input = _enc.encode(JSON.stringify(request));
  const output = callOut((outPtr) => {
    native().nie_wiki_json_out(ptr(input), BigInt(input.byteLength), outPtr);
  });
  if (output === null) {
    throw new Error(`Rust wiki operation failed: ${request.op}`);
  }
  return JSON.parse(_dec.decode(output)) as T;
}

// ─── G4TX → PNG ──────────────────────────────────────────────────────────────

/**
 * Décode la première texture G4TX en PNG.
 * BC1-BC5 supportés. BC7/NXTCH → retourne `null`.
 */
export function decodeToPng(bytes: Uint8Array): Uint8Array | null {
  if (bytes.byteLength === 0) return null;
  return callOut((outPtr) => {
    native().nie_g4tx_to_png_out(ptr(bytes), BigInt(bytes.byteLength), outPtr);
  });
}

/**
 * Lit un fichier .g4tx et retourne ses octets PNG.
 */
export async function decodeToPngFile(path: string): Promise<Uint8Array | null> {
  const ab = await Bun.file(path).arrayBuffer();
  return decodeToPng(new Uint8Array(ab));
}

// ─── VFS ─────────────────────────────────────────────────────────────────────

/** Entrée VFS. */
export interface VfsEntry {
  path: string;
  cpk:  string;
  size: number;
}

/** Structure sémantique d'un écran `*_menu_setting.cfg.bin` produite par `nie-data`. */
export interface MenuSetting {
  layers: Array<{
    layer_id: number;
    name: string;
    objbin_path: string;
    params: number[];
  }>;
  resources: Array<{ logical_path: string; kind: number }>;
  commands: Array<{
    layer_id: number;
    command_hash: number;
    name: string;
    args: number[];
  }>;
  layer_groups: Array<{ layer_id: number; flags: number[] }>;
  groups: Array<{ group_id: number; name: string; flags: number[] }>;
  group_refs: Array<{ start: number; count: number }>;
  focus_base_infos: Array<{ role: number; param: number; param2: number }>;
  focus_groups: Array<{ layer_id: number; flags: number[] }>;
  focus_group_refs: Array<{ start: number; count: number }>;
  focus_shift_base_infos: Array<{ values: number[] }>;
  focus_shifts: number[];
  focus_shift_refs: Array<{ start: number; count: number }>;
}

/**
 * Handle RAII sur le VFS monté.
 *
 * @example
 * using vfs = vfsOpen("/home/user/nie/data");
 * if (vfs) {
 *   const bytes = vfs.read("chr/c000001/c000001.g4tx");
 * }
 */
export class VfsHandle {
  #handle: Pointer | null;

  /** @internal */
  constructor(rawHandle: Pointer) {
    this.#handle = rawHandle;
  }

  #guard(): Pointer {
    if (this.#handle === null) throw new Error("VfsHandle: déjà libéré");
    return this.#handle;
  }

  /** Lit un fichier du VFS. Retourne les octets bruts ou `null` si absent. */
  read(internalPath: string): Uint8Array | null {
    const h = this.#guard();
    const pathBuf = cstr(internalPath);
    return callOut((outPtr) => {
      native().nie_vfs_read_out(h, pathBuf, outPtr);
    });
  }

  /** Lit et décode directement un écran `*_menu_setting.cfg.bin` du VFS. */
  menuSetting(internalPath: string): MenuSetting | null {
    const bytes = this.read(internalPath);
    return bytes === null ? null : decodeMenuSetting(bytes);
  }

  /** Liste des entrées VFS (plafonnée à 50 000). Préférer {@link listAll} ou {@link listRange}. */
  list(): VfsEntry[] {
    const h = this.#guard();
    const json = callOut((outPtr) => {
      native().nie_vfs_list_json_out(h, outPtr);
    });
    if (json === null) return [];
    return JSON.parse(_dec.decode(json)) as VfsEntry[];
  }

  /** Nombre total d'entrées indexées — sans le plafond de {@link list}. */
  count(): number {
    return Number(native().nie_vfs_count(this.#guard()));
  }

  /**
   * Tranche `[offset, offset + limit)` de l'index VFS.
   *
   * L'ordre est stable pour un même handle mais non trié : il vient de l'itération de la
   * table d'index Rust.
   */
  listRange(offset: number, limit: number): VfsEntry[] {
    const h = this.#guard();
    const json = callOut((outPtr) => {
      native().nie_vfs_list_range_json_out(h, BigInt(offset), BigInt(limit), outPtr);
    });
    if (json === null) return [];
    return JSON.parse(_dec.decode(json)) as VfsEntry[];
  }

  /**
   * Index VFS complet, paginé par tranches de `pageSize`.
   *
   * Contrairement à {@link list}, rien n'est tronqué : sur le VFS IEVR (~255 000 fichiers)
   * cette méthode les renvoie tous.
   */
  listAll(pageSize = 50_000): VfsEntry[] {
    const total = this.count();
    const out: VfsEntry[] = [];
    for (let offset = 0; offset < total; offset += pageSize) {
      const page = this.listRange(offset, pageSize);
      if (page.length === 0) break;
      out.push(...page);
    }
    return out;
  }

  /**
   * Ouvre un contexte de police (métriques `font.cfg.bin` + atlas `font.g4tx`)
   * pour le rendu de texte. Retourne `null` si la police est absente du VFS.
   *
   * @example
   * using vfs  = vfsOpen(dir)!;
   * using font = vfs.openFont()!;
   * const png  = font.renderText("COMMENCER");   // PNG RGBA8
   */
  openFont(): FontHandle | null {
    const ctx = native().nie_font_open(this.#guard()) as Pointer | null;
    if (ctx === null) return null;
    return new FontHandle(ctx);
  }

  /** Libère le handle Rust. Idempotent. */
  free(): void {
    if (this.#handle === null) return;
    native().nie_vfs_free(this.#handle);
    this.#handle = null;
  }

  [Symbol.dispose](): void { this.free(); }
}

// ─── Police (rendu de texte) ──────────────────────────────────────────────────

/** Teinte RGBA appliquée au masque des glyphes : `[R, G, B, A]`, chacun 0..255. */
export type RgbaColor = readonly [number, number, number, number];

/** Blanc opaque — couleur de teinte par défaut. */
const WHITE: RgbaColor = [255, 255, 255, 255];

/**
 * Handle RAII sur un contexte de police chargé (métriques + atlas).
 *
 * Créé via {@link VfsHandle.openFont}. Réutilisable pour rendre plusieurs chaînes
 * sans relire l'atlas de ~33 Mo. Libérer via `.free()`, `.dispose()`, ou `using`.
 */
export class FontHandle {
  #ctx: Pointer | null;

  /** @internal */
  constructor(rawCtx: Pointer) {
    this.#ctx = rawCtx;
  }

  #guard(): Pointer {
    if (this.#ctx === null) throw new Error("FontHandle: déjà libéré");
    return this.#ctx;
  }

  /**
   * Rend une chaîne UTF-8 avec la police du jeu → octets PNG RGBA8 (fond transparent).
   *
   * Le PNG fait la hauteur d'une cellule (`cell_height`, 71 px) et la largeur de
   * l'avance totale du texte. Les points de code absents de la police sont ignorés.
   *
   * @param text  - chaîne à rendre
   * @param color - teinte RGBA `[R, G, B, A]` (défaut : blanc opaque)
   * @returns octets PNG, ou `null` si le texte ne produit aucun glyphe
   */
  renderText(text: string, color: RgbaColor = WHITE): Uint8Array | null {
    const ctx = this.#guard();
    const textBuf = cstr(text);
    const [r, g, b, a] = color;
    return callOut((outPtr) => {
      native().nie_font_render_text_out(ctx, textBuf, r, g, b, a, outPtr);
    });
  }

  /** Libère le contexte de police Rust. Idempotent. */
  free(): void {
    if (this.#ctx === null) return;
    native().nie_font_free(this.#ctx);
    this.#ctx = null;
  }

  [Symbol.dispose](): void { this.free(); }
}

/**
 * Monte le VFS depuis le répertoire contenant `cpk_list.cfg.bin`.
 * Retourne un VfsHandle ou `null` si le montage échoue.
 */
export function vfsOpen(gameDataDir: string): VfsHandle | null {
  const dirBuf = cstr(gameDataDir);
  const handle = native().nie_vfs_open(dirBuf) as Pointer | null;
  if (handle === null) return null;
  return new VfsHandle(handle);
}
