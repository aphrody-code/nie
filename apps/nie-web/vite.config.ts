import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ConfigEnv, type UserConfig } from "vite";
import { fileURLToPath } from "node:url";

/** One frontend build owner; host adapters retain their native services and resources. */
export function createFrontendConfig({ mode }: ConfigEnv): UserConfig {
	const desktop = mode === "desktop";
	const host = process.env.TAURI_DEV_HOST;
	// The site build never carries Tauri: its API is replaced by HTTP shims that talk to
	// `nie-site`, which is how the Inacord workspace runs at `nie.aphrody.com/inacord`. The
	// desktop build keeps the real plugins.
	const browserShimAliases: Record<string, string> = !desktop ? {
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
	} : {};
	return {
		root: fileURLToPath(new URL(".", import.meta.url)),
		plugins: [react(), tailwindcss(), {
			name: "nie-host-document",
			transformIndexHtml(html: string) {
				if (!desktop) return html;
				return html
					.replace("<title>nie</title>", "<title>Inacord</title>")
					.replace('<link rel="icon" href="/static/favicon.ico" />', '<link rel="icon" href="/favicon.ico" />');
			},
		}],
		publicDir: desktop ? fileURLToPath(new URL("../inacord/public", import.meta.url)) : "public",
		resolve: {
			dedupe: ["react", "react-dom"],
			alias: {
				"#nie-host": fileURLToPath(new URL(desktop ? "./src/desktop/DesktopHost.tsx" : "./src/BrowserHost.tsx", import.meta.url)),
				"@": fileURLToPath(new URL("./src/desktop", import.meta.url)),
				...browserShimAliases,
			},
		},
		clearScreen: !desktop,
		// Keep the existing site output stable; Tauri consumes the desktop artifact.
		build: { outDir: desktop ? "dist-desktop" : "dist", sourcemap: true, assetsDir: "static" },
		server: {
			port: desktop ? 1420 : 5175,
			strictPort: desktop,
			host: desktop ? host || false : undefined,
			hmr: desktop && host ? { protocol: "ws", host, port: 1421 } : undefined,
			watch: { ignored: ["**/src-tauri/**"] },
			proxy: Object.fromEntries(
				["/api", "/f", "/b", "/assets", "/downloads", "/healthz"].map(path => [
					path,
					{ target: "http://127.0.0.1:8085", changeOrigin: true },
				]),
			),
		},
	};
}

export default defineConfig(createFrontendConfig);
