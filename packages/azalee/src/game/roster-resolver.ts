/**
 * Résolution client → serveur des IDs du roster d'une sauvegarde IEVR en noms réels.
 *
 * La SAVE reste dans le navigateur (parsée par le wasm `nie-save`). Cette fonction
 * n'envoie QUE la liste d'IDs `0x........` au serveur (`/api/save/resolve-roster`),
 * jamais les octets de la sauvegarde. Le serveur résout chaque ID contre le miroir
 * SQLite embarqué (`inagle_characters`, table de vérité terrain).
 */

/** Un personnage du roster résolu en nom réel (ou inconnu si non mappé). */
export interface ResolvedChara {
	/** ID hex canonique `0xXXXXXXXX`. */
	id: string;
	/** Nom français, ou `null` si l'ID n'est pas dans le miroir. */
	name: string | null;
	/** Slug de base pour lien fiche (`/chara/<baseSlug>`), ou `null`. */
	baseSlug: string | null;
	element: string | null;
	position: string | null;
	rarity: string | null;
}

/** Réponse agrégée de la résolution. */
export interface RosterResolution {
	resolved: ResolvedChara[];
	/** Nombre d'IDs effectivement retrouvés dans le miroir. */
	matched: number;
	/** Nombre total d'IDs uniques soumis. */
	total: number;
}

/**
 * Résout une liste d'IDs de roster (décimaux ou hex) en personnages nommés.
 * @throws si la requête réseau échoue.
 */
export async function resolveRoster(ids: Array<number | string>): Promise<RosterResolution> {
	if (ids.length === 0) {
		return { resolved: [], matched: 0, total: 0 };
	}
	const resp = await fetch("/api/save/resolve-roster", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ ids }),
	});
	if (!resp.ok) {
		const detail = await resp.text().catch(() => "");
		throw new Error(`Résolution du roster échouée (HTTP ${resp.status}). ${detail}`.trim());
	}
	return (await resp.json()) as RosterResolution;
}
