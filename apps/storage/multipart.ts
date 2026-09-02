// Découpage `multipart/form-data` sur les octets bruts.
//
// Module séparé du serveur pour rester sans effet de bord : `server.ts` démarre
// `Bun.serve` et exige des variables d'environnement au moment de l'import, ce
// qui le rend intestable directement.

/** Position de `motif` dans `source` à partir de `depuis`, ou -1. */
export function indexOfBytes(source: Uint8Array, motif: Uint8Array, depuis = 0): number {
	outer: for (let i = depuis; i <= source.length - motif.length; i++) {
		for (let j = 0; j < motif.length; j++) {
			if (source[i + j] !== motif[j]) continue outer;
		}
		return i;
	}
	return -1;
}

/** Extrait la valeur de `boundary` d'un en-tête `Content-Type`. */
export function boundaryOf(contentType: string): string | null {
	const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
	return (match?.[1] ?? match?.[2])?.trim() || null;
}

/**
 * Extrait la partie fichier d'un corps `multipart/form-data`.
 *
 * `@supabase/storage-js` envoie `body.append("", blob)` : la partie fichier a un
 * `name` ET un `filename` VIDES. `Request.formData()` la rend alors comme une
 * chaîne, ce qui détruirait tout contenu binaire au décodage UTF-8 — d'où ce
 * découpage sur les octets bruts, qui identifie la partie par la seule présence
 * de l'attribut `filename` dans son `Content-Disposition`.
 */
export function extractFilePart(
	body: Uint8Array,
	boundary: string
): { bytes: Uint8Array; mime: string } | null {
	const encoder = new TextEncoder();
	const delimiter = encoder.encode(`--${boundary}`);
	const doubleCrlf = encoder.encode("\r\n\r\n");

	let position = indexOfBytes(body, delimiter);
	while (position !== -1) {
		const partStart = position + delimiter.length;
		// `--` juste après le délimiteur = marqueur de fin du corps.
		if (body[partStart] === 0x2d && body[partStart + 1] === 0x2d) break;

		const headerEnd = indexOfBytes(body, doubleCrlf, partStart);
		if (headerEnd === -1) break;
		const next = indexOfBytes(body, delimiter, headerEnd);
		const contentEnd = next === -1 ? body.length : next - 2; // retire le CRLF final
		const headers = new TextDecoder().decode(body.subarray(partStart, headerEnd));

		if (/content-disposition:[^\n]*;\s*filename\s*=/i.test(headers)) {
			const mime = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim();
			return {
				bytes: body.subarray(headerEnd + doubleCrlf.length, contentEnd),
				mime: mime || "application/octet-stream",
			};
		}
		position = next;
	}
	return null;
}
