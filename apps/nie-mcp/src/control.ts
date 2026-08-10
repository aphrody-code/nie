/**
 * Pilotage des applications : `nie-explorer` via le pont `@niers/bridge`, et le jeu
 * `nie.exe` via un lancement de processus.
 *
 * Le pont est optionnel de bout en bout : sans explorateur connecté, les outils
 * `explorer_*` renvoient une erreur explicite et le reste du serveur MCP est intact.
 */

import { join } from "node:path";
import type { BridgeCommand, ExplorerState } from "@niers/bridge";
import { BridgeServer, BridgeUnavailable } from "@niers/bridge/server";
import { config } from "./config.ts";
import { ToolError } from "./security.ts";

/** Résultat renvoyé par les outils `explorer_*`. */
export interface ControlResult {
  ok: true;
  /** Application pilotée, telle qu'elle s'est annoncée. */
  app: string;
  /** État de l'explorateur après la commande. */
  state: ExplorerState;
}

/** État du pont, pour `explorer_status`. */
export interface BridgeStatus {
  listening: boolean;
  url: string;
  connected: boolean;
  app: string | null;
  version: string | null;
  /** Depuis quand le client est connecté, en secondes. */
  connected_for_s: number | null;
}

/** Serveur de pont du process courant. */
export class Control {
  readonly #bridge: BridgeServer;
  #listening = false;

  constructor(log: (message: string) => void) {
    this.#bridge = new BridgeServer({ port: config.bridgePort, log });
  }

  /** Ouvre le port de contrôle. Sans effet si déjà ouvert ou si le port est pris. */
  start(): void {
    this.#listening = this.#bridge.start();
  }

  /** Ferme le port de contrôle. */
  stop(): void {
    this.#bridge.stop();
    this.#listening = false;
  }

  /** Vue de l'état du pont — ne touche pas au client. */
  status(): BridgeStatus {
    const peer = this.#bridge.peer;
    return {
      listening: this.#listening,
      url: `ws://127.0.0.1:${this.#bridge.port}/bridge`,
      connected: this.#bridge.connected,
      app: peer?.hello.app ?? null,
      version: peer?.hello.version ?? null,
      connected_for_s: peer === null ? null : Math.round((Date.now() - peer.since) / 1000),
    };
  }

  /** Envoie une commande à l'explorateur et renvoie son état. */
  async send(command: BridgeCommand): Promise<ControlResult> {
    if (!this.#listening) {
      throw new ToolError(
        `pont non démarré (port ${config.bridgePort} indisponible) — une autre instance du serveur MCP l'occupe sans doute`,
      );
    }
    try {
      const state = await this.#bridge.send(command);
      return { ok: true, app: this.#bridge.peer?.hello.app ?? "inconnu", state };
    } catch (e) {
      if (e instanceof BridgeUnavailable) {
        throw new ToolError(
          "nie-explorer n'est pas connecté au pont : lancer l'explorateur, ou vérifier que le pont est activé dans ses Paramètres",
        );
      }
      throw new ToolError((e as Error).message);
    }
  }
}

/** Ce que `game_launch` renvoie. */
export interface LaunchResult {
  ok: true;
  exe: string;
  pid: number;
  args: string[];
}

/**
 * Lance le jeu (`nie.exe`, à la racine du repo — cf. CLAUDE.md) sans l'attendre.
 *
 * Le process est détaché : il survit à l'arrêt du serveur MCP, comme un lancement depuis
 * l'explorateur de fichiers.
 */
export async function launchGame(args: readonly string[] = []): Promise<LaunchResult> {
  const exe = join(config.repoRoot, config.gameExe);
  if (!(await Bun.file(exe).exists())) {
    throw new ToolError(`exécutable introuvable : ${exe}`);
  }
  for (const a of args) {
    if (a.includes("\0")) throw new ToolError("argument invalide");
  }
  const proc = Bun.spawn([exe, ...args], {
    cwd: config.repoRoot,
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });
  proc.unref();
  return { ok: true, exe, pid: proc.pid, args: [...args] };
}
