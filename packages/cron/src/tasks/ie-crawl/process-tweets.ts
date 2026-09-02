import { createSupabaseServiceClient } from "@rosegriffon/db/service";
import type { Tables } from "@rosegriffon/db";
import { join } from "node:path";
import { grokChat } from "./grok-oidc";
import { sql } from "../../lib/db.js";

interface MediaItem {
	url: string;
	type: string;
	width?: number;
	height?: number;
	previewUrl?: string;
	original_url?: string;
	original_previewUrl?: string;
}

// Simple helper to detect Japanese characters
const containsJapanese = (text: string) =>
	/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/.test(text);

function escapeRegExp(str: string) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Translation using Google single API
async function translateWithGoogle(text: string, from: string, to: string): Promise<string> {
	if (!text.trim()) return "";
	try {
		const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
		const res = await fetch(url);
		if (res.ok) {
			const data = (await res.json()) as any;
			if (data && data[0]) {
				return data[0].map((x: any) => x[0]).join("");
			}
		}
	} catch (e) {
		console.warn(`[Translator] Google translation failed from ${from} to ${to}:`, e);
	}
	return text;
}

// Translation with pre-translation glossary mapping using placeholders
async function translateWithGlossary(
	text: string,
	from: string,
	to: string,
	replacements: { term: string; lowerTerm: string; frVal: string }[]
): Promise<string> {
	if (!text.trim()) return "";
	if (replacements.length === 0) {
		return translateWithGoogle(text, from, to);
	}

	// 1. Identify and replace terms with placeholders
	let processedText = text;
	const placeholderMap = new Map<string, string>();
	let placeholderIndex = 0;

	const regexCache = new Map<string, RegExp>();
	const globalRegexCache = new Map<string, RegExp>();
	const getRegex = (t: string) => {
		let r = regexCache.get(t);
		if (!r) {
			r = new RegExp("\\b" + escapeRegExp(t) + "\\b", "i");
			regexCache.set(t, r);
		}
		return r;
	};
	const getGlobalRegex = (t: string) => {
		let r = globalRegexCache.get(t);
		if (!r) {
			r = new RegExp("\\b" + escapeRegExp(t) + "\\b", "gi");
			globalRegexCache.set(t, r);
		}
		return r;
	};

	for (const { term, lowerTerm, frVal } of replacements) {
		let matches = false;
		if (from === "ja") {
			matches = processedText.includes(term);
		} else {
			if (processedText.toLowerCase().includes(lowerTerm)) {
				const regex = getRegex(term);
				matches = regex.test(processedText);
			}
		}

		if (matches) {
			const placeholder = ` [[T${placeholderIndex}]] `;
			placeholderMap.set(placeholder.trim(), frVal);

			if (from === "ja") {
				processedText = processedText.replaceAll(term, placeholder);
			} else {
				const regex = getGlobalRegex(term);
				processedText = processedText.replace(regex, placeholder);
			}
			placeholderIndex++;
		}
	}

	// 2. Translate text containing placeholders
	let translated = await translateWithGoogle(processedText, from, to);

	// 3. Replace placeholders back with French values with extra robustness
	for (const [placeholder, frVal] of placeholderMap.entries()) {
		const cleanPlaceholder = placeholder.replace("[[", "").replace("]]", "").trim().toLowerCase();
		const num = cleanPlaceholder.replace("t", "");

		// 3.1. Double brackets: [[T0]]
		const dblRegex = new RegExp("\\[\\s*\\[\\s*[tT]\\s*" + num + "\\s*\\]\\s*\\]", "g");
		translated = translated.replace(dblRegex, frVal);

		// 3.2. Single brackets: [T0]
		const sglRegex = new RegExp("\\[\\s*[tT]\\s*" + num + "\\s*\\]", "g");
		translated = translated.replace(sglRegex, frVal);

		// 3.3. Raw tokens: T0 or T 0 (word boundary)
		const rawRegex = new RegExp("\\b[tT]\\s*" + num + "\\b", "g");
		translated = translated.replace(rawRegex, frVal);
	}

	// Fallback cleanup
	for (const [placeholder, frVal] of placeholderMap.entries()) {
		if (translated.includes(placeholder)) {
			translated = translated.replaceAll(placeholder, frVal);
		}
		const rawPlaceholder = placeholder.trim();
		if (translated.includes(rawPlaceholder)) {
			translated = translated.replaceAll(rawPlaceholder, frVal);
		}
	}

	// Normalise multiple whitespace to a single space
	translated = translated.replace(/\s+/g, " ");

	return translated.trim();
}

