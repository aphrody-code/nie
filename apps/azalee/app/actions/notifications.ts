"use server";

import { getServerSession } from "@/lib/auth-helpers";
import { createClient } from "@/lib/supabase/server";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";

/**
 * Charge `web-push` à la DEMANDE (jamais au top-level du module).
 *
 * `web-push` est un `serverExternalPackages` : Next l'externalise et s'attend à
 * le trouver dans `.next/standalone/.../node_modules`. Or le tracing standalone
 * peut produire un symlink DANGLING (cf. `Failed to load external module
 * web-push … ENOENT`). Un `import webpush from "web-push"` en tête de module
 * faisait alors throw l'évaluation du module — et comme Next co-bundle TOUTES
 * les server actions d'une page dans un même graphe, ça faisait planter
 * `searchTranslations`/`searchRagOnly`/`searchGlobal`/`searchCompareCharacters`
 * (comparateur, traducteur, recherche assistée morts "du tout"). En important
 * web-push uniquement dans `sendPushToAll`, le module se charge toujours et seul
 * l'envoi de push réel dépend du paquet natif.
 */
async function getWebPush() {
	const mod = await import("web-push");
	const webpush = mod.default ?? mod;
	if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
		webpush.setVapidDetails("mailto:azalee@rose-griffon.fr", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
	}
	return webpush;
}

export async function getNotifications(limit = 20): Promise<
	Array<{
		id: string;
		type: string;
		title: string;
		body: string | null;
		data: Record<string, unknown>;
		read: boolean;
		created_at: string;
	}>
> {
	const session = await getServerSession();
	if (!session?.user) {
		return [];
	}

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data } = await (supabase as any)
		.from("notifications")
		.select("id, type, title, body, data, read, created_at")
		.eq("user_id", session.user.id)
		.order("created_at", { ascending: false })
		.limit(limit);

	return data || [];
}

export async function getUnreadCount(): Promise<number> {
	const session = await getServerSession();
	if (!session?.user) {
		return 0;
	}

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { count } = await (supabase as any)
		.from("notifications")
		.select("id", { count: "exact", head: true })
		.eq("user_id", session.user.id)
		.eq("read", false);

	return count || 0;
}

export async function markAsRead(notificationId: string): Promise<void> {
	const session = await getServerSession();
	if (!session?.user) {
		return;
	}

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	await (supabase as any)
		.from("notifications")
		.update({ read: true })
		.eq("id", notificationId)
		.eq("user_id", session.user.id);
}

export async function markAllAsRead(): Promise<void> {
	const session = await getServerSession();
	if (!session?.user) {
		return;
	}

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	await (supabase as any)
		.from("notifications")
		.update({ read: true })
		.eq("user_id", session.user.id)
		.eq("read", false);
}

export async function subscribeToPush(subscription: {
	endpoint: string;
	keys: { p256dh: string; auth: string };
}): Promise<{ success: boolean }> {
	const session = await getServerSession();
	if (!session?.user) {
		throw new Error("Non authentifié");
	}

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	await (supabase as any).from("push_subscriptions").upsert(
		{
			auth_key: subscription.keys.auth,
			endpoint: subscription.endpoint,
			p256dh: subscription.keys.p256dh,
			user_id: session.user.id,
		},
		{ onConflict: "user_id,endpoint" }
	);

	return { success: true };
}

export async function unsubscribeFromPush(endpoint: string): Promise<void> {
	const session = await getServerSession();
	if (!session?.user) {
		return;
	}

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	await (supabase as any)
		.from("push_subscriptions")
		.delete()
		.eq("user_id", session.user.id)
		.eq("endpoint", endpoint);
}

export async function sendPushToAll(
	title: string,
	body: string,
	data: Record<string, unknown> = {}
): Promise<{ sent: number; failed: number }> {
	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	// Get all push subscriptions
	const { data: subscriptions } = await client
		.from("push_subscriptions")
		.select("endpoint, p256dh, auth_key, user_id");

	if (!subscriptions || subscriptions.length === 0) {
		return { failed: 0, sent: 0 };
	}

	// Create in-app notifications for all unique users
	const userIds = [...new Set(subscriptions.map((s: { user_id: string }) => s.user_id))];
	const notifications = userIds.map((userId) => ({
		body,
		data,
		title,
		type: "article",
		user_id: userId,
	}));

	await client.from("notifications").insert(notifications);

	// Send push notifications
	const payload = JSON.stringify({ body, data, title });
	let sent = 0;
	let failed = 0;

	let webpush: Awaited<ReturnType<typeof getWebPush>>;
	try {
		webpush = await getWebPush();
	} catch {
		// `web-push` indisponible (module externe non tracé) — les notifications
		// in-app sont déjà enregistrées ci-dessus ; on saute juste l'envoi push.
		return { failed: subscriptions.length, sent: 0 };
	}

	await Promise.allSettled(
		subscriptions.map(async (sub: { endpoint: string; p256dh: string; auth_key: string }) => {
			try {
				await webpush.sendNotification(
					{
						endpoint: sub.endpoint,
						keys: { auth: sub.auth_key, p256dh: sub.p256dh },
					},
					payload
				);
				sent++;
			} catch {
				failed++;
				// Remove invalid subscriptions (410 Gone)
				await client.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
			}
		})
	);

	return { failed, sent };
}
