/**
 * Côté client du pont — celui que `nie-explorer` embarque.
 *
 * Isomorphe : n'utilise que le `WebSocket` standard, donc fonctionne dans la WebView Tauri
 * comme sous Bun. Le serveur (`./server.ts`), lui, dépend de `Bun.serve`.
 *
 * La connexion est opportuniste : si aucun serveur MCP n'écoute, le client réessaie en
 * arrière-plan sans jamais rejeter — l'explorateur doit rester parfaitement utilisable seul.
 */

import {
  bridgeUrl,
  parseFrame,
  BRIDGE_PROTOCOL_VERSION,
  type BridgeCommand,
  type ExplorerState,
} from "./protocol.ts";

/** Ce que l'application hôte fournit au pont pour agir sur elle. */
export interface BridgeHandlers {
  /** État courant, à jour à chaque appel. */
  getState: () => ExplorerState;
  /** Ouvre l'explorateur sur un dossier VFS. */
  navigate: (prefix: string, select?: string | undefined) => void;
  /** Ouvre un fichier du VFS. */
  open: (path: string) => void;
  /** Bascule d'onglet. */
  setTab: (tab: string) => void;
  /** Affiche une notification. */
  toast: (message: string, kind: "info" | "success" | "error") => void;
}

/** Réglages de connexion. */
export interface BridgeClientOptions {
  /** Nom applicatif annoncé au serveur. */
  app: string;
  /** Version annoncée au serveur. */
  version: string;
  /** Port du pont. */
  port?: number | undefined;
  /** Délai entre deux tentatives de reconnexion, en millisecondes. */
  retryMs?: number | undefined;
  /** Notifié à chaque changement d'état de la connexion. */
  onStatus?: ((connected: boolean) => void) | undefined;
}

/** Poignée rendue par {@link connectBridge}. */
export interface BridgeClient {
  /** Vrai tant que le socket est ouvert. */
  readonly connected: boolean;
  /** Ferme la connexion et arrête les tentatives de reconnexion. */
  close: () => void;
}

/**
 * Connecte l'application hôte au pont et exécute les commandes reçues.
 *
 * Ne lève jamais : une absence de serveur est un état normal, pas une erreur.
 */
export function connectBridge(handlers: BridgeHandlers, options: BridgeClientOptions): BridgeClient {
  const url = bridgeUrl(options.port);
  const retryMs = options.retryMs ?? 3_000;

  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let connected = false;

  function setConnected(v: boolean): void {
    if (connected === v) return;
    connected = v;
    options.onStatus?.(v);
  }

  function scheduleRetry(): void {
    if (closed || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      connect();
    }, retryMs);
  }

  function connect(): void {
    if (closed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleRetry();
      return;
    }
    socket = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(
        JSON.stringify({
          type: "hello",
          hello: { app: options.app, version: options.version, protocol: BRIDGE_PROTOCOL_VERSION },
        }),
      );
    };

    ws.onmessage = (ev: MessageEvent) => {
      const frame = parseFrame(typeof ev.data === "string" ? ev.data : "");
      if (frame === null || frame.type !== "request") return;
      try {
        apply(frame.command, handlers);
        ws.send(JSON.stringify({ type: "response", id: frame.id, ok: true, state: handlers.getState() }));
      } catch (e) {
        ws.send(
          JSON.stringify({ type: "response", id: frame.id, ok: false, error: (e as Error).message ?? String(e) }),
        );
      }
    };

    ws.onclose = () => {
      setConnected(false);
      socket = null;
      scheduleRetry();
    };

    // `onerror` précède toujours `onclose` : la reconnexion est planifiée là.
    ws.onerror = () => {};
  }

  connect();

  return {
    get connected(): boolean {
      return connected;
    },
    close(): void {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      socket?.close();
      socket = null;
      setConnected(false);
    },
  };
}

/** Exécute une commande sur l'application hôte. */
function apply(command: BridgeCommand, h: BridgeHandlers): void {
  switch (command.cmd) {
    case "ping":
    case "state":
      return;
    case "navigate":
      h.navigate(command.prefix, command.select);
      return;
    case "open":
      h.open(command.path);
      return;
    case "tab":
      h.setTab(command.tab);
      return;
    case "toast":
      h.toast(command.message, command.kind ?? "info");
      return;
    default:
      return assertNever(command);
  }
}

/** Garde d'exhaustivité : une commande non traitée casse la compilation. */
function assertNever(v: never): never {
  throw new Error(`commande de pont non gérée : ${JSON.stringify(v)}`);
}
