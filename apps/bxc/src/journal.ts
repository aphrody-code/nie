/**
 * Journal et codes de sortie — copie fidèle de `src/cli/shared.ts` du dépôt
 * `@aphrody/bxc`, réduite à ce dont l'app niers se sert.
 *
 * Pourquoi recopier plutôt qu'importer : `@aphrody/bxc` ne publie PAS
 * `./src/cli/shared.ts` dans sa carte d'`exports`. L'importer marcherait par
 * chemin profond aujourd'hui et casserait à la première republication. Ces
 * trente lignes n'ont aucune dépendance ; les dupliquer coûte moins qu'un
 * couplage à un chemin interne.
 */

/** Options communes à toutes les sous-commandes. */
export interface OptionsCommunes {
	/** Sortie machine plutôt qu'humaine. */
	json: boolean;
	/** N'écrit plus rien sur la sortie standard. */
	quiet: boolean;
}

/**
 * Extrait les drapeaux communs d'`argv` et rend le reste intact.
 *
 * `--quiet` a un repli d'environnement (`BXC_QUIET`) parce que le service
 * systemd le pose globalement : une commande lancée à la main dans le même
 * shell doit se comporter pareil.
 */
export function lireOptionsCommunes(argv: readonly string[]): {
	options: OptionsCommunes;
	reste: string[];
} {
	const options: OptionsCommunes = {
		json: false,
		quiet: Bun.env.BXC_QUIET === "1",
	};
	const reste: string[] = [];

	for (const argument of argv) {
		if (argument === "--json") options.json = true;
		else if (argument === "--quiet" || argument === "-q") options.quiet = true;
		else reste.push(argument);
	}

	return { options, reste };
}

/** Écriture qui respecte `--quiet`. Les erreurs, elles, sortent toujours. */
export const journal = {
	log(message: string, options?: OptionsCommunes): void {
		if (!options?.quiet) Bun.stdout.write(`${message}\n`);
	},
	warn(message: string, options?: OptionsCommunes): void {
		if (!options?.quiet) Bun.stderr.write(`[avertissement] ${message}\n`);
	},
	error(message: string): void {
		Bun.stderr.write(`[erreur] ${message}\n`);
	},
};

/**
 * Codes de sortie, alignés sur `sysexits` — le service systemd s'en sert :
 * `RestartPreventExitStatus=77` et `SuccessExitStatus=130`.
 */
export const SORTIE = {
	OK: 0,
	/** Mauvais usage de la ligne de commande. */
	USAGE: 1,
	/** Le programme a échoué de son propre fait. */
	LOGICIEL: 70,
	/** Configuration refusée (jeton absent, identifiant invalide) : réessayer ne répare rien. */
	CONFIG: 77,
	/** Arrêt demandé par un signal, traité proprement. */
	SIGINT: 130,
} as const;

/** Message lisible d'une erreur, quelle que soit sa forme. */
export function messageErreur(erreur: unknown): string {
	return erreur instanceof Error ? erreur.message : String(erreur);
}
