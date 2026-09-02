import { ADMIN_ROLES } from "@rosegriffon/types/roles";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/admin/news/draft
 *
 * Cree un article en brouillon dans le CMS azalee.
 * Reserve aux integrations admin (scripts/CLI). Auth via Bearer token.
 *
 * Headers:
 *   Authorization: Bearer <ADMIN_API_KEY>      (depuis .env, alias historique CLAUDE_API_KEY)
 *   Content-Type: application/json
 *
 * Body JSON (title requis, le reste optionnel):
 *   {
 *     title: string,
 *     content?: string,                    // markdown light: # H1, ## H2, ### H3, sinon paragraphe
 *     excerpt?: string,
 *     slug?: string,                       // sinon dérivé du titre, suffixe -N si collision
 *     category?: "announcement"|"event"|"critique"|"community",
 *     tags?: string[],
 *     featured_image_url?: string,
 *     featured_image_alt?: string,
 *     meta_title?: string,
 *     meta_description?: string,
 *     author_id?: string,                  // sinon premier admin trouvé
 *     author_email?: string,               // sinon premier admin trouvé
 *     author_username?: string             // sinon premier admin trouvé
 *   }
 *
 * Reponse 201:
 *   { id, slug, editUrl, previewUrl, authorId }
 *
 * Codes:
 *   400 — body invalide
 *   401 — bearer manquant/invalide
 *   404 — auteur ou ressource introuvable
 *   500 — erreur Supabase
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_CATEGORIES = ["announcement", "event", "critique", "community"] as const;
type Category = (typeof VALID_CATEGORIES)[number];

const APP_SCOPE = "azalee";
const ORIGIN = "https://azalee.rosegriffon.fr";

interface CoAuthor {
	name: string;
	avatar_url?: string;
	discord_id?: string;
	profile_id?: string;
}

interface DraftBody {
	title: string;
	content?: string;
	excerpt?: string;
	slug?: string;
	category?: Category;
	tags?: string[];
	featured_image_url?: string;
	featured_image_alt?: string;
	meta_title?: string;
	meta_description?: string;
	author_id?: string;
	author_email?: string;
	author_username?: string;
	co_authors?: CoAuthor[];
	/** Auto-fetch members of this Discord role et les ajouter en co_authors */
	discord_role_id?: string;
	/** Si true et `discord_role_id` set : exclure le author_id principal du co_authors */
	exclude_author_from_co?: boolean;
}

function generateSlug(title: string): string {
	return title
		.toLowerCase()
		.normalize("NFD")
		.replaceAll(/[̀-ͯ]/g, "")
		.replaceAll(/[^\w\s-]/g, "")
		.replaceAll(/\s+/g, "-")
		.replaceAll(/-+/g, "-")
		.replaceAll(/^-|-$/g, "");
}

interface LexicalText {
	type: "text";
	text: string;
	format: number;
	style: string;
	mode: "normal";
	detail: number;
	version: 1;
}
interface LexicalParagraph {
	type: "paragraph";
	format: "";
	indent: 0;
	version: 1;
	direction: null;
	children: LexicalText[];
}
interface LexicalHeading {
	type: "heading";
	tag: "h1" | "h2" | "h3";
	format: "";
	indent: 0;
	version: 1;
	direction: null;
	children: LexicalText[];
}

function textNode(text: string): LexicalText {
	return {
		detail: 0,
		format: 0,
		mode: "normal",
		style: "",
		text,
		type: "text",
		version: 1,
	};
}

function paragraph(text: string): LexicalParagraph {
	return {
		children: text ? [textNode(text)] : [],
		direction: null,
		format: "",
		indent: 0,
		type: "paragraph",
		version: 1,
	};
}

function heading(tag: "h1" | "h2" | "h3", text: string): LexicalHeading {
	return {
		children: [textNode(text)],
		direction: null,
		format: "",
		indent: 0,
		tag,
		type: "heading",
		version: 1,
	};
}

