import { NextResponse } from "next/server";
import { getPgPool } from "@/lib/db/pg";

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const id = searchParams.get("id");

	if (!id) {
		return NextResponse.json({ count: 0 });
	}

	try {
		const pool = getPgPool();
		const { rows } = await pool.query<{ share_count: number | null }>(
			`SELECT share_count FROM articles WHERE id = $1 AND app = $2 LIMIT 1`,
			[id, "azalee"]
		);

		return NextResponse.json({ count: rows[0]?.share_count || 0 });
	} catch (error) {
		console.error("Error fetching share_count:", error);
		return NextResponse.json({ count: 0 });
	}
}
