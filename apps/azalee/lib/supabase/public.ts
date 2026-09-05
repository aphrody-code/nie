import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@rosegriffon/db";
import { origineSupabase } from "@/lib/supabase/url";

const PLACEHOLDER_URL = (typeof window === "undefined" ? "http://127.0.0.1:8811" : window.location.origin);
const PLACEHOLDER_ANON_JWT =
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzYmthZWx0dWJxaXR0eXdpYmVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NDYyNzUsImV4cCI6MjA5MjEyMjI3NX0.eAyJfqREb8Kh5F_yLf5Jp43S2qOil4qUcqFTLQiExx0";

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

// Résolution unique : cf. `./url`. La variante interne (`127.0.0.1`) n'est plus consultée.
const supabaseUrl = origineSupabase();

const supabaseAnonKey =
	(isValidKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
		? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
		: null) ||
	(isValidKey(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
		? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
		: null) ||
	PLACEHOLDER_ANON_JWT;

export const createPublicClient = () => {
	return createSupabaseClient<Database>(supabaseUrl, supabaseAnonKey);
};
