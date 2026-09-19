#!/usr/bin/env python3
"""
Sync IEVR Ultimate Team Supabase database into a local SQLite mirror.
Single source of truth: Supabase project https://ovgasnwnfnlvczmtpfrb.supabase.co
Target SQLite: data/ievr-ut.sqlite
Metadata: var/ievr-supabase-mirror.json
"""

import os
import sys
import json
import time
import sqlite3
import argparse
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
from requests.adapters import HTTPAdapter
from urllib3.util import Retry

PROJECT_URL = "https://ovgasnwnfnlvczmtpfrb.supabase.co"
ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im92Z2FzbnduZm5sdmN6bXRwZnJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NTI2NjQsImV4cCI6MjEwMjIyODY2NH0."
    "amPgGMw-j6i3FkhEQIMupNuLXbxzR9BiV67yztD2xSw"
)

# All tables identified in prompt
DEFAULT_TABLES = [
    "admins",
    "auras",
    "beta_testers",
    "clan_actividad",
    "clan_banco_movimientos",
    "clan_configuracion",
    "clan_mensajes_chat",
    "clan_rol_permisos",
    "contenido_paginas",
    "conversaciones_chat",
    "cosmeticos_catalogo",
    "cosmeticos-catalogo",
    "desafios_catalogo",
    "desafios_plantilla_catalogo",
    "desafios_progreso",
    "equipos",
    "formaciones",
    "game_flags",
    "imagenes-inazuma",
    "jugadores",
    "mis_escudos",
    "mis_supertacticas",
    "mis_uniformes",
    "movimientos_saldo",
    "notificaciones",
    "plantillas",
    "precios_venta_rapida",
    "recursos",
    "sobres",
    "sobres_pendientes",
    "subastas_vip",
    "subastas_vip_config",
    "supertacticas",
    "supertecnicas",
    "uniformes",
    "usuarios",
    "usuarios_cosmeticos",
    "vip_planes",
    "vr_draft_config",
    "vr_draft_probabilidades"
]

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEFAULT_DB_PATH = os.path.join(REPO_ROOT, "data", "ievr-ut.sqlite")
DEFAULT_META_PATH = os.path.join(REPO_ROOT, "var", "ievr-supabase-mirror.json")
PAGE_SIZE = 1000
TIMEOUT = 45


def create_session() -> requests.Session:
    session = requests.Session()
    retry_strategy = Retry(
        total=3,
        backoff_factor=1.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"]
    )
    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def fetch_table(table: str):
    """
    Fetch all records for a table using pagination with Range header.
    Returns dict: {table, status, records, http_status, error, duration}
    """
    session = create_session()
    offset = 0
    all_records = []
    t0 = time.time()
    last_http_code = None

    try:
        while True:
            # Query with Range header and limit/offset query parameters for robustness
            url = f"{PROJECT_URL}/rest/v1/{table}?limit={PAGE_SIZE}&offset={offset}"
            headers = {
                "apikey": ANON_KEY,
                "Authorization": f"Bearer {ANON_KEY}",
                "Range": f"{offset}-{offset + PAGE_SIZE - 1}",
                "Range-Unit": "items",
                "Prefer": "count=exact"
            }

            resp = session.get(url, headers=headers, timeout=TIMEOUT)
            last_http_code = resp.status_code

            if resp.status_code == 404:
                elapsed = time.time() - t0
                return {
                    "table": table,
                    "status": "404_not_found",
                    "records": [],
                    "http_status": 404,
                    "error": resp.text[:120],
                    "duration": round(elapsed, 2)
                }
            elif resp.status_code in (401, 403):
                elapsed = time.time() - t0
                return {
                    "table": table,
                    "status": f"{resp.status_code}_forbidden_rls",
                    "records": [],
                    "http_status": resp.status_code,
                    "error": resp.text[:120],
                    "duration": round(elapsed, 2)
                }
            elif resp.status_code not in (200, 206):
                elapsed = time.time() - t0
                return {
                    "table": table,
                    "status": f"http_error_{resp.status_code}",
                    "records": [],
                    "http_status": resp.status_code,
                    "error": resp.text[:120],
                    "duration": round(elapsed, 2)
                }

            data = resp.json()
            if not isinstance(data, list):
                elapsed = time.time() - t0
                return {
                    "table": table,
                    "status": "invalid_json_format",
                    "records": [],
                    "http_status": resp.status_code,
                    "error": f"Expected list, got {type(data)}",
                    "duration": round(elapsed, 2)
                }

            if not data:
                break

            all_records.extend(data)

            if len(data) < PAGE_SIZE:
                break

            offset += PAGE_SIZE

        elapsed = time.time() - t0
        if not all_records:
            return {
                "table": table,
                "status": "empty_or_rls_restricted",
                "records": [],
                "http_status": 200,
                "error": None,
                "duration": round(elapsed, 2)
            }

        return {
            "table": table,
            "status": "mirrored",
            "records": all_records,
            "http_status": 200,
            "error": None,
            "duration": round(elapsed, 2)
        }

    except Exception as e:
        elapsed = time.time() - t0
        return {
            "table": table,
            "status": "exception",
            "records": all_records,
            "http_status": last_http_code,
            "error": str(e),
            "duration": round(elapsed, 2)
        }
    finally:
        session.close()


def infer_sqlite_type(values):
    """Infer SQLite column type from observed python values."""
    non_nulls = [v for v in values if v is not None]
    if not non_nulls:
        return "TEXT"

    # If any value is a dict or list, serialize to JSON string (TEXT)
    if any(isinstance(v, (dict, list)) for v in non_nulls):
        return "TEXT"

    # Check if all values are boolean
    if all(isinstance(v, bool) for v in non_nulls):
        return "INTEGER"

    # Check if all values are int (excluding bool)
    if all(isinstance(v, int) and not isinstance(v, bool) for v in non_nulls):
        return "INTEGER"

    # Check if numeric (float or int)
    if all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in non_nulls):
        return "REAL"

    return "TEXT"


