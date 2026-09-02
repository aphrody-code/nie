import { getSupabaseClient } from "@/src/lib/api/supabase";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
	const checks: Record<string, "ok" | "error"> = {};

	try {
		const supabase = getSupabaseClient();
		const { error } = await supabase.from("profiles").select("id").limit(1);
		checks.db = error ? "error" : "ok";
	} catch {
		checks.db = "error";
	}

	const allOk = Object.values(checks).every((v) => v === "ok");

	return NextResponse.json(
		{ checks, status: allOk ? "ok" : "degraded", uptime: process.uptime() },
		{ status: allOk ? 200 : 503 }
	);
}
