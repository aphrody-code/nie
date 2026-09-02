import { JSONParser } from "@streamparser/json";

/**
 * Cache for loaded JSON files to prevent redundant disk I/O
 */
const fileCache = new Map<string, any>();

/**
 * Clear the internal file cache
 */
export function clearCache() {
	fileCache.clear();
}

/**
 * Asynchronously load a JSON file with caching.
 * Uses streaming for files larger than 5MB to be memory efficient.
 * @param path Absolute path to the file
 * @returns Parsed JSON object or null if not found/error
 */
export async function loadJsonAsync<T>(path: string | null): Promise<T | null> {
	if (!path) return null;
	if (fileCache.has(path)) {
		return fileCache.get(path) as T;
	}

	const bunFile = Bun.file(path);
	if (!(await bunFile.exists())) {
		return null;
	}

	try {
		// Streaming parser pour les gros fichiers, Bun.file().json() pour les petits
		// (un seul syscall, pas d'intermediate string).
		const size = bunFile.size;

		let data: T;
		if (size > 5 * 1024 * 1024) {
			// > 5MB
			data = await loadJsonStream<T>(path);
		} else {
			data = (await bunFile.json()) as T;
		}

		fileCache.set(path, data);
		return data;
	} catch (error) {
		console.error(`[AsyncLoader] Failed to parse ${path}`, error);
		return null;
	}
}

/**
 * Streaming JSON loader using @streamparser/json.
 * Memory efficient for large files — uses Bun.file().stream() (ReadableStream).
 */
export function loadJsonStream<T>(path: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const parser = new JSONParser();
		const stream = Bun.file(path).stream();

		let result: unknown;

		parser.onValue = (event) => {
			// The parser emits 'onValue' for every completed value (leaves and nodes).
			// The last emitted value corresponds to the root object.
			// event structure: { value, key, parent, stack }
			if (event.stack.length === 0) {
				result = event.value;
			}
		};

		parser.onError = (err) => reject(err);
		parser.onEnd = () => resolve(result as T);

		(async () => {
			try {
				// ReadableStream<Uint8Array> est async-iterable au runtime Bun/Node 18+
				// mais le typing DOM lib ne l'expose pas — cast localise.
				for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
					parser.write(chunk);
				}
				parser.end();
			} catch (err) {
				reject(err);
			}
		})();
	});
}

/**
 * Helper to measure execution time
 */
export async function measureTime<T>(label: string, fn: () => Promise<T>): Promise<T> {
	const start = performance.now();
	const result = await fn();
	const end = performance.now();
	console.log(`[Perf] ${label}: ${(end - start).toFixed(2)}ms`);
	return result;
}
