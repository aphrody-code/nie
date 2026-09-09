import { expect, test } from "bun:test";
import { MCP_SERVER_NAME, mcpConfigFragment, mcpServerEntry } from "./mcp-config.ts";

test("sans racine, le chemin reste relatif — forme versionnable du .mcp.json", () => {
  const entry = mcpServerEntry();
  expect(entry.command).toBe("cargo");
  expect(entry.args).toEqual(["run", "--release", "--quiet", "--package", "nie-mcp", "--"]);
  expect(entry.env).toEqual({});
});

test("avec une racine Windows, le chemin est absolu et séparé par des antislashs", () => {
  const entry = mcpServerEntry({ repoRoot: "C:\\Jeux\\IEVR" });
  expect(entry.args.slice(3, 5)).toEqual(["--manifest-path", "C:\\Jeux\\IEVR\\Cargo.toml"]);
  expect(entry.env["NIERS_REPO"]).toBe("C:\\Jeux\\IEVR");
});

test("avec une racine POSIX, le séparateur reste la barre oblique", () => {
  const entry = mcpServerEntry({ repoRoot: "/home/ubuntu/niers/" });
  expect(entry.args.slice(3, 5)).toEqual(["--manifest-path", "/home/ubuntu/niers/Cargo.toml"]);
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
