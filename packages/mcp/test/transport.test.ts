/**
 * Transports : sémantique HTTP exacte de la révision 2026-07-28, et cadrage
 * des messages sur stdio.
 *
 * On teste le gestionnaire `fetch` directement (aucun port ouvert) sauf pour
 * un aller-retour réel sur `Bun.serve`, qui vérifie que la mécanique tient
 * aussi sur une vraie socket.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { ErrorCode } from "../src/protocol/json-rpc.ts";
import { structured, text } from "../src/protocol/types.ts";
import { MODERN_PROTOCOL_VERSION } from "../src/protocol/versions.ts";
import { McpRegistry, defineTool } from "../src/registry.ts";
import { McpServer } from "../src/server.ts";
import { createFetchHandler, createHttpTransport, decodeHeaderValue } from "../src/transport/http.ts";
import { runStdioTransport } from "../src/transport/stdio.ts";

const ENDPOINT = "http://mcp.test/mcp";

/**
 * `bun test` lancé depuis la racine précharge happy-dom (cf. `bunfig.toml`),
 * qui remplace `Request`/`Response` par des implémentations conformes à la
 * spec **navigateur** : elles suppriment les en-têtes interdits comme
 * `Origin`, et `Bun.serve` refuse leur `Response`. Les deux tests qui en
 * dépendent n'ont de sens que sur les primitives natives ; ailleurs on les
 * ignore explicitement plutôt que de les faire échouer.
 */
const PRIMITIVES_NATIVES =
	new Request("http://exemple.test/", { headers: { origin: "http://autre.test" } }).headers.get("origin") !== null;

function buildServer(): McpServer {
	const registry = new McpRegistry();
	registry.addTool(
		defineTool({
			name: "echo",
			description: "Renvoie le texte reçu.",
			inputSchema: z.object({ value: z.string() }),
			handler: ({ value }) => structured({ value }),
		}),
	);
	registry.addTool(
		defineTool({
			name: "lent",
			description: "Émet deux progressions.",
			inputSchema: z.object({}),
			handler: (_args, context) => {
				context.progress(1, 2);
				context.progress(2, 2);
				return { content: [text("terminé")] };
			},
		}),
	);
	return new McpServer({ serverInfo: { name: "test", version: "0.0.1" }, registry });
}

function modernBody(method: string, params: Record<string, unknown> = {}, id: number | string = 1) {
	return JSON.stringify({
		jsonrpc: "2.0",
		id,
		method,
		params: {
			...params,
			_meta: {
				"io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION,
				"io.modelcontextprotocol/clientCapabilities": {},
				"io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
				...(params._meta as Record<string, unknown> | undefined),
			},
		},
	});
}

function modernHeaders(method: string, name?: string): Record<string, string> {
	const headers: Record<string, string> = {
		"content-type": "application/json",
		accept: "application/json, text/event-stream",
		"mcp-protocol-version": MODERN_PROTOCOL_VERSION,
		"mcp-method": method,
	};
	if (name) headers["mcp-name"] = name;
	return headers;
}

