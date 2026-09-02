/**
 * Tests du découpage multipart du service Storage.
 *
 * Le cas critique est celui de `@supabase/storage-js`, qui envoie la partie
 * fichier avec un `name` ET un `filename` VIDES : `Request.formData()` la rend
 * alors comme une chaîne, ce qui corromprait tout binaire au décodage UTF-8.
 * Ces tests figent le comportement du découpage sur octets bruts.
 */
import { describe, expect, test } from "bun:test";

import { boundaryOf, extractFilePart, indexOfBytes } from "./multipart";

const BOUNDARY = "----WebKitFormBoundary982ae4f8572143738f2dd2897d7a9143";

/** Reconstruit un corps multipart à partir de parties textuelles et binaires. */
function corpsMultipart(contenu: Uint8Array, mime = "text/plain;charset=utf-8"): Uint8Array {
	const encoder = new TextEncoder();
	const entete = encoder.encode(
		`--${BOUNDARY}\r\n` +
			`Content-Disposition: form-data; name="cacheControl"\r\n\r\n` +
			`3600\r\n` +
			`--${BOUNDARY}\r\n` +
			`Content-Disposition: form-data; name=""; filename=""\r\n` +
			`Content-Type: ${mime}\r\n\r\n`
	);
	const pied = encoder.encode(`\r\n--${BOUNDARY}--\r\n`);
	const total = new Uint8Array(entete.length + contenu.length + pied.length);
	total.set(entete, 0);
	total.set(contenu, entete.length);
	total.set(pied, entete.length + contenu.length);
	return total;
}

describe("boundaryOf", () => {
	test("lit une frontière nue", () => {
		expect(boundaryOf(`multipart/form-data; boundary=${BOUNDARY}`)).toBe(BOUNDARY);
	});

	test("lit une frontière entre guillemets", () => {
		expect(boundaryOf(`multipart/form-data; boundary="abc; def"`)).toBe("abc; def");
	});

	test("renvoie null sans frontière", () => {
		expect(boundaryOf("application/json")).toBeNull();
	});
});

describe("indexOfBytes", () => {
	test("trouve un motif et respecte le décalage de départ", () => {
		const source = new Uint8Array([1, 2, 3, 4, 2, 3]);
		expect(indexOfBytes(source, new Uint8Array([2, 3]))).toBe(1);
		expect(indexOfBytes(source, new Uint8Array([2, 3]), 2)).toBe(4);
		expect(indexOfBytes(source, new Uint8Array([9]))).toBe(-1);
	});
});

describe("extractFilePart", () => {
	test("extrait la partie fichier alors que name et filename sont vides", () => {
		const attendu = new TextEncoder().encode("bonjour");
		const part = extractFilePart(corpsMultipart(attendu), BOUNDARY);
		expect(part).not.toBeNull();
		expect(new TextDecoder().decode(part?.bytes)).toBe("bonjour");
		expect(part?.mime).toBe("text/plain;charset=utf-8");
	});

	test("préserve les octets binaires à l'identique", () => {
		// Contenu couvrant toute la plage d'octets, y compris ceux qu'un décodage
		// UTF-8 remplacerait par U+FFFD.
		const binaire = new Uint8Array(512);
		for (let i = 0; i < binaire.length; i++) binaire[i] = i % 256;

		const part = extractFilePart(corpsMultipart(binaire, "image/webp"), BOUNDARY);
		expect(part?.mime).toBe("image/webp");
		expect(part?.bytes.length).toBe(binaire.length);
		expect(Array.from(part?.bytes ?? [])).toEqual(Array.from(binaire));
	});

	test("gère un contenu vide", () => {
		const part = extractFilePart(corpsMultipart(new Uint8Array(0)), BOUNDARY);
		expect(part?.bytes.length).toBe(0);
	});

	test("renvoie null quand aucune partie ne porte de filename", () => {
		const corps = new TextEncoder().encode(
			`--${BOUNDARY}\r\nContent-Disposition: form-data; name="cacheControl"\r\n\r\n3600\r\n--${BOUNDARY}--\r\n`
		);
		expect(extractFilePart(corps, BOUNDARY)).toBeNull();
	});

	test("renvoie null sur un corps tronqué", () => {
		const corps = new TextEncoder().encode(`--${BOUNDARY}\r\nContent-Disposition: form-data`);
		expect(extractFilePart(corps, BOUNDARY)).toBeNull();
	});
});