function buildLexical(content: string) {
	const lines = (content || "").replaceAll("\r\n", "\n").split("\n");
	const children: Array<LexicalParagraph | LexicalHeading> = [];
	for (const line of lines) {
		const trimmed = line.trimEnd();
		if (trimmed.startsWith("# ")) {
			children.push(heading("h1", trimmed.slice(2)));
		} else if (trimmed.startsWith("## ")) {
			children.push(heading("h2", trimmed.slice(3)));
		} else if (trimmed.startsWith("### ")) {
			children.push(heading("h3", trimmed.slice(4)));
		} else {
			children.push(paragraph(trimmed));
		}
	}
	if (children.length === 0) {
		children.push(paragraph(""));
	}
	return {
		root: {
			children,
			direction: null,
			format: "",
			indent: 0,
			type: "root",
			version: 1,
		},
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveAuthorId(supabase: any, body: DraftBody): Promise<string> {
	if (body.author_id) {
		return body.author_id;
	}

	if (body.author_email || body.author_username) {
		const filter = body.author_email
			? { col: "email", val: body.author_email }
			: { col: "username", val: body.author_username! };
		const { data, error } = await supabase
			.from("profiles")
			.select("id")
			.eq(filter.col, filter.val)
			.maybeSingle();
		if (error) {
			throw new Error(`Profile lookup failed: ${error.message}`);
		}
		if (!data?.id) {
			throw new Error(`Aucun profil avec ${filter.col}="${filter.val}"`);
		}
		return data.id as string;
	}

	const { data, error } = await supabase
		.from("profiles")
		.select("id, role")
		.in("role", ADMIN_ROLES)
		.order("updated_at", { ascending: true })
		.limit(1)
		.maybeSingle();
	if (error) {
		throw new Error(`Admin lookup failed: ${error.message}`);
	}
	if (!data?.id) {
		throw new Error("Aucun admin/superadmin/editor/moderator trouvé — précise author_id.");
	}
	return data.id as string;
}

function discordAvatarUrl(userId: string, hash: string | null | undefined): string {
	if (!hash) {
		const idx = Number((BigInt(userId) >> 22n) % 6n);
		return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
	}
	const ext = hash.startsWith("a_") ? "gif" : "webp";
	return `https://cdn.discordapp.com/avatars/${userId}/${hash}.${ext}?size=256`;
}

interface DiscordMember {
	user: {
		id: string;
		username: string;
		global_name?: string | null;
		avatar?: string | null;
	};
	nick?: string | null;
	roles: string[];
}

async function fetchCoAuthorsFromDiscordRole(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	supabase: any,
	roleId: string,
	excludeProfileId: string | null
): Promise<CoAuthor[]> {
	const token = process.env.DISCORD_BOT_TOKEN;
	const guildId = process.env.DISCORD_GUILD_ID;
	if (!token || !guildId) {
		throw new Error("DISCORD_BOT_TOKEN/DISCORD_GUILD_ID requis pour `discord_role_id`");
	}

	const all: DiscordMember[] = [];
	let after: string | undefined;
	while (true) {
		const u = new URL(`https://discord.com/api/v10/guilds/${guildId}/members`);
		u.searchParams.set("limit", "1000");
		if (after) {
			u.searchParams.set("after", after);
		}
		const res = await fetch(u, { headers: { Authorization: `Bot ${token}` } });
		if (!res.ok) {
			throw new Error(`Discord API ${res.status}: ${(await res.text()).slice(0, 200)}`);
		}
		const batch = (await res.json()) as DiscordMember[];
		all.push(...batch);
		if (batch.length < 1000) {
			break;
		}
		const lastMember = batch[batch.length - 1];
		if (!lastMember) {
			break;
		}
		after = lastMember.user.id;
	}

	const withRole = all.filter((m) => m.roles?.includes(roleId));
	if (withRole.length === 0) {
		return [];
	}

	const discordIds = withRole.map((m) => m.user.id);
	const { data: profiles } = await supabase
		.from("profiles")
		.select("id, discord_id")
		.in("discord_id", discordIds);

	const profileByDiscord = new Map<string, string>(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		((profiles ?? []) as any[]).map((p) => [p.discord_id, p.id as string])
	);

	const out: CoAuthor[] = [];
	for (const m of withRole) {
		const profileId = profileByDiscord.get(m.user.id);
		if (excludeProfileId && profileId === excludeProfileId) {
			continue;
		}
		out.push({
			avatar_url: discordAvatarUrl(m.user.id, m.user.avatar),
			discord_id: m.user.id,
			name: m.nick || m.user.global_name || m.user.username,
			profile_id: profileId,
		});
	}
	return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureUniqueSlug(supabase: any, base: string): Promise<string> {
	let candidate = base;
	let n = 2;
	while (n < 100) {
		const { data, error } = await supabase
			.from("articles")
			.select("id")
			.eq("app", APP_SCOPE)
			.eq("slug", candidate)
			.maybeSingle();
		if (error) {
			throw new Error(`Slug check failed: ${error.message}`);
		}
		if (!data) {
			return candidate;
		}
		candidate = `${base}-${n}`;
		n++;
	}
	throw new Error("Impossible de trouver un slug unique apres 100 essais.");
}

export async function POST(request: NextRequest) {
	const apiKey = process.env.CLAUDE_API_KEY;
	if (!apiKey) {
		return NextResponse.json(
			{ error: "CLAUDE_API_KEY non configuré côté serveur" },
			{ status: 500 }
		);
	}

	const authHeader = request.headers.get("authorization");
	if (authHeader !== `Bearer ${apiKey}`) {
		return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
	}

	let body: DraftBody;
	try {
		body = (await request.json()) as DraftBody;
	} catch {
		return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
	}

	if (!body.title || typeof body.title !== "string") {
		return NextResponse.json({ error: "Le champ `title` est requis (string)" }, { status: 400 });
	}

	const category: Category = body.category ?? "community";
	if (!VALID_CATEGORIES.includes(category)) {
		return NextResponse.json(
			{
				error: `category invalide. Attendu: ${VALID_CATEGORIES.join("|")}`,
			},
			{ status: 400 }
		);
	}

	if (body.tags !== undefined && !Array.isArray(body.tags)) {
		return NextResponse.json({ error: "`tags` doit être un tableau de strings" }, { status: 400 });
	}

	try {
		const supabase = createAdminClient();
		const authorId = await resolveAuthorId(supabase, body);

		const baseSlug = body.slug ? generateSlug(body.slug) : generateSlug(body.title);
		if (!baseSlug) {
			return NextResponse.json({ error: "Slug dérivé vide — précise `slug`" }, { status: 400 });
		}
		const slug = await ensureUniqueSlug(supabase, baseSlug);

		const tags = body.tags && body.tags.length > 0 ? body.tags : null;
		const content = buildLexical(body.content ?? "");
		const now = new Date().toISOString();

		// Resolve co_authors : direct list + optional Discord role expansion
		const coAuthors: CoAuthor[] = Array.isArray(body.co_authors) ? [...body.co_authors] : [];
		if (body.discord_role_id) {
			const expanded = await fetchCoAuthorsFromDiscordRole(
				supabase,
				body.discord_role_id,
				body.exclude_author_from_co ? authorId : null
			);
			for (const c of expanded) {
				if (!coAuthors.some((existing) => existing.discord_id === c.discord_id)) {
					coAuthors.push(c);
				}
			}
		}

		const row = {
			app: APP_SCOPE,
			author_id: authorId,
			category,
			co_authors: coAuthors.length > 0 ? coAuthors : null,
			content,
			created_at: now,
			excerpt: body.excerpt ?? null,
			featured_image_alt: body.featured_image_alt ?? null,
			featured_image_url: body.featured_image_url ?? null,
			meta_description: body.meta_description ?? body.excerpt ?? null,
			meta_title: body.meta_title ?? body.title,
			slug,
			status: "draft",
			tags,
			title: body.title,
			updated_at: now,
		};

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { data, error } = await (supabase as any)
			.from("articles")
			.insert([row])
			.select("id, slug")
			.single();

		if (error) {
			return NextResponse.json({ error: `Supabase insert: ${error.message}` }, { status: 500 });
		}

		return NextResponse.json(
			{
				authorId,
				editUrl: `${ORIGIN}/dashboard/news/${data.id}`,
				id: data.id,
				previewUrl: `${ORIGIN}/news/${data.slug}?preview=true`,
				slug: data.slug,
			},
			{ status: 201 }
		);
	} catch (error) {
		const msg = (error as Error).message;
		const status = /introuvable|aucun/i.test(msg) ? 404 : 500;
		return NextResponse.json({ error: msg }, { status });
	}
}
