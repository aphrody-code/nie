import { ragSearch, type RagSourceKind } from "@rosegriffon/db/rag";

// RAG unifié — endpoint REST additif (cf. iecode/re/rag/UNIFIED-RAG-PLAN.md §5).
// POST /api/rag/search  { query: string, k?: number, kinds?: string[] }
// Recherche hybride locale (dense cosine + lexicale FTS5, fusion RRF).

interface RagSearchBody {
	query?: string;
	k?: number;
	kinds?: string[];
}

export async function POST(req: Request): Promise<Response> {
	let body: RagSearchBody;
	try {
		body = (await req.json()) as RagSearchBody;
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const query = (body.query ?? "").trim();
	if (query.length < 2) {
		return Response.json({ error: "query must be at least 2 characters" }, { status: 400 });
	}

	const k = Math.min(Math.max(body.k ?? 10, 1), 50);
	const kinds = Array.isArray(body.kinds) ? (body.kinds as RagSourceKind[]) : undefined;

	try {
		const results = await ragSearch(query, { k, kinds });
		return Response.json({ query, count: results.length, results });
	} catch (err) {
		return Response.json(
			{ error: err instanceof Error ? err.message : "rag search failed" },
			{ status: 500 }
		);
	}
}

export const GET = () =>
	Response.json(
		{ message: "POST { query, k?, kinds? } to search the unified RAG (local hybrid)." },
		{ status: 200 }
	);
