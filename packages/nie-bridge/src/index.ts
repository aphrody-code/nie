/**
 * `@niers/bridge` — canal de contrôle entre le serveur MCP et l'explorateur.
 *
 * - `@niers/bridge` (ce module) : protocole + client. Isomorphe, utilisable dans la WebView.
 * - `@niers/bridge/server` : serveur, dépend de `Bun.serve`.
 */

export * from "./protocol.ts";
export * from "./client.ts";
export * from "./mcp-config.ts";
