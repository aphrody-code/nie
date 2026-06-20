/**
 * Base de connaissance reverse-engineering (SQLite `var/niers.sqlite`, lecture seule).
 *
 * Ouverte avec `{ readonly: true, safeIntegers: true }` : toutes les colonnes entières
 * reviennent en BigInt (les adresses virtuelles dépassent parfois 2^53 — ex. les vaddr
 * synthétiques 0x7000000000000000 des thunks). On sérialise ensuite proprement, en
 * affichant les colonnes d'adresse en hexadécimal.
 */

import { Database } from "bun:sqlite";
import { config } from "./config.ts";
import { assertSelectOnly, ToolError } from "./security.ts";

/** Colonnes dont la valeur entière est une adresse virtuelle : affichées en hex. */
const ADDR_COLUMNS = new Set([
  "vaddr", "from_addr", "to_addr", "addr", "base_addr", "va", "target_addr",
]);

type Row = Record<string, unknown>;

/** Convertit une valeur (BigInt issu de safeIntegers, etc.) en JSON-friendly. */
function normalizeValue(column: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    if (ADDR_COLUMNS.has(column)) return "0x" + value.toString(16);
    if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(value);
    }
    return value.toString();
  }
  if (value instanceof Uint8Array) return `<blob ${value.length} bytes>`;
  return value;
}

function normalizeRow(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k] = normalizeValue(k, v);
  return out;
}

export interface CoverageResult {
  latest: Row | null;
  function_rows_total: number;
  per_binary: Row[];
  primary_binary_id: number;
}

export interface FunctionResult {
  query: { name?: string; vaddr?: string };
  matches: Row[];
  total_matches: number;
  xrefs?: {
    of: string;
    incoming: Row[];
    outgoing: Row[];
  };
}

export class KnowledgeBase {
  private readonly db: Database;

  constructor() {
    this.db = new Database(config.sqlitePath, { readonly: true, safeIntegers: true });
  }

  close(): void {
    this.db.close(false);
  }

  /** Requête SELECT arbitraire (validée SELECT-only), bornée à `limit` lignes. */
  query(sql: string, limit: number): { rows: Row[]; truncated: boolean; columns: string[] } {
    const safe = assertSelectOnly(sql);
    const stmt = this.db.prepare(safe);
    try {
      const rows: Row[] = [];
      let truncated = false;
      for (const row of stmt.iterate() as Iterable<Row>) {
        if (rows.length >= limit) {
          truncated = true;
          break;
        }
        rows.push(normalizeRow(row));
      }
      const columns = rows.length > 0 ? Object.keys(rows[0]!) : stmt.columnNames;
      return { rows, truncated, columns };
    } finally {
      stmt.finalize();
    }
  }

  /** Dernière ligne de `coverage` + comptes réels de la table `function`. */
  coverage(): CoverageResult {
    const latestStmt = this.db.prepare(
      "SELECT ts, binary_id, total_funcs, named, classified, pct FROM coverage ORDER BY id DESC LIMIT 1",
    );
    const latest = latestStmt.get() as Row | null;
    latestStmt.finalize();

    const totalStmt = this.db.prepare("SELECT COUNT(*) AS n FROM function");
    const totalRow = totalStmt.get() as { n: bigint } | null;
    totalStmt.finalize();

    const perStmt = this.db.prepare(
      "SELECT binary_id, COUNT(*) AS rows_total, SUM(name IS NOT NULL) AS named FROM function GROUP BY binary_id ORDER BY binary_id",
    );
    const per = (perStmt.all() as Row[]).map(normalizeRow);
    perStmt.finalize();

    return {
      latest: latest ? normalizeRow(latest) : null,
      function_rows_total: totalRow ? Number(totalRow.n) : 0,
      per_binary: per,
      primary_binary_id: config.primaryBinaryId,
    };
  }

  /** Cherche une fonction par nom (LIKE) ou vaddr (hex/dec) + xrefs entrants/sortants. */
  findFunction(args: { name?: string; vaddr?: string }, matchLimit = 25, xrefLimit = 12): FunctionResult {
    const cols =
      "id, binary_id, vaddr, size, name, name_source, confidence, cc, n_args, subsystem, role, pagerank, ret_type, params, n_calls_in, n_calls_out, complexity";

    let matches: Row[] = [];
    if (args.vaddr !== undefined && args.vaddr.trim().length > 0) {
      const va = parseAddr(args.vaddr);
      const stmt = this.db.prepare(
        `SELECT ${cols} FROM function WHERE vaddr = ? ORDER BY binary_id`,
      );
      matches = (stmt.all(va) as Row[]).slice(0, matchLimit);
      stmt.finalize();
    } else if (args.name !== undefined && args.name.trim().length > 0) {
      const stmt = this.db.prepare(
        `SELECT ${cols} FROM function WHERE name LIKE ? ORDER BY (name = ?) DESC, pagerank DESC, binary_id LIMIT ?`,
      );
      matches = stmt.all(`%${args.name}%`, args.name, BigInt(matchLimit)) as Row[];
      stmt.finalize();
    } else {
      throw new ToolError("re_function : fournir `name` ou `vaddr`");
    }

    const result: FunctionResult = {
      query: args,
      total_matches: matches.length,
      matches: matches.map(normalizeRow),
    };

    // Xrefs pour le meilleur match (premier de la liste).
    const best = matches[0];
    if (best) {
      const binId = best.binary_id as bigint;
      const va = best.vaddr as bigint;
      const inStmt = this.db.prepare(
        `SELECT x.from_addr, x.kind, f.name AS from_name
         FROM xref x LEFT JOIN function f ON f.vaddr = x.from_addr AND f.binary_id = x.binary_id
         WHERE x.to_addr = ? AND x.binary_id = ? LIMIT ?`,
      );
      const incoming = (inStmt.all(va, binId, BigInt(xrefLimit)) as Row[]).map(normalizeRow);
      inStmt.finalize();

      const outStmt = this.db.prepare(
        `SELECT x.to_addr, x.kind, f.name AS to_name
         FROM xref x LEFT JOIN function f ON f.vaddr = x.to_addr AND f.binary_id = x.binary_id
         WHERE x.from_addr = ? AND x.binary_id = ? LIMIT ?`,
      );
      const outgoing = (outStmt.all(va, binId, BigInt(xrefLimit)) as Row[]).map(normalizeRow);
      outStmt.finalize();

      result.xrefs = {
        of: (best.name as string | null) ?? "0x" + va.toString(16),
        incoming,
        outgoing,
      };
    }

    return result;
  }
}

/** Parse une adresse virtuelle hex (`0x…`) ou décimale en BigInt. */
export function parseAddr(s: string): bigint {
  const t = s.trim().toLowerCase();
  try {
    if (t.startsWith("0x")) return BigInt(t);
    if (/^[0-9]+$/.test(t)) return BigInt(t);
    // Tolère un hex nu (lettres a-f présentes).
    if (/^[0-9a-f]+$/.test(t)) return BigInt("0x" + t);
  } catch {
    /* tombe dans l'erreur ci-dessous */
  }
  throw new ToolError(`vaddr invalide : ${s} (attendu hex 0x… ou décimal)`);
}
