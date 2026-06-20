/**
 * Smoke-test de bout en bout : démarre le serveur MCP en sous-process (stdio),
 * s'y connecte avec un vrai client MCP, et appelle chaque outil contre les VRAIES
 * sources (Redis db3, var/niers.sqlite, nie-model-serve, repo).
 *
 *   bun run test/smoke.ts
 *
 * Sortie : un rapport lisible + code de sortie 0 (succès) / 1 (échec).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, "../src/index.ts");

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail: string): void {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label} — ${detail}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label} — ${detail}`);
  }
}

type TextContent = { type: string; text?: string };

function textOf(result: { content: TextContent[]; isError?: boolean }): string {
  return result.content.map((c) => c.text ?? "").join("");
}

async function callJson<T>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ data: T; isError: boolean; raw: string }> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: TextContent[];
    isError?: boolean;
  };
  const raw = textOf(res);
  let data: T;
  try {
    data = JSON.parse(raw) as T;
  } catch {
    data = raw as unknown as T;
  }
  return { data, isError: res.isError === true, raw };
}

async function main(): Promise<void> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;

  const transport = new StdioClientTransport({
    command: process.execPath, // binaire bun
    args: ["run", serverEntry],
    env,
    stderr: "inherit",
  });
  const client = new Client({ name: "niers-game-smoke", version: "0.1.0" });

  console.log("→ démarrage du serveur MCP niers-game (stdio)…\n");
  await client.connect(transport);

  // Liste des outils exposés.
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  check("listTools", names.length === 8, `${names.length} outils : ${names.join(", ")}`);

  // (1) re_coverage : pct plausible (~93 %), total 52783.
  {
    const { data } = await callJson<{
      latest: { pct: number; total_funcs: number; named: number; classified: number };
      function_rows_total: number;
    }>(client, "re_coverage", {});
    const pct = data.latest?.pct ?? 0;
    check(
      "re_coverage",
      pct >= 85 && pct <= 100 && data.latest?.total_funcs === 52783,
      `pct=${pct.toFixed(2)} total=${data.latest?.total_funcs} named=${data.latest?.named} rows=${data.function_rows_total}`,
    );
  }

  // (2) vfs_search "c01000010" : chemins renvoyés.
  {
    const { data } = await callJson<{ total_matches: number; matches: { path: string }[] }>(
      client,
      "vfs_search",
      { query: "c01000010", limit: 5 },
    );
    check(
      "vfs_search c01000010",
      data.total_matches > 0 && data.matches.length > 0,
      `total=${data.total_matches} ex=${data.matches[0]?.path ?? "—"}`,
    );
  }

  // (3) vfs_list "data/dx11/chr" : sous-dossiers listés.
  {
    const { data } = await callJson<{ directories: string[]; total_directories: number; total_files: number }>(
      client,
      "vfs_list",
      { prefix: "data/dx11/chr" },
    );
    check(
      "vfs_list data/dx11/chr",
      data.directories.length > 0,
      `dirs=${data.total_directories} [${data.directories.slice(0, 5).join(", ")}] files=${data.total_files}`,
    );
  }

  // (3b) vfs_stat sur un fichier connu.
  {
    const { data } = await callJson<{ kind: string; cpk?: string; decode?: string }>(client, "vfs_stat", {
      path: "data/common/text/en/event/ev20_03200.cfg.bin",
    });
    check(
      "vfs_stat cfg.bin",
      data.kind === "file" && data.decode === "cfg" && !!data.cpk,
      `kind=${data.kind} decode=${data.decode} cpk=${data.cpk?.slice(0, 12)}…`,
    );
  }

  // (4) asset_get cfg.bin -> JSON via model-serve.
  {
    const { data } = await callJson<{ http_status: number; text?: string; url: string }>(client, "asset_get", {
      path: "data/common/text/en/event/ev20_03200.cfg.bin",
      decode: "cfg",
    });
    let jsonOk = false;
    try {
      jsonOk = !!data.text && typeof JSON.parse(data.text) === "object";
    } catch {
      jsonOk = false;
    }
    check(
      "asset_get cfg (model-serve)",
      data.http_status === 200 && jsonOk,
      `http=${data.http_status} json=${jsonOk} url=${data.url}`,
    );
  }

  // (4b) asset_get tex -> PNG. On passe le chemin AVEC .g4tx : la convention /tex
  // doit produire une URL '…/x.png' (jamais '…/x.g4tx.png').
  {
    const texPath = "data/dx11/menu/200_icon/10_icon_chr/uniform/u040607_20_04_l.g4tx";
    const { data } = await callJson<{
      http_status: number;
      content_type: string | null;
      url: string;
      base64?: string;
    }>(client, "asset_get", { path: texPath, decode: "tex" });
    check(
      "asset_get tex (PNG)",
      data.http_status === 200 &&
        (data.content_type ?? "").includes("png") &&
        data.url.endsWith("/u040607_20_04_l.png") &&
        !data.url.includes(".g4tx.png"),
      `http=${data.http_status} ct=${data.content_type} b64=${data.base64 ? data.base64.length + "c" : "—"} url=${data.url}`,
    );
  }

  // (4c) glob inter-dossiers (sémantique '**') doit matcher.
  {
    const { data } = await callJson<{ total_matches: number; mode: string }>(client, "vfs_search", {
      query: "data/dx11/chr/**/*.g4tx",
      limit: 3,
    });
    check("vfs_search glob **", data.mode === "glob" && data.total_matches > 0, `mode=${data.mode} total=${data.total_matches}`);
  }

  // (5) re_function CScene + re_query.
  {
    const { data } = await callJson<{ total_matches: number; matches: { name: string; vaddr: string }[] }>(
      client,
      "re_function",
      { name: "CScene" },
    );
    check(
      "re_function CScene",
      data.total_matches > 0 && data.matches[0]?.vaddr?.startsWith("0x") === true,
      `matches=${data.total_matches} top=${data.matches[0]?.name} @ ${data.matches[0]?.vaddr}`,
    );
  }
  {
    const { data } = await callJson<{ rows: Record<string, unknown>[] }>(client, "re_query", {
      sql: "SELECT name, subsystem FROM function WHERE name IS NOT NULL LIMIT 5",
    });
    check("re_query SELECT", data.rows.length === 5, `rows=${data.rows.length} ex=${data.rows[0]?.name}`);
  }
  {
    // Sécurité : une mutation doit être refusée.
    const { isError, raw } = await callJson(client, "re_query", { sql: "DELETE FROM function" });
    check("re_query rejette DELETE", isError, raw.slice(0, 60));
  }

  // (6) repo_read + garde anti-traversal.
  {
    const { data } = await callJson<{ content?: string; size: number }>(client, "repo_read", {
      path: "docs/PLAN.md",
    });
    check("repo_read docs/PLAN.md", typeof data.content === "string" && data.size > 0, `size=${data.size}`);
  }
  {
    const { isError, raw } = await callJson(client, "repo_read", { path: "var/niers.sqlite" });
    check("repo_read bloque var/", isError, raw.slice(0, 70));
  }
  {
    const { isError, raw } = await callJson(client, "repo_read", { path: "../../etc/passwd" });
    check("repo_read bloque traversal", isError, raw.slice(0, 70));
  }

  await client.close();

  console.log(`\n=== ${passed} PASS / ${failed} FAIL ===`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("smoke-test : échec inattendu :", e);
  process.exit(1);
});
