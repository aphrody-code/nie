import { Glob } from "bun";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";
import { execSync } from "node:child_process";

const SOURCE_DIR = "/home/ubuntu/rg/packages/assets/public";
const DEST_DIRS = ["/var/www/cdn/static/azalee/public", "/var/www/cdn/static/website/public"];

/**
 * Synchronise les assets statiques partagés du monorepo vers le CDN.
 * Génère des versions pré-compressées Gzip (.gz) et Brotli (.br) pour les types de fichiers compressibles.
 */
export async function syncCdnAssets(): Promise<{ success: boolean; error?: string }> {
	console.log("[Cron CDN] Démarrage de la synchronisation des assets CDN...");
	try {
		// Utilise l'implémentation native ultra-rapide de Glob de Bun
		const glob = new Glob("**/*");
		const files = Array.from(glob.scanSync({ cwd: SOURCE_DIR, onlyFiles: true }));
		console.log(`[Cron CDN] ${files.length} assets trouvés pour la synchronisation.`);

		let copyCount = 0;
		let skipCount = 0;

		for (const relPath of files) {
			const srcPath = join(SOURCE_DIR, relPath);
			const fileContent = await Bun.file(srcPath).arrayBuffer();
			const buffer = Buffer.from(fileContent);

			for (const destDir of DEST_DIRS) {
				const destPath = join(destDir, relPath);
				const destParentDir = dirname(destPath);

				// Crée le dossier parent si nécessaire
				await mkdir(destParentDir, { recursive: true });

				// Vérifie si le fichier existe déjà et est identique
				let shouldCopy = true;
				try {
					const destStat = await stat(destPath);
					const srcStat = await stat(srcPath);
					if (destStat.size === srcStat.size) {
						shouldCopy = false;
					}
				} catch {
					// Le fichier n'existe pas encore
				}

				if (shouldCopy) {
					// Copie du fichier
					await writeFile(destPath, buffer);
					copyCount++;

					// Pré-compression pour les fichiers texte, SVG, polices, etc.
					const ext = destPath.split(".").pop()?.toLowerCase();
					const compressibleExtensions = [
						"js",
						"css",
						"html",
						"svg",
						"json",
						"txt",
						"ttf",
						"xml",
						"webmanifest",
					];
					if (ext && compressibleExtensions.includes(ext)) {
						try {
							// Gzip (niveau 9)
							const gzContent = gzipSync(buffer, { level: 9 });
							await writeFile(`${destPath}.gz`, gzContent);

							// Brotli (qualité 11)
							const brContent = brotliCompressSync(buffer, {
								params: {
									[constants.BROTLI_PARAM_QUALITY]: 11,
								},
							});
							await writeFile(`${destPath}.br`, brContent);
						} catch (compressErr) {
							console.warn(
								`[Cron CDN] Warning: Impossible de pré-compresser ${relPath}:`,
								compressErr
							);
						}
					}
				} else {
					skipCount++;
				}
			}
		}
		console.log(
			`[Cron CDN] Synchronisation terminée. ${copyCount} fichiers copiés, ${skipCount} ignorés.`
		);

		if (copyCount > 0) {
			console.log("[Cron CDN] Nouveaux fichiers copiés. Invalidation du cache CDN...");
			// 1. Invalider le cache local Nginx
			try {
				execSync("sudo systemctl reload nginx", { stdio: "ignore" });
				console.log("[Cron CDN] Nginx rechargé avec succès.");
			} catch (_) {
				try {
					execSync("sudo nginx -s reload", { stdio: "ignore" });
					console.log("[Cron CDN] Nginx rechargé via la commande nginx.");
				} catch (nginxErr: any) {
					console.warn("[Cron CDN] Impossible de recharger Nginx :", nginxErr.message || nginxErr);
				}
			}

			// 2. Purge Cloudflare
			const zoneId = process.env.CLOUDFLARE_ZONE_ID;
			const apiToken = process.env.CLOUDFLARE_API_TOKEN;
			if (zoneId && apiToken) {
				try {
					const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`;
					const response = await fetch(url, {
						method: "POST",
						headers: {
							"Authorization": `Bearer ${apiToken}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ purge_everything: true }),
					});
					if (response.ok) {
						const data = (await response.json()) as { success: boolean; errors?: any[] };
						if (data.success) {
							console.log("[Cron CDN] Cloudflare cache purgé avec succès.");
						} else {
							console.error("[Cron CDN] Échec purge Cloudflare :", data.errors);
						}
					} else {
						console.error("[Cron CDN] Cloudflare API status :", response.status);
					}
				} catch (cfErr) {
					console.error("[Cron CDN] Erreur purge Cloudflare :", cfErr);
				}
			}
		}

		return { success: true };
	} catch (err: any) {
		console.error("[Cron CDN] Erreur lors de la synchronisation CDN :", err);
		return { success: false, error: err.message || String(err) };
	}
}
