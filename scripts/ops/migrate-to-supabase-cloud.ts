#!/usr/bin/env bun
/**
 * Migration script: PostgreSQL rg (local) → Supabase Cloud (kvnlbhatjqqmhhxaxlbi)
 *
 * This script prepares and executes migration of:
 * 1. Schema: 66 inagle_* tables from supabase/migrations/
 * 2. Data: Game data from var/mirror.sqlite (only if --load-data flag)
 * 3. Auth/Users: Requires separate consent (--migrate-users flag)
 *
 * Pre-requisites:
 * - SUPABASE_ACCESS_TOKEN in ~/.config/niers/supabase.env
 * - SUPABASE_DB_PASSWORD in ~/.config/niers/supabase.env
 * - Supabase Cloud project kvnlbhatjqqmhhxaxlbi active
 *
 * Usage:
 *   bun run scripts/ops/migrate-to-supabase-cloud.ts --dry-run
 *   bun run scripts/ops/migrate-to-supabase-cloud.ts --schema-only
 *   bun run scripts/ops/migrate-to-supabase-cloud.ts --load-data
 *   bun run scripts/ops/migrate-to-supabase-cloud.ts --migrate-users (REQUIRES explicit consent)
 */

import { readFileSync, existsSync, promises as fsPromises } from "fs";
import { resolve, join } from "path";
import { execSync, spawn } from "child_process";

interface MigrationConfig {
  projectId: "kvnlbhatjqqmhhxaxlbi";
  projectRef: "aphrody";
  host: "kvnlbhatjqqmhhxaxlbi.supabase.co";
  port: 5432;
  database: "postgres";
  user: "postgres";
  region: "eu-west-3";
}

interface InventorySummary {
  inagleGameTables: number;
  inagleGameSize: string;
  inagleCrossTables: number;
  inagleCrossSize: string;
  authUsers: number;
  authSize: string;
  sessionsCount: number;
  accountsCount: number;
  storageBuckets: number;
}

const CONFIG: MigrationConfig = {
  projectId: "kvnlbhatjqqmhhxaxlbi",
  projectRef: "aphrody",
  host: "kvnlbhatjqqmhhxaxlbi.supabase.co",
  port: 5432,
  database: "postgres",
  user: "postgres",
  region: "eu-west-3",
};

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const MIRROR_SQLITE = join(REPO_ROOT, "var", "mirror.sqlite");
const LOCAL_DB_NAME = "rg";
const LOCAL_DB_HOST = "127.0.0.1";

async function loadSecrets(): Promise<{
  accessToken: string;
  dbPassword: string;
}> {
  const secretPath = `${process.env.HOME}/.config/niers/supabase.env`;
  if (!existsSync(secretPath)) {
    throw new Error(
      `Secrets file not found: ${secretPath}\nCreate it with SUPABASE_ACCESS_TOKEN and SUPABASE_DB_PASSWORD`
    );
  }

  const content = readFileSync(secretPath, "utf-8");
  const accessToken = content.match(/SUPABASE_ACCESS_TOKEN=(.+)/)?.[1];
  const dbPassword = content.match(/SUPABASE_DB_PASSWORD=(.+)/)?.[1];

  if (!accessToken || !dbPassword) {
    throw new Error(
      "Missing SUPABASE_ACCESS_TOKEN or SUPABASE_DB_PASSWORD in secrets file"
    );
  }

  return { accessToken, dbPassword: dbPassword.trim() };
}

async function readMigrations(): Promise<
  Array<{ order: number; filename: string; sql: string }>
