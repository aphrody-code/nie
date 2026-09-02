/**
 * Conformité au protocole : routage, erreurs, pagination, dual-era.
 *
 * Ces tests n'ouvrent aucun socket — ils appellent `McpServer.handle()`
 * directement, ce qui est précisément l'intérêt d'avoir isolé le noyau des
 * transports.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { ErrorCode, type JsonRpcResponse } from "../src/protocol/json-rpc.ts";
import { structured, text } from "../src/protocol/types.ts";
import {
	LEGACY_PROTOCOL_VERSIONS,
	MODERN_PROTOCOL_VERSION,
	SUPPORTED_PROTOCOL_VERSIONS,
	eraOf,
	isSupportedVersion,
	negotiateLegacyVersion,
} from "../src/protocol/versions.ts";
import { McpRegistry, defineTool, matchUriTemplate, toJsonSchema } from "../src/registry.ts";
import { McpServer } from "../src/server.ts";
import { legacyMeta, parseModernMeta } from "../src/protocol/meta.ts";

function buildServer(): McpServer {
	const registry = new McpRegistry();
	registry.addTool(
		defineTool({
			name: "echo",
			description: "Renvoie le texte reçu.",
			inputSchema: z.object({ value: z.string(), times: z.int().min(1).max(5).default(1) }),
			handler: ({ value, times }) => structured({ value: value.repeat(times) }),
		}),
	);
	registry.addTool(
		defineTool({
			name: "boom",
			description: "Échoue toujours.",
			inputSchema: z.object({}),
			handler: () => {
				throw new Error("panne simulée");
			},
		}),
	);
	registry.addTool(
		defineTool({
			name: "progressif",
			description: "Émet une progression.",
			inputSchema: z.object({}),
			handler: (_args, context) => {
				context.progress(1, 2, "moitié");
				context.log("info", "trace");
				return { content: [text("fini")] };
			},
		}),
	);
	registry.addResource({
		uri: "rg://test/fixe",
		name: "fixe",
		mimeType: "text/plain",
		read: () => ({ uri: "rg://test/fixe", text: "contenu" }),
	});
	registry.addTemplate({
		uriTemplate: "rg://test/{nom}",
		name: "gabarit",
		mimeType: "text/plain",
		read: (uri, variables) =>
			variables.nom === "connu" ? { uri, text: `valeur ${variables.nom}` } : undefined,
		complete: (variable, value) =>
			variable === "nom" ? ["connu", "autre"].filter((entry) => entry.startsWith(value)) : [],
	});
	registry.addPrompt({
		name: "salut",
		description: "Un prompt d'exemple.",
		arguments: [{ name: "qui", required: true }],
		build: (args) => ({ messages: [{ role: "user", content: text(`bonjour ${args.qui}`) }] }),
	});
	return new McpServer({
		serverInfo: { name: "test", version: "0.0.1" },
		instructions: "Serveur de test.",
		registry,
		pageSize: 2,
	});
}

const modernContext = {
	meta: parseModernMeta({
		_meta: {
			"io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION,
			"io.modelcontextprotocol/clientCapabilities": {},
		},
	}),
	signal: new AbortController().signal,
	emit: () => {},
};

const legacyContext = {
	meta: legacyMeta({}, "2025-06-18"),
	signal: new AbortController().signal,
	emit: () => {},
};

function ok(response: JsonRpcResponse | null): Record<string, unknown> {
	expect(response).not.toBeNull();
	expect(response).toHaveProperty("result");
	return (response as { result: Record<string, unknown> }).result;
}

function failure(response: JsonRpcResponse | null): { code: number; message: string } {
	expect(response).not.toBeNull();
	expect(response).toHaveProperty("error");
	return (response as { error: { code: number; message: string } }).error;
}

describe("versions", () => {
	test("la révision courante et les révisions à handshake sont annoncées", () => {
		expect(SUPPORTED_PROTOCOL_VERSIONS[0]).toBe(MODERN_PROTOCOL_VERSION);
		expect(SUPPORTED_PROTOCOL_VERSIONS).toContain("2025-06-18");
		expect(isSupportedVersion("2025-11-25")).toBe(true);
		expect(isSupportedVersion("2019-01-01")).toBe(false);
	});

	test("l'ère se déduit de la version", () => {
		expect(eraOf(MODERN_PROTOCOL_VERSION)).toBe("modern");
		for (const version of LEGACY_PROTOCOL_VERSIONS) expect(eraOf(version)).toBe("legacy");
		// Une révision future reste traitée comme moderne.
		expect(eraOf("2027-01-01")).toBe("modern");
	});

	test("initialize renvoie la version demandée si elle est connue", () => {
		expect(negotiateLegacyVersion("2025-06-18")).toBe("2025-06-18");
		expect(negotiateLegacyVersion("2024-01-01")).toBe(LEGACY_PROTOCOL_VERSIONS[0]);
		expect(negotiateLegacyVersion(undefined)).toBe(LEGACY_PROTOCOL_VERSIONS[0]);
	});
});

describe("registre", () => {
	test("zod devient un JSON Schema 2020-12", () => {
		const schema = toJsonSchema(z.object({ q: z.string().describe("terme"), n: z.int().optional() }));
		expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
		expect(schema.type).toBe("object");
		expect((schema.required as string[]) ?? []).toEqual(["q"]);
	});

	test("un nom d'outil non sûr pour un en-tête HTTP est refusé", () => {
		expect(() =>
			defineTool({
				name: "outil invalide",
				description: "x",
				inputSchema: z.object({}),
				handler: () => ({ content: [] }),
			}),
		).toThrow(/Nom de outil invalide/);
	});

	test("les gabarits d'URI extraient leurs variables", () => {
		expect(matchUriTemplate("rg://docs/{slug}", "rg://docs/azalee-lib")).toEqual({ slug: "azalee-lib" });
		expect(matchUriTemplate("rg://docs/{slug}", "rg://autre/x")).toBeUndefined();
		expect(matchUriTemplate("rg://docs/{slug}", "rg://docs/a/b")).toBeUndefined();
	});
});

describe("routage", () => {
	const server = buildServer();

	test("server/discover expose versions et capacités", async () => {
		const result = ok(
			await server.handle({ jsonrpc: "2.0", id: 1, method: "server/discover" }, modernContext),
		);
		expect(result.resultType).toBe("complete");
		expect(result.supportedVersions).toEqual(SUPPORTED_PROTOCOL_VERSIONS);
		expect((result.capabilities as Record<string, unknown>).tools).toBeDefined();
		expect((result._meta as Record<string, unknown>)["io.modelcontextprotocol/serverInfo"]).toMatchObject({
			name: "test",
		});
	});

	test("initialize répond aux clients à handshake", async () => {
		const result = ok(
			await server.handle(
				{
					jsonrpc: "2.0",
					id: 2,
					method: "initialize",
					params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c" } },
				},
				legacyContext,
			),
		);
		expect(result.protocolVersion).toBe("2025-06-18");
		expect(result.serverInfo).toMatchObject({ name: "test" });
	});

	test("une notification ne produit aucune réponse", async () => {
		expect(await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" }, legacyContext)).toBeNull();
	});

	test("une méthode inconnue donne -32601", async () => {
		const error = failure(await server.handle({ jsonrpc: "2.0", id: 3, method: "inexistant" }, modernContext));
		expect(error.code).toBe(ErrorCode.MethodNotFound);
	});

	test("ping répond", async () => {
		expect(ok(await server.handle({ jsonrpc: "2.0", id: 4, method: "ping" }, modernContext)).resultType).toBe(
			"complete",
		);
	});
});

describe("outils", () => {
	const server = buildServer();

	test("tools/list pagine avec un curseur opaque", async () => {
		const first = ok(await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }, modernContext));
		expect((first.tools as unknown[]).length).toBe(2);
		expect(first.nextCursor).toBeString();
		const second = ok(
			await server.handle(
				{ jsonrpc: "2.0", id: 2, method: "tools/list", params: { cursor: first.nextCursor as string } },
				modernContext,
			),
		);
		expect((second.tools as unknown[]).length).toBe(1);
		expect(second.nextCursor).toBeUndefined();
	});

	test("un curseur invalide est rejeté", async () => {
		const error = failure(
			await server.handle(
				{ jsonrpc: "2.0", id: 3, method: "tools/list", params: { cursor: "n'importe quoi" } },
				modernContext,
			),
		);
		expect(error.code).toBe(ErrorCode.InvalidParams);
	});

	test("tools/call applique les valeurs par défaut du schéma", async () => {
		const result = ok(
			await server.handle(
				{ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "echo", arguments: { value: "ab" } } },
				modernContext,
			),
		);
		expect(result.structuredContent).toEqual({ value: "ab" });
		expect((result.content as { text: string }[])[0]?.text).toContain("ab");
	});

	test("des arguments invalides donnent -32602, pas un résultat d'erreur", async () => {
		const error = failure(
			await server.handle(
				{ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "echo", arguments: { value: 42 } } },
				modernContext,
			),
		);
		expect(error.code).toBe(ErrorCode.InvalidParams);
	});

	test("un échec d'exécution devient isError, pas une erreur de protocole", async () => {
		const result = ok(
			await server.handle(
				{ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "boom", arguments: {} } },
				modernContext,
			),
		);
		expect(result.isError).toBe(true);
		expect((result.content as { text: string }[])[0]?.text).toContain("panne simulée");
	});

	test("un outil inconnu est une erreur de protocole", async () => {
		const error = failure(
			await server.handle(
				{ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "fantome" } },
				modernContext,
			),
		);
		expect(error.code).toBe(ErrorCode.InvalidParams);
	});

	test("progression et journalisation ne partent que si le client les demande", async () => {
		const sansToken: unknown[] = [];
		await server.handle(
			{ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "progressif", arguments: {} } },
			{ ...modernContext, emit: (notification) => sansToken.push(notification) },
		);
		// Pas de progressToken → aucune notification de progression, mais le
		// journal de niveau `info` passe (seuil par défaut).
		expect(sansToken.filter((n) => (n as { method: string }).method === "notifications/progress")).toHaveLength(0);

		const avecToken: unknown[] = [];
		const meta = parseModernMeta({
			_meta: {
				"io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION,
				"io.modelcontextprotocol/clientCapabilities": {},
				progressToken: "t1",
			},
		});
		await server.handle(
			{ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "progressif", arguments: {} } },
			{ meta, signal: modernContext.signal, emit: (notification) => avecToken.push(notification) },
		);
		const progress = avecToken.find((n) => (n as { method: string }).method === "notifications/progress") as {
			params: Record<string, unknown>;
		};
		expect(progress?.params.progressToken).toBe("t1");
		expect(progress?.params.total).toBe(2);
	});
});

describe("ressources et prompts", () => {
	const server = buildServer();

	test("resources/read sert une ressource fixe", async () => {
		const result = ok(
			await server.handle(
				{ jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: "rg://test/fixe" } },
				modernContext,
			),
		);
		expect((result.contents as { text: string }[])[0]?.text).toBe("contenu");
	});

	test("resources/read résout un gabarit", async () => {
		const result = ok(
			await server.handle(
				{ jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: "rg://test/connu" } },
				modernContext,
			),
		);
		expect((result.contents as { text: string }[])[0]?.text).toBe("valeur connu");
	});

	test("une ressource introuvable donne -32602 (et non -32002, retiré)", async () => {
		const error = failure(
			await server.handle(
				{ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: "rg://test/absent" } },
				modernContext,
			),
		);
		expect(error.code).toBe(ErrorCode.InvalidParams);
		expect(error.code).not.toBe(-32_002);
	});

	test("prompts/get exige ses arguments requis", async () => {
		const error = failure(
			await server.handle(
				{ jsonrpc: "2.0", id: 4, method: "prompts/get", params: { name: "salut", arguments: {} } },
				modernContext,
			),
		);
		expect(error.code).toBe(ErrorCode.InvalidParams);

		const result = ok(
			await server.handle(
				{ jsonrpc: "2.0", id: 5, method: "prompts/get", params: { name: "salut", arguments: { qui: "toi" } } },
				modernContext,
			),
		);
		expect((result.messages as { content: { text: string } }[])[0]?.content.text).toBe("bonjour toi");
	});

	test("completion/complete propose les valeurs d'un gabarit", async () => {
		const result = ok(
			await server.handle(
				{
					jsonrpc: "2.0",
					id: 6,
					method: "completion/complete",
					params: { ref: { type: "ref/resource", uri: "rg://test/{nom}" }, argument: { name: "nom", value: "c" } },
				},
				modernContext,
			),
		);
		expect((result.completion as { values: string[] }).values).toEqual(["connu"]);
	});

	test("logging/setLevel accepte un niveau valide et refuse le reste", async () => {
		expect(
			ok(await server.handle({ jsonrpc: "2.0", id: 7, method: "logging/setLevel", params: { level: "warning" } }, modernContext))
				.resultType,
		).toBe("complete");
		expect(
			failure(
				await server.handle(
					{ jsonrpc: "2.0", id: 8, method: "logging/setLevel", params: { level: "bavard" } },
					modernContext,
				),
			).code,
		).toBe(ErrorCode.InvalidParams);
	});
});
