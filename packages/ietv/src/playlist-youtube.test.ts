/**
 * Tests des parseurs de playlist — sur des fragments réels, sans réseau.
 *
 * Les gabarits ci-dessous sont copiés de la page servie le 2026-09-03 pour
 * `UU1cdmvDug3oRgl_d-w1fdTg`, réduits à ce qui compte. Un test bâti sur du HTML
 * inventé ne prouverait que la cohérence de l'invention.
 */

import { describe, expect, test } from "bun:test";
import {
	decoderLitteral,
	parserPagePlaylist,
	parserPagePlaylists,
	playlistDesUploads,
	urlPlaylist,
} from "./playlist-youtube.ts";

/** Un bloc d'affichage tel que la page en porte un par vidéo. */
function bloc(videoId: string, titre: string): string {
	return (
		`"lockupViewModel":{"contentImage":{"thumbnailViewModel":{"image":{"sources":` +
		`[{"url":"https://i.ytimg.com/vi/${videoId}/hqdefault.jpg"}]}}},` +
		`"contentId":"${videoId}","contentType":"LOCKUP_CONTENT_TYPE_VIDEO",` +
		`"metadata":{"lockupMetadataViewModel":{"title":{"content":"${titre}"}}}}`
	);
}

describe("playlist des mises en ligne", () => {
	test("UC devient UU", () => {
		expect(playlistDesUploads("UClfhcLqicImW9Se7NKaFADQ")).toBe("UUlfhcLqicImW9Se7NKaFADQ");
	});

	test("un identifiant qui n'est pas une chaine rend null", () => {
		// Fabriquer `UU` + n'importe quoi produirait une URL valide pointant une
		// playlist qui n'existe pas, et une moisson silencieusement vide.
		expect(playlistDesUploads("PLlapDTT9GR4Q9oVV4wwV2LGvy5BX-JIy2")).toBeNull();
		expect(playlistDesUploads("")).toBeNull();
	});

	test("l'URL encode l'identifiant", () => {
		expect(urlPlaylist("UU1cdmvDug3oRgl_d-w1fdTg")).toBe(
			"https://www.youtube.com/playlist?list=UU1cdmvDug3oRgl_d-w1fdTg"
		);
	});
});

describe("decodage des litteraux", () => {
	test("les echappements JSON du HTML sont rendus", () => {
		expect(decoderLitteral("Aujourd\\u0027hui")).toBe("Aujourd'hui");
		expect(decoderLitteral("A \\u0026 B")).toBe("A & B");
		expect(decoderLitteral('un \\"titre\\"')).toBe('un "titre"');
	});
});

describe("parserPagePlaylist", () => {
	test("associe chaque identifiant a SON titre", () => {
		// Le vrai risque du parsing de cette page : rendre les bons identifiants
		// et les bons titres, mais mal appariés. D'où deux entrées, pas une.
		const html = `x${bloc("fxnvAqACT8c", "[VOSTFR] Inazuma Eleven 78")}y${bloc(
			"AAAAAAAAAAA",
			"[VOSTFR] Inazuma Eleven 77"
		)}z`;
		expect(parserPagePlaylist(html)).toEqual([
			{
				videoId: "fxnvAqACT8c",
				titre: "[VOSTFR] Inazuma Eleven 78",
				url: "https://www.youtube.com/watch?v=fxnvAqACT8c",
			},
			{
				videoId: "AAAAAAAAAAA",
				titre: "[VOSTFR] Inazuma Eleven 77",
				url: "https://www.youtube.com/watch?v=AAAAAAAAAAA",
			},
		]);
	});

	test("un identifiant repete par les menus ne cree pas de doublon", () => {
		const html = bloc("fxnvAqACT8c", "un titre") + bloc("fxnvAqACT8c", "un titre");
		expect(parserPagePlaylist(html)).toHaveLength(1);
	});

	test("un bloc sans titre est ignore, pas complete au jugé", () => {
		const html = `"lockupViewModel":{"contentId":"fxnvAqACT8c"}`;
		expect(parserPagePlaylist(html)).toEqual([]);
	});

	test("une page sans bloc d'affichage rend une liste vide", () => {
		expect(parserPagePlaylist("<html></html>")).toEqual([]);
	});
});

describe("parserPagePlaylists", () => {
	test("retient les playlists et ecarte les vignettes de video", () => {
		// La page des playlists porte AUSSI des `contentId` de onze caractères —
		// la vidéo de tête de chaque liste. Les prendre pour des playlists
		// produirait des URL `?list=<videoId>` qui ne rendent rien.
		const html =
			bloc("fxnvAqACT8c", "une video de tete") +
			`"lockupViewModel":{"contentId":"PLlapDTT9GR4Q9oVV4wwV2LGvy5BX-JIy2",` +
			`"metadata":{"lockupMetadataViewModel":{"title":{"content":"TOKYO GAME SHOW 2025"}}}}`;
		expect(parserPagePlaylists(html)).toEqual([
			{ playlistId: "PLlapDTT9GR4Q9oVV4wwV2LGvy5BX-JIy2", titre: "TOKYO GAME SHOW 2025" },
		]);
	});
});
