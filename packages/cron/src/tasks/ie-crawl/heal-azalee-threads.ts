import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { XClient, XSession } from "@aphrody-code/x";
import { createSupabaseServiceClient } from "@rosegriffon/db/service";
import { syncThread } from "./sync-specific-thread";

// Répare en masse les threads Azalee tronqués (timeline collapse / thread()
// coupé sur 429 lors du re-crawl). Pour chaque thread stocké, on refetch le
// thread complet et on ne réécrit QUE s'il a plus de tweets (non destructif).
//
// Résilience rate-limit X (TweetDetail ≈ 50 req/15min) :
//  - checkpoint /tmp : les threads déjà vérifiés (réel ≤ stocké) ou réparés ne
//    sont PAS re-sondés au relancement → resume sans gaspiller d'API.
//  - sur N erreurs consécutives (429), on attend 16 min puis on reprend, au
//    lieu d'abandonner. Plafonné pour ne pas tourner indéfiniment.
const CHECKPOINT = "/tmp/heal_azalee_verified.json";

function loadVerified(): Set<string> {
	try {
		if (existsSync(CHECKPOINT)) {
			return new Set(JSON.parse(readFileSync(CHECKPOINT, "utf8")) as string[]);
		}
	} catch {
		// checkpoint corrompu → on repart de zéro
	}
	return new Set();
}

function saveVerified(set: Set<string>): void {
	try {
		writeFileSync(CHECKPOINT, JSON.stringify([...set]));
	} catch {
		// non bloquant
	}
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
	const screenName = process.argv[2] || "Azalee_IE";
	const client = new XClient(XSession.loadOrEnv());
	const supabase = createSupabaseServiceClient();

	const { data: threads, error } = await supabase
		.from("tweets")
		.select("id, tweet_count")
		.eq("author_username", screenName)
		.eq("is_thread", true)
		.order("created_at", { ascending: false });

	if (error) {
		console.error("Lecture des threads échouée :", error.message);
		return;
	}
	const list = threads ?? [];
	const verified = loadVerified();
	console.log(
		`[Heal] ${list.length} threads @${screenName} (${verified.size} déjà vérifiés, ignorés).`
	);

	let healed = 0;
	let skipped = 0;
	let consecutiveErrors = 0;
	let rateWaits = 0;
	const MAX_CONSECUTIVE_ERRORS = 5;
	const MAX_RATE_WAITS = 6;
	const RATE_WAIT_MS = 16 * 60 * 1000;

	for (let i = 0; i < list.length; i++) {
		const row = list[i]!;
		const id = row.id as string;
		const stored = (row.tweet_count as number) ?? 0;
		if (verified.has(id)) continue;

		try {
			const r = await syncThread(client, supabase, id, screenName, { onlyIfLarger: true });
			consecutiveErrors = 0;
			verified.add(id);
			saveVerified(verified);
			if (r.action === "healed") {
				healed++;
				console.log(`[Heal] ✓ ${id} : ${stored} → ${r.after} tweets RÉPARÉ.`);
			} else {
				skipped++;
				console.log(`[Heal] · ${id} : ${stored} (réel ${r.after}) ${r.action}.`);
			}
		} catch (caught) {
			consecutiveErrors++;
			console.warn(
				`[Heal] ! ${id} échec (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}) :`,
				caught instanceof Error ? caught.message : caught
			);
			if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
				if (rateWaits >= MAX_RATE_WAITS) {
					console.error(
						`[Heal] Abandon : ${MAX_RATE_WAITS} fenêtres de rate-limit épuisées. ` +
							`Relancer le script plus tard pour terminer (checkpoint conservé).`
					);
					break;
				}
				rateWaits++;
				console.log(
					`[Heal] Rate-limit X probable — pause 16 min (${rateWaits}/${MAX_RATE_WAITS}) puis reprise…`
				);
				await sleep(RATE_WAIT_MS);
				consecutiveErrors = 0;
				i--; // on rejoue le thread courant après la pause
				continue;
			}
		}
		await sleep(1800); // throttle anti rate-limit
	}

	console.log(
		`[Heal] Terminé : ${healed} réparés, ${skipped} déjà complets. ${verified.size}/${list.length} vérifiés.`
	);
}

main();
