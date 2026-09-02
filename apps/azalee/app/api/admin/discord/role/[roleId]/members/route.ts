import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * GET /api/admin/discord/role/[roleId]/members
 *
 * Liste les membres d'un role Discord du guild Rose Griffon.
 * Auth: Bearer CLAUDE_API_KEY (meme que /api/admin/news/draft).
 *
 * Pour chaque membre, retourne:
 *   { id, username, global_name, nick, name (best display), avatar_url, profile_id? }
 *
 * `profile_id` est presents si un profile Supabase existe avec ce discord_id.
 *
 * Variables env requises:
 *   CLAUDE_API_KEY        (bearer)
 *   DISCORD_BOT_TOKEN     (token du bot — partage avec rg-bot, meme app Discord)
 *   DISCORD_GUILD_ID      (guild Rose Griffon)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function avatarUrl(userId: string, hash: string | null | undefined): string {
	if (!hash) {
		const idx = Number((BigInt(userId) >> 22n) % 6n);
		return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
	}
	const ext = hash.startsWith("a_") ? "gif" : "webp";
	return `https://cdn.discordapp.com/avatars/${userId}/${hash}.${ext}?size=256`;
}

async function fetchAllMembers(guildId: string, token: string): Promise<DiscordMember[]> {
	const all: DiscordMember[] = [];
	let after: string | undefined;
	while (true) {
		const u = new URL(`https://discord.com/api/v10/guilds/${guildId}/members`);
		u.searchParams.set("limit", "1000");
		if (after) {
			u.searchParams.set("after", after);
		}
		const res = await fetch(u, {
			headers: { Authorization: `Bot ${token}` },
		});
		if (!res.ok) {
			throw new Error(`Discord ${res.status}: ${(await res.text()).slice(0, 200)}`);
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
	return all;
}

export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ roleId: string }> }
) {
	const apiKey = process.env.CLAUDE_API_KEY;
	if (!apiKey) {
		return NextResponse.json(
			{ error: "CLAUDE_API_KEY non configuré côté serveur" },
			{ status: 500 }
		);
	}
	if (request.headers.get("authorization") !== `Bearer ${apiKey}`) {
		return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
	}

	const { roleId } = await params;
	if (!/^\d{17,20}$/.test(roleId)) {
		return NextResponse.json({ error: "roleId Discord invalide" }, { status: 400 });
	}

	const token = process.env.DISCORD_BOT_TOKEN;
	const guildId = process.env.DISCORD_GUILD_ID;
	if (!token || !guildId) {
		return NextResponse.json(
			{ error: "DISCORD_BOT_TOKEN/DISCORD_GUILD_ID non configurés" },
			{ status: 500 }
		);
	}

	let members: DiscordMember[];
	try {
		members = await fetchAllMembers(guildId, token);
	} catch (error) {
		return NextResponse.json({ error: (error as Error).message }, { status: 502 });
	}

	const withRole = members.filter((m) => m.roles?.includes(roleId));
	if (withRole.length === 0) {
		return NextResponse.json({ members: [], roleId });
	}

	// Lookup profiles existants
	const { createAdminClient } = await import("@/lib/supabase/admin");
	const supabase = createAdminClient();
	const discordIds = withRole.map((m) => m.user.id);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data: profiles } = await (supabase as any)
		.from("profiles")
		.select("id, discord_id, username, full_name")
		.in("discord_id", discordIds);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const profileByDiscord = new Map<string, any>(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		((profiles ?? []) as any[]).map((p) => [p.discord_id, p])
	);

	const out = withRole.map((m) => {
		const profile = profileByDiscord.get(m.user.id);
		return {
			avatar_url: avatarUrl(m.user.id, m.user.avatar),
			discord_id: m.user.id,
			global_name: m.user.global_name ?? null,
			name: m.nick || m.user.global_name || m.user.username,
			nick: m.nick ?? null,
			profile_full_name: profile?.full_name ?? null,
			profile_id: profile?.id ?? null,
			profile_username: profile?.username ?? null,
			username: m.user.username,
		};
	});

	return NextResponse.json({ count: out.length, members: out, roleId });
}