/**
 * Traduction auto via Grok (OIDC SuperGrok keyless natif, comme dans bxc xai)
 * + sync avec glossaire Azalée (data/glossary.json partagé avec le traducteur Azalée /tools/translator).
 * Utilisé prioritairement pour tweets AkihiroHino (CEO) et contenus JA IE, pour qualité lore/termes jeu.
 */
async function translateWithGrok(text: string, from: string, to: string): Promise<string> {
	if (!text.trim()) return text;
	const system = `Expert traducteur Inazuma Eleven / Level-5 pour le wiki Azalée (Rose Griffon, azalee.rosegriffon.fr). Traduis le tweet ci-dessous de ${from} vers ${to} (français naturel et fidèle). 

Règles Azalée:
- Noms persos, hissatsu, termes jeu, "Inazuma Eleven", "Victory Road", "Cross" etc. : garde EXACTS ou utilise équiv FR du glossaire Azalée (ex: ne traduis pas "God Hand" en "Main de Dieu" sauf si glossaire le fait).
- Pour Akihiro Hino (CEO LEVEL-5) : ton direct, visionnaire, business + passion IE.
- Output UNIQUEMENT la traduction, rien d'autre, pas de blocs de code ni notes.
- Si JP : traduis le sens complet en gardant termes techniques intacts.`;

	try {
		const res = await grokChat(text, {
			system,
			temperature: 0.12,
			maxTokens: 1200,
		});
		if (res.ok && res.content && res.content.trim().length > 3 && !/no-token|error|désolé/i.test(res.content)) {
			console.log(`[Azalee+Grok] Traduction Grok utilisée pour tweet ${from}->${to} (sync glossaire Azalée)`);
			return res.content.trim();
		}
	} catch (e) {
		console.warn("[Azalee+Grok] Grok OIDC échec (fallback Google+glossaire):", e);
	}
	return text;
}

