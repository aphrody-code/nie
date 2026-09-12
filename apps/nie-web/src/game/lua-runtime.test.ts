/**
 * Ce que ce test protège : l'affirmation « ce module exige les exceptions WebAssembly ».
 *
 * Elle n'est pas tirée d'un tableau de compatibilité — elle est LUE dans l'artefact servi. Si un
 * futur réglage de compilation retire la section `tag`, la contrainte documentée cesse d'être
 * vraie et ce test le dit ; si elle reste, la détection doit continuer de la reconnaître.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { crc32, wasmExceptionsAvailable } from "./lua-runtime";

/** L'artefact que la page télécharge, tel qu'il est publié. */
const MODULE = new URL("../../public/static/game/nie_lua_web.wasm", import.meta.url);

/** Les identifiants de section d'un module, dans l'ordre. */
function sections(bytes: Uint8Array): number[] {
	expect([...bytes.subarray(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]);
	const ids: number[] = [];
	let offset = 8;
	while (offset < bytes.length) {
		ids.push(bytes[offset]);
		offset += 1;
		let size = 0;
		let shift = 0;
		for (;;) {
			const byte = bytes[offset];
			offset += 1;
			size |= (byte & 0x7f) << shift;
			shift += 7;
			if ((byte & 0x80) === 0) break;
		}
		offset += size;
	}
	return ids;
}

describe("le module de la VM Lua", () => {
	test("déclare une section `tag` — il EXIGE donc les exceptions WebAssembly", () => {
		const bytes = new Uint8Array(readFileSync(MODULE));
		// 13 = `tag`, la section que seule la proposition « exception handling » définit. Elle
		// vient de `-sSUPPORT_LONGJMP=wasm`, le mode par lequel Lua remonte ses erreurs.
		expect(sections(bytes)).toContain(13);
	});
});

describe("wasmExceptionsAvailable", () => {
	test("reconnaît un moteur qui valide un module à section `tag`", () => {
		// Ce moteur-ci les implémente : la détection doit donc être positive, sinon elle
		// refuserait la VM là où elle fonctionne.
		expect(wasmExceptionsAvailable()).toBe(true);
	});

	test("ne jette jamais, même si WebAssembly est absent", () => {
		const origine = globalThis.WebAssembly;
		// @ts-expect-error — on retire volontairement l'objet global pour éprouver le garde-fou.
		delete globalThis.WebAssembly;
		try {
			expect(wasmExceptionsAvailable()).toBe(false);
		} finally {
			globalThis.WebAssembly = origine;
		}
	});
});

describe("crc32", () => {
	test("rend la valeur de référence de la chaîne d'essai", () => {
		// Vecteur canonique du CRC-32 (IEEE 802.3) : « 123456789 » → 0xCBF43926.
		expect(crc32("123456789")).toBe(0xcbf43926);
		expect(crc32("")).toBe(0);
	});
});
