/**
 * Où un build du site a le droit d'écrire — et la vérification qu'il n'écrit pas sur la prod.
 *
 * # Le défaut que ce module ferme
 *
 * `nie-site` sert `--bundle-dir ${NIE_REPO_ROOT}/apps/nie-web/dist` (unité systemd), et `dist`
 * est un lien symbolique. La règle « si `dist` est un lien, écrire à côté » existait déjà, en
 * double, dans `vite.config.ts` et `precompress.ts` ; son intention est écrite noir sur blanc
 * dans le second (« A staged release must be compressed before it replaces the live bundle »).
 * Elle suppose que la cible du lien n'est PAS le répertoire de travail du build.
 *
 * Mesuré le 2026-09-20 sur cette machine : `dist -> dist-web`, et `dist-web` était exactement le
 * répertoire où les deux règles envoyaient le build. Le garde-fou ne gardait donc rien. Or
 * `vite build` VIDE son `outDir` avant d'écrire : un `bun run build` lancé dans le dépôt
 * effaçait le bundle que `nie.aphrody.com` était en train de servir, puis le reconstituait
 * quelques minutes plus tard. Aucune commande ne le disait, et le service n'en sait rien — il
 * lit le disque à chaque requête.
 *
 * # L'invariant, et pourquoi c'est un `throw` et non un commentaire
 *
 * **Le répertoire de sortie d'un build ne doit jamais être celui que `dist` désigne.** Les deux
 * chemins sont comparés après résolution des liens : un nom ne prouve rien, deux noms peuvent
 * désigner le même inode. La violation lève, parce que la seule autre issue — continuer en
 * avertissant — produit précisément la panne silencieuse qu'on vient de mesurer.
 *
 * # Qui publie, alors
 *
 * `scripts/deploy-target.ts` (cible `web`), et lui seul : il bâtit dans
 * `var/deployments/targeted/<commit>/<run>/web/bundle`, puis bascule `dist` par `symlink` +
 * `rename`, ce qui est atomique, et revient en arrière si la santé du site ne se prouve pas.
 * Il passe `--outDir` explicitement, donc il ne dépend pas de ce module — c'est voulu : la
 * publication et le build de travail n'ont pas à partager une valeur par défaut.
 */
import { lstatSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Racine de `apps/nie-web`, quel que soit le répertoire courant de l'appelant. */
const appRoot = fileURLToPath(new URL("..", import.meta.url));

/** Le lien de PUBLICATION, lu par `nie-site`. Personne d'autre que le déploiement n'y touche. */
export const publishedLink = resolve(appRoot, "dist");

/**
 * Résout le chemin réel d'un répertoire, ou `null` s'il n'existe pas encore.
 *
 * `realpathSync` sur un lien cassé lève ; un `dist` pointant vers une version supprimée est
 * exactement le cas où l'on veut continuer plutôt que faire échouer le build.
 */
function cheminReel(chemin: string): string | null {
	try {
		return realpathSync(chemin);
	} catch {
		return null;
	}
}

/**
 * Ce que `dist` PUBLIE, ou `null` s'il ne publie rien.
 *
 * Le lien symbolique est ce qui distingue les deux situations, et la distinction n'est pas
 * cosmétique : `nie-site` sert à travers lui, et `deploy-target.ts` publie en le faisant pivoter
 * (`symlink` + `rename`). Un `dist` qui est un répertoire ORDINAIRE est la sortie d'un build de
 * développement, que personne ne sert.
 *
 * Confondre les deux coûte cher dans les deux sens. Traiter le lien comme un répertoire, c'est
 * le défaut mesuré le 2026-09-20 : le build effaçait la production. Traiter le répertoire comme
 * un lien casse le **deuxième** build de tout checkout neuf — le premier crée `dist`, et le
 * garde refuse ensuite d'y réécrire. Ce second cas a bien été introduit ici avant d'être vu.
 */
function ciblePubliee(lien: string): string | null {
	try {
		if (!lstatSync(lien).isSymbolicLink()) return null;
	} catch {
		return null;
	}
	return cheminReel(lien);
}

/**
 * Le répertoire où un build ORDINAIRE écrit.
 *
 * - `NIE_WEB_OUT_DIR` l'emporte ; `NIERS_WEB_OUT_DIR` reste accepté pour compatibilité.
 * - `dist` n'est pas un lien → `dist`. Rien n'est publié depuis un tel arbre (une unité systemd
 *   qui lirait un répertoire ordinaire du dépôt serait un autre problème, et le garde ci-dessous
 *   le dirait quand même).
 * - `dist` est un lien → `dist-build`, un répertoire de travail distinct de la cible du lien.
 *
 * @throws si le chemin retenu est, après résolution, celui que `dist` désigne.
 */
export function resolveBuildOutDir(lien: string = publishedLink): string {
	const configuredOutDir = process.env.NIE_WEB_OUT_DIR ?? process.env.NIERS_WEB_OUT_DIR;
	const choisi = configuredOutDir
		? resolve(configuredOutDir)
		: ciblePubliee(lien) === null
			? lien
			: resolve(appRoot, "dist-build");
	assertNePubliePas(choisi, lien);
	return choisi;
}

/**
 * Lève si `outDir` est le répertoire que le lien de publication désigne.
 *
 * Exportée séparément pour que `precompress.ts` puisse vérifier un chemin reçu en argument :
 * lui aussi réécrit des fichiers en place, et un `bun precompress.ts apps/nie-web/dist` passerait
 * sans cela tout droit dans le bundle servi. `lien` n'est paramétré que pour les tests — les
 * éprouver sur une disposition jetable est la seule façon de couvrir le cas « `dist` est un vrai
 * répertoire » sans toucher à celui que la production sert.
 */
export function assertNePubliePas(outDir: string, lien: string = publishedLink): void {
	const cible = ciblePubliee(lien);
	if (cible === null) return;
	const sortie = cheminReel(outDir) ?? resolve(outDir);
	if (sortie !== cible) return;
	throw new Error(
		[
			`Ce build écrirait dans le bundle SERVI par nie.aphrody.com : ${sortie}`,
			`  ${lien} -> ${cible}`,
			"`vite build` vide son outDir avant d'écrire : le site répondrait 404 pendant tout le build.",
			"Publier passe par `bun run deploy:target web`, qui bâtit à part puis bascule le lien.",
			"Pour bâtir ailleurs sans publier : NIE_WEB_OUT_DIR=<chemin hors du lien>.",
		].join("\n"),
	);
}
