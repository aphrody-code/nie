// Aller-retour réel serveur ↔ client sur la boucle locale : c'est le seul test qui prouve que
// les deux moitiés du protocole se comprennent (le typage garantit la forme, pas le transport).
import { afterEach, expect, test } from "bun:test";
import { connectBridge, type BridgeClient, type ExplorerState } from "./index.ts";
import { BridgeServer, BridgeUnavailable } from "./server.ts";

/** Port dédié aux tests : ne doit pas percuter un serveur MCP en cours d'exécution. */
const TEST_PORT = 8899;

let server: BridgeServer | null = null;
let client: BridgeClient | null = null;

afterEach(() => {
  client?.close();
  client = null;
  server?.stop();
  server = null;
});

/** Attend que `predicate` soit vrai, ou échoue au bout de `timeoutMs`. */
async function until(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition jamais atteinte");
    await Bun.sleep(10);
  }
}

test("le serveur pilote le client et récupère son état", async () => {
  const state: ExplorerState = { tab: "explorer", prefix: "data", selected: null, externalPath: null };

  server = new BridgeServer({ port: TEST_PORT });
  expect(server.start()).toBe(true);

  const toasts: string[] = [];
  client = connectBridge(
    {
      getState: () => ({ ...state }),
      navigate: (prefix, select) => {
        state.prefix = prefix;
        state.selected = select ?? null;
        state.tab = "explorer";
      },
      open: (path) => {
        state.selected = path;
      },
      setTab: (tab) => {
        state.tab = tab;
      },
      toast: (message) => {
        toasts.push(message);
      },
    },
    { app: "test-client", version: "0.0.0", port: TEST_PORT, retryMs: 50 },
  );

  await until(() => server?.connected === true);
  expect(server.peer?.hello.app).toBe("test-client");

  const afterNav = await server.send({ cmd: "navigate", prefix: "data/common/chr", select: "data/x.g4md" });
  expect(afterNav.prefix).toBe("data/common/chr");
  expect(afterNav.selected).toBe("data/x.g4md");

  const afterTab = await server.send({ cmd: "tab", tab: "re" });
  expect(afterTab.tab).toBe("re");

  await server.send({ cmd: "toast", message: "coucou", kind: "success" });
  expect(toasts).toEqual(["coucou"]);

  // `state` ne modifie rien et renvoie l'état courant.
  const observed = await server.send({ cmd: "state" });
  expect(observed.tab).toBe("re");
});

test("sans client connecté, l'envoi échoue explicitement", async () => {
  server = new BridgeServer({ port: TEST_PORT });
  expect(server.start()).toBe(true);
  expect(server.connected).toBe(false);
  await expect(server.send({ cmd: "ping" })).rejects.toBeInstanceOf(BridgeUnavailable);
});

test("une erreur du client remonte au serveur", async () => {
  server = new BridgeServer({ port: TEST_PORT });
  server.start();
  client = connectBridge(
    {
      getState: () => ({ tab: "explorer", prefix: "data", selected: null, externalPath: null }),
      navigate: () => {
        throw new Error("dossier inconnu");
      },
      open: () => {},
      setTab: () => {},
      toast: () => {},
    },
    { app: "test-client", version: "0.0.0", port: TEST_PORT, retryMs: 50 },
  );

  await until(() => server?.connected === true);
  await expect(server.send({ cmd: "navigate", prefix: "nawak" })).rejects.toThrow("dossier inconnu");
});
