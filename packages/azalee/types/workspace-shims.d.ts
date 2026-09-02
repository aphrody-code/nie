/**
 * Shims de types pour le **build de publication** uniquement.
 *
 * `@rosegriffon/db` est un package workspace qui exporte ses **sources TS**
 * (pas de `dist`). En émission de déclarations, `tsc` refuse alors des fichiers
 * hors `rootDir` (TS6059). Le type-check de développement
 * (`tsconfig.json`, sans `rootDir`) utilise les VRAIS types ; seul
 * `tsconfig.build.json` substitue ces shims pour produire `dist/`.
 *
 * Conséquence assumée : dans les `.d.ts` publiés, les types venant de
 * `@rosegriffon/db` sont dégradés. Le comportement runtime est identique.
 */

declare module "@rosegriffon/db" {
	/** Schéma Supabase généré — dégradé dans le build de publication. */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	export type Database = any;
}

declare module "@rosegriffon/db/redis" {
	export const cache: {
		get<T>(key: string): Promise<T | null>;
		set<T>(key: string, value: T, ttl?: number): Promise<void>;
		del(key: string): Promise<void>;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		[extra: string]: any;
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	export function getRedisClient(): any;
	export function getEmbedding(text: string): Promise<number[]>;
	export const vectorStore: {
		search(
			collection: string,
			embedding: number[],
			limit: number,
			query?: string,
		): Promise<
			Array<{
				document: { id: string; text: string; metadata: Record<string, unknown> };
				score: number;
			}>
		>;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		[extra: string]: any;
	};
}
