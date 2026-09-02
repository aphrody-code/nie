import { XClient, XSession, type Tweet } from "@aphrody-code/x";
import { createSupabaseServiceClient } from "@rosegriffon/db/service";

type SupabaseService = ReturnType<typeof createSupabaseServiceClient>;

export type MediaItem = {
	id: string;
	type: string;
	url?: string;
	previewUrl?: string;
	video_url?: string;
	preview_url?: string;
	original_url?: string;
	original_previewUrl?: string;
	width?: number;
	height?: number;
	[key: string]: string | number | boolean | null | undefined;
};

type RawMedia = {
	id?: string;
	type?: string;
	url?: string;
	preview_url?: string;
	video_url?: string;
	width?: number;
	height?: number;
};

// Récupère TOUS les tweets d'un thread en paginant TweetDetail (la timeline
// collapse les longs self-threads à ~5 tweets → il FAUT thread() paginé sinon
// la news est tronquée). Garde uniquement les tweets de l'auteur, triés par id.
export async function fetchFullThread(
	client: XClient,
	convId: string,
	screenName: string,
	maxPages = 15
): Promise<Tweet[]> {
	const all = new Map<string, Tweet>();
	let cursor: string | undefined;
	let stagnantPages = 0;
	for (let p = 0; p < maxPages; p++) {
		const before = all.size;
		const page = await Promise.race([
			client.thread(convId, cursor),
			new Promise<never>((_, rej) => setTimeout(() => rej(new Error("thread() timeout")), 20000)),
		]);
		for (const t of page.tweets || []) {
			if (t.author?.username?.toLowerCase() === screenName.toLowerCase()) {
				all.set(t.id, t);
			}
		}
		// Anti-boucle : si 2 pages d'affilée n'apportent rien de neuf, on s'arrête
		// même si un cursor est renvoyé (X répète parfois le dernier curseur).
		stagnantPages = all.size === before ? stagnantPages + 1 : 0;
		if (!page.next_cursor || stagnantPages >= 2) break;
		cursor = page.next_cursor;
	}
	return [...all.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// Télécharge un binaire et l'upload dans le bucket `tweets`. Retourne l'URL
// publique azalee, ou null en cas d'échec (on garde alors l'URL source).
async function mirrorToStorage(
	supabase: SupabaseService,
	srcUrl: string,
	storagePath: string,
	fallbackContentType: string
): Promise<string | null> {
	try {
		const res = await fetch(srcUrl);
		if (!res.ok) {
			console.warn(`[Media] fetch ${srcUrl} → ${res.status}`);
			return null;
		}
		const buffer = Buffer.from(await res.arrayBuffer());
		const contentType = res.headers.get("content-type") || fallbackContentType;
		const { error } = await supabase.storage.from("tweets").upload(storagePath, buffer, {
			contentType,
			upsert: true,
		});
		if (error) {
			console.error(`[Media] upload ${storagePath} failed:`, error.message);
			return null;
		}
		return `https://azalee.rosegriffon.fr/storage/v1/object/public/tweets/${storagePath}`;
	} catch (err) {
		console.error(`[Media] error ${srcUrl}:`, err instanceof Error ? err.message : err);
		return null;
	}
}

function extFromUrl(url: string, fallback: string): string {
	const base = url.split("?")[0] ?? url;
	const m = base.match(/\.([a-z0-9]{2,4})$/i);
	return m?.[1] ? m[1].toLowerCase() : fallback;
}

async function processTweetMedia(
	supabase: SupabaseService,
	rootId: string,
	tweetId: string,
	rawMedia: RawMedia[]
): Promise<MediaItem[]> {
	const out: MediaItem[] = [];
	for (let i = 0; i < rawMedia.length; i++) {
		const m = rawMedia[i];
		if (!m) continue;
		const isVideo = m.type === "video" || m.type === "animated_gif";

		if (isVideo && m.video_url) {
			const vExt = extFromUrl(m.video_url, "mp4");
			const vPath = `${rootId}/${tweetId}_${i}.${vExt}`;
			const videoPublic = await mirrorToStorage(supabase, m.video_url, vPath, "video/mp4");
			const posterSrc = m.preview_url || m.url;
			let posterPublic: string | null = null;
			if (posterSrc) {
				const pExt = extFromUrl(posterSrc, "jpg");
				const pPath = `${rootId}/${tweetId}_${i}_poster.${pExt}`;
				posterPublic = await mirrorToStorage(supabase, posterSrc, pPath, "image/jpeg");
			}
			out.push({
				id: m.id ?? "",
				type: m.type ?? "video",
				url: videoPublic ?? m.video_url,
				video_url: videoPublic ?? m.video_url,
				preview_url: posterPublic ?? m.preview_url,
				previewUrl: posterPublic ?? m.preview_url,
				original_url: m.video_url,
				original_previewUrl: m.preview_url,
				...(typeof m.width === "number" ? { width: m.width } : {}),
				...(typeof m.height === "number" ? { height: m.height } : {}),
			});
			continue;
		}

		const srcUrl = m.url || m.preview_url;
		if (!srcUrl) continue;
		const ext = extFromUrl(srcUrl, "jpg");
		const path = `${rootId}/${tweetId}_${i}.${ext}`;
		const publicUrl = await mirrorToStorage(supabase, srcUrl, path, "image/jpeg");
		out.push({
			id: m.id ?? "",
			type: m.type ?? "photo",
			url: publicUrl ?? srcUrl,
			previewUrl: publicUrl ?? srcUrl,
			preview_url: publicUrl ?? srcUrl,
			original_url: srcUrl,
			original_previewUrl: m.preview_url ?? srcUrl,
			...(typeof m.width === "number" ? { width: m.width } : {}),
			...(typeof m.height === "number" ? { height: m.height } : {}),
		});
	}
	return out;
}

function classify(headText: string): string {
	const t = headText.toLowerCase();
	if (/leak|rumeur|leaké|corocoro/i.test(t)) return "leak";
	if (/patch|version|mise à jour|maj|patch note/i.test(t)) return "patch-note";
	if (/fan|communauté/i.test(t)) return "fan-content";
	if (/trailer|pv|vidéo|scan|illustration/i.test(t)) return "media";
	return "news";
}

export type SyncResult = {
	convId: string;
	rootId: string;
	before: number;
	after: number;
	action: "healed" | "skip-not-larger" | "empty";
};

// Resynchronise un thread complet (fetch paginé + mirror média + upsert).
// `onlyIfLarger` : ne réécrit que si le thread réel a PLUS de tweets que la
// version stockée (réparation non destructive des threads tronqués).
export async function syncThread(
	client: XClient,
	supabase: SupabaseService,
	convId: string,
	screenName: string,
	opts: { onlyIfLarger?: boolean } = {}
): Promise<SyncResult> {
	const threadTweets = await fetchFullThread(client, convId, screenName);
	if (threadTweets.length === 0) {
		return { convId, rootId: convId, before: 0, after: 0, action: "empty" };
	}

	const headTweet = threadTweets.find((t) => t.id === convId) || threadTweets[0]!;
	const lastTweet = threadTweets[threadTweets.length - 1]!;
	const rootId = lastTweet.id;

	let before = 0;
	if (opts.onlyIfLarger) {
		const { data: existing } = await supabase
			.from("tweets")
			.select("tweet_count")
			.eq("id", rootId)
			.maybeSingle();
		before = (existing?.tweet_count as number) ?? 0;
		if (threadTweets.length <= before) {
			return { convId, rootId, before, after: threadTweets.length, action: "skip-not-larger" };
		}
	}

	const allThreadMedia: MediaItem[] = [];
	const processedRawTweets = [];
	for (const t of threadTweets) {
		const media = await processTweetMedia(supabase, rootId, t.id, (t.media || []) as RawMedia[]);
		allThreadMedia.push(...media);
		processedRawTweets.push({
			id: t.id,
			text: t.text,
			fullText: t.text,
			translation: t.text, // Azalée = compte FR
			created_at: t.created_at,
			in_reply_to_status_id: t.in_reply_to_status_id ?? null,
			media,
		});
	}

	const createdAtIso = headTweet.created_at
		? new Date(headTweet.created_at).toISOString()
		: new Date().toISOString();

	const tweetRow = {
		id: rootId,
		author_id: headTweet.author_id || "1391462345197686789",
		author_name: headTweet.author?.name || "Azalée 🌸 | Inazuma Eleven FR",
		author_username: headTweet.author?.username || screenName,
		created_at: createdAtIso,
		text: headTweet.text,
		translation: headTweet.text,
		is_thread: threadTweets.length > 1,
		tweet_count: threadTweets.length,
		metrics: {
			reply_count: lastTweet.reply_count,
			retweet_count: lastTweet.retweet_count,
			like_count: lastTweet.like_count,
			quote_count: lastTweet.quote_count,
			view_count: lastTweet.view_count,
		},
		media: allThreadMedia,
		quoted_tweets: lastTweet.quoted_tweet
			? JSON.parse(JSON.stringify(lastTweet.quoted_tweet))
			: null,
		raw_tweets: processedRawTweets,
		category: classify(headTweet.text),
		updated_at: new Date().toISOString(),
	};

	const { error: upsertErr } = await supabase.from("tweets").upsert(tweetRow);
	if (upsertErr) throw new Error(`upsert ${rootId}: ${upsertErr.message}`);

	const deleteIds = threadTweets.map((t) => t.id).filter((id) => id !== rootId);
	if (deleteIds.length > 0) {
		await supabase.from("tweets").delete().in("id", deleteIds);
	}
	return { convId, rootId, before, after: threadTweets.length, action: "healed" };
}

async function main() {
	const convId = process.argv[2] || "2061064712393982247";
	const screenName = process.argv[3] || "Azalee_IE";
	console.log(`=== Sync complet du thread ${convId} (@${screenName}) ===`);
	const client = new XClient(XSession.loadOrEnv());
	const supabase = createSupabaseServiceClient();
	const r = await syncThread(client, supabase, convId, screenName);
	console.log(`✓ ${r.action} : thread ${convId} → ${r.after} tweets (root ${r.rootId}).`);
}

if (import.meta.main) {
	main();
}
