/**
 * Plugin Claude `rose-griffon` : cohérence de la configuration livrée.
 *
 * Ces tests remplacent une inspection à l'œil sur la machine cliente. Ils
 * reproduisent ce que fait Claude Code au chargement — lecture du manifeste,
 * expansion des variables d'environnement, appel du point d'entrée — et
 * échouent sur les modes de panne réellement rencontrés : entrée MCP sans
 * `type` (silencieusement ignorée), variable non définie envoyée telle quelle
 * dans un en-tête, `hooks.json` de plugin à plat, outil déclaré dans une skill
 * mais absent du serveur.
 */

import { describe, expect, test } from "bun:test";
import { createRgMcpServer } from "../src/index.ts";

const RACINE = `${import.meta.dir}/../../..`;
const PLUGIN = `${RACINE}/plugins/rose-griffon`;

async function lireJson<T>(chemin: string): Promise<T> {
	return (await Bun.file(chemin).json()) as T;
}

/** Expansion `${VAR}` / `${VAR:-défaut}`, comme le fait Claude Code. */
function etendre(valeur: string, env: Record<string, string | undefined>): string {
	return valeur.replaceAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_t, nom: string, defaut?: string) => {
		return env[nom] ?? defaut ?? `\${${nom}}`;
	});
}

describe("manifeste et marketplace", () => {
	test("le manifeste déclare un nom en kebab-case et une version", async () => {
		const manifeste = await lireJson<{ name: string; version: string; description: string }>(
			`${PLUGIN}/.claude-plugin/plugin.json`,
		);
		expect(manifeste.name).toBe("rose-griffon");
		expect(manifeste.name).toMatch(/^[a-z][a-z0-9-]*$/);
		expect(manifeste.version).toMatch(/^\d+\.\d+\.\d+$/);
		expect(manifeste.description.length).toBeGreaterThan(30);
	});

	test("la marketplace pointe le plugin et annonce la même version", async () => {
		const marketplace = await lireJson<{
			plugins: { name: string; source: string; version: string }[];
		}>(`${RACINE}/.claude-plugin/marketplace.json`);
		const entree = marketplace.plugins.find((p) => p.name === "rose-griffon");
		expect(entree).toBeDefined();
		expect(entree!.source).toBe("./plugins/rose-griffon");
		const manifeste = await lireJson<{ version: string }>(`${PLUGIN}/.claude-plugin/plugin.json`);
		expect(entree!.version).toBe(manifeste.version);
		expect(await Bun.file(`${RACINE}/${entree!.source.slice(2)}/.claude-plugin/plugin.json`).exists()).toBe(true);
	});

	test("les composants sont à la racine du plugin, pas dans .claude-plugin", async () => {
		// `Bun.file(...).exists()` répond `false` sur un répertoire : on passe
		// donc par `stat()` pour les dossiers, `exists()` pour les fichiers.
		for (const dossier of ["skills", "agents", "hooks"]) {
			expect((await Bun.file(`${PLUGIN}/${dossier}`).stat()).isDirectory()).toBe(true);
		}
		for (const fichier of ["hooks/hooks.json", ".mcp.json", "README.md", ".claude-plugin/plugin.json"]) {
			expect(await Bun.file(`${PLUGIN}/${fichier}`).exists()).toBe(true);
		}
		// Les composants dans `.claude-plugin/` ne seraient pas découverts.
		expect(await Bun.file(`${PLUGIN}/.claude-plugin/skills/donnees-jeu/SKILL.md`).exists()).toBe(false);
		expect(await Bun.file(`${PLUGIN}/.claude-plugin/.mcp.json`).exists()).toBe(false);
	});
});

