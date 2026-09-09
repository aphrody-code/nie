import { NextResponse } from "next/server";

/** Transport-only proxy to the Rust Aphrody owner; it contains no game data. */
export async function GET(): Promise<Response> {
	const origin = process.env.NIE_SITE_ORIGIN ?? "http://127.0.0.1:8085";
	try {
		const response = await fetch(`${origin}/api/v1/aphrody`, { cache: "no-store" });
		return new NextResponse(response.body, {
			status: response.status,
			headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
		});
	} catch {
		return NextResponse.json({ error: "Native Aphrody service unavailable" }, { status: 503 });
	}
}
