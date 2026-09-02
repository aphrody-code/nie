import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { mintSupabaseJwt } from "@/lib/supabase/jwt";

export async function GET() {
	try {
		const reqHeaders = await headers();
		const session = await auth.api.getSession({ headers: reqHeaders });

		if (!session?.user?.id) {
			return NextResponse.json({ token: null }, { status: 200 });
		}

		const token = mintSupabaseJwt(session.user.id);
		return NextResponse.json({ token });
	} catch {
		return NextResponse.json({ token: null }, { status: 500 });
	}
}
