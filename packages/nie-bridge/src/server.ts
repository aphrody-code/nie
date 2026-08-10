/**
 * Côté serveur du pont — celui que `nie-mcp` héberge. Dépend de `Bun.serve`.
 *
 * Le serveur MCP parle en stdio à son client ; ce socket-là est un canal séparé, en écoute
 * sur la boucle locale uniquement, par lequel il pilote l'explorateur. Un seul client à la
 * fois : la dernière connexion remplace la précédente.
 */

import {
  DEFAULT_BRIDGE_PORT,
  BRIDGE_PATH,
  parseFrame,
  type BridgeCommand,
  type BridgeHello,
  type ExplorerState,
} from "./protocol.ts";

/** Données attachées à chaque socket accepté. */
interface BridgeSocketData {
  peer: BridgePeer | null;
}

/** Client connecté et son identité. */
export interface BridgePeer {
  hello: BridgeHello;
  /** Horodatage de la connexion (ms depuis l'époque). */
  since: number;
}

/** Réglages du serveur. */
export interface BridgeServerOptions {
  /** Port d'écoute. */
  port?: number | undefined;
  /** Délai au-delà duquel une commande sans réponse est abandonnée, en millisecondes. */
  timeoutMs?: number | undefined;
  /** Journalisation (stderr côté MCP : stdout est réservé au JSON-RPC). */
  log?: ((message: string) => void) | undefined;
}

interface Pending {
  resolve: (state: ExplorerState) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Aucune application connectée au pont. */
export class BridgeUnavailable extends Error {
  constructor(message = "aucun client connecté au pont (nie-explorer n'est pas lancé)") {
    super(message);
    this.name = "BridgeUnavailable";
  }
}

/**
 * Serveur de contrôle : accepte un client et lui envoie des commandes.
 *
 * `send` rejette avec {@link BridgeUnavailable} quand personne n'écoute — c'est un état
 * normal (l'explorateur n'est pas lancé), pas une panne du serveur MCP.
 */
export class BridgeServer {
  readonly port: number;
  readonly #timeoutMs: number;
  readonly #log: (message: string) => void;
  readonly #pending = new Map<number, Pending>();

  #server: Bun.Server<BridgeSocketData> | null = null;
  #socket: Bun.ServerWebSocket<BridgeSocketData> | null = null;
  #peer: BridgePeer | null = null;
  #nextId = 1;

  constructor(options: BridgeServerOptions = {}) {
    this.port = options.port ?? DEFAULT_BRIDGE_PORT;
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    this.#log = options.log ?? (() => {});
  }

  /** Client actuellement connecté, ou `null`. */
  get peer(): BridgePeer | null {
    return this.#peer;
  }

  /** Vrai si une application est connectée. */
  get connected(): boolean {
    return this.#socket !== null;
  }

  /**
   * Démarre l'écoute sur `127.0.0.1`.
   *
   * Renvoie `false` si le port est déjà pris — typiquement une seconde instance du serveur
   * MCP : le pont est optionnel, le reste des outils doit continuer de fonctionner.
   */
  start(): boolean {
    if (this.#server !== null) return true;
    try {
      this.#server = Bun.serve<BridgeSocketData>({
        hostname: "127.0.0.1",
        port: this.port,
        fetch: (req, server) => {
          const url = new URL(req.url);
          if (url.pathname !== BRIDGE_PATH) return new Response("not found", { status: 404 });
          if (server.upgrade(req, { data: { peer: null } })) return undefined;
          return new Response("websocket attendu", { status: 426 });
        },
        websocket: {
          open: (ws) => {
            this.#socket?.close();
            this.#socket = ws;
          },
          message: (ws, raw) => {
            const frame = parseFrame(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
            if (frame === null) return;
            if (frame.type === "hello") {
              this.#peer = { hello: frame.hello, since: Date.now() };
              ws.data.peer = this.#peer;
              this.#log(`[bridge] ${frame.hello.app} ${frame.hello.version} connecté`);
              return;
            }
            if (frame.type !== "response") return;
            const pending = this.#pending.get(frame.id);
            if (pending === undefined) return;
            this.#pending.delete(frame.id);
            clearTimeout(pending.timer);
            if (frame.ok) pending.resolve(frame.state);
            else pending.reject(new Error(frame.error));
          },
          close: (ws) => {
            if (this.#socket === ws) {
              this.#socket = null;
              this.#peer = null;
              this.#log("[bridge] client déconnecté");
            }
          },
        },
      });
      this.#log(`[bridge] écoute sur ws://127.0.0.1:${this.port}${BRIDGE_PATH}`);
      return true;
    } catch (e) {
      this.#log(`[bridge] écoute impossible sur le port ${this.port} : ${(e as Error).message}`);
      this.#server = null;
      return false;
    }
  }

  /** Arrête l'écoute et rejette les commandes en attente. */
  stop(): void {
    for (const [, p] of this.#pending) {
      clearTimeout(p.timer);
      p.reject(new BridgeUnavailable("pont arrêté"));
    }
    this.#pending.clear();
    this.#socket?.close();
    this.#socket = null;
    this.#peer = null;
    this.#server?.stop(true);
    this.#server = null;
  }

  /**
   * Envoie une commande et attend l'état renvoyé par le client.
   *
   * @throws {BridgeUnavailable} si aucun client n'est connecté.
   */
  send(command: BridgeCommand): Promise<ExplorerState> {
    const ws = this.#socket;
    if (ws === null) return Promise.reject(new BridgeUnavailable());

    const id = this.#nextId++;
    return new Promise<ExplorerState>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`le client n'a pas répondu à « ${command.cmd} » en ${this.#timeoutMs} ms`));
      }, this.#timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ type: "request", id, command }));
    });
  }
}
