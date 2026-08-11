#!/usr/bin/env bun
/**
 * Pipeline 100% natif iecode : télécharge/valide IEVR via le downloader Steam natif
 * (SteamKit2, plus de steamcmd), puis dump sélectif (preset inagle/azalee) avec le CLI iecode.
 *
 * Env :
 *   STEAM_USER        compte Steam possédant IEVR (requis sauf SKIP_DOWNLOAD=1).
 *   STEAM_PASSWORD    mot de passe (optionnel si un refresh token est déjà en cache).
 *   STEAM_GUARD_CODE  code Steam Guard 2FA (requis au 1er login ; ensuite token caché).
 *   IEVR_GAME_DIR     dir d'install (défaut ~/.local/share/Steam/iecode/inazuma)
 *   STEAM_TOKEN_STORE cache JSON des jetons (défaut ~/.local/share/iecode/steam-tokens.json)
 *   DUMP_PRESET       inagle | azalee | inagle-azalee (défaut inagle-azalee)
 *   DUMP_OUT          sortie du dump (défaut ~/iecode-dump)
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
const OUT = process.env.DUMP_OUT ?? join(HOME, "iecode-dump");
const CLI = join(import.meta.dir, "../csharp/IECODE.CLI/bin/Release/net10.0/iecode.dll");

// 1. Construire le CLI iecode si nécessaire (il porte download + dump).
if (!existsSync(CLI)) {
	console.info("▸ build CLI iecode (Release)…");
	await $`dotnet build ${join(import.meta.dir, "../csharp/IECODE.CLI/IECODE.CLI.csproj")} -c Release`.quiet();
}

// 2. Télécharger/valider le jeu nativement (sauf SKIP_DOWNLOAD).
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
	await $`dotnet ${CLI} download ${APP_ID} -o ${GAME_DIR} --token-store ${TOKEN_STORE}`;
}

// 3. Dump sélectif (seuls les packs inagle/azalee : gamedata utile + text + dx11/chr,
//    sans map/event, dédupliqué).
console.info(`▸ dump iecode --preset ${PRESET} → ${OUT}`);
await $`dotnet ${CLI} dump -g ${GAME_DIR} -o ${OUT} --preset ${PRESET} --smart`;

console.info(`\n✓ Données prêtes : ${OUT}`);
console.info(`  → pour inagle : DATA_PATH=${OUT} (createInagleService lit ce dossier)`);
