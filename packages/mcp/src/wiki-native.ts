import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { wiki, type WikiRequest } from "nie";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Resolve only the repository's verified read-only game mirror. */
export function resolveMirrorPath(): string | undefined {
	const configured = process.env.NIE_WIKI_DB ?? process.env.SQLITE_DB_PATH;
	if (configured) {
		const path = resolve(REPO_ROOT, configured);
		if (statNonEmpty(path)) return path;
	}
	const primary = resolve(REPO_ROOT, "var/mirror.sqlite");
	if (statNonEmpty(primary)) return primary;
	return undefined;
}

function statNonEmpty(path: string): boolean {
	try {
		const stat = statSync(path);
		return stat.isFile() && stat.size > 0;
	} catch {
		return false;
	}
}

/** Invoke the native Rust wiki boundary. No SQL, Supabase, or TypeScript IEVR logic crosses it. */
export function nativeWiki<T = unknown>(request: WikiRequest): T {
	const database = resolveMirrorPath();
	if (!database) throw new Error("The verified read-only game mirror is unavailable.");
	return wiki<T>({ ...request, database });
}

export function nativeWikiSearch(query: string, limit: number): Array<Record<string, unknown>> {
	return nativeWiki<Array<Record<string, unknown>>>({ op: "search", query, limit });
}
