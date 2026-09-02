/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

// Client Grok via flux OIDC (auth.x.ai) — utilisé pour la DÉCOUVERTE de comptes
// X / requêtes Inazuma Eleven à ingérer dans le RAG. On NE dépend PAS de
// XAI_API_KEY (metered, sans crédit → 403). À la place :
//   1. lire ~/.grok/auth.json (clé unique "https://auth.x.ai::<uuid>")
//      → refresh_token / oidc_issuer / oidc_client_id
//   2. POST {issuer}/oauth2/token (grant_type=refresh_token) → access_token (JWT)
//   3. POST https://api.x.ai/v1/chat/completions (OpenAI-compat, model grok-4.3)
//
// SÉCURITÉ : on ne logge JAMAIS le refresh_token ni l'access_token.

import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface GrokAuthEntry {
	refresh_token?: string;
	oidc_issuer?: string;
	oidc_client_id?: string;
}

interface GrokCreds {
	refreshToken: string;
	issuer: string;
	clientId: string;
}

const GROK_MODEL = "grok-4.3";

// Le grok CLI utilise des refresh tokens ROTATIFS : chaque échange invalide le
// précédent, et le CLI sauvegarde l'ancien dans auth.json.corrupt.<ts>. Le
// refresh_token courant peut donc être révoqué tandis qu'un backup reste valide.
// On collecte tous les candidats (auth.json + corrupt.*) et on tente chacun.
function grokAuthCandidates(): string[] {
	const dir = join(homedir(), ".grok");
	const out: string[] = [join(dir, "auth.json")];
	try {
		const extra = readdirSync(dir)
			.filter((f) => f.startsWith("auth.json.corrupt."))
			.sort()
			.reverse() // plus récent d'abord
			.map((f) => join(dir, f));
		out.push(...extra);
	} catch {
		/* dir absent */
	}
	return out;
}

async function readCreds(path: string): Promise<GrokCreds | null> {
	const file = Bun.file(path);
	if (!(await file.exists())) return null;
	try {
		const raw = (await file.json()) as Record<string, GrokAuthEntry>;
		for (const [key, entry] of Object.entries(raw)) {
			if (!key.startsWith("https://auth.x.ai")) continue;
			if (entry.refresh_token && entry.oidc_issuer && entry.oidc_client_id) {
				return {
					refreshToken: entry.refresh_token,
					issuer: entry.oidc_issuer,
					clientId: entry.oidc_client_id,
				};
			}
		}
	} catch {
		/* json corrompu */
	}
	return null;
}

async function exchange(creds: GrokCreds): Promise<string | null> {
	const body = new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: creds.refreshToken,
		client_id: creds.clientId,
	});
	const res = await fetch(`${creds.issuer.replace(/\/$/, "")}/oauth2/token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: body.toString(),
	});
	if (!res.ok) return null;
	const json = (await res.json()) as { access_token?: string };
	return json.access_token ?? null;
}

// Cache de l'access_token au sein d'un run : le refresh est rotatif, on évite
// de le re-consommer à chaque message (sinon on révoque le token valide).
let cachedAccessToken: string | null = null;

/** Échange un refresh_token (parmi les candidats) contre un access_token (JWT). */
async function getAccessToken(): Promise<string | null> {
	if (cachedAccessToken) return cachedAccessToken;
	for (const path of grokAuthCandidates()) {
		const creds = await readCreds(path);
		if (!creds) continue;
		const token = await exchange(creds);
		if (token) {
			cachedAccessToken = token;
			return token;
		}
	}
	console.warn("[Grok OIDC] aucun refresh_token valide (tous révoqués/expirés).");
	return null;
}

export interface GrokChatResult {
	ok: boolean;
	content: string;
	status?: number;
}

/** Envoie un prompt à Grok (OpenAI-compat). Renvoie le contenu texte. */
export async function grokChat(
	prompt: string,
	opts: { system?: string; temperature?: number; maxTokens?: number } = {}
): Promise<GrokChatResult> {
	const token = await getAccessToken();
	if (!token) return { ok: false, content: "no-token" };

	const messages: { role: string; content: string }[] = [];
	if (opts.system) messages.push({ role: "system", content: opts.system });
	messages.push({ role: "user", content: prompt });

	const res = await fetch("https://api.x.ai/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			model: GROK_MODEL,
			messages,
			temperature: opts.temperature ?? 0.2,
			max_tokens: opts.maxTokens ?? 2000,
		}),
	});
	if (!res.ok) {
		const txt = await res.text().catch(() => "");
		return { ok: false, content: txt.slice(0, 300), status: res.status };
	}
	const json = (await res.json()) as {
		choices?: { message?: { content?: string } }[];
	};
	const content = json.choices?.[0]?.message?.content ?? "";
	return { ok: true, content, status: 200 };
}

/** Smoke test : ping minimal pour vérifier le flux OIDC de bout en bout. */
export async function grokPing(): Promise<GrokChatResult> {
	return grokChat("Réponds exactement: PONG", { maxTokens: 10 });
}

if (import.meta.main) {
	const res = await grokPing();
	console.log(`[Grok OIDC] ok=${res.ok} status=${res.status ?? "n/a"} content=${JSON.stringify(res.content)}`);
	process.exit(res.ok ? 0 : 1);
}