export async function processTweets() {
	console.log("=== Starting Tweet Processing (Media, Translation, Classification) ===");
	const supabase = createSupabaseServiceClient();

	// Load Glossary for corrections
	let glossary: any = null;
	const glossaryPath = join(process.cwd(), "data", "glossary.json");
	const glossaryFile = Bun.file(glossaryPath);
	if (await glossaryFile.exists()) {
		try {
			glossary = await glossaryFile.json();
			console.log(`[Glossary] Loaded glossary with ${glossary._meta?.counts?.total || 0} entries.`);
		} catch (e) {
			console.error("[Glossary] Failed to parse glossary.json:", e);
		}
	} else {
		console.warn(
			"[Glossary] glossary.json not found. Translation will proceed without glossary corrections."
		);
	}

	// Fetch all tweets (lecture Postgres directe)
	console.log("[DB] Fetching tweets...");
	const tweets = await sql<Tables<"tweets">[]>`SELECT * FROM tweets`;

	console.log(`[DB] Fetched ${tweets.length} tweets.`);

	// Pre-build translation maps from glossary to apply replacement corrections
	const jpToFrMap = new Map<string, string>();
	const enToFrMap = new Map<string, string>();

	if (glossary) {
		const categories = ["characters", "techniques", "auras", "passives", "teams", "items", "terms"];
		for (const cat of categories) {
			const list = glossary[cat] || [];
			for (const entry of list) {
				const frVal = entry.fr || entry.name_FR;
				if (!frVal) continue;

				if (entry.ja && entry.ja.trim()) {
					// Clean ja from furigana / brackets
					const cleanJa = entry.ja
						.split(" ")[0]
						.replaceAll(/[\[\]]/g, "")
						.trim();
					if (cleanJa.length > 1) {
						jpToFrMap.set(cleanJa, frVal);
					}
				}
				if (entry.en && entry.en.trim() && entry.en.toLowerCase() !== frVal.toLowerCase()) {
					enToFrMap.set(entry.en.trim(), frVal);
				}
			}
		}
	}

	// Sort replacements by length descending to replace longer phrases first
	const jpReplacements = Array.from(jpToFrMap.entries())
		.sort((a, b) => b[0].length - a[0].length)
		.map(([term, frVal]) => ({ term, lowerTerm: term.toLowerCase(), frVal }));
	const enReplacements = Array.from(enToFrMap.entries())
		.sort((a, b) => b[0].length - a[0].length)
		.map(([term, frVal]) => ({ term, lowerTerm: term.toLowerCase(), frVal }));

	let updatedCount = 0;

	for (const tweet of tweets) {
		try {
			console.log(`--- Processing Tweet ${tweet.id} (@${tweet.author_username}) ---`);
			let needsUpdate = false;

			// 1. Process Media URLs
			const mediaArray = (tweet.media as unknown as MediaItem[]) || [];
			const updatedMedia: MediaItem[] = [];

			for (let i = 0; i < mediaArray.length; i++) {
				const item = mediaArray[i];
				if (!item || !item.url) continue;

				const isExternal =
					item.url.includes("pbs.twimg.com") ||
					item.url.includes("video.twimg.com") ||
					!item.url.includes("storage/v1/object/public/tweets");

				if (isExternal) {
					console.log(`[Media] Downloading external media URL: ${item.url}`);
					try {
						const res = await fetch(item.url);
						if (!res.ok) {
							console.warn(`[Media] Failed to fetch media from ${item.url}. Status: ${res.status}`);
							updatedMedia.push(item);
							continue;
						}

						const buffer = Buffer.from(await res.arrayBuffer());
						const contentType = res.headers.get("content-type") || "image/jpeg";
						let ext = "jpg";
						if (contentType.includes("png")) ext = "png";
						else if (contentType.includes("webp")) ext = "webp";
						else if (contentType.includes("gif")) ext = "gif";
						else if (contentType.includes("avif")) ext = "avif";

						const storagePath = `${tweet.id}/${tweet.id}_${i}.${ext}`;
						console.log(`[Media] Uploading to Storage: tweets/${storagePath}`);

						const { error: uploadErr } = await supabase.storage
							.from("tweets")
							.upload(storagePath, buffer, {
								contentType,
								upsert: true,
							});

						if (uploadErr) {
							console.error(`[Media] Upload failed:`, uploadErr);
							updatedMedia.push(item);
						} else {
							const publicUrl = `https://azalee.rosegriffon.fr/storage/v1/object/public/tweets/${storagePath}`;
							const originalUrl = item.original_url || item.url;
							const originalPreviewUrl = item.original_previewUrl || item.previewUrl;

							updatedMedia.push({
								...item,
								url: publicUrl,
								previewUrl: publicUrl,
								original_url: originalUrl,
								original_previewUrl: originalPreviewUrl,
							});
							needsUpdate = true;
						}
					} catch (mediaErr) {
						console.error(`[Media] Error processing media URL ${item.url}:`, mediaErr);
						updatedMedia.push(item);
					}
				} else {
					updatedMedia.push(item);
				}
			}

			// Update raw_tweets media references and translate thread replies
			let updatedRawTweets = tweet.raw_tweets;
			if (Array.isArray(updatedRawTweets)) {
				let rawTweetsChanged = false;
				updatedRawTweets = await Promise.all(
					updatedRawTweets.map(async (rt: any) => {
						if (!rt) return rt;
						const updatedRt = { ...rt };

						// 1. Update media URLs
						if (Array.isArray(updatedRt.media)) {
							updatedRt.media = updatedRt.media.map((m: any) => {
								if (m && typeof m.url === "string") {
									const match = updatedMedia.find(
										(um) => um.original_url === m.url || um.url === m.url
									);
									if (match) {
										return { ...m, url: match.url };
									}
								}
								return m;
							});
						}

						// 2. Translate thread reply text if missing
						if (typeof updatedRt.text === "string" && !updatedRt.translation) {
							if (tweet.author_username === "Azalee_IE") {
								updatedRt.translation = updatedRt.text;
							} else {
								const rtIsJa = containsJapanese(updatedRt.text);
								const rtSourceLang = rtIsJa ? "ja" : "en";
								const rtReplacements = rtIsJa ? jpReplacements : enReplacements;
								if (tweet.author_username === "AkihiroHino" || rtIsJa) {
									updatedRt.translation = await translateWithGrok(updatedRt.text, rtSourceLang, "fr");
									if (rtReplacements.length > 0) {
										updatedRt.translation = await translateWithGlossary(updatedRt.translation, rtSourceLang, "fr", rtReplacements);
									}
								} else {
									updatedRt.translation = await translateWithGlossary(
										updatedRt.text,
										rtSourceLang,
										"fr",
										rtReplacements
									);
								}
							}
							rawTweetsChanged = true;
						}

						return updatedRt;
					})
				);

				if (rawTweetsChanged || needsUpdate) {
					needsUpdate = true;
				}
			}

			// 2. Translate text if missing or update
			let translation = tweet.translation;
			const originalText = tweet.text || "";

			if (!translation) {
				if (tweet.author_username === "Azalee_IE") {
					// Azalee writes in French already
					translation = originalText;
					needsUpdate = true;
				} else {
					console.log(`[Translation] Translating tweet text...`);
					const isJa = containsJapanese(originalText);
					const sourceLang = isJa ? "ja" : "en";
					const replacements = isJa ? jpReplacements : enReplacements;
					let translated: string;
					if (tweet.author_username === "AkihiroHino" || isJa) {
						// Sync Azalee translate (glossaire + /tools/translator) + Grok natif (OIDC comme bxc)
						translated = await translateWithGrok(originalText, sourceLang, "fr");
						if (replacements.length > 0) {
							translated = await translateWithGlossary(translated, sourceLang, "fr", replacements);
						}
					} else {
						translated = await translateWithGlossary(
							originalText,
							sourceLang,
							"fr",
							replacements
						);
					}

					translation = translated;
					needsUpdate = true;
					console.log(
						`[Translation] Translated: "${originalText.slice(0, 40)}..." -> "${translation.slice(0, 40)}..."`
					);
				}
			}

			// 3. Classify tweet if missing or update
			let category = tweet.category;
			if (!category) {
				console.log(`[Classification] Classifying tweet...`);
				const lowerText = originalText.toLowerCase() + " " + (translation || "").toLowerCase();

				if (/leak|rumeur|leaké|corocoro leak|scans corocoro|famitsu leak/i.test(lowerText)) {
					category = "leak";
				} else if (/patch|version|mise à jour|maj|patch note|ver\.|ver_/i.test(lowerText)) {
					category = "patch-note";
				} else if (/fan|communauté|fan-art|dessin|concours|création/i.test(lowerText)) {
					category = "fan-content";
				} else if (
					/trailer|pv|vidéo|scan|média|teaser|illustration|image|screenshot/i.test(lowerText)
				) {
					category = "media";
				} else {
					category = "news";
				}

				needsUpdate = true;
				console.log(`[Classification] Categorized as: ${category}`);
			}

			if (needsUpdate) {
				const { error: updateErr } = await supabase
					.from("tweets")
					.update({
						media: updatedMedia as any,
						raw_tweets: updatedRawTweets as any,
						translation,
						category,
						updated_at: new Date().toISOString(),
					})
					.eq("id", tweet.id);

				if (updateErr) {
					console.error(`[DB] Failed to update tweet ${tweet.id}:`, updateErr);
				} else {
					console.log(`[DB] Successfully updated tweet ${tweet.id}`);
					updatedCount++;
				}
			} else {
				console.log(`[Skip] Tweet ${tweet.id} already up-to-date.`);
			}
		} catch (tweetErr) {
			console.error(`Error processing tweet ${tweet.id}:`, tweetErr);
		}
	}

	console.log(`=== Tweet Processing Finished. Updated ${updatedCount} tweets. ===`);
}

// Standalone execution support
if (import.meta.main) {
	processTweets().catch(console.error);
}
