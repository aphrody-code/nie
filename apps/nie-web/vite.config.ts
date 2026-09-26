import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ConfigEnv, type UserConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBuildOutDir } from "./scripts/out-dir";
import { stageVfs } from "./scripts/stage-vfs";

/**
 * The one frontend build: the nie web page served by `nie-site`. The Inacord Tauri desktop host
 * was removed on 2026-09-26 (the desktop is aphrody-ui `aphrody-app`; IEVR stays in nie web).
 */
export function createFrontendConfig(_env: ConfigEnv): UserConfig {
	// Le résolveur commun REFUSE d'écrire dans le bundle que `nie-site` sert — cf.
	// `scripts/out-dir.ts`. `--outDir` en ligne de commande l'emporte sur cette valeur.
	const defaultOutDir = resolveBuildOutDir();
	let resolvedOutDir = defaultOutDir;
	// The site never carries Tauri: its API is replaced by HTTP shims that talk to `nie-site`,
	// which is how the Inacord workspace runs at `nie.aphrody.com/inacord`.
	const browserShimAliases: Record<string, string> = {
		"@tauri-apps/api/core": fileURLToPath(new URL("./src/inacord-web/shims/core.ts", import.meta.url)),
		"@tauri-apps/api/event": fileURLToPath(new URL("./src/inacord-web/shims/event.ts", import.meta.url)),
		"@tauri-apps/api/window": fileURLToPath(new URL("./src/inacord-web/shims/window.ts", import.meta.url)),
		"@tauri-apps/api/menu": fileURLToPath(new URL("./src/inacord-web/shims/menu.ts", import.meta.url)),
		"@tauri-apps/api/path": fileURLToPath(new URL("./src/inacord-web/shims/path.ts", import.meta.url)),
		"@tauri-apps/api/dpi": fileURLToPath(new URL("./src/inacord-web/shims/dpi.ts", import.meta.url)),
		"@tauri-apps/plugin-dialog": fileURLToPath(new URL("./src/inacord-web/shims/dialog.ts", import.meta.url)),
		"@tauri-apps/plugin-clipboard-manager": fileURLToPath(new URL("./src/inacord-web/shims/clipboard.ts", import.meta.url)),
		"@tauri-apps/plugin-opener": fileURLToPath(new URL("./src/inacord-web/shims/opener.ts", import.meta.url)),
		"@tauri-apps/plugin-fs": fileURLToPath(new URL("./src/inacord-web/shims/fs.ts", import.meta.url)),
		"@tauri-apps/plugin-updater": fileURLToPath(new URL("./src/inacord-web/shims/updater.ts", import.meta.url)),
		"@tauri-apps/plugin-process": fileURLToPath(new URL("./src/inacord-web/shims/process.ts", import.meta.url)),
	};
	return {
		root: fileURLToPath(new URL(".", import.meta.url)),
		plugins: [react(), tailwindcss(), {
			name: "nie-candidate-vfs",
			apply: "build" as const,
			configResolved(config) { resolvedOutDir = resolve(config.root, config.build.outDir); },
			writeBundle() {
				const source = process.env.NIE_VFS_BUNDLE_DIR ?? process.env.NIE_VFS_BUNDLE_DIR;
				if (source) console.log(`VFS candidate: ${stageVfs(source, resolvedOutDir)} verified archives`);
			},
		}],
		publicDir: "public",
		resolve: {
			dedupe: ["react", "react-dom"],
			alias: {
				"#nie-host": fileURLToPath(new URL("./src/BrowserHost.tsx", import.meta.url)),
				"@": fileURLToPath(new URL("./src/desktop", import.meta.url)),
				"@nie/inacord-ui": fileURLToPath(new URL("./src/inacord", import.meta.url)),
				...browserShimAliases,
			},
		},
		// Keep the existing site output stable.
		//
		// `hashCharacters: "hex"` n'est pas cosmétique. Rollup empreinte en **base64url** par
		// défaut, et cet alphabet contient `-` ; or `nie_site::routes::static_files::empreinte`
		// découpe le nom sur `-` et `.`, donc un tiret tombé DANS l'empreinte la casse en
		// morceaux trop courts et le fichier part en `no-cache` au lieu d'`immutable`.
		// Mesuré le 2026-09-20 sur un bundle réel : **30 des 252 fichiers émis**, ce que prédit
		// 1 − (63/64)^8 ≈ 12 %, plus `index-QCGMVBRT.js` — le point d'entrée — dont l'empreinte
		// n'avait ni chiffre ni minuscule et échouait par l'autre moitié de l'heuristique.
		// `hex` n'a ni tiret ni casse : il tombe dans la branche hexadécimale, qui ne devine rien.
		// `scripts/deploy-target.ts` imputait cela à rolldown seul — c'est l'alphabet, et le
		// vite 6.4.3 épinglé le produit aussi.
		build: {
			outDir: defaultOutDir,
			sourcemap: true,
			assetsDir: "static",
			rollupOptions: { output: { hashCharacters: "hex" } },
		},
		server: {
			port: 5175,
			proxy: Object.fromEntries(
				["/api", "/f", "/b", "/assets", "/model", "/downloads", "/healthz"].map(path => [
					path,
					{ target: "http://127.0.0.1:8085", changeOrigin: true },
				]),
			),
		},
	};
}

export default defineConfig(createFrontendConfig);
