import { createClient } from "@/lib/supabase/server";
import { normalizeRosterIdentifiers } from "@rosegriffon/azalee/game/roster-identifiers";
import type { ResolvedChara } from "@rosegriffon/azalee/game/roster-resolver";

/**
 * Résolution serveur des IDs du roster d'une sauvegarde IEVR → noms réels.
 *
 * La SAVE ne quitte JAMAIS le navigateur : le wasm `nie-save` la parse côté client
 * et extrait la liste d'IDs `0x........` (hash de personnage). Seule cette liste
 * d'IDs (aucun octet de save) transite ici. On résout chaque ID contre le miroir
 * SQLite embarqué (`inagle_characters.id`, hex string) — table de vérité terrain
 * (validation croisée 4484/4484 = 100% avec la save réelle).
 *
 * POST /api/save/resolve-roster  { ids: string[] }
 * → { resolved: ResolvedChara[], matched: number, total: number }
 *
 * Anti-hallucination : aucun ID non présent en DB n'est inventé ; les inconnus sont
 * remontés tels quels (`name: null`) plutôt que devinés.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ResolveBody {
	ids?: unknown;
}

// Borne dure : une save IEVR expose ~4500 IDs uniques. On plafonne à 8000 pour
// éviter un abus (le tableau est dédupliqué et tronqué avant la requête).
const MAX_IDS = 8000;

export async function POST(req: Request): Promise<Response> {
	let body: ResolveBody;
	try {
		body = (await req.json()) as ResolveBody;
	} catch {
		return Response.json({ error: "Corps JSON invalide." }, { status: 400 });
	}

	if (!Array.isArray(body.ids)) {
		return Response.json({ error: "`ids` doit être un tableau." }, { status: 400 });
	}

	// La logique de normalisation est portable (CLI, Tauri et hôte web) ; cette
	// route ne garde que la limite de transport et l'adaptateur Supabase.
	const ids = normalizeRosterIdentifiers(body.ids, MAX_IDS);

	if (ids.length === 0) {
		return Response.json({ resolved: [], matched: 0, total: 0 });
	}

	try {
		const supabase = await createClient();
		// Résolution par chunks : un `.in()` de plusieurs milliers d'IDs génère trop
		// de placeholders pour SQLite (limite ~32k variables, marge confortable à 900).
		const byId = new Map<string, ResolvedChara>();
		const CHUNK = 900;
		for (let i = 0; i < ids.length; i += CHUNK) {
			const slice = ids.slice(i, i + CHUNK);
			const { data, error } = await supabase
				.from("inagle_characters")
				.select("id, name_fr, base_slug, element, position, rarity_label")
				.in("id", slice);
			if (error) {
				throw error;
			}
			for (const row of (data ?? []) as Array<Record<string, unknown>>) {
				const id = String(row.id);
				byId.set(id, {
					id,
					name: (row.name_fr as string) || null,
					baseSlug: (row.base_slug as string) || null,
					element: (row.element as string) || null,
					position: (row.position as string) || null,
					rarity: (row.rarity_label as string) || null,
				});
			}
		}

		// Reconstruit dans l'ordre d'entrée ; les inconnus restent visibles (name null).
		const resolved: ResolvedChara[] = ids.map(
			(id) =>
				byId.get(id) ?? {
					id,
					name: null,
					baseSlug: null,
					element: null,
					position: null,
					rarity: null,
				}
		);
		const matched = resolved.filter((r) => r.name !== null).length;

		return Response.json({ resolved, matched, total: ids.length });
	} catch (e) {
		const message = e instanceof Error ? e.message : "Erreur de résolution.";
		return Response.json({ error: message }, { status: 500 });
	}
}
