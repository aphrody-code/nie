import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET() {
	// @ts-ignore - plugin properties are typed dynamically on auth.api
	const configuration = await auth.api.getAgentConfiguration();
	return NextResponse.json(configuration);
}
