import { Pool } from "pg";

// Connexion Postgres DIRECTE (bypass le Data API PostgREST de Supabase) —
// utilisée pour les lectures publiques qui ne doivent PAS dépendre de la
// disponibilité du Data API (ex. `exceed_storage_size_quota` a restreint le
// Data API pendant 7+ jours début août 2026 alors que la connexion Postgres
// directe restait fonctionnelle tout du long — cf. docs/rag-unified.md).
// Azalée tourne exclusivement en self-host VPS : pas de
// réécriture pooler nécessaire (IPv6 direct dispo, cf. lib/auth.ts).
// Miroir de apps/website/src/lib/db/pg.ts (même pattern, adapté azalee).

export const getDatabaseURL = (): string => {
	const url = process.env.DATABASE_URL;
	if (!url || url.startsWith("eyJ2Ijo") || url === "undefined" || url === "null") {
		throw new Error(
			"DATABASE_URL absent ou corrompu : une chaîne de connexion Postgres valide est requise."
		);
	}
	return url;
};

let _pgPool: Pool | null = null;

/** Pool Postgres direct partagé (singleton lazy) — réutiliser ce pool, ne jamais en créer un par requête. */
export function getPgPool(): Pool {
	if (!_pgPool) {
		_pgPool = new Pool({
			connectionString: getDatabaseURL(),
			connectionTimeoutMillis: 5_000,
			idleTimeoutMillis: 30_000,
			max: 10,
		});
	}
	return _pgPool;
}
