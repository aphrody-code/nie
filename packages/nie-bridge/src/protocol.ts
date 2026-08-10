/**
 * Protocole de contrôle `nie-bridge` — la définition unique, partagée par les deux bouts.
 *
 * `nie-mcp` (serveur MCP, Bun) écoute ; `nie-explorer` (UI Tauri) se connecte et exécute.
 * Les deux importent ce module : une commande ajoutée ici casse la compilation du côté qui
 * ne la gère pas, au lieu de diverger en silence — même raison d'être que les bindings
 * `tauri-specta` entre le Rust et le React de l'explorateur.
 *
 * Transport : WebSocket sur la boucle locale, une trame = un message JSON.
 */

/** Port par défaut du pont. `MODEL_SERVE_URL` occupe 8790 ; on prend le suivant. */
export const DEFAULT_BRIDGE_PORT = 8791;

/** Chemin WebSocket servi par le pont. */
export const BRIDGE_PATH = "/bridge";

/** Version du protocole, incrémentée à chaque changement incompatible. */
export const BRIDGE_PROTOCOL_VERSION = 1;

/** URL WebSocket du pont pour un port donné. */
export function bridgeUrl(port: number = DEFAULT_BRIDGE_PORT): string {
  return `ws://127.0.0.1:${port}${BRIDGE_PATH}`;
}

// ─── Commandes ───────────────────────────────────────────────────────────────

/** Onglets adressables de l'explorateur (identiques aux `value` des `TabsContent`). */
export const EXPLORER_TABS = [
  "editor",
  "explorer",
  "search",
  "data",
  "cpk",
  "save",
  "mods",
  "re",
  "lua",
  "settings",
] as const;

export type ExplorerTab = (typeof EXPLORER_TABS)[number];

/** Vrai si `v` est un onglet connu de l'explorateur. */
export function isExplorerTab(v: string): v is ExplorerTab {
  return (EXPLORER_TABS as readonly string[]).includes(v);
}

/**
 * Commandes que le serveur peut envoyer au client.
 *
 * Union discriminée par `cmd` : ajouter un membre force le `switch` du client à le traiter
 * (le `never` de `assertNever` ne compile plus sinon).
 */
export type BridgeCommand =
  /** Sonde de présence : le client répond son identité et son état. */
  | { cmd: "ping" }
  /** Ouvre l'explorateur sur `prefix`, en sélectionnant éventuellement une entrée. */
  | { cmd: "navigate"; prefix: string; select?: string | undefined }
  /** Ouvre un fichier du VFS dans le panneau de détail. */
  | { cmd: "open"; path: string }
  /** Bascule sur un onglet. */
  | { cmd: "tab"; tab: ExplorerTab }
  /** Affiche une notification dans l'interface. */
  | { cmd: "toast"; message: string; kind?: "info" | "success" | "error" | undefined }
  /** Demande l'état courant sans rien modifier. */
  | { cmd: "state" };

/** Nom d'une commande. */
export type BridgeCommandName = BridgeCommand["cmd"];

/** État de l'explorateur, renvoyé par `ping` et `state`. */
export interface ExplorerState {
  /** Onglet affiché. */
  tab: string;
  /** Dossier VFS courant de l'explorateur. */
  prefix: string;
  /** Entrée sélectionnée, si une l'est. */
  selected: string | null;
  /** Fichier ouvert hors arborescence (« Ouvrir avec »), si un l'est. */
  externalPath: string | null;
}

/** Identité annoncée par un client à la connexion. */
export interface BridgeHello {
  /** Nom applicatif, ex. `nie-explorer`. */
  app: string;
  /** Version du paquet client. */
  version: string;
  /** Version de protocole comprise par le client. */
  protocol: number;
}

// ─── Trames ──────────────────────────────────────────────────────────────────

/** Serveur → client : exécute `command`, réponds avec le même `id`. */
export interface BridgeRequest {
  type: "request";
  id: number;
  command: BridgeCommand;
}

/** Client → serveur : résultat d'une requête. */
export type BridgeResponse =
  | { type: "response"; id: number; ok: true; state: ExplorerState }
  | { type: "response"; id: number; ok: false; error: string };

/** Client → serveur, à la connexion. */
export interface BridgeHelloFrame {
  type: "hello";
  hello: BridgeHello;
}

/** Tout ce qui transite sur le socket. */
export type BridgeFrame = BridgeRequest | BridgeResponse | BridgeHelloFrame;

/** Parse une trame reçue, ou `null` si elle est illisible ou d'une forme inconnue. */
export function parseFrame(raw: string): BridgeFrame | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const type = (value as { type?: unknown }).type;
  if (type !== "request" && type !== "response" && type !== "hello") return null;
  return value as BridgeFrame;
}
