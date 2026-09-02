"use client";

import { useSupabaseClient } from "@/components/providers/SupabaseProvider";

export function useSupabase() {
	return useSupabaseClient();
}