describe("Streamable HTTP — ère moderne", () => {
	const handler = createFetchHandler({ server: buildServer() });

	test("une requête conforme renvoie du JSON", async () => {
		const response = await handler(
			new Request(ENDPOINT, { method: "POST", headers: modernHeaders("tools/list"), body: modernBody("tools/list") }),
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/json");
		const body = (await response.json()) as { result: { tools: unknown[] } };
		expect(body.result.tools).toHaveLength(2);
	});

	test("`MCP-Protocol-Version` absent sur une requête moderne → -32020", async () => {
		const headers = modernHeaders("tools/list");
		delete headers["mcp-protocol-version"];
		const response = await handler(new Request(ENDPOINT, { method: "POST", headers, body: modernBody("tools/list") }));
		expect(response.status).toBe(400);
		expect(((await response.json()) as { error: { code: number } }).error.code).toBe(ErrorCode.HeaderMismatch);
	});

	test("`Mcp-Method` divergent du corps → -32020", async () => {
		const response = await handler(
			new Request(ENDPOINT, { method: "POST", headers: modernHeaders("prompts/list"), body: modernBody("tools/list") }),
		);
		expect(response.status).toBe(400);
		expect(((await response.json()) as { error: { code: number } }).error.code).toBe(ErrorCode.HeaderMismatch);
	});

	test("`Mcp-Name` requis et vérifié sur tools/call", async () => {
		const sans = await handler(
			new Request(ENDPOINT, {
				method: "POST",
				headers: modernHeaders("tools/call"),
				body: modernBody("tools/call", { name: "echo", arguments: { value: "x" } }),
			}),
		);
		expect(sans.status).toBe(400);

		const bon = await handler(
			new Request(ENDPOINT, {
				method: "POST",
				headers: modernHeaders("tools/call", "echo"),
				body: modernBody("tools/call", { name: "echo", arguments: { value: "x" } }),
			}),
		);
		expect(bon.status).toBe(200);
	});

	test("la sentinelle Base64 des en-têtes est décodée avant comparaison", () => {
		const encoded = `=?base64?${Buffer.from("Hello, 世界", "utf8").toString("base64")}?=`;
		expect(decodeHeaderValue(encoded)).toBe("Hello, 世界");
		expect(decodeHeaderValue("us-west1")).toBe("us-west1");
	});

	test("une version inconnue → -32022 avec la liste supportée", async () => {
		const headers = modernHeaders("tools/list");
		headers["mcp-protocol-version"] = "2099-01-01";
		const body = JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/list",
			params: {
				_meta: {
					"io.modelcontextprotocol/protocolVersion": "2099-01-01",
					"io.modelcontextprotocol/clientCapabilities": {},
				},
			},
		});
		const response = await handler(new Request(ENDPOINT, { method: "POST", headers, body }));
		expect(response.status).toBe(400);
		const payload = (await response.json()) as { error: { code: number; data: { supported: string[] } } };
		expect(payload.error.code).toBe(ErrorCode.UnsupportedProtocolVersion);
		expect(payload.error.data.supported).toContain(MODERN_PROTOCOL_VERSION);
	});

	test("`_meta` incomplet → -32602 en 400", async () => {
		const response = await handler(
			new Request(ENDPOINT, {
				method: "POST",
				headers: modernHeaders("tools/list"),
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/list",
					params: { _meta: { "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION } },
				}),
			}),
		);
		expect(response.status).toBe(400);
		expect(((await response.json()) as { error: { code: number } }).error.code).toBe(ErrorCode.InvalidParams);
	});

	test("une notification renvoie 202 sans corps", async () => {
		const response = await handler(
			new Request(ENDPOINT, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
			}),
		);
		expect(response.status).toBe(202);
		expect(await response.text()).toBe("");
	});

	test("GET et DELETE répondent 405 (mécanismes retirés en 2026-07-28)", async () => {
		for (const method of ["GET", "DELETE"] as const) {
			const response = await handler(new Request(ENDPOINT, { method }));
			expect(response.status).toBe(405);
			expect(response.headers.get("allow")).toContain("POST");
		}
	});

	test("les lots JSON-RPC sont refusés", async () => {
		const response = await handler(
			new Request(ENDPOINT, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "ping" }]),
			}),
		);
		expect(response.status).toBe(400);
	});

	test("un progressToken déclenche une réponse SSE", async () => {
		const response = await handler(
			new Request(ENDPOINT, {
				method: "POST",
				headers: modernHeaders("tools/call", "lent"),
				body: modernBody("tools/call", {
					name: "lent",
					arguments: {},
					_meta: { progressToken: "p1" },
				}),
			}),
		);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		expect(response.headers.get("x-accel-buffering")).toBe("no");
		const body = await response.text();
		const events = body
			.split("\n\n")
			.filter(Boolean)
			.map((chunk) => JSON.parse(chunk.split("data: ")[1] ?? "{}"));
		expect(events.filter((event) => event.method === "notifications/progress")).toHaveLength(2);
		expect(events.at(-1)).toHaveProperty("result");
	});
});

describe("Streamable HTTP — ère legacy", () => {
	const handler = createFetchHandler({ server: buildServer() });

	test("initialize fonctionne sans métadonnées per-requête", async () => {
		const response = await handler(
			new Request(ENDPOINT, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "initialize",
					params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code" } },
				}),
			}),
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { result: { protocolVersion: string } };
		expect(body.result.protocolVersion).toBe("2025-06-18");
	});

	test("un appel d'outil legacy n'exige aucun en-tête miroir", async () => {
		const response = await handler(
			new Request(ENDPOINT, {
				method: "POST",
				headers: { "content-type": "application/json", "mcp-protocol-version": "2025-06-18" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: { name: "echo", arguments: { value: "salut" } },
				}),
			}),
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { result: { structuredContent: { value: string } } };
		expect(body.result.structuredContent.value).toBe("salut");
	});

	test("un en-tête de session d'une ancienne révision est ignoré, pas réémis", async () => {
		const response = await handler(
			new Request(ENDPOINT, {
				method: "POST",
				headers: { "content-type": "application/json", "mcp-session-id": "abc", "last-event-id": "3" },
				body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping", params: {} }),
			}),
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("mcp-session-id")).toBeNull();
	});
});