describe("configuration MCP du plugin", () => {
	test("l'entrée déclare `type` — sans lui elle est lue comme stdio et ignorée", async () => {
		const config = await lireJson<{
			mcpServers: Record<string, { type?: string; url?: string; headers?: Record<string, string> }>;
		}>(`${PLUGIN}/.mcp.json`);
		const serveur = config.mcpServers["rose-griffon"];
		expect(serveur).toBeDefined();
		expect(serveur!.type).toBe("http");
		expect(serveur!.url).toBeString();
	});

	test("l'URL a un défaut, le jeton n'en a pas — et ça doit se voir", async () => {
		const config = await lireJson<{
			mcpServers: Record<string, { url: string; headers: Record<string, string> }>;
		}>(`${PLUGIN}/.mcp.json`);
		const serveur = config.mcpServers["rose-griffon"]!;

		// Sans aucune variable : l'URL retombe sur le défaut, l'en-tête reste
		// littéral. C'est exactement le symptôme d'un 401 côté client.
		const sansEnv = { RG_MCP_URL: undefined, RG_MCP_TOKEN: undefined };
		expect(etendre(serveur.url, sansEnv)).toBe("https://mcp.rosegriffon.fr/");
		expect(etendre(serveur.headers.Authorization!, sansEnv)).toContain("${RG_MCP_TOKEN}");

		// Avec le jeton : en-tête porteur exploitable.
		const avecEnv = { RG_MCP_URL: undefined, RG_MCP_TOKEN: "jeton-test" };
		expect(etendre(serveur.headers.Authorization!, avecEnv)).toBe("Bearer jeton-test");
	});
});

describe("hook", () => {
	test("le hooks.json d'un plugin porte un objet racine `hooks`", async () => {
		const config = await lireJson<{ hooks?: Record<string, unknown> }>(`${PLUGIN}/hooks/hooks.json`);
		// À plat (sans la clé `hooks`), Claude Code refuse de charger le plugin :
		// « expected record, received undefined ».
		expect(config.hooks).toBeDefined();
		expect(config.hooks!.PostToolUse).toBeArray();
	});

	test("les commandes de hook utilisent ${CLAUDE_PLUGIN_ROOT}", async () => {
		const brut = await Bun.file(`${PLUGIN}/hooks/hooks.json`).text();
		expect(brut).toContain("${CLAUDE_PLUGIN_ROOT}");
		expect(brut).not.toContain("/home/ubuntu");
	});

	test("le script de hook existe et est exécutable par bash", async () => {
		const script = `${PLUGIN}/hooks/scripts/restore-lockfile.sh`;
		expect(await Bun.file(script).exists()).toBe(true);
		const verif = Bun.spawn(["bash", "-n", script], { stdout: "pipe", stderr: "pipe" });
		expect(await verif.exited).toBe(0);
	});

	test("le hook remet un lockfile v2 en v1, et ne touche à rien sinon", async () => {
		const bac = `${import.meta.dir}/.bac-hook`;
		const script = `${PLUGIN}/hooks/scripts/restore-lockfile.sh`;
		await Bun.write(`${bac}/bun.lock`, '{\n  "lockfileVersion": 2,\n  "configVersion": 1\n}\n');
		// Le hook n'agit que sur le monorepo rg : il faut donc que le bac à sable
		// se présente comme tel.
		await Bun.write(`${bac}/package.json`, '{ "name": "rg-monorepo" }\n');

		const lancer = async (commande: string) => {
			const proc = Bun.spawn(["bash", script], {
				env: { ...process.env, CLAUDE_PROJECT_DIR: bac },
				stdin: new TextEncoder().encode(JSON.stringify({ tool_input: { command: commande } })),
				stdout: "pipe",
				stderr: "pipe",
			});
			const sortie = await new Response(proc.stdout).text();
			await proc.exited;
			return sortie.trim();
		};

		// Commande hors périmètre : le lockfile reste tel quel.
		expect(await lancer("git status")).toBe("");
		expect(await Bun.file(`${bac}/bun.lock`).text()).toContain('"lockfileVersion": 2');

		// Commande de dépendances : correction et message.
		expect(await lancer("bun install")).toContain("lockfileVersion 1");
		expect(await Bun.file(`${bac}/bun.lock`).text()).toContain('"lockfileVersion": 1');

		// Idempotent : un second passage ne dit plus rien.
		expect(await lancer("bun install")).toBe("");

		await Bun.spawn(["rm", "-rf", bac]).exited;
	});

	test("le hook ignore un dépôt qui n'est pas le monorepo", async () => {
		const bac = `${import.meta.dir}/.bac-etranger`;
		await Bun.write(`${bac}/bun.lock`, '{\n  "lockfileVersion": 2\n}\n');
		await Bun.write(`${bac}/package.json`, '{ "name": "un-autre-projet" }\n');

		const proc = Bun.spawn(["bash", `${PLUGIN}/hooks/scripts/restore-lockfile.sh`], {
			env: { ...process.env, CLAUDE_PROJECT_DIR: bac },
			stdin: new TextEncoder().encode(JSON.stringify({ tool_input: { command: "bun install" } })),
			stdout: "pipe",
			stderr: "pipe",
		});
		expect((await new Response(proc.stdout).text()).trim()).toBe("");
		await proc.exited;
		// Le lockfile d'un projet tiers reste intact, y compris en v2 assumée.
		expect(await Bun.file(`${bac}/bun.lock`).text()).toContain('"lockfileVersion": 2');
		await Bun.spawn(["rm", "-rf", bac]).exited;
	});
});

