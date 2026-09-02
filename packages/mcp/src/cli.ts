#!/usr/bin/env bun
/**
 * CLI `rg-mcp` — lance le serveur MCP du monorepo.
 *
 *   rg-mcp                       # stdio (ce qu'attend Claude Code en local)
 *   rg-mcp --http --port 8808    # Streamable HTTP
 *   rg-mcp --list                # inventaire des outils, ressources, prompts
 *   rg-mcp --probe <url>         # teste un serveur MCP distant
 *
 * Sortie volontairement terse : une ligne `clé=valeur`, le détail va dans
 * les journaux. Sur stdio, RIEN ne doit être écrit sur la sortie standard en
 * dehors des messages du protocole — les traces partent sur stderr.
 */

import { createRgMcpServer } from "./index.ts";
import { MODERN_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "./protocol/versions.ts";
import { createHttpTransport } from "./transport/http.ts";
import { runStdioTransport } from "./transport/stdio.ts";

interface CliOptions {
	mode: "stdio" | "http" | "list" | "probe" | "help";
	port?: number;
	hostname?: string;
	endpoint?: string;
	tokens: string[];
	adminTokens: string[];
	scope?: "read" | "admin";
	allowedOrigins?: string[];
	cors: boolean;
	probeUrl?: string;
}

function parseArgs(argv: string[]): CliOptions {
	const options: CliOptions = { mode: "stdio", tokens: [], adminTokens: [], cors: false };
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		const next = () => argv[++index];
		switch (argument) {
			case "serve":
				break;
			case "--http":
				options.mode = "http";
				break;
			case "--stdio":
				options.mode = "stdio";
				break;
			case "--list":
				options.mode = "list";
				break;
			case "--probe":
				options.mode = "probe";
				options.probeUrl = next();
				break;
			case "--port":
				options.port = Number.parseInt(next() ?? "", 10);
				break;
			case "--host":
			case "--hostname":
				options.hostname = next();
				break;
			case "--endpoint":
				options.endpoint = next();
				break;
			case "--token":
				options.tokens.push(next() ?? "");
				break;
			case "--admin-token":
				options.adminTokens.push(next() ?? "");
				break;
			case "--scope": {
				const valeur = next();
				if (valeur !== "read" && valeur !== "admin") throw new Error("--scope attend `read` ou `admin`");
				options.scope = valeur;
				break;
			}
			case "--origin":
				(options.allowedOrigins ??= []).push(next() ?? "");
				break;
			case "--cors":
				options.cors = true;
				break;
			case "-h":
			case "--help":
				options.mode = "help";
				break;
			default:
				if (argument?.startsWith("-")) throw new Error(`Option inconnue : ${argument}`);
		}
	}
	return options;
}

const HELP = `rg-mcp — serveur MCP du monorepo Rose Griffon

  rg-mcp [serve] [--stdio|--http] [options]

Transports
  --stdio                 JSON-RPC sur les flux standard (défaut)
  --http                  Streamable HTTP sur Bun.serve

Options HTTP
  --port <n>              port d'écoute (défaut : RG_MCP_PORT ou 8808)
  --host <adresse>        interface (défaut : 127.0.0.1)
  --endpoint <chemin>     point d'entrée MCP (défaut : /mcp)
  --token <jeton>         jeton de LECTURE (répétable ; RG_MCP_TOKEN sinon)
  --admin-token <jeton>   jeton d'ADMINISTRATION : écriture, suppression,
                          exécution de commandes (RG_MCP_ADMIN_TOKEN sinon)
  --origin <origine>      origine autorisée (répétable)
  --cors                  ajoute les en-têtes CORS

Portée
  --scope read|admin      portée du transport stdio (défaut : admin) et portée
                          accordée en HTTP quand aucun jeton n'est configuré
                          (défaut : read)

Diagnostic
  --list                  inventaire des outils, ressources et prompts
  --probe <url>           interroge un serveur MCP distant (server/discover)

Protocole : ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")} (courante : ${MODERN_PROTOCOL_VERSION})`;

