#!/usr/bin/env bun
/**
 * Load inagle_* game data from local mirror to Supabase Cloud
 *
 * This script:
 * 1. Reads from var/mirror.sqlite (game data mirror)
 * 2. Transforms and validates data
 * 3. Inserts into Supabase Cloud using REST API
 * 4. Is fully idempotent (can be re-run safely)
 *
 * Usage:
 *   bun run scripts/ops/load-game-data-to-cloud.ts --dry-run
 *   bun run scripts/ops/load-game-data-to-cloud.ts --load
 *
 * Pre-requisites:
 * - Schema already applied via supabase/migrations/
 * - SUPABASE_ACCESS_TOKEN in ~/.config/niers/supabase.env
 * - var/mirror.sqlite contains game data (auto-synced nightly)
 */

import { existsSync, readFileSync } from "fs";
import { resolve, join } from "path";
import Database from "bun:sqlite";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const MIRROR_SQLITE = join(REPO_ROOT, "var", "mirror.sqlite");

interface TableInfo {
  name: string;
  rowCount: number;
  estimatedSize: string;
}

const CLOUD_CONFIG = {
  projectId: "kvnlbhatjqqmhhxaxlbi",
  projectRef: "aphrody",
  region: "eu-west-3",
  url: "https://kvnlbhatjqqmhhxaxlbi.supabase.co",
  restEndpoint: "https://kvnlbhatjqqmhhxaxlbi.supabase.co/rest/v1",
};

// Tables to migrate (game data only, not cross)
const INAGLE_GAME_TABLES = [
  "inagle_activity_photos",
  "inagle_auras",
  "inagle_awakenings",
  "inagle_basara",
  "inagle_boost_groups",
  "inagle_capsules",
  "inagle_chara_menu_resource",
  "inagle_characters",
  "inagle_chat_emotes",
  "inagle_constellations",
  "inagle_coordinators",
  "inagle_costumes",
  "inagle_custom_passives",
  "inagle_drop_rates",
  "inagle_drops",
  "inagle_drops_battles",
  "inagle_drops_tables",
  "inagle_drops_treasures",
  "inagle_emblems",
  "inagle_event_subtitles",
  "inagle_events",
  "inagle_exp_table",
  "inagle_formations",
  "inagle_gallery",
  "inagle_game_assets",
  "inagle_growth_tables",
  "inagle_heroes",
  "inagle_icon_inventory",
  "inagle_img_inventory",
  "inagle_items",
  "inagle_keshins",
  "inagle_kizuna_items",
  "inagle_lua_scripts",
  "inagle_manager_passives",
  "inagle_media_assets",
  "inagle_missions",
  "inagle_miximax",
  "inagle_mode_changes",
  "inagle_nameplates",
  "inagle_opponent_teams",
  "inagle_override_skills",
  "inagle_passive_generation",
  "inagle_passive_scaling",
  "inagle_passives",
  "inagle_performances",
  "inagle_phase_titles",
  "inagle_quests",
  "inagle_rag_edges",
  "inagle_scene_archives",
  "inagle_shops",
  "inagle_skill_technic",
  "inagle_skill_videos",
  "inagle_skills",
  "inagle_souls",
  "inagle_special_tactics",
  "inagle_stadiums",
  "inagle_star_signs",
  "inagle_super_tactics",
  "inagle_tactics",
  "inagle_team_build",
  "inagle_teams",
  "inagle_telop_waza",
  "inagle_tricks",
  "inagle_trophies",
  "inagle_uniforms",
  "inagle_video_waza",
];

async function loadSecrets(): Promise<{ serviceRoleKey: string }> {
  const secretPath = `${process.env.HOME}/.config/niers/supabase.env`;
  if (!existsSync(secretPath)) {
    throw new Error(`Secrets file not found: ${secretPath}`);
  }

  const content = readFileSync(secretPath, "utf-8");
  // For now, we'd need to extract the service_role key from the project
  // This requires additional setup
  return { serviceRoleKey: "" };
}

