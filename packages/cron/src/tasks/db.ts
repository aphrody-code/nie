import { $ } from "bun";
import { racineDepot } from "../lib/racine";

/**
 * Chemin du binaire Bun **courant**, utilisé au lieu d'un `bun` nu.
 *
 * Ces tâches échouaient avec le code 127 à chaque exécution nocturne :
 * `bun run --filter <paquet> <script>` exécute le script du paquet **via
 * `/usr/bin/bash`**, et ce shell hérite du `PATH` du service — qui ne
 * contenait pas `/home/ubuntu/.bun/bin`. Le message n'apparaissait que dans la
 * sortie standard de la commande imbriquée (`bun: command not found`), jamais
 * dans l'erreur remontée, d'où six semaines de sauvegardes muettes.
 *
 * Le correctif de fond est le `PATH` de l'unité systemd (cf.
 * `infra/systemd/rg-cron.service`), sans lequel la commande imbriquée
 * resterait cassée. `process.execPath` sécurise en plus l'appel externe :
 * il vaut le binaire qui fait tourner ce processus, quel que soit
 * l'environnement.
 */
const BUN = process.execPath;

/** Racine du monorepo : les commandes de workspace doivent partir de là. */
const RACINE = racineDepot();

/**
 * Exécute la commande de push d'Inagle pour synchroniser la base de données
 * Supabase avec les fichiers de données du jeu les plus récents.
 */
export async function runInaglePush(): Promise<{ success: boolean; error?: string }> {
	console.log("[Cron DB] Démarrage de la synchronisation Inagle avec la base de données...");
	try {
		await $`${BUN} run --filter @rosegriffon/inagle push`.cwd(RACINE);
		console.log("[Cron DB] Synchronisation réussie.");
		return { success: true };
	} catch (err: unknown) {
		console.error("[Cron DB] Erreur lors du push d'Inagle :", err);
		return { success: false, error: describeShellError(err) };
	}
}

/**
 * Génère une sauvegarde SQLite locale optimisée depuis la base Supabase.
 */
export async function runSQLiteBackup(): Promise<{ success: boolean; error?: string }> {
	console.log("[Cron DB] Démarrage de la sauvegarde Supabase vers SQLite local...");
	try {
		await $`${BUN} run --filter @rosegriffon/azalee-web backup:supabase`.cwd(RACINE);
		console.log("[Cron DB] Sauvegarde SQLite réussie.");
		return { success: true };
	} catch (err: unknown) {
		console.error("[Cron DB] Erreur lors de la sauvegarde SQLite :", err);
		return { success: false, error: describeShellError(err) };
	}
}

/**
 * Message d'erreur exploitable pour une commande shell.
 *
 * `Bun.$` lève un objet dont le `message` se réduit à « Failed with exit code
 * N » : sans la sortie d'erreur ni l'explication du code, un échec nocturne
 * était indiagnosticable dans le journal.
 */
function describeShellError(err: unknown): string {
	if (typeof err !== "object" || err === null) return String(err);
	const shell = err as { exitCode?: number; stderr?: { toString(): string }; message?: string };
	const base = shell.message ?? String(err);
	const details: string[] = [];
	if (shell.exitCode === 127) {
		details.push("commande introuvable — vérifier le PATH du service (le binaire Bun n'y est pas par défaut)");
	}
	const stderr = shell.stderr?.toString().trim();
	if (stderr) details.push(stderr.slice(0, 500));
	return details.length > 0 ? `${base} : ${details.join(" | ")}` : base;
}
