/**
 * Playlists YouTube lues sans clé d'API — module de PARSING pur, plus une
 * fonction de récupération.
 *
 * ── POURQUOI CE MODULE, APRÈS `youtube-feed.ts` ────────────────────────────
 * Le flux Atom d'une chaîne plafonne à quinze entrées, et ce plafond est ce qui
 * limite la VO du catalogue : `LEVEL5ch` n'y a jamais donné que treize épisodes.
 * `youtube-feed.ts` documente par ailleurs que l'onglet `/videos` ne rend plus
 * sa grille — revérifié le 2026-09-03, toujours vrai (1 seul `videoId` dans
 * 814 ko de page).
 *
 * Une PAGE DE PLAYLIST, elle, est encore rendue côté serveur. Mesuré le
 * 2026-09-03 sur quatre chaînes, en comptant les `contentId` distincts :
 *
 * | playlist d'uploads        | Atom | page de playlist |
 * |---------------------------|------|------------------|
 * | `UU1cdmvDug3oRgl_d-w1fdTg`|   15 |               96 |
 * | `UUGMvTdioudzJSa5uTAY6FDw`|   15 |              100 |
 * | `UUXFes6UCUtCUZXFVYT8AD7A`|   15 |               59 |
 * | `UUlfhcLqicImW9Se7NKaFADQ`|   15 |               21 |
 *
 * ── CE QUE ÇA NE DONNE PAS, ET IL FAUT LE DIRE ─────────────────────────────
 * Il n'y a **aucun jeton de continuation** dans ces pages
 * (`continuationItemRenderer` : 0 occurrence). Ce que la page rend est donc
 * tout ce qu'on aura : entre 21 et 100 vidéos, jamais l'historique complet
 * d'une chaîne qui en compte des centaines. La suite exige `playlistItems.list`
 * de la YouTube Data API, donc une clé — cf. `docs` de la moisson.
 *
 * Le cas de `LEVEL5ch` le montre crûment : ses 21 dernières mises en ligne sont
 * des vidéos promotionnelles de jeu, pas des épisodes. Ses épisodes VO sont
 * plus loin dans l'historique, c'est-à-dire hors d'atteinte sans clé.
 *
 * ── AUCUN CONTOURNEMENT ────────────────────────────────────────────────────
 * On demande une URL publique, on suit les redirections que YouTube émet
 * lui-même (il renvoie vers `?cbrd=1&ucbcb=1`), et on lit le HTML servi. Pas
 * d'en-tête falsifié, pas de cookie de consentement fabriqué, pas d'appel à
 * l'API interne `youtubei` : uniquement ce qu'un lien public rend.
 */

/** Une entrée de playlist telle que la page la rend. */
export interface EntreePlaylist {
	videoId: string;
	titre: string;
	url: string;
}

/** Identifiant de la playlist des mises en ligne d'une chaîne (`UC…` → `UU…`). */
export function playlistDesUploads(channelId: string): string | null {
	return /^UC[A-Za-z0-9_-]{22}$/.test(channelId) ? `UU${channelId.slice(2)}` : null;
}

/** URL publique d'une playlist. */
export function urlPlaylist(playlistId: string): string {
	return `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
}

/**
 * Décode les échappements JSON d'un littéral de chaîne extrait à la regex.
 *
 * Le HTML porte du JSON *dans* du JavaScript : les titres y arrivent avec
 * `'` pour une apostrophe et `&` pour une esperluette. Sans ce
 * décodage, « Aujourd'hui » entrerait tel quel au catalogue.
 */
export function decoderLitteral(texte: string): string {
	return texte
		.replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
		.replace(/\\n/g, "\n")
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, "\\");
}

/**
 * Entrées d'une page de playlist.
 *
 * ── POURQUOI ON DÉCOUPE SUR `lockupViewModel` ──────────────────────────────
 * L'identifiant apparaît des dizaines de fois par vidéo dans la page (menus,
 * files d'attente, traceurs de clic) : une regex globale sur `"videoId"` rend
 * les bons identifiants mais AUCUN moyen de les rattacher à un titre. Le seul
 * endroit où les deux cohabitent est le bloc d'affichage `lockupViewModel`, qui
 * porte `contentId` d'un côté et `lockupMetadataViewModel.title.content` de
 * l'autre. On découpe donc par bloc, et une entrée sans les deux est ignorée
 * plutôt que complétée au jugé.
 */
