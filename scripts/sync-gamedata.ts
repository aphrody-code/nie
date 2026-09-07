#!/usr/bin/env bun
/**
 * Pipeline 100% natif niers : télécharge/valide IEVR via le downloader Steam Rust natif,
 * puis dump sélectif (preset inagle/azalee) avec la CLI `niers`.
 *
 * Env :
 *   STEAM_USER        compte Steam possédant IEVR (requis sauf SKIP_DOWNLOAD=1).
 *   STEAM_PASSWORD    mot de passe (optionnel si un refresh token est déjà en cache).
 *   STEAM_GUARD_CODE  code Steam Guard 2FA (requis au 1er login ; ensuite token caché).
 *   IEVR_GAME_DIR     dir d'install (défaut ~/.local/share/Steam/iecode/inazuma)
 *   STEAM_TOKEN_STORE cache JSON des jetons (défaut ~/.local/share/iecode/steam-tokens.json)
 *   DUMP_PRESET       inagle | azalee | inagle-azalee (défaut inagle-azalee)
 *   DUMP_OUT          sortie du dump (défaut ~/niers-dump)
 *   SKIP_DOWNLOAD=1   saute le download (dump seulement, sur l'install existante)
 *
 * Usage : bun run sync:gamedata
 */
import { $ } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";

const HOME = process.env.HOME ?? "/home/ubuntu";
const APP_ID = "2799860"; // INAZUMA ELEVEN: Victory Road
const GAME_DIR = process.env.IEVR_GAME_DIR ?? join(HOME, ".local/share/Steam/iecode/inazuma");
const TOKEN_STORE =
	process.env.STEAM_TOKEN_STORE ?? join(HOME, ".local/share/iecode/steam-tokens.json");
const PRESET = process.env.DUMP_PRESET ?? "inagle-azalee";
const OUT = process.env.DUMP_OUT ?? join(HOME, "niers-dump");
const NIERS = process.env.NIERS_BIN ?? join(import.meta.dir, "../target/release/niers.exe");
const useBuiltBinary = existsSync(NIERS);

async function runNiers(...args: string[]) {
	if (useBuiltBinary) {
		await $`${NIERS} ${args}`;
	} else {
		await $`cargo run --release -q -p nie-cli -- ${args}`;
	}
}

// 1. Télécharger/valider le jeu nativement (sauf SKIP_DOWNLOAD).
// IEVR est PAYANT → login avec un compte qui le possède (anonymous impossible).
// Le 1er login nécessite STEAM_GUARD_CODE (2FA) ; le refresh token est ensuite mis
// en cache dans STEAM_TOKEN_STORE → runs suivants non-interactifs (sans mot de passe).
// Le download écrit l'arborescence d'install Steam dans GAME_DIR (GAME_DIR/data/packs/*.cpk),
// layout identique à steamcmd, donc directement consommable par `iecode dump -g`.
if (process.env.SKIP_DOWNLOAD !== "1") {
	if (!process.env.STEAM_USER) {
		throw new Error("STEAM_USER requis (ou SKIP_DOWNLOAD=1 pour dumper l'install existante).");
	}
	console.info(`▸ download natif : app ${APP_ID} → ${GAME_DIR}`);
	await runNiers("steam", "download", APP_ID, "-o", GAME_DIR, "--token-store", TOKEN_STORE);
}

// 2. Dump sélectif (seuls les packs inagle/azalee : gamedata utile + text + dx11/chr,
//    sans map/event, dédupliqué).
console.info(`▸ dump niers --preset ${PRESET} → ${OUT}`);
await runNiers("viola", "dump", "--game-dir", GAME_DIR, "-o", OUT, "--preset", PRESET);

console.info(`\n✓ Données prêtes : ${OUT}`);
console.info(`  → pour inagle : DATA_PATH=${OUT} (createInagleService lit ce dossier)`);
