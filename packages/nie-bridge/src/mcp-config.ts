/**
 * Description de l'entrée de configuration du serveur MCP `nie-game`.
 *
 * Partagée entre `nie-explorer` (qui l'écrit dans la config d'un client MCP depuis ses
 * Paramètres) et `nie-mcp` (qui s'en sert pour se diagnostiquer) : une seule définition de
 * la commande de lancement, au lieu d'un `.mcp.json` recopié à la main dans trois README.
 */

/** Nom sous lequel le serveur apparaît chez les clients MCP. */
export const MCP_SERVER_NAME = "nie-game";

/**
 * Binaire du serveur, lancé depuis le `PATH` (installé par `cargo install --path crates/tools/nie-mcp`).
 * Même forme que l'installeur Rust (`apps/inacord/src-tauri/src/mcp.rs`) : `cargo run` compile au
 * démarrage et attend le verrou du dossier de build, ce qui dépasse le délai de connexion du client.
 */
export const MCP_SERVER_BINARY = "nie-mcp";

/** Entrée `mcpServers[...]` telle qu'attendue par Claude Code et Claude Desktop. */
export interface McpServerEntry {
  type: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** Options de génération. */
export interface McpEntryOptions {
  /**
   * Racine du repo nie. Requise pour Claude Desktop, qui lance le serveur depuis un
   * répertoire courant arbitraire ; laisser vide pour Claude Code, dont le `.mcp.json` de
   * projet s'exécute déjà à la racine.
   */
  repoRoot?: string | undefined;
  /** Dossier du jeu, si différent de la racine du repo. */
  gameDir?: string | undefined;
  /** URL de l'API `nie-site` à transmettre au serveur MCP. */
  aphrodyApiUrl?: string | undefined;
}

/**
 * Construit l'entrée de configuration du serveur.
 *
 * Sans `repoRoot`, l'entrée n'a pas d'environnement — c'est la forme versionnée dans le
 * `.mcp.json` du repo, valable sur toutes les machines.
 */
export function mcpServerEntry(options: McpEntryOptions = {}): McpServerEntry {
  const root = options.repoRoot?.trim() ?? "";
  const env: Record<string, string> = {};
  if (root !== "") env["NIE_REPO"] = root;
  if (options.gameDir !== undefined && options.gameDir.trim() !== "") env["NIE_GAME_DIR"] = options.gameDir.trim();
  if (options.aphrodyApiUrl !== undefined && options.aphrodyApiUrl.trim() !== "") {
    env["NIE_APHRODY_API_URL"] = options.aphrodyApiUrl.trim().replace(/\/+$/, "");
  }
  return { type: "stdio", command: MCP_SERVER_BINARY, args: [], env };
}

/** Objet complet `{ mcpServers: { "nie-game": … } }`, à fusionner dans une config existante. */
export function mcpConfigFragment(options: McpEntryOptions = {}): {
  mcpServers: Record<string, McpServerEntry>;
} {
  return { mcpServers: { [MCP_SERVER_NAME]: mcpServerEntry(options) } };
}