def save_to_sqlite(conn: sqlite3.Connection, table: str, records: list):
    """Create clean table schema based on JSON fields and insert all records."""
    if not records:
        return []

    # Collect all unique column names preserving order of first appearance
    cols_order = []
    col_seen = set()
    for rec in records:
        for k in rec.keys():
            if k not in col_seen:
                col_seen.add(k)
                cols_order.append(k)

    # Determine types
    col_defs = []
    for col in cols_order:
        values = [r.get(col) for r in records]
        col_type = infer_sqlite_type(values)
        col_defs.append(f'"{col}" {col_type}')

    cursor = conn.cursor()
    cursor.execute(f'DROP TABLE IF EXISTS "{table}"')
    create_sql = f'CREATE TABLE "{table}" ({", ".join(col_defs)})'
    cursor.execute(create_sql)

    placeholders = ", ".join(["?"] * len(cols_order))
    col_names_quoted = ", ".join([f'"{c}"' for c in cols_order])
    insert_sql = f'INSERT INTO "{table}" ({col_names_quoted}) VALUES ({placeholders})'

    rows_to_insert = []
    for rec in records:
        row = []
        for col in cols_order:
            val = rec.get(col)
            if isinstance(val, (dict, list)):
                row.append(json.dumps(val, ensure_ascii=False))
            elif isinstance(val, bool):
                row.append(1 if val else 0)
            else:
                row.append(val)
        rows_to_insert.append(row)

    cursor.executemany(insert_sql, rows_to_insert)
    conn.commit()
    return cols_order


def main():
    parser = argparse.ArgumentParser(description="Sync Supabase IEVR UT into local SQLite mirror.")
    parser.add_argument("--workers", type=int, default=4, help="Number of concurrent worker threads")
    parser.add_argument("--db", type=str, default=DEFAULT_DB_PATH, help="Path to output SQLite database")
    parser.add_argument("--meta", type=str, default=DEFAULT_META_PATH, help="Path to output mirror JSON metadata")
    parser.add_argument("--tables", nargs="*", default=DEFAULT_TABLES, help="List of tables to sync")
    args = parser.parse_args()

    db_path = os.path.abspath(args.db)
    meta_path = os.path.abspath(args.meta)
    tables = args.tables

    print(f"[{datetime.now(timezone.utc).isoformat()}] Starting Supabase IEVR UT sync...")
    print(f"  Project URL: {PROJECT_URL}")
    print(f"  Target DB:   {db_path}")
    print(f"  Metadata:    {meta_path}")
    print(f"  Tables:      {len(tables)} tables")
    print(f"  Workers:     {args.workers}")

    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    os.makedirs(os.path.dirname(meta_path), exist_ok=True)

    conn = sqlite3.connect(db_path)

    results = {}
    total_mirrored_rows = 0
    mirrored_tables_count = 0
    empty_tables_count = 0
    not_found_count = 0
    error_count = 0

    t_start = time.time()

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        future_to_table = {executor.submit(fetch_table, t): t for t in tables}
        completed_count = 0

        for future in as_completed(future_to_table):
            completed_count += 1
            res = future.result()
            table = res["table"]
            status = res["status"]
            records = res["records"]
            row_count = len(records)
            elapsed = res["duration"]

            columns = []
            if status == "mirrored" and row_count > 0:
                columns = save_to_sqlite(conn, table, records)
                total_mirrored_rows += row_count
                mirrored_tables_count += 1
                msg = f"OK ({row_count} rows, {len(columns)} cols)"
            elif status == "empty_or_rls_restricted":
                empty_tables_count += 1
                msg = "EMPTY / RLS RESTRICTED (0 rows)"
            elif status == "404_not_found":
                not_found_count += 1
                msg = "404 NOT FOUND"
            else:
                error_count += 1
                msg = f"FAILED: {status} ({res.get('error', '')[:60]})"

            print(f"[{completed_count:02d}/{len(tables):02d}] {table:30} -> {msg} [{elapsed:.1f}s]")

            results[table] = {
                "status": status,
                "http_status": res["http_status"],
                "row_count": row_count,
                "columns": columns,
                "duration_sec": elapsed,
                "error": res["error"]
            }

    conn.close()
    total_elapsed = time.time() - t_start

    # Write metadata JSON
    meta = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "project_url": PROJECT_URL,
        "database_file": os.path.relpath(db_path, REPO_ROOT),
        "total_elapsed_sec": round(total_elapsed, 2),
        "summary": {
            "total_tables_checked": len(tables),
            "mirrored_tables": mirrored_tables_count,
            "empty_or_rls_tables": empty_tables_count,
            "not_found_tables": not_found_count,
            "error_tables": error_count,
            "total_rows_mirrored": total_mirrored_rows
        },
        "tables": results
    }

    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    print("\n" + "=" * 65)
    print("SYNC COMPLETE SUMMARY:")
    print(f"  Total tables checked: {len(tables)}")
    print(f"  Mirrored tables:      {mirrored_tables_count}")
    print(f"  Empty / RLS tables:   {empty_tables_count}")
    print(f"  Not found (404):      {not_found_count}")
    print(f"  Errors:               {error_count}")
    print(f"  Total rows saved:     {total_mirrored_rows}")
    print(f"  Total time elapsed:   {total_elapsed:.1f}s")
    if os.path.exists(db_path):
        print(f"  SQLite DB:            {db_path} ({os.path.getsize(db_path):,} bytes)")
    print(f"  Metadata JSON:        {meta_path}")
    print("=" * 65)


if __name__ == "__main__":
    main()
