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
  // On vérifie la PRÉSENCE de chaque outil attendu, pas un total. Un compte en dur casse à
  // chaque ajout légitime (il annonçait 14 quand 17 étaient enregistrés) sans rien dire de ce
  // qui manque ; une liste nommée détecte la perte d'un outil et laisse passer les nouveaux.
  const attendus = [
    "vfs_list", "vfs_search", "vfs_stat", "asset_get",
    "re_query", "re_function", "re_coverage",
    "repo_read", "repo_list", "repo_find", "repo_grep",
    "explorer_status", "explorer_navigate", "explorer_open", "explorer_tab", "explorer_toast",
    "game_launch",
  ];
  const manquants = attendus.filter((a) => !names.includes(a));
  check(
    "listTools",
    manquants.length === 0,
    manquants.length === 0
      ? `${names.length} outils, les ${attendus.length} attendus présents`
      : `manquants : ${manquants.join(", ")}`,
  );

  // (1) re_coverage : pct plausible, et total COHÉRENT avec les lignes de `function`.
  // Pas de constante en dur : le nombre de racines `.pdata` dépend du build ciblé et d'un
  // `niers rebuild` (52 783 au 2026-08-10, 55 351 depuis le 2026-08-15). Le figer faisait
  // échouer la smoke sur une KB pourtant saine. Ce qui doit tenir, c'est la cohérence.
  {
    const { data } = await callJson<{
      latest: { pct: number; total_funcs: number; named: number; classified: number };
      function_rows_total: number;
    }>(client, "re_coverage", {});
    const pct = data.latest?.pct ?? 0;
    const total = data.latest?.total_funcs ?? 0;
    check(
      "re_coverage",
      pct >= 85 && pct <= 100 && total > 50_000 && total === data.function_rows_total,
      `pct=${pct.toFixed(2)} total=${total} named=${data.latest?.named} rows=${data.function_rows_total}`,
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

  // (4b) asset_get tex -> PNG. Deux voies possibles selon l'hôte, toutes deux valides :
  //  - `ffi`         : décodage en process par `nie` (CPK montés), l'URL est un `nie://…g4tx` ;
  //  - `model-serve` : service HTTP, et là la convention /tex impose '…/x.png' — jamais
  //                    '…/x.g4tx.png'. C'est ce piège-là que le test doit continuer de garder.
  {
    const texPath = "data/dx11/menu/200_icon/10_icon_chr/uniform/u040607_20_04_l.g4tx";
    const { data } = await callJson<{
      http_status: number;
      content_type: string | null;
      url: string;
      base64?: string;
      source?: string;
    }>(client, "asset_get", { path: texPath, decode: "tex" });
    const urlOk =
      data.source === "ffi"
        ? data.url.endsWith("/u040607_20_04_l.g4tx")
        : data.url.endsWith("/u040607_20_04_l.png") && !data.url.includes(".g4tx.png");
    check(
      "asset_get tex (PNG)",
      data.http_status === 200 && (data.content_type ?? "").includes("png") && urlOk && (data.base64?.length ?? 0) > 0,
      `source=${data.source} http=${data.http_status} ct=${data.content_type} b64=${data.base64 ? data.base64.length + "c" : "—"} url=${data.url}`,
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

  // (5) re_function + re_query.
  //
  // Le nom cherché est LU DANS LA BASE plutôt que codé en dur : `var/niers.sqlite` est refondée
  // (`niers rebuild`) au fil du reverse, et l'ancien littéral « CScene » n'y a plus aucune
  // fonction — la table `function` en compte 55 351 dont seule une fraction est nommée, et les
  // `CScene*` ne vivent plus que dans `rtti_class`. Le test échouait donc sur l'état de la base,
  // pas sur l'outil qu'il prétend vérifier.
  {
    const { data: seed } = await callJson<{ rows: { name: string }[] }>(client, "re_query", {
      sql: "SELECT name FROM function WHERE name IS NOT NULL AND length(name) > 4 LIMIT 1",
    });
    const nom = seed.rows[0]?.name;
    if (!nom) {
      check("re_function", false, "aucune fonction nommée dans var/niers.sqlite");
    } else {
      // Un fragment plutôt que le nom entier : c'est la recherche par fragment qu'on teste.
      const fragment = nom.slice(0, Math.min(6, nom.length));
      const { data } = await callJson<{
        total_matches: number;
        matches: { name: string; vaddr: string }[];
      }>(client, "re_function", { name: fragment });
      check(
        `re_function « ${fragment} »`,
        data.total_matches > 0 && data.matches[0]?.vaddr?.startsWith("0x") === true,
        `matches=${data.total_matches} top=${data.matches[0]?.name} @ ${data.matches[0]?.vaddr}`,
      );
    }
  }
  {
    const { data } = await callJson<{ rows: Record<string, unknown>[] }>(client, "re_query", {
      sql: "SELECT name, subsystem FROM function WHERE name IS NOT NULL LIMIT 5",
    });
    check("re_query SELECT", data.rows.length === 5, `rows=${data.rows.length} ex=${data.rows[0]?.["name"]}`);
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

  // (7) repo_list / repo_find / repo_grep — la navigation et la recherche dans le code, sur le
  // même moteur natif que `niers find`/`grep`. Aucune valeur en dur : on vérifie des invariants
  // (présence des dossiers de code, absence des dossiers exclus, lignes situées).
  {
    const { data } = await callJson<Array<{ name: string; is_dir: boolean }>>(client, "repo_list", {});
    const noms = data.map((e) => e.name);
    const exclusVus = ["data", "target", "node_modules", ".git", "var"].filter((x) => noms.includes(x));
    check(
      "repo_list racine",
      noms.includes("crates") && noms.includes("packages") && exclusVus.length === 0,
      `${data.length} entrées, exclus vus : ${exclusVus.length === 0 ? "aucun" : exclusVus.join(",")}`,
    );
  }
  {
    const { data } = await callJson<string[]>(client, "repo_find", {
      pattern: "depot",
      dir: "crates/engine/nie-explore",
      exts: ["rs"],
      limit: 20,
    });
    check(
      "repo_find depot.rs",
      data.some((p) => p.endsWith("nie-explore/src/depot.rs")),
      `${data.length} résultat(s)`,
    );
  }
  {
    const { data } = await callJson<Array<{ path: string; line: number; text: string }>>(
      client,
      "repo_grep",
      { pattern: "DOSSIERS_EXCLUS", dir: "crates/engine/nie-explore/src", exts: ["rs"], limit: 20 },
    );
    check(
      "repo_grep DOSSIERS_EXCLUS",
      data.length > 0 && data.every((m) => m.line >= 1 && m.path.includes("nie-explore")),
      `${data.length} ligne(s), 1re : ${data[0]?.path}:${data[0]?.line}`,
    );
  }
  {
    const { isError, raw } = await callJson(client, "repo_grep", { pattern: "x", dir: "data" });
    check("repo_grep bloque data/", isError, raw.slice(0, 70));
  }

  await client.close();

  console.log(`\n=== ${passed} PASS / ${failed} FAIL ===`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("smoke-test : échec inattendu :", e);
  process.exit(1);
});