describe("skills et agents du plugin", () => {
	const attendus = ["donnees-jeu", "conventions", "deployer", "diagnostic", "verifier-connexion"];

	test("chaque skill a un SKILL.md avec nom et description", async () => {
		for (const nom of attendus) {
			const chemin = `${PLUGIN}/skills/${nom}/SKILL.md`;
			expect(await Bun.file(chemin).exists()).toBe(true);
			const contenu = await Bun.file(chemin).text();
			expect(contenu.startsWith("---\n")).toBe(true);
			expect(contenu).toContain(`name: ${nom}`);
			expect(/^description: .{40,}$/m.test(contenu)).toBe(true);
		}
	});

	test("les deux agents déclarent des exemples de déclenchement, sans figer leurs outils", async () => {
		for (const nom of ["rg-donnees", "rg-ops"]) {
			const contenu = await Bun.file(`${PLUGIN}/agents/${nom}.md`).text();
			const frontmatter = contenu.split("---")[1] ?? "";
			expect(contenu).toContain(`name: ${nom}`);
			expect(contenu).toContain("<example>");
			// Pas de champ `tools:` : un agent qui en déclare un n'hérite d'AUCUN
			// autre outil. Comme le préfixe MCP dépend de l'enregistrement
			// (plugin ou projet), figer la liste le priverait de tout outil sur la
			// machine cliente. L'héritage est la seule forme portable.
			expect(/^tools:/m.test(frontmatter)).toBe(false);
			// Couleurs documentées par plugin-dev.
			expect(/^color: (blue|cyan|green|yellow|magenta|red)$/m.test(frontmatter)).toBe(true);
		}
	});

	test("tout outil MCP cité par une skill ou un agent existe vraiment", async () => {
		const serveur = await createRgMcpServer();
		const connus = new Set(serveur.registry.tools.map((outil) => outil.definition.name));
		const glob = new Bun.Glob("**/*.md");

		for await (const relatif of glob.scan({ cwd: PLUGIN, onlyFiles: true })) {
			const contenu = await Bun.file(`${PLUGIN}/${relatif}`).text();
			for (const [, outil] of contenu.matchAll(/mcp__(?:plugin_rose-griffon_)?rose-griffon__([a-z_]+)/g)) {
				expect(connus.has(outil!)).toBe(true);
			}
		}
	});

	test("les skills autorisent le serveur du PLUGIN, pas seulement celui du projet", async () => {
		// Un serveur MCP fourni par un plugin est enregistré sous
		// `plugin:<plugin>:<serveur>` : ses outils s'appellent
		// `mcp__plugin_rose-griffon_rose-griffon__…`. Une règle écrite avec le seul
		// préfixe `mcp__rose-griffon__` ne s'applique QUE dans une copie du
		// monorepo — c'est-à-dire nulle part sur la machine cliente visée.
		for (const nom of attendus) {
			const contenu = await Bun.file(`${PLUGIN}/skills/${nom}/SKILL.md`).text();
			const frontmatter = contenu.split("---")[1] ?? "";
			// `conventions` est une skill de pure connaissance : elle ne déclare
			// aucun outil, et n'a donc rien à autoriser.
			if (!frontmatter.includes("allowed-tools")) continue;
			expect(frontmatter).toContain("mcp__plugin_rose-griffon_rose-griffon");
		}
	});

	test("la skill auto-déclenchée ne pré-autorise aucun outil d'écriture", async () => {
		// `allowed-tools` ACCORDE la permission sans invite. `donnees-jeu` se
		// déclenche sur n'importe quelle question de wiki : y pré-autoriser
		// `shell_run` ou `repo_delete` ouvrirait un accès équivalent SSH sans
		// confirmation.
		const contenu = await Bun.file(`${PLUGIN}/skills/donnees-jeu/SKILL.md`).text();
		const frontmatter = contenu.split("---")[1] ?? "";
		const serveur = await createRgMcpServer();
		for (const outil of serveur.registry.tools.filter((o) => o.scope === "admin")) {
			expect(frontmatter).not.toContain(`__${outil.definition.name}`);
		}
	});
});
