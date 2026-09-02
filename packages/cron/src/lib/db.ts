/**
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

import { SQL } from "bun";
import { createSupabaseServiceClient } from "@rosegriffon/db/service";

export const supabase = createSupabaseServiceClient();

const databaseUrl = Bun.env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error(
		"[@rosegriffon/cron] DATABASE_URL is required (Supabase Postgres pooler URL)"
	);
}

export const sql = new SQL(databaseUrl);
