/// <reference types="bun" />
/**
 * Vérifie la partie du flux OAuth VRoid Hub qui ne dépend pas du réseau :
 * la dérivation PKCE et la construction de l'URL d'autorisation.
 *
 * Le vecteur de test est celui de l'annexe B de la RFC 7636 — la même
 * référence normative que VRoid Hub cite pour `code_verifier`.
 */
import { describe, expect, test } from "bun:test";
import type { ConfigVroid } from "./constantes";
import { base64url, genererCodeChallenge, genererCodeVerifier, genererState, urlAutorisation } from "./oauth";

/** Configuration factice : aucun secret réel n'entre dans un test. */
const CONFIG: ConfigVroid = {
	applicationId: "identifiant-de-test",
	secret: "secret-de-test",
	redirectUri: "https://azalee.rosegriffon.fr/",
	scope: "heart default",
};

describe("base64url", () => {
	test("encode sans remplissage ni caractère non sûr en URL", () => {
		// 0xFB 0xFF force les deux caractères que base64 standard écrit `+` et `/`.
		expect(base64url(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
		expect(base64url(new Uint8Array([1]))).not.toContain("=");
	});
});

describe("code_verifier", () => {
	test("respecte les bornes de longueur de la RFC 7636", () => {
		expect(genererCodeVerifier().length).toBe(64);
		expect(genererCodeVerifier(43).length).toBe(43);
		expect(genererCodeVerifier(128).length).toBe(128);
		expect(() => genererCodeVerifier(42)).toThrow(RangeError);
		expect(() => genererCodeVerifier(129)).toThrow(RangeError);
	});

	test("n'emploie que l'alphabet `unreserved`", () => {
		expect(genererCodeVerifier(128)).toMatch(/^[A-Za-z0-9\-._~]{128}$/);
	});

	test("ne se répète pas d'un tirage à l'autre", () => {
		expect(genererCodeVerifier()).not.toBe(genererCodeVerifier());
	});
});

describe("code_challenge", () => {
	test("reproduit le vecteur de l'annexe B de la RFC 7636", async () => {
		const challenge = await genererCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
		expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
	});

	test("est déterministe pour un même verifier", async () => {
		const verifier = genererCodeVerifier();
		expect(await genererCodeChallenge(verifier)).toBe(await genererCodeChallenge(verifier));
	});
});

describe("urlAutorisation", () => {
	test("porte tous les paramètres exigés par VRoid Hub", () => {
		const url = new URL(urlAutorisation(CONFIG, "un-state", "un-challenge"));

		expect(url.origin).toBe("https://hub.vroid.com");
		expect(url.pathname).toBe("/oauth/authorize");
		expect(url.searchParams.get("response_type")).toBe("code");
		expect(url.searchParams.get("client_id")).toBe(CONFIG.applicationId);
		expect(url.searchParams.get("redirect_uri")).toBe(CONFIG.redirectUri);
		expect(url.searchParams.get("scope")).toBe("heart default");
		expect(url.searchParams.get("state")).toBe("un-state");
		expect(url.searchParams.get("code_challenge")).toBe("un-challenge");
		// VRoid Hub n'accepte que S256 : `plain` serait rejeté.
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
	});

	test("ne laisse jamais fuiter le secret client dans l'URL", () => {
		expect(urlAutorisation(CONFIG, genererState(), "c")).not.toContain(CONFIG.secret);
	});
});