export function parserPagePlaylist(html: string): EntreePlaylist[] {
	const entrees: EntreePlaylist[] = [];
	const vus = new Set<string>();

	for (const bloc of html.split('"lockupViewModel":{').slice(1)) {
		const id = /"contentId":"([A-Za-z0-9_-]{11})"/.exec(bloc);
		const titre = /"lockupMetadataViewModel":\{"title":\{"content":"((?:[^"\\]|\\.)*)"/.exec(bloc);
		if (!id?.[1] || !titre?.[1]) continue;
		const videoId = id[1];
		if (vus.has(videoId)) continue;
		vus.add(videoId);
		entrees.push({
			videoId,
			titre: decoderLitteral(titre[1]),
			url: `https://www.youtube.com/watch?v=${videoId}`,
		});
	}
	return entrees;
}

/** Playlists publiées par une chaîne : leur identifiant et leur nom. */
export function parserPagePlaylists(html: string): { playlistId: string; titre: string }[] {
	const listes: { playlistId: string; titre: string }[] = [];
	const vus = new Set<string>();

	for (const bloc of html.split('"lockupViewModel":{').slice(1)) {
		const id = /"contentId":"([A-Za-z0-9_-]{13,42})"/.exec(bloc);
		const titre = /"lockupMetadataViewModel":\{"title":\{"content":"((?:[^"\\]|\\.)*)"/.exec(bloc);
		if (!id?.[1] || !titre?.[1]) continue;
		const playlistId = id[1];
		// Un `contentId` de onze caractères est une VIDÉO, pas une playlist : la
		// page des playlists en porte aussi (vignettes de tête de liste).
		if (playlistId.length === 11 || vus.has(playlistId)) continue;
		vus.add(playlistId);
		listes.push({ playlistId, titre: decoderLitteral(titre[1]) });
	}
	return listes;
}

/** En-tête d'identification — le même que le vérificateur, et pour la même raison. */
export const AGENT = "niers-ietv-verifier/1.0 (+https://github.com/rosegriffon; catalogue anime)";

/** Récupère et analyse une page de playlist. Rend `[]` sur toute panne. */
export async function lirePlaylist(playlistId: string): Promise<EntreePlaylist[]> {
	try {
		const reponse = await fetch(urlPlaylist(playlistId), {
			headers: { "user-agent": AGENT },
			redirect: "follow",
		});
		if (!reponse.ok) return [];
		return parserPagePlaylist(await reponse.text());
	} catch {
		return [];
	}
}

/** Récupère et analyse la page des playlists d'une chaîne. */
export async function lirePlaylistsDeChaine(
	channelId: string
): Promise<{ playlistId: string; titre: string }[]> {
	try {
		const reponse = await fetch(`https://www.youtube.com/channel/${channelId}/playlists`, {
			headers: { "user-agent": AGENT },
			redirect: "follow",
		});
		if (!reponse.ok) return [];
		return parserPagePlaylists(await reponse.text());
	} catch {
		return [];
	}
}

// ── Programme de sondage ────────────────────────────────────────────────────
//
// ```bash
// bun packages/ietv/src/playlist-youtube.ts UClfhcLqicImW9Se7NKaFADQ
// bun packages/ietv/src/playlist-youtube.ts --playlist UU1cdmvDug3oRgl_d-w1fdTg
// ```
//
// Il ne rend QUE ce qu'il mesure : combien d'entrées, et lesquelles. Rien
// n'entre en base par ici — le tri entre un épisode et une bande-annonce, puis
// la question de savoir si la chaîne a le droit de diffuser, se tranchent
// ailleurs et pas à la volée.

if (import.meta.main) {
	const argv = process.argv.slice(2);
	if (argv[0] === "--playlist") {
		const id = argv[1] ?? "";
		const entrees = await lirePlaylist(id);
		console.log(`${id} : ${entrees.length} entrees`);
		for (const e of entrees) console.log(`  ${e.videoId}  ${e.titre}`);
	} else {
		// Les chaînes sont sondées l'une APRÈS l'autre, à dessein : un
		// `Promise.all` sur la liste ouvrirait autant de requêtes simultanées
		// vers le même hôte, ce qui est précisément ce qu'on s'interdit ailleurs
		// dans ce paquet. Le gain de temps ne vaut pas la rafale.
		/* eslint-disable no-await-in-loop */
		for (const channelId of argv) {
			const uploads = playlistDesUploads(channelId);
			const listes = await lirePlaylistsDeChaine(channelId);
			console.log(`\n=== ${channelId} (uploads ${uploads ?? "?"}) ===`);
			console.log(`playlists publiees : ${listes.length}`);
			for (const l of listes) console.log(`  ${l.playlistId.padEnd(36)} ${l.titre}`);
			if (uploads) {
				const entrees = await lirePlaylist(uploads);
				console.log(`uploads rendus : ${entrees.length}`);
			}
		}
		/* eslint-enable no-await-in-loop */
	}
}
