/**
 * Capture une page du site à résolution fixe, pour la comparer à une capture du vrai jeu.
 *
 *   bun --bun apps/azalee/scripts/shot.ts <url> <sortie.png> [largeur] [hauteur]
 *
 * La résolution par défaut (1920 × 1080) est celle des captures de référence produites par
 * `niers/scripts/nie-wine-run.sh` : une comparaison à des dimensions différentes ne mesure plus
 * l'écart de rendu mais celui du redimensionnement.
 *
 * Playwright est installé sans ses navigateurs sur ce VPS ; on lui passe le chromium du système
 * (`executablePath`), sinon il réclame `npx playwright install` et échoue.
 */
import { chromium } from "@playwright/test";

const [url, sortie, largeur, hauteur] = process.argv.slice(2);
if (!url || !sortie) {
	console.error("usage: bun --bun apps/azalee/scripts/shot.ts <url> <sortie.png> [largeur] [hauteur]");
	process.exit(1);
}

const navigateur = await chromium.launch({
	executablePath: process.env.CHROMIUM_PATH ?? "/usr/local/bin/chromium",
	args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await navigateur.newPage({
	viewport: { width: Number(largeur ?? 1920), height: Number(hauteur ?? 1080) },
	deviceScaleFactor: 1,
});
await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
// Le modèle 3D et les sprites arrivent après `networkidle` : sans cette pause, la capture montre
// une page à moitié peinte et la mesure qui suit est fausse.
await page.waitForTimeout(Number(process.env.SHOT_WAIT_MS ?? 4000));
await page.screenshot({ path: sortie });
await navigateur.close();
console.log(sortie);