describe("sécurité du transport", () => {
	test.skipIf(!PRIMITIVES_NATIVES)("une origine non autorisée est refusée en 403", async () => {
		const handler = createFetchHandler({ server: buildServer(), allowedOrigins: ["https://ok.example"] });
		const refus = await handler(
			new Request(ENDPOINT, {
				method: "POST",
				headers: { "content-type": "application/json", origin: "https://pirate.example" },
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
			}),
		);
		expect(refus.status).toBe(403);

		const accepte = await handler(
			new Request(ENDPOINT, {
				method: "POST",
				headers: { "content-type": "application/json", origin: "https://ok.example" },
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
			}),
		);
		expect(accepte.status).toBe(200);
	});

	test.skipIf(!PRIMITIVES_NATIVES)("la boucle locale reste autorisée par défaut", async () => {
		const handler = createFetchHandler({ server: buildServer() });
		const response = await handler(
			new Request(ENDPOINT, {
				method: "POST",
				headers: { "content-type": "application/json", origin: "http://localhost:6274" },
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
			}),
		);
		expect(response.status).toBe(200);
	});

	test("le jeton porteur est exigé et vérifié", async () => {
		const handler = createFetchHandler({ server: buildServer(), tokens: ["secret-123"] });
		const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });

		const sans = await handler(
			new Request(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body }),
		);
		expect(sans.status).toBe(401);
		expect(sans.headers.get("www-authenticate")).toContain("Bearer");

		const mauvais = await handler(
			new Request(ENDPOINT, {
				method: "POST",
				headers: { "content-type": "application/json", authorization: "Bearer autre" },
				body,
			}),
		);
		expect(mauvais.status).toBe(401);

		const bon = await handler(
			new Request(ENDPOINT, {
				method: "POST",
				headers: { "content-type": "application/json", authorization: "Bearer secret-123" },
				body,
			}),
		);
		expect(bon.status).toBe(200);
	});
});

describe("serveur réel sur Bun.serve", () => {
	test.skipIf(!PRIMITIVES_NATIVES)("aller-retour complet sur une socket", async () => {
		const transport = createHttpTransport({ server: buildServer(), port: 0, hostname: "127.0.0.1" });
		try {
			const response = await fetch(transport.url, {
				method: "POST",
				headers: modernHeaders("tools/call", "echo"),
				body: modernBody("tools/call", { name: "echo", arguments: { value: "réseau" } }),
			});
			expect(response.status).toBe(200);
			const payload = (await response.json()) as { result: { structuredContent: { value: string } } };
			expect(payload.result.structuredContent.value).toBe("réseau");

			const health = await fetch(`http://${transport.hostname}:${transport.port}/health`);
			expect(((await health.json()) as { ok: boolean }).ok).toBe(true);
		} finally {
			await transport.stop(true);
		}
	});
});

describe("stdio", () => {
	test("un message par ligne, réponse par ligne", async () => {
		const lines: string[] = [];
		const input = new ReadableStream<Uint8Array>({
			start(controller) {
				const encoder = new TextEncoder();
				controller.enqueue(
					encoder.encode(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: {} })}\n`),
				);
				// Message coupé en deux morceaux : le cadrage doit recoller.
				const second = JSON.stringify({
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: { name: "echo", arguments: { value: "flux" } },
				});
				controller.enqueue(encoder.encode(second.slice(0, 20)));
				controller.enqueue(encoder.encode(`${second.slice(20)}\n`));
				controller.close();
			},
		});

		await runStdioTransport({
			server: buildServer(),
			input,
			write: (line) => {
				lines.push(line);
			},
			onLog: () => {},
		});

		expect(lines).toHaveLength(2);
		const second = JSON.parse(lines[1] ?? "{}") as { result: { structuredContent: { value: string } } };
		expect(second.result.structuredContent.value).toBe("flux");
	});

	test("une ligne illisible produit une erreur d'analyse, pas un plantage", async () => {
		const lines: string[] = [];
		const input = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode("ceci n'est pas du JSON\n"));
				controller.close();
			},
		});
		await runStdioTransport({ server: buildServer(), input, write: (line) => void lines.push(line), onLog: () => {} });
		expect(JSON.parse(lines[0] ?? "{}").error.code).toBe(ErrorCode.ParseError);
	});
});
