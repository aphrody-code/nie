import { expect, test } from "bun:test";
import { MCP_SERVER_BINARY, MCP_SERVER_NAME, mcpConfigFragment, mcpServerEntry } from "./mcp-config.ts";

test("sans racine, le binaire est lancé depuis le PATH, sans environnement", () => {
  const entry = mcpServerEntry();
  expect(entry.command).toBe(MCP_SERVER_BINARY);
  expect(entry.command).toBe("nie-mcp");
  expect(entry.args).toEqual([]);
  expect(entry.env).toEqual({});
});

test("avec une racine, elle passe par NIE_REPO et la commande ne change pas", () => {
  const entry = mcpServerEntry({ repoRoot: "  C:\Jeux\IEVR  " });
  expect(entry.command).toBe("nie-mcp");
  expect(entry.args).toEqual([]);
  expect(entry.env).toEqual({ NIE_REPO: "C:\Jeux\IEVR" });
});

test("le dossier du jeu passe par l'environnement, et seulement s'il est renseigné", () => {
  expect(mcpServerEntry({ gameDir: "D:/Jeux/IEVR" }).env["NIE_GAME_DIR"]).toBe("D:/Jeux/IEVR");
  expect(mcpServerEntry({ gameDir: "   " }).env["NIE_GAME_DIR"]).toBeUndefined();
});

test("le fragment est prêt à fusionner dans une config existante", () => {
  const fragment = mcpConfigFragment();
  expect(Object.keys(fragment.mcpServers)).toEqual([MCP_SERVER_NAME]);
  expect(fragment.mcpServers[MCP_SERVER_NAME]?.type).toBe("stdio");
});

test("transmet l'URL nie-site sans slash final", () => {
  expect(mcpServerEntry({ aphrodyApiUrl: "https://nie.aphrody.com///" }).env).toMatchObject({
    NIE_APHRODY_API_URL: "https://nie.aphrody.com",
  });
});
