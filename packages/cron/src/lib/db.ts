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

const configuredPoolMax = Number.parseInt(Bun.env.DATABASE_POOL_MAX ?? "", 10);
const poolMax = configuredPoolMax > 0 ? Math.min(configuredPoolMax, 4) : 4;

export const sql = new SQL({
	url: databaseUrl,
	max: poolMax,
	idleTimeout: 30,
	maxLifetime: 1_800,
	connectionTimeout: 10,
});
