/**
 * Passe-plat vers le CLI amont `@aphrody/bxc`.
 *
 * ── POURQUOI UN PASSE-PLAT PLUTÔT QU'UNE RECOPIE ───────────────────────────
 * Le dépôt `bxc` porte 24 sous-commandes (`ietv`, `zukan`, `crawl-worker`,
 * `recon`, `scrape`, `search`, `mirror`, `x`, `xcom`, `fut`, `challonge`…). Les
 * recopier dans niers, c'était 845 Mo et 4 545 fichiers d'un AUTRE dépôt —
 * avec son `CLAUDE.md`, ses bases SQLite et ses cookies. Le paquet npm
 * `@aphrody/bxc@0.8.0` publie déjà tout `src/`, CLI compris : le déléguer ne
 * perd aucune commande et n'en duplique aucune.
 *
 * C'est la même doctrine que `niers cpp` / `niers cs` côté Rust : une façade,
 * un sous-processus, zéro réimplémentation.
 */

import { dirname, join } from "node:path";

/**
 * Racine du paquet `@aphrody/bxc` installé.
 *
 * On résout l'entrée publique (`src/api/browser.ts`) puis on remonte de trois
 * crans. Passer par `package.json` ne marcherait pas : il n'est pas déclaré
 * dans la carte d'`exports` du paquet.
 */
export function racineBxc(): string {
	const entree = Bun.resolveSync("@aphrody/bxc", import.meta.dir);
	return dirname(dirname(dirname(entree)));
}

/** Chemin du CLI amont — un module qui s'exécute lui-même à l'import. */
export function cliBxc(): string {
	return join(racineBxc(), "src", "cli", "index.ts");
}

/**
 * Exécute `bxc <args>` et rend son code de sortie.
 *
 * `--bun` est indispensable : plusieurs dépendances transitives portent un
 * shebang `#!/usr/bin/env node`, que Bun honore par défaut — et `node` est
 * proscrit dans ce dépôt. Les flux sont hérités pour que la sortie du
 * sous-processus arrive telle quelle, sans tampon intermédiaire.
 */
export async function executerBxc(argv: readonly string[]): Promise<number> {
	const processus = Bun.spawn([process.execPath, "--bun", cliBxc(), ...argv], {
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
		// Le CLI amont lit `BXC_*` dans l'environnement : on le lui passe entier.
		env: Bun.env as Record<string, string>,
	});
	return processus.exited;
}
