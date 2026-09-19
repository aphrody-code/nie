import fs from "fs";
import { Database } from "bun:sqlite";

const SUPABASE_URL = "https://ovgasnwnfnlvczmtpfrb.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im92Z2FzbnduZm5sdmN6bXRwZnJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NTI2NjQsImV4cCI6MjEwMjIyODY2NH0.amPgGMw-j6i3FkhEQIMupNuLXbxzR9BiV67yztD2xSw";

const tables = [
  "jugadores",
  "equipos",
  "sobres",
  "supertecnicas",
  "supertacticas",
  "uniformes",
  "auras",
  "formaciones",
  "recursos",
  "precios_venta_rapida",
  "desafios_catalogo",
  "desafios_plantilla_catalogo",
  "game_flags",
  "subastas_vip_config",
  "subastas_vip",
  "plantillas",
  "usuarios",
  "notificaciones",
  "movimientos_saldo",
  "mis_escudos",
  "mis_supertacticas",
  "mis_uniformes",
  "sobres_pendientes",
  "admins",
  "beta_testers"
];

fs.mkdirSync("var/mirror/ievr-ut/db", { recursive: true });
const sqliteDb = new Database("var/mirror/ievr-ut/ievr_ut.sqlite");

async function dumpTable(table: string) {
  let allRows: any[] = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=*`;
    try {
      const res = await fetch(url, {
        headers: {
          "apikey": ANON_KEY,
          "Authorization": `Bearer ${ANON_KEY}`,
          "Range": `${from}-${to}`,
          "Prefer": "count=exact"
        }
      });

      if (!res.ok) {
        const text = await res.text();
        console.log(`[${table}] HTTP ${res.status}: ${text}`);
        return { table, count: 0, status: res.status, error: text };
      }

      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        break;
      }
      allRows.push(...rows);
      if (rows.length < pageSize) {
        break;
      }
      page++;
    } catch (err: any) {
      console.error(`[${table}] Error:`, err.message);
      return { table, count: allRows.length, error: err.message };
    }
  }

  console.log(`[${table}] Dumped ${allRows.length} rows`);
  fs.writeFileSync(`var/mirror/ievr-ut/db/${table}.json`, JSON.stringify(allRows, null, 2));

  // Store in SQLite
  if (allRows.length > 0) {
    const sample = allRows[0];
    const cols = Object.keys(sample);
    const colDefs = cols.map(c => {
      const val = sample[c];
      if (typeof val === "number") return `"${c}" REAL`;
      if (typeof val === "boolean") return `"${c}" INTEGER`;
      return `"${c}" TEXT`;
    }).join(", ");

    sqliteDb.run(`DROP TABLE IF EXISTS "${table}"`);
    sqliteDb.run(`CREATE TABLE "${table}" (${colDefs})`);

    const placeholders = cols.map(() => "?").join(", ");
    const insertStmt = sqliteDb.prepare(`INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(", ")}) VALUES (${placeholders})`);

    sqliteDb.transaction(() => {
      for (const row of allRows) {
        const values = cols.map(c => {
          const v = row[c];
          if (v === null || v === undefined) return null;
          if (typeof v === "object") return JSON.stringify(v);
          if (typeof v === "boolean") return v ? 1 : 0;
          return v;
        });
        insertStmt.run(...values);
      }
    })();
  }

  return { table, count: allRows.length, status: 200 };
}

async function main() {
  const summary: any[] = [];
  for (const table of tables) {
    const res = await dumpTable(table);
    summary.push(res);
  }
  fs.writeFileSync("var/mirror/ievr-ut/db_summary.json", JSON.stringify(summary, null, 2));
  console.log("Database dump complete!");
}

main().catch(console.error);
