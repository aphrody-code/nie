/**
 * Routeur de backends natifs — **le point unique** où TypeScript choisit entre les deux
 * bibliothèques natives du dépôt.
 *
 * | Backend | Bibliothèque | Autorité |
 * |---|---|---|
 * | `rust` | `nie_ffi` (crates/engine/nie-ffi) | décodage **byte-exact**, VFS, polices, CRand |
 * | `cpp`  | `iecode_ffi` (src/ffi) | conversion de texture native (DirectXTex/WebP), compression Level-5 complète, base de données de jeu |
 *
 * Règle de routage (cf. `docs/ARCHITECTURE-POLYGLOTTE.md`) : **Rust d'abord** — c'est lui
 * qu'ancrent les tests golden. Le C++ n'est appelé que pour ce que le Rust ne fait pas, ou
 * quand l'appelant le demande explicitement.
 *
 * Le backend C++ est chargé **paresseusement** : sa bibliothèque n'est pas construite sur
 * toutes les machines (elle demande vcpkg), et un `dlopen` raté au niveau module ferait
 * échouer n'importe quelle commande `bun` du dépôt via le préchargement `bunfig.toml`.
 */

/** Module du backend C++, tel qu'exposé par `./iecode.ts`. */
export type IecodeModule = typeof import("./iecode.ts")

let _cpp: IecodeModule | null | undefined
let _cppError: string | undefined

/**
 * Charge le backend C++ si sa bibliothèque est présente, sinon `null` (jamais d'exception).
 * Le résultat est mémoïsé — l'échec aussi, pour ne pas retenter un `dlopen` par appel.
 */
export async function loadIecode(): Promise<IecodeModule | null> {
	if (_cpp !== undefined) return _cpp
	try {
		_cpp = (await import("./iecode.ts")) as IecodeModule
	} catch (e) {
		_cppError = e instanceof Error ? e.message : String(e)
		_cpp = null
	}
	return _cpp
}

/** Backends disponibles sur cette machine, avec le motif d'indisponibilité le cas échéant. */
export interface Capabilities {
	/** `nie_ffi` — toujours requis : le paquet ne se charge pas sans lui. */
	rust: true
	/** `iecode_ffi` — présent seulement si l'arbre C++ a été construit. */
	cpp: boolean
	/** Message d'erreur du dernier chargement C++ raté (diagnostic). */
	cppError?: string
	/** Chemin de la bibliothèque C++ tentée. */
	cppPath?: string
}

/** Interroge les backends réellement chargeables ici. */
export async function capabilities(): Promise<Capabilities> {
	const cpp = await loadIecode()
	return {
		rust: true,
		cpp: cpp !== null,
		...(cpp === null && _cppError !== undefined ? { cppError: _cppError } : {}),
		...(cpp !== null ? { cppPath: cpp.LIB_PATH } : {}),
	}
}

/** Choix de backend d'une opération : `auto` suit la règle de routage. */
export type BackendChoice = "auto" | "rust" | "cpp"

/**
 * Encode une texture G4TX en WebP — **héritage C++, à porter**.
 *
 * La conversion de texture n'est pas un rôle C++ : Rust (byte-exact, wasm) et C# la font mieux.
 * Cette fonction ne subsiste que parce que l'encodeur WebP n'existe encore que dans
 * `iecode_ffi` (libwebp lié par CMake) — le Rust ne produit que du PNG (`decodeToPng`).
 * Dès que l'encodage WebP existe côté Rust ou C#, ce chemin disparaît.
 * Retourne `false` si le backend C++ manque.
 */
export async function g4txToWebp(data: Uint8Array, outPath: string, quality = 90): Promise<boolean> {
	const cpp = await loadIecode()
	if (!cpp) return false
	const tex = cpp.iecode.g4txParse(data)
	if (!tex) return false
	try {
		return tex.exportWebp(0, outPath, quality)
	} finally {
		tex.close()
	}
}

/**
 * Décompresse un flux Level-5 (méthodes 1/2/3/4/5 + InazumaLZSS) — **C++ d'abord**.
 *
 * `iecode_ffi` couvre le dispatcher complet (LZ10, Huffman 4/8, RLE, ZLib, LZ4, CRILAYLA) ;
 * le Rust n'expose que CRILAYLA via le VFS. Retourne `null` sans backend C++.
 */
export async function decompressLevel5(data: Uint8Array): Promise<Uint8Array | null> {
	const cpp = await loadIecode()
	if (!cpp) return null
	return cpp.iecode.decompress(data)
}
