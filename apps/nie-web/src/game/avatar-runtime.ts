/** Thin WebAssembly adapter: Rust resolves every resource and relationship. */
import type { AvatarCatalog, AvatarComposition, AvatarReferenceImport, AvatarState, OcReference } from "@nie/inacord-ui/avatar/contract";
import { avatar_composition_json, avatar_reference_import_json, export_avatar_oc_document_json } from "../wasm/nie_wasm.js";
import { ensureWasm } from "./bridge";
export { avatarModelUrl } from "@nie/inacord-ui/avatar/request";

export async function resolveAvatar(catalog: AvatarCatalog, state: AvatarState): Promise<AvatarComposition> {
	await ensureWasm();
	return JSON.parse(avatar_composition_json(JSON.stringify(catalog), JSON.stringify(state))) as AvatarComposition;
}

export async function importAvatarReference(catalog: AvatarCatalog, state: AvatarState, reference: string): Promise<AvatarReferenceImport> {
	await ensureWasm();
	return JSON.parse(avatar_reference_import_json(JSON.stringify(catalog), JSON.stringify(state), reference)) as AvatarReferenceImport;
}

export async function exportAvatarOcDocument(
	catalog: AvatarCatalog,
	state: AvatarState,
	metadata: { slug: string; internalCode: string | null; references: OcReference[] },
): Promise<string> {
	await ensureWasm();
	return export_avatar_oc_document_json(JSON.stringify(catalog), JSON.stringify(state), JSON.stringify({
		...metadata,
		generationRecipe: null,
		provenance: ["Chara Edit session; no filesystem write performed"],
	}));
}
