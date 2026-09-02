/**
 * Hybrid cache: Redis backend (Bun.RedisClient) + in-memory fallback.
 * - Redis backend gives us shared cache across bot instances + persistence across restarts.
 * - Fallback Map is used if Redis is unreachable (graceful degradation, never block reads).
 *
 * The mutating ops (`invalidate`, `invalidatePrefix`) stay synchronous: they update the local
 * fallback immediately and fire-and-forget the Redis DEL.
 */
import { RedisClient } from "bun";
import { REDIS_URL } from "./config";

const PREFIX = "niebot:";

interface FallbackEntry {
	value: unknown;
	expiresAt: number;
}

const fallback = new Map<string, FallbackEntry>();

let client: RedisClient | null = null;
let initFailed = false;
const metrics = {
	hits: 0,
	misses: 0,
	redisHits: 0,
	fallbackHits: 0,
	errors: 0,
};

function getRedis(): RedisClient | null {
	if (initFailed) return null;
	if (client) return client;
	try {
		client = new RedisClient(REDIS_URL);
		client.onclose = (err) => {
			if (err) {
				console.warn("[cache] redis closed:", err.message ?? err);
			}
		};
		return client;
	} catch (err) {
		initFailed = true;
		console.warn("[cache] Redis init failed, falling back to memory:", err);
		return null;
	}
}

function k(key: string): string {
	return PREFIX + key;
}

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
	const full = k(key);
	const ttlSec = Math.max(Math.floor(ttlMs / 1000), 1);
	const redis = getRedis();

	// 1. Try Redis
	if (redis) {
		try {
			const raw = await redis.get(full);
			if (raw !== null && raw !== undefined) {
				metrics.hits++;
				metrics.redisHits++;
				return JSON.parse(raw) as T;
			}
		} catch (err) {
			metrics.errors++;
			console.warn("[cache] redis.get failed for", key, ":", err);
		}
	}

	// 2. Try fallback Map (covers Redis-down scenarios + first-init burst)
	const local = fallback.get(full);
	if (local && local.expiresAt > Date.now()) {
		metrics.hits++;
		metrics.fallbackHits++;
		return local.value as T;
	}

	// 3. Compute fresh value
	metrics.misses++;
	const value = await fn();
	const serialized = JSON.stringify(value);

	if (redis) {
		redis.set(full, serialized, "EX", ttlSec).catch((err) => {
			metrics.errors++;
			console.warn("[cache] redis.set failed for", key, ":", err);
			fallback.set(full, { value, expiresAt: Date.now() + ttlMs });
		});
	} else {
		fallback.set(full, { value, expiresAt: Date.now() + ttlMs });
	}
	return value;
}

export function invalidate(key: string): void {
	const full = k(key);
	fallback.delete(full);
	const redis = getRedis();
	if (redis) {
		redis.del(full).catch((err) => {
			metrics.errors++;
			console.warn("[cache] del failed for", key, ":", err);
		});
	}
}

export function invalidatePrefix(prefix: string): void {
	const fullPrefix = k(prefix);
	for (const key of fallback.keys()) {
		if (key.startsWith(fullPrefix)) fallback.delete(key);
	}
	const redis = getRedis();
	if (redis) {
		// SCAN is non-blocking; for a small bot keyspace KEYS is acceptable too.
		redis
			.send("SCAN", ["0", "MATCH", `${fullPrefix}*`, "COUNT", "200"])
			.then(async (res: unknown) => {
				const arr = Array.isArray(res) && Array.isArray(res[1]) ? (res[1] as string[]) : [];
				if (arr.length > 0) {
					await redis.send("DEL", arr).catch((err) => {
						metrics.errors++;
						console.warn("[cache] del prefix batch failed:", err);
					});
				}
			})
			.catch((err) => {
				metrics.errors++;
				console.warn("[cache] scan prefix failed:", err);
			});
	}
}

export function cacheStats() {
	const total = metrics.hits + metrics.misses;
	return {
		backend: client && !initFailed ? "redis+fallback" : "fallback-only",
		redis_url: REDIS_URL.replace(/:[^:@]+@/, ":***@"),
		prefix: PREFIX,
		fallback_size: fallback.size,
		hits: metrics.hits,
		misses: metrics.misses,
		redis_hits: metrics.redisHits,
		fallback_hits: metrics.fallbackHits,
		errors: metrics.errors,
		ratio: total > 0 ? metrics.hits / total : 0,
	};
}

/**
 * Optional: explicitly close Redis on shutdown.
 * `RedisClient.close()` is synchronous (returns void) per Bun docs.
 */
export function closeCache(): void {
	if (client) {
		try {
			client.close();
		} catch {
			/* ignore */
		}
		client = null;
	}
}
