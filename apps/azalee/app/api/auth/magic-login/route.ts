import crypto from "node:crypto";
import { getSupabaseClient } from "@/lib/api/supabase";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { ADMIN_ROLES } from "@/lib/auth-roles";
import { absoluteUrl, getPublicOrigin } from "@/lib/site-url";

/**
 * Allowed IPs for magic login. Only these IPs can access this endpoint.
 * localhost + server IP. Add your own IP here if needed.
 */
const ALLOWED_IPS = new Set([
	"127.0.0.1",
	"::1",
	"localhost",
	// Server's own IP (requests from the machine itself)
	"81.64.138.142",
]);

/**
 * Magic login secret token. Must be passed as ?secret=... query param.
 * Falls back to a substring of BETTER_AUTH_SECRET if MAGIC_LOGIN_SECRET is not set.
 */
function getMagicSecret(): string {
	return process.env.MAGIC_LOGIN_SECRET || process.env.BETTER_AUTH_SECRET?.slice(0, 16) || "";
}

function signCookieValue(value: string, secret: string): string {
	const signature = crypto.createHmac("sha256", secret).update(value).digest("base64");
	return encodeURIComponent(`${value}.${signature}`);
}

/**
 * Magic Login - admin login without password.
 * SECURED: requires IP whitelist + secret token.
 *
 * Usage:
 *   GET /api/auth/magic-login?secret=<token>              → auto-select first admin
 *   GET /api/auth/magic-login?secret=<token>&user=<uuid>  → login as specific admin
 *   GET /api/auth/magic-login?secret=<token>&list=1       → list eligible users
 */
export async function GET(request: Request) {
	const reqHeaders = await headers();
	const url = new URL(request.url);

	// ── IP whitelist ───────────────────────────────────
	const forwarded = reqHeaders.get("x-forwarded-for");
	const realIp = forwarded ? forwarded.split(",")[0].trim() : "unknown";

	if (!ALLOWED_IPS.has(realIp)) {
		await logAudit("system", "magic_login_blocked", {
			ip: realIp,
			reason: "ip_not_allowed",
		});
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	// ── Secret token validation ────────────────────────
	const secret = url.searchParams.get("secret");
	if (!secret || secret !== getMagicSecret()) {
		await logAudit("system", "magic_login_blocked", {
			ip: realIp,
			reason: "invalid_secret",
		});
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	// Client Admin Supabase (service-role via @rosegriffon/db)
	const supabaseAdmin = getSupabaseClient();

	// Mode liste
	if (url.searchParams.get("list") === "1") {
		const { data: users } = await supabaseAdmin
			.from("profiles")
			.select("id, username, full_name, role")
			.in("role", ADMIN_ROLES as unknown as string[])
			.order("role");

		const baseUrl = getPublicOrigin();
		const links = (users || []).map((u) => ({
			full_name: u.full_name,
			magic_link: `${baseUrl}/api/auth/magic-login?secret=${encodeURIComponent(secret)}&user=${u.id}`,
			role: u.role,
			username: u.username,
		}));

		return NextResponse.json({ total: links.length, users: links });
	}

	// Trouver l'utilisateur cible
	const targetUserId = url.searchParams.get("user");
	let targetUser: { id: string; username: string; role: string };

	if (targetUserId) {
		const { data, error } = await supabaseAdmin
			.from("profiles")
			.select("id, username, role")
			.eq("id", targetUserId)
			.in("role", ADMIN_ROLES as unknown as string[])
			.single();

		if (error || !data) {
			return NextResponse.json({ error: "User not found or not admin" }, { status: 404 });
		}
		targetUser = data;
	} else {
		const { data, error } = await supabaseAdmin
			.from("profiles")
			.select("id, username, role")
			.in("role", ["superadmin", "admin"])
			.order("role", { ascending: false })
			.limit(1)
			.single();

		if (error || !data) {
			return NextResponse.json({ error: "No admin user found" }, { status: 404 });
		}
		targetUser = data;
	}

	try {
		const ctx = await auth.$context;
		const session = await ctx.internalAdapter.createSession(targetUser.id, false, {
			ipAddress: realIp,
			userAgent: reqHeaders.get("user-agent") || "Magic Login",
		});

		if (!session?.token) {
			return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
		}

		await logAudit(
			targetUser.id,
			"magic_login",
			{
				role: targetUser.role,
				username: targetUser.username,
			},
			{ ipAddress: realIp }
		);

		const response = NextResponse.redirect(absoluteUrl("/dashboard"));
		const authSecret = process.env.BETTER_AUTH_SECRET!;
		const signedToken = signCookieValue(session.token, authSecret);
		const cookieName = "__Secure-better-auth.session_token";
		const maxAge = 60 * 60 * 24 * 365 * 10;

		response.headers.append(
			"set-cookie",
			`${cookieName}=${signedToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
		);

		return response;
	} catch (error) {
		console.error("[Magic Login] Erreur:", error);
		return NextResponse.json({ error: "Session creation failed" }, { status: 500 });
	}
}
