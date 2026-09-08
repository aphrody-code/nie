/** Thin WebAssembly adapter: Rust resolves every resource and relationship. */
import type { AvatarCatalog, AvatarComposition, AvatarState } from "@niers/inacord-ui/avatar/contract";
import { avatar_composition_json } from "../wasm/nie_wasm.js";
import { ensureWasm } from "./bridge";
export { avatarModelUrl } from "@niers/inacord-ui/avatar/request";

export async function resolveAvatar(catalog: AvatarCatalog, state: AvatarState): Promise<AvatarComposition> {
	await ensureWasm();
	return JSON.parse(avatar_composition_json(JSON.stringify(catalog), JSON.stringify(state))) as AvatarComposition;
}