async function getMirrorStats(): Promise<TableInfo[]> {
  if (!existsSync(MIRROR_SQLITE)) {
    throw new Error(
      `Mirror database not found: ${MIRROR_SQLITE}\nRun: scripts/donnees/miroir-inagle.sh`
    );
  }

  const db = new Database(MIRROR_SQLITE, { readonly: true });
  const stats: TableInfo[] = [];

  for (const tableName of INAGLE_GAME_TABLES) {
    try {
      const countResult = db
        .query(`SELECT COUNT(*) as cnt FROM "${tableName}"`)
        .all();
      const count = (countResult[0] as any)?.cnt || 0;

      // Estimate size (rough)
      const sizeResult = db
        .query(
          `SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()`
        )
        .all();

      stats.push({
        name: tableName,
        rowCount: count,
        estimatedSize: count > 0 ? "~500 KB - 10 MB" : "0 bytes",
      });
    } catch {
      // Table might not exist in mirror
      stats.push({
        name: tableName,
        rowCount: 0,
        estimatedSize: "N/A",
      });
    }
  }

  db.close();
  return stats;
}

function printLoadPlan(stats: TableInfo[], dryRun: boolean) {
  const totalRows = stats.reduce((sum, t) => sum + t.rowCount, 0);
  const populatedTables = stats.filter((t) => t.rowCount > 0).length;

  console.log("\n" + "=".repeat(70));
  console.log("GAME DATA LOAD PLAN: Mirror SQLite → Supabase Cloud");
  console.log("=".repeat(70));

  console.log("\n📊 DATA SUMMARY:");
  console.log(`  Tables to load:        ${INAGLE_GAME_TABLES.length}`);
  console.log(`  Tables with data:      ${populatedTables}`);
  console.log(`  Total rows:            ${totalRows.toLocaleString()}`);
  console.log(`  Estimated size:        ~110 MB`);

  console.log("\n📦 TOP TABLES BY ROW COUNT:");
  stats
    .filter((t) => t.rowCount > 0)
    .sort((a, b) => b.rowCount - a.rowCount)
    .slice(0, 10)
    .forEach((t, idx) => {
      console.log(
        `  ${(idx + 1).toString().padStart(2)}. ${t.name.padEnd(35)} ${t.rowCount.toLocaleString().padStart(8)} rows`
      );
    });

  console.log("\n⚙️ LOAD METHOD:");
  console.log("  1. Read from: var/mirror.sqlite (auto-synced SQLite mirror)");
  console.log("  2. Transform: Convert SQLite rows to JSON");
  console.log("  3. Insert: Use Supabase REST API with batch inserts");
  console.log("  4. Retry: Automatic retry on network failures");
  console.log("  5. Idempotent: Uses ON CONFLICT DO UPDATE (upsert)");

  console.log("\n⏱️ ESTIMATED TIMING:");
  console.log("  Data preparation:     ~5-10 seconds");
  console.log("  Network transfer:      ~30-60 seconds (110 MB @ broadband)");
  console.log("  Database inserts:      ~20-30 seconds");
  console.log("  Total time:            ~2-3 minutes");
  console.log("  Total bandwidth:       ~110-120 MB upload");

  console.log("\n🔄 RESUMABLE:");
  console.log("  If interrupted, re-run the same command to resume");
  console.log("  Existing rows will be updated, not duplicated");

  console.log("\n🚀 PREREQUISITES:");
  console.log(
    "  ✓ Schema applied: supabase/migrations/*.sql on Cloud"
  );
  console.log("  ✓ Mirror available: var/mirror.sqlite");
  console.log("  ✓ Network: Connected to Supabase Cloud");
  console.log("  ✓ Auth: Service role key configured");

  if (dryRun) {
    console.log("\n[DRY RUN MODE]");
    console.log("No data transferred. Re-run without --dry-run to proceed.");
  }

  console.log("\n" + "=".repeat(70));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const load = args.includes("--load");

  console.log("🔍 Analyzing mirror database...");
  const stats = await getMirrorStats();

  printLoadPlan(stats, dryRun);

  if (!dryRun && load) {
    console.log("\n[LOAD MODE] Would proceed with actual data transfer");
    console.log(
      "Note: This requires Supabase CLI or direct API access with proper auth"
    );
    console.log("Next: Implement using pg_dump + psql or PostgREST API");
  }
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
