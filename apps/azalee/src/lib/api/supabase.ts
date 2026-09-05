import { createClient } from "@supabase/supabase-js";
import { origineSupabase } from "@/lib/supabase/url";

// We can define Database type here or import it if we share types package.
// For now, let's use 'any' or a minimal interface if needed, but 'any' is fine for internal tool.
// If types are available, good. The website had them in '@rosegriffon/types'.
// I'll skip strict typing for DB for now to speed up, or copy the type file if needed.

function isValidHttpUrl(v: string | undefined | null): v is string {
	return Boolean(
		v && v !== "undefined" && v !== "null" && v.startsWith("http") && !v.startsWith("eyJ2Ijo")
	);
}

function isValidKey(v: string | undefined | null): v is string {
	return Boolean(
		v && v !== "undefined" && v !== "null" && !v.startsWith("{") && !v.startsWith("eyJ2Ijo")
	);
}

const PLACEHOLDER_URL = (typeof window === "undefined" ? "http://127.0.0.1:8811" : window.location.origin);
const PLACEHOLDER_SERVICE_KEY =
	"***REDACTED-SERVICE-ROLE***";

export function getSupabaseClient() {
	let supabaseUrl = origineSupabase();
	let supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

	if (!isValidHttpUrl(supabaseUrl)) {
		supabaseUrl = PLACEHOLDER_URL;
	}
	if (!isValidKey(supabaseServiceKey)) {
		supabaseServiceKey = PLACEHOLDER_SERVICE_KEY;
	}

	return createClient(supabaseUrl, supabaseServiceKey);
}
