/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

// Charger les proxies depuis la variable d'environnement PROXIES (format: "http://proxy1:port,http://proxy2:port")
const PROXIES_ENV = process.env.PROXIES || "";
const PROXIES_LIST = PROXIES_ENV.split(",")
	.map((p) => p.trim())
	.filter(Boolean);

let currentProxyIndex = 0;

/**
 * Récupère le prochain proxy disponible (round-robin).
 */
export function getNextProxy(): string | null {
	if (PROXIES_LIST.length === 0) {
		return null;
	}
	const proxy = PROXIES_LIST[currentProxyIndex];
	currentProxyIndex = (currentProxyIndex + 1) % PROXIES_LIST.length;
	return proxy || null;
}

/**
 * Configure les variables d'environnement système pour utiliser un proxy.
 */
export function applyProxy(proxyUrl: string): void {
	process.env.HTTP_PROXY = proxyUrl;
	process.env.HTTPS_PROXY = proxyUrl;
	console.log(`[Proxy Rotator] Utilisation du proxy : ${proxyUrl}`);
}

/**
 * Efface les variables d'environnement système liées aux proxies.
 */
export function clearProxy(): void {
	delete process.env.HTTP_PROXY;
	delete process.env.HTTPS_PROXY;
	console.log("[Proxy Rotator] Proxy désactivé.");
}

/**
 * Exécute une fonction asynchrone avec un proxy configuré.
 * En cas d'erreur de connexion/réseau, tente avec le proxy suivant (rotation automatique).
 */
export async function withProxyRotation<T>(fn: () => Promise<T>): Promise<T> {
	if (PROXIES_LIST.length === 0) {
		return fn();
	}

	const maxRetries = Math.min(3, PROXIES_LIST.length);
	let lastError: unknown;

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		const proxy = getNextProxy();
		if (!proxy) {
			return fn();
		}

		applyProxy(proxy);
		try {
			return await fn();
		} catch (error) {
			lastError = error;
			console.warn(`[Proxy Rotator] Échec avec le proxy ${proxy} :`, error);
			console.warn(`[Proxy Rotator] Tentative ${attempt + 1}/${maxRetries} échouée. Rotation vers le proxy suivant...`);
		} finally {
			clearProxy();
		}
	}

	throw lastError || new Error("Proxy rotation failed after maximum retries");
}
