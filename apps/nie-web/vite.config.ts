import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ConfigEnv, type UserConfig } from "vite";
import { fileURLToPath } from "node:url";

/** One frontend build owner; host adapters retain their native services and resources. */
export function createFrontendConfig({ mode }: ConfigEnv): UserConfig {
	const desktop = mode === "desktop";
	const host = process.env.TAURI_DEV_HOST;
	return {
		root: fileURLToPath(new URL(".", import.meta.url)),
		plugins: [react(), tailwindcss(), {
			name: "nie-host-document",
			transformIndexHtml(html: string) {
				return desktop
					? html.replace("<title>nie</title>", "<title>Inacord</title>").replace('<link rel="icon" href="/static/favicon.ico" />', "")
					: html;
			},
		}],
		publicDir: desktop ? fileURLToPath(new URL("../inacord/public", import.meta.url)) : "public",
		resolve: {
			dedupe: ["react", "react-dom"],
			alias: {
				"#nie-host": fileURLToPath(new URL(desktop ? "./src/desktop/DesktopHost.tsx" : "./src/BrowserHost.tsx", import.meta.url)),
				"@": fileURLToPath(new URL("./src/desktop", import.meta.url)),
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
				["/api", "/f", "/b", "/assets", "/healthz"].map(path => [
					path,
					{ target: "http://127.0.0.1:8085", changeOrigin: true },
				]),
			),
		},
	};
}

export default defineConfig(createFrontendConfig);