const options = parseArgs(Bun.argv.slice(2));

if (options.mode === "help") {
	console.log(HELP);
	process.exit(0);
}

if (options.mode === "probe") {
	const url = options.probeUrl;
	if (!url) {
		console.error("--probe attend une URL");
		process.exit(2);
	}
	const token = Bun.env.RG_MCP_TOKEN ?? options.tokens[0];
	const response = await fetch(url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			"mcp-protocol-version": MODERN_PROTOCOL_VERSION,
			"mcp-method": "server/discover",
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "server/discover",
			params: {
				_meta: {
					"io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION,
					"io.modelcontextprotocol/clientInfo": { name: "rg-mcp-probe", version: "1.0.0" },
					"io.modelcontextprotocol/clientCapabilities": {},
				},
			},
		}),
	});
	const body = await response.text();
	console.log(`probe status=${response.status} body=${body.slice(0, 800)}`);
	process.exit(response.ok ? 0 : 1);
}

const server = await createRgMcpServer();

if (options.mode === "list") {
	const tools = server.registry.tools;
	const lecture = server.registry.toolsFor("read").length;
	const resources = await server.registry.listResourceDefinitions();
	console.log(
		`outils=${tools.length} (lecture=${lecture} admin=${tools.length - lecture})` +
			` ressources=${resources.length} prompts=${server.registry.prompts.length}`,
	);
	for (const tool of tools) console.log(`  outil     ${tool.definition.name}${tool.scope === "admin" ? "  [admin]" : ""}`);
	for (const template of server.registry.templateDefinitions()) {
		console.log(`  gabarit   ${template.uriTemplate}`);
	}
	for (const prompt of server.registry.prompts) console.log(`  prompt    ${prompt.name}`);
	process.exit(0);
}

if (options.mode === "http") {
	const tokens = [...options.tokens, ...listeEnv(Bun.env.RG_MCP_TOKEN)].filter(Boolean);
	const adminTokens = [...options.adminTokens, ...listeEnv(Bun.env.RG_MCP_ADMIN_TOKEN)].filter(Boolean);

	// Un même secret dans les deux rôles rendrait la séparation illusoire.
	const collision = adminTokens.find((jeton) => tokens.includes(jeton));
	if (collision) {
		console.error("rg-mcp erreur=jeton identique en lecture et en administration");
		process.exit(2);
	}

	const transport = createHttpTransport({
		server,
		port: options.port ?? Number.parseInt(Bun.env.RG_MCP_PORT ?? "8808", 10),
		hostname: options.hostname ?? Bun.env.RG_MCP_HOST ?? "127.0.0.1",
		endpoint: options.endpoint ?? Bun.env.RG_MCP_ENDPOINT ?? "/mcp",
		tokens,
		adminTokens,
		defaultScope: options.scope ?? "read",
		allowedOrigins: options.allowedOrigins ?? parseOrigins(Bun.env.RG_MCP_ORIGINS),
		cors: options.cors || Bun.env.RG_MCP_CORS === "1",
		onLog: (line) => process.stderr.write(`${line}\n`),
	});

	console.log(
		[
			`rg-mcp url=${transport.url}`,
			`outils=${server.registry.tools.length}`,
			`prompts=${server.registry.prompts.length}`,
			`auth=${tokens.length + adminTokens.length > 0 ? "bearer" : "aucune"}`,
			`admin=${adminTokens.length > 0 ? "activé" : "désactivé"}`,
			`protocole=${SUPPORTED_PROTOCOL_VERSIONS.join("|")}`,
		].join(" "),
	);

	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.on(signal, () => {
			void transport.stop(true);
			process.exit(0);
		});
	}
} else {
	await runStdioTransport({ server, scope: options.scope ?? "admin" });
}

/** Découpe une variable d'environnement en liste de jetons. */
function listeEnv(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((jeton) => jeton.trim())
		.filter(Boolean);
}

function parseOrigins(value: string | undefined): string[] | "*" | undefined {
	if (!value) return undefined;
	if (value === "*") return "*";
	return value
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);
}
