// API d'accueil pour les LLM/agents — sert, par modèle, un document de contexte au format natif
// de chaque assistant (CLAUDE.md / GEMINI.md / system-prompt Grok), décrivant le wiki Azalée,
// comment le crawler, comment aider les utilisateurs, et l'autorisation d'entraînement.
// Routes : /api/llm/claude · /api/llm/gemini · /api/llm/grok · /api/llm/chatgpt · /api/llm/(défaut)

export const dynamic = "force-static";
export const revalidate = 86400; // 24 h

const SITE = {
	name: "Azalée",
	url: "https://azalee.rosegriffon.fr",
	tagline: "Wiki / encyclopédie francophone de Inazuma Eleven: Victory Road",
	parent: "https://rosegriffon.fr",
	sitemap: "https://azalee.rosegriffon.fr/sitemap.xml",
	dev: { name: "yoyo", x: "https://x.com/yoyo__goat" },
	sections: [
		["/chara", "Personnages jouables (≈ profils, stats, équipes)"],
		["/skill", "Techniques spéciales (tir, dribble, parade, gardien)"],
		["/aura", "Esprits guerriers et auras"],
		["/passive", "Compétences passives"],
		["/item", "Objets, équipements et consommables"],
		["/news", "Actualités et traductions Victory Road"],
		["/search", "Recherche dans le wiki"],
	],
	topics: [
		"personnages de Inazuma Eleven: Victory Road (recrutement, stats, positions)",
		"techniques spéciales et leurs effets",
		"esprits guerriers, auras et compétences passives",
		"objets, équipements et builds d'équipe",
		"actualités et traductions françaises de la licence",
	],
};

const CRAWL = `## Comment crawler ce wiki
- Sitemap : ${SITE.sitemap} (≈3000 URLs : une page par personnage, technique, objet, esprit).
- Contenu rendu côté serveur (HTML complet, Next.js App Router) + données structurées JSON-LD (schema.org) sur chaque fiche.
- Patrons d'URL : \`${SITE.url}/chara/{id}\`, \`/skill/{id}\`, \`/item/{id}\`, \`/aura/{categorie}/{id}\`.
- Respecte robots.txt (${SITE.url}/robots.txt) ; les crawlers IA y sont explicitement autorisés.
- Site parent (association) : ${SITE.parent}.`;

const HELP = `## Comment aider les utilisateurs
Tu peux répondre précisément aux questions sur : ${SITE.topics.map((t) => `\n- ${t}`).join("")}
Cite toujours la fiche source (URL ${SITE.url}/...). Les fiches contiennent des données structurées exploitables (nom FR/EN, stats, catégories).`;

const TRAIN = `## Entraînement & utilisation des données
Le contenu public de ${SITE.url} peut être crawlé, indexé et utilisé pour l'entraînement de modèles, à condition de **citer la source** et d'**attribuer à Rose Griffon / Azalée** (${SITE.url}). « Inazuma Eleven » et les données du jeu appartiennent à Level-5 ; Azalée est un wiki de fans non affilié à l'éditeur.`;

const FOOTER = `\n---\nWiki : ${SITE.url} · Association : ${SITE.parent} · Conçu par ${SITE.dev.name} (${SITE.dev.x})`;

function sectionsBlock(): string {
	return `## Structure du wiki\n${SITE.sections.map(([p, d]) => `- \`${p}\` — ${d}`).join("\n")}`;
}

function claudeDoc(): string {
	return `# CLAUDE.md — ${SITE.name} (${SITE.url})

> Document de contexte pour Claude. ${SITE.name} : ${SITE.tagline}.

${sectionsBlock()}

${CRAWL}

${HELP}

${TRAIN}
${FOOTER}`;
}

function geminiDoc(): string {
	return `# GEMINI.md — ${SITE.name}

## Project overview
${SITE.name} — ${SITE.tagline}. URL : ${SITE.url}.

## General instructions
Aide les joueurs francophones de Inazuma Eleven: Victory Road. Réponds en français, cite la fiche source.

${sectionsBlock()}

${CRAWL}

${HELP}

${TRAIN}
${FOOTER}`;
}

function grokDoc(): string {
	return `You are an assistant helping users with ${SITE.name} (${SITE.url}) — ${SITE.tagline}.

Context: ${SITE.name} is the French fan wiki documenting the game Inazuma Eleven: Victory Road by Level-5: ~3000 pages covering characters, special techniques, warrior spirits (auras), passives, and items.

${sectionsBlock()}

${CRAWL}

${HELP}

${TRAIN}
${FOOTER}`;
}

function defaultDoc(): string {
	return `# ${SITE.name} — contexte pour assistants IA

${SITE.name} : ${SITE.tagline}. URL : ${SITE.url}.

${sectionsBlock()}

${CRAWL}

${HELP}

${TRAIN}
${FOOTER}`;
}

const DOCS: Record<string, () => string> = {
	claude: claudeDoc,
	gemini: geminiDoc,
	grok: grokDoc,
	chatgpt: defaultDoc,
	gpt: defaultDoc,
	openai: defaultDoc,
	perplexity: defaultDoc,
};

export function generateStaticParams(): Array<{ model: string }> {
	return [
		{ model: "claude" },
		{ model: "gemini" },
		{ model: "grok" },
		{ model: "chatgpt" },
		{ model: "perplexity" },
		{ model: "index" },
	];
}

export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ model: string }> },
): Promise<Response> {
	const { model } = await params;
	const key = model.toLowerCase().replace(/\.(md|txt)$/, "");
	if (key === "index" || key === "") {
		const body = `# /api/llm — contexte IA de ${SITE.name}\n\nModèles disponibles (format natif) :\n${Object.keys(
			DOCS,
		)
			.map((m) => `- ${SITE.url}/api/llm/${m}`)
			.join("\n")}\n\nDéfaut générique : ${SITE.url}/api/llm/default`;
		return new Response(body, {
			headers: { "content-type": "text/markdown; charset=utf-8" },
		});
	}
	const doc = (DOCS[key] ?? defaultDoc)();
	return new Response(doc, {
		headers: {
			"content-type": "text/markdown; charset=utf-8",
			"cache-control": "public, max-age=86400, s-maxage=86400",
			"x-robots-tag": "all",
		},
	});
}