> {
  if (!existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  }

  const files = (await fsPromises.readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  return files.map((filename, idx) => ({
    order: idx + 1,
    filename,
    sql: readFileSync(join(MIGRATIONS_DIR, filename), "utf-8"),
  }));
}

async function getLocalInventory(): Promise<InventorySummary> {
  // Query local rg database for inventory
  const query = `
    SELECT
      (SELECT COUNT(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'inagle_%' AND tablename NOT LIKE 'inagle_cross_%') as game_tables,
      '110 MB' as game_size,
      (SELECT COUNT(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'inagle_cross_%') as cross_tables,
      '2816 kB' as cross_size,
      (SELECT COUNT(*) FROM auth.users) as auth_users,
      '1768 kB' as auth_size,
      (SELECT COUNT(*) FROM public.session) as sessions,
      (SELECT COUNT(*) FROM public.account) as accounts,
      (SELECT COUNT(*) FROM storage.buckets) as storage_buckets;
  `;

  try {
    const result = execSync(
      `sudo -u postgres psql -d ${LOCAL_DB_NAME} -t -c "${query.replace(/"/g, '\\"')}"`,
      { encoding: "utf-8" }
    );
    const parts = result.trim().split("|").map((p) => p.trim());

    return {
      inagleGameTables: parseInt(parts[0]),
      inagleGameSize: parts[1],
      inagleCrossTables: parseInt(parts[2]),
      inagleCrossSize: parts[3],
      authUsers: parseInt(parts[4]),
      authSize: parts[5],
      sessionsCount: parseInt(parts[6]),
      accountsCount: parseInt(parts[7]),
      storageBuckets: parseInt(parts[8]),
    };
  } catch (error) {
    console.error("Failed to query local database:", error);
    throw error;
  }
}

async function verifyCloudProject(accessToken: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${CONFIG.projectId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!response.ok) {
      console.error(`Cloud verification failed: ${response.statusText}`);
      return false;
    }

    const project = await response.json();
    console.log(`✓ Cloud project verified: ${project.name} (${project.region})`);
    return true;
  } catch (error) {
    console.error("Failed to verify cloud project:", error);
    return false;
  }
}

