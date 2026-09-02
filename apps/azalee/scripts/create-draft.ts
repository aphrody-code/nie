#!/usr/bin/env bun
/**
 * Create-draft.ts — Cree un brouillon dans le CMS azalee.
 *
 * Wrapper HTTP autour de POST /api/admin/news/draft.
 * Auth via CLAUDE_API_KEY (env), defaut endpoint = https://azalee.rosegriffon.fr.
 *
 * Usage:
 *   bun run create-draft -- --title="Mon brouillon" [opts]
 *   bun run create-draft -- --title="..." --content-file=./body.txt
 *   echo "Contenu" | bun run create-draft -- --title="..." --stdin
 *
 * Options:
 *   --title=<str>         (requis) Titre de l'article
 *   --slug=<str>          Slug custom (sinon dérivé du titre)
 *   --excerpt=<str>       Résumé court
 *   --content=<str>       Contenu inline (\n pour saut de ligne)
 *   --content-file=<path> Lit depuis un fichier
 *   --stdin               Lit depuis stdin
 *   --category=<value>    announcement|event|update|community|patch_notes (défaut: community)
 *   --tags=<csv>          "tag1,tag2,tag3"
 *   --featured-image=<url>
 *   --featured-image-alt=<str>
 *   --meta-title=<str>
 *   --meta-description=<str>
 *   --author-id=<uuid>
 *   --author-email=<str>
 *   --author-username=<str>
 *   --endpoint=<url>      (défaut: https://azalee.rosegriffon.fr ou AZALEE_BASE_URL)
 *   --api-key=<str>       (défaut: $CLAUDE_API_KEY)
 *   --json                Sortie JSON
 *   --help
 */

type Args = Record<string, string | boolean | undefined>;

function parseArgs(argv: string[]): Args {
	const out: Args = {};
	for (const raw of argv) {
		if (raw === "--help" || raw === "-h") {
			out.help = true;
		} else if (raw === "--stdin") {
			out.stdin = true;
		} else if (raw === "--json") {
			out.json = true;
		} else {
			const m = raw.match(/^--([a-z-]+)=(.*)$/i);
			if (m) {
				out[m[1]] = m[2];
			}
		}
	}
	return out;
}

function helpText(): string {
	return `Usage: bun run create-draft -- --title="..." [opts]

Crée un brouillon via POST /api/admin/news/draft (auth Bearer CLAUDE_API_KEY).

Options requises:
  --title=<str>             Titre de l'article

Contenu (au choix):
  --content=<str>           Texte inline (\\n pour saut de ligne)
  --content-file=<path>     Lit depuis un fichier
  --stdin                   Lit depuis stdin

Métadonnées (toutes optionnelles):
  --slug=<str>              Slug custom (sinon dérivé du titre)
  --excerpt=<str>           Résumé court
  --category=<value>        announcement|event|update|community|patch_notes (défaut: community)
  --tags=<csv>              "tag1,tag2,tag3"
  --featured-image=<url>    URL image de couverture
  --featured-image-alt=<str>
  --meta-title=<str>
  --meta-description=<str>

Auteur (au choix, sinon premier admin trouvé):
  --author-id=<uuid>
  --author-email=<str>
  --author-username=<str>

Endpoint:
  --endpoint=<url>          (défaut: https://azalee.rosegriffon.fr ou $AZALEE_BASE_URL)
  --api-key=<str>           (défaut: $CLAUDE_API_KEY)

Sortie:
  --json                    JSON brut
  --help`;
}

async function readStdin(): Promise<string> {
	const chunks: Uint8Array[] = [];
	for await (const chunk of Bun.stdin.stream()) {
		chunks.push(chunk);
	}
	return new TextDecoder().decode(Buffer.concat(chunks));
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log(helpText());
		process.exit(0);
	}

	if (!args.title) {
		console.error("ERREUR: --title est requis. Lance avec --help pour l'usage.");
		process.exit(1);
	}

	const endpoint =
		(args.endpoint as string) || process.env.AZALEE_BASE_URL || "https://azalee.rosegriffon.fr";
	const apiKey = (args["api-key"] as string) || process.env.CLAUDE_API_KEY;
	if (!apiKey) {
		console.error("ERREUR: API key manquante. Précise --api-key=<…> ou définit $CLAUDE_API_KEY.");
		process.exit(1);
	}

	let content: string | undefined;
	if (args.stdin) {
		content = (await readStdin()).trim();
	} else if (args["content-file"]) {
		content = await Bun.file(args["content-file"] as string).text();
	} else if (args.content) {
		content = (args.content as string).replaceAll("\\n", "\n");
	}

	const tags =
		typeof args.tags === "string"
			? args.tags
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean)
			: undefined;

	const body: Record<string, unknown> = {
		author_email: args["author-email"],
		author_id: args["author-id"],
		author_username: args["author-username"],
		category: args.category,
		content,
		excerpt: args.excerpt,
		featured_image_alt: args["featured-image-alt"],
		featured_image_url: args["featured-image"],
		meta_description: args["meta-description"],
		meta_title: args["meta-title"],
		slug: args.slug,
		tags,
		title: args.title,
	};
	for (const k of Object.keys(body)) {
		if (body[k] === undefined) delete body[k];
	}

	const url = `${endpoint.replace(/\/$/, "")}/api/admin/news/draft`;
	const res = await fetch(url, {
		body: JSON.stringify(body),
		headers: {
			authorization: `Bearer ${apiKey}`,
			"content-type": "application/json",
		},
		method: "POST",
	});

	const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

	if (!res.ok) {
		console.error(`ERREUR ${res.status}: ${(json.error as string) ?? "réponse non-JSON"}`);
		process.exit(1);
	}

	if (args.json) {
		console.log(JSON.stringify(json, null, 2));
	} else {
		console.log(`Brouillon créé: ${json.id}`);
		console.log(`  slug      : ${json.slug}`);
		console.log(`  auteur    : ${json.authorId}`);
		console.log(`  éditer    : ${json.editUrl}`);
		console.log(`  preview   : ${json.previewUrl}`);
	}
}

main().catch((error) => {
	console.error(`ERREUR: ${(error as Error).message}`);
	process.exit(1);
});
