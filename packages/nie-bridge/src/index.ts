/**
 * `@niers/bridge` — canal de contrôle entre le serveur MCP et l'explorateur.
 *
 * Le serveur vit désormais dans `crates/tools/nie-cli/src/mcp/bridge.rs` ; ce paquet
 * ne conserve que le protocole et le client isomorphe utilisé par la WebView.
 */

export * from "./protocol.ts";
export * from "./client.ts";
export * from "./mcp-config.ts";