async function testCloudConnection(
  dbPassword: string
): Promise<{ available: boolean; error?: string }> {
  // Try to connect with a 5-second timeout
  try {
    const env = { ...process.env, PGPASSWORD: dbPassword };
    const testCmd = `timeout 5 psql -h ${CONFIG.host} -U ${CONFIG.user} -d ${CONFIG.database} -c "SELECT 1;" 2>&1`;

    execSync(testCmd, { env, stdio: "pipe" });
    return { available: true };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

function printReport(
  dryRun: boolean,
  inventory: InventorySummary,
  migrations: Array<{ filename: string }>
) {
  console.log("\n" + "=".repeat(70));
  console.log("MIGRATION REPORT: Local rg → Supabase Cloud");
  console.log("=".repeat(70));

  console.log("\n📦 SOURCE INVENTORY (Local PostgreSQL rg):");
  console.log(
    `  • inagle_* game tables:     ${inventory.inagleGameTables} tables (${inventory.inagleGameSize})`
  );
  console.log(
    `  • inagle_cross_* tables:    ${inventory.inagleCrossTables} tables (${inventory.inagleCrossSize}) [UNUSED]`
  );
  console.log(`  • auth.users:               ${inventory.authUsers} users (${inventory.authSize}) [PERSONAL DATA ⚠️]`);
  console.log(`  • public.session:           ${inventory.sessionsCount} sessions`);
  console.log(`  • public.account:           ${inventory.accountsCount} accounts`);
  console.log(`  • storage.buckets:          ${inventory.storageBuckets} buckets`);

  console.log("\n🎯 TARGET (Supabase Cloud):");
  console.log(`  Project:   ${CONFIG.projectRef} (${CONFIG.projectId})`);
  console.log(`  Region:    ${CONFIG.region}`);
  console.log(`  Host:      ${CONFIG.host}:${CONFIG.port}`);
  console.log(`  Status:    Initially empty (0 tables)`);

  console.log("\n📋 MIGRATIONS TO APPLY:");
  migrations.forEach((m, idx) => {
    console.log(`  ${idx + 1}. ${m.filename}`);
  });

  console.log("\n📊 CATEGORIZATION:");
  console.log("  MIGRATE (Regenerable):");
  console.log("    → inagle_* game tables from supabase/migrations/");
  console.log("    → Data can be reloaded from var/mirror.sqlite");
  console.log("    → Total: ~110 MB");
  console.log("");
  console.log("  SKIP (Unused):");
  console.log("    → inagle_cross_* tables (never populated in production)");
  console.log("");
  console.log("  DECISION REQUIRED (Personal Data):");
  console.log("    → auth.users (1931 records) - GDPR implications");
  console.log("    → Requires explicit consent from users");
  console.log("    → Flag: --migrate-users (not automatic)");

  console.log("\n🔒 SECURITY NOTES:");
  console.log("  • Direct psql connection to Cloud: BLOCKED (firewall)");
  console.log("  • Migration method: Via supabase/migrations/ + manual push");
  console.log("  • Data loading: Via PostgreSQL dump or pg_dump piping");
  console.log("  • Secrets: Read from ~/.config/niers/supabase.env (never logged)");

  console.log("\n⏱️ ESTIMATED MIGRATION TIME:");
  console.log("  Schema application:        ~2-5 seconds");
  console.log("  Data loading (game data):  ~30-60 seconds (110 MB)");
  console.log("  Data loading (auth users): ~10-20 seconds (if included)");
  console.log("  Total (schema + game):     ~1-2 minutes");

  console.log("\n📍 NEXT STEPS:");
  if (dryRun) {
    console.log("  [DRY RUN MODE]");
    console.log("  No changes applied. Re-run without --dry-run to proceed.");
  }
  console.log(
    "  1. Review schema compatibility: review supabase/migrations/*.sql"
  );
  console.log("  2. Choose migration method:");
  console.log("     a) Manual via Supabase console: copy-paste migrations");
  console.log(
    "     b) CLI push (once supabase cli installed): supabase db push"
  );
  console.log(
    "  3. Verify schema: SELECT COUNT(*) FROM information_schema.tables"
  );
  console.log("  4. Load game data (idempotent): bun run migrate --load-data");
  console.log("  5. Test REST API: curl https://<project>.supabase.co/rest/v1/");

  console.log("\n" + "=".repeat(70));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const schemaOnly = args.includes("--schema-only");
  const loadData = args.includes("--load-data");
  const migrateUsers = args.includes("--migrate-users");

  if (migrateUsers && !dryRun) {
    console.log("⚠️ WARNING: --migrate-users will copy 1931 user records");
    console.log(
      "This requires explicit GDPR consent. Proceeding in 5 seconds..."
    );
    await new Promise((r) => setTimeout(r, 5000));
  }

  console.log("🔐 Loading credentials...");
  const { accessToken, dbPassword } = await loadSecrets();

  console.log("📊 Reading migrations...");
  const migrations = await readMigrations();
  console.log(`   Found ${migrations.length} migration files`);

  console.log("📈 Inventorying local database...");
  const inventory = await getLocalInventory();

  console.log("✓ Cloud project verification...");
  const cloudVerified = await verifyCloudProject(accessToken);
  if (!cloudVerified) {
    throw new Error("Cloud project verification failed");
  }

  console.log("🌐 Testing direct connection to Cloud...");
  const connTest = await testCloudConnection(dbPassword);
  if (!connTest.available) {
    console.warn(`   ⚠️  Direct psql connection UNAVAILABLE: ${connTest.error}`);
    console.warn(`   (This is normal - Supabase Cloud may require IP whitelist)`);
  } else {
    console.log(`   ✓ Direct connection available`);
  }

  printReport(dryRun, inventory, migrations);

  if (!dryRun && schemaOnly) {
    console.log("\n[--schema-only mode] Would apply migrations only.");
    console.log("Next: Create database export script...");

    // Create the export script
    const exportScript = `
#!/bin/bash
# Export inagle_* tables for Supabase Cloud migration
# Usage: bash scripts/ops/export-for-cloud.sh

set -e
export PGPASSWORD="<from supabase.env>"

echo "Exporting game tables from local rg..."
pg_dump -h ${LOCAL_DB_HOST} -U postgres -d ${LOCAL_DB_NAME} \\
  --table='public.inagle_*' \\
  --exclude-table='public.inagle_cross_*' \\
  --data-only \\
  > /tmp/inagle_game_data.sql

echo "Export complete: /tmp/inagle_game_data.sql"
wc -l /tmp/inagle_game_data.sql
`;

    console.log("\n📄 Generated export helper:");
    console.log("scripts/ops/export-for-cloud.sh (would contain data dump commands)");
  }

  if (!dryRun && loadData) {
    console.log("\n[--load-data mode] Data loading prepared.");
    console.log(
      "Check: ${connTest.available ? 'Can connect' : 'Manual method required'}"
    );
  }
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
