/**
 * Ce que ce test protège : l'affirmation « ce module exige les exceptions WebAssembly ».
 *
 * Elle n'est pas tirée d'un tableau de compatibilité — elle est LUE dans l'artefact servi. Si un
 * futur réglage de compilation retire la section `tag`, la contrainte documentée cesse d'être
 * vraie et ce test le dit ; si elle reste, la détection doit continuer de la reconnaître.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { initSync } from "../wasm/nie_wasm.js";
import { catalogue, crc32, wasmExceptionsAvailable } from "./lua-runtime";

// `crc32` est maintenant celui du module (`nie_formats::cfgbin::crc32`), pas une boucle écrite
// ici : il faut donc charger le module pour l'éprouver. C'est le même artefact que la page
// télécharge, donc ce test passe par le chemin réel plutôt que par une copie.
initSync({ module: readFileSync(new URL("../../public/static/game/nie_wasm_bg.wasm", import.meta.url)) });

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
	test("connaît le champ `missing` — sinon il est plus vieux que le code qui le lit", () => {
		// Rien dans le build n'impose de reconstruire ce module quand un type Rust qui le
		// traverse change : il vit hors de la chaîne `bun run build` parce qu'il exige emsdk.
		// Le nom du champ sérialisé est dans ses données ; s'il en est absent, l'artefact
		// précède `ReplayOutput::missing` et le navigateur ne rapporterait jamais un manque.
		// Le test est DIRECTIONNEL : la présence ne prouve pas la fraîcheur, l'absence prouve
		// l'obsolescence.
		const octets = readFileSync(MODULE);
		expect(octets.includes(Buffer.from("missing"))).toBe(true);
	});

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

describe("la visibilité par exemplaire", () => {
	test("la clé d'un exemplaire joint l'objet ET son rang", () => {
		// C'est le contrat que `LayoutCanvas` interroge : `${crc32(nom)}:${instance}`. Le
		// vérifier ici évite qu'un des deux côtés change de forme sans l'autre.
		const id = crc32("team14_01_chara_bank_list");
		expect(`${id}:0`).toBe("449417347:0");
		expect(`${id}:3`).toBe("449417347:3");
	});
});

describe("crc32", () => {
	test("rend la valeur de référence de la chaîne d'essai", () => {
		// Vecteur canonique du CRC-32 (IEEE 802.3) : « 123456789 » → 0xCBF43926.
		expect(crc32("123456789")).toBe(0xcbf43926);
		expect(crc32("")).toBe(0);
	});
});

describe("le catalogue de scripts", () => {
	test("lit toutes les pages — la route en rend 50 par défaut", async () => {
		// Mesuré le 2026-09-13 : `?q=chara_edit` annonce 51 scripts et en rend 50. Le rejeu d'un
		// écran de l'éditeur d'avatar tournait donc déjà sans l'un des siens, sans rien dire.
		const pagesDemandees: number[] = [];
		const origine = globalThis.fetch;
		globalThis.fetch = (async (url: string) => {
			const adresse = new URL(String(url), "http://x");
			if (!adresse.pathname.startsWith("/api/v1/lua/scripts")) return new Response("", { status: 404 });
			const page = Number(adresse.searchParams.get("page") ?? "1");
			pagesDemandees.push(page);
			return Response.json({
				elements: [{ chemin: `data/common/script/lua/menu/p${page}.lua.bin` }],
				pages: 4,
			});
		}) as unknown as typeof fetch;
		try {
			const chemins = await catalogue("q=chara_edit");
			expect([...new Set(pagesDemandees)].sort()).toEqual([1, 2, 3, 4]);
			expect(chemins).toHaveLength(4);
		} finally {
			globalThis.fetch = origine;
		}
	});
});

describe("le catalogue d'includes", () => {
	test("ne mémorise pas un échec pour toute la session", async () => {
		// `catalogue` ne LÈVE pas quand le réseau échoue : il rend une liste vide. Mémoriser
		// cette liste retirerait à chaque écran, jusqu'au rechargement de la page, les fonctions
		// que ses includes définissent — le défaut que `menu_host_gap.rs` mesure comme le plus
		// bloquant. Un `.catch()` ne l'attrapait pas, puisqu'il n'était jamais atteint.
		let tentatives = 0;
		const origine = globalThis.fetch;
		globalThis.fetch = (async (url: string) => {
			const adresse = new URL(String(url), "http://x");
			if (!adresse.pathname.startsWith("/api/v1/lua/scripts")) return new Response("", { status: 404 });
			tentatives += 1;
			// La première interrogation échoue, la seconde répond.
			if (tentatives === 1) return new Response("", { status: 503 });
			return Response.json({
				elements: [{ chemin: "data/common/script/lua/include/menu/main_menu_inc.lua.bin" }],
				pages: 1,
			});
		}) as unknown as typeof fetch;
		try {
			const { includePathsForTests } = await import("./lua-runtime");
			expect(await includePathsForTests()).toEqual([]);
			expect(await includePathsForTests()).toHaveLength(1);
		} finally {
			globalThis.fetch = origine;
		}
	});
});

describe("resolveMenuVisibility", () => {
	test("dit POURQUOI elle ne rend rien, au lieu d'une table vide muette", async () => {
		// Sans VM, toutes les sorties anticipées rendaient la même table vide : « rien ne
		// manque » et « le rejeu n'a pas eu lieu » étaient indiscernables. Ce moteur de test ne
		// charge pas le module, donc c'est la première raison qui sort — et c'en est une.
		const origine = globalThis.fetch;
		globalThis.fetch = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
		try {
			const { resolveMenuVisibility } = await import("./lua-runtime");
			const resolu = await resolveMenuVisibility("chara_bank_menu");
			expect(resolu.complete).toBe(false);
			expect(resolu.missing).toHaveLength(1);
			expect(resolu.missing[0]).toContain("VM Lua indisponible");
		} finally {
			globalThis.fetch = origine;
		}
	});
});
