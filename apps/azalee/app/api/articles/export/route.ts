import { NextResponse } from "next/server";
import { exportArticleStatsCSV } from "@/app/actions/stats-export";
import { requireAdmin } from "@/lib/auth-helpers";

export async function GET() {
	try {
		await requireAdmin();
	} catch {
		return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
	}

	const csv = await exportArticleStatsCSV();

	return new NextResponse(csv, {
		headers: {
			"Content-Disposition": `attachment; filename="articles-stats-${new Date().toISOString().slice(0, 10)}.csv"`,
			"Content-Type": "text/csv; charset=utf-8",
		},
	});
}
