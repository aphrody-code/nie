// Vérification VISUELLE de `nie-explorer`, automatisée et rejouable.
//
// ## Le problème que ce script résout
//
// La fenêtre de l'application est une **WebView2**. `PrintWindow`/`BitBlt` (les captures par HWND
// du plugin winclean) rendent un rectangle NOIR sur sa surface : le rendu passe par la
// composition DWM du process WebView, pas par le HDC de la fenêtre. Et la capture plein écran ne
// sert à rien sur une machine multi-écrans où l'application n'est pas au premier plan.
//
// Conséquence vécue : impossible de vérifier qu'un écran s'affiche réellement, alors que
// `CLAUDE.md` est formel — « seul le LANCEMENT trouve ces bugs-là » (une ressource jamais lue,
// une table vide, une icône absente ne font échouer ni `tsc`, ni clippy, ni le build).
//
// ## La solution
//
// WebView2 accepte les arguments de Chromium via `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`. Lancée
// avec `--remote-debugging-port=9222`, elle expose le **Chrome DevTools Protocol** : on capture
// alors la page elle-même (`Page.captureScreenshot`), on lit son texte, et on la pilote
// (`Runtime.evaluate`) — indépendamment du gestionnaire de fenêtres, de l'écran, du focus et de
// la superposition. C'est aussi ce qui permet de VÉRIFIER le contenu, pas seulement l'image.
//
// ## Usage
//
//   bun scripts/capture-explorer.ts                      # capture l'écran courant
//   bun scripts/capture-explorer.ts --vue data            # bascule sur une vue puis capture
//   bun scripts/capture-explorer.ts --clic "Personnages"  # clique un libellé puis capture
//   bun scripts/capture-explorer.ts --texte               # imprime le texte visible (assertions)
//
// L'application doit avoir été lancée avec le port de débogage :
//
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 nie-explorer.exe

const PORT = Number(process.env.NIE_CDP_PORT ?? 9222);

interface Cible {
  id: string;
  title: string;
  url: string;
  type: string;
  webSocketDebuggerUrl: string;
}

/** Cible DevTools de la fenêtre principale — jamais les cibles techniques (worker, siw). */
async function trouverCible(): Promise<Cible> {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  if (!r.ok) throw new Error(`CDP injoignable sur ${PORT} : HTTP ${r.status}`);
  const cibles = (await r.json()) as Cible[];
  const pages = cibles.filter((c) => c.type === "page" && !c.url.startsWith("devtools://"));
  // Une WebView de BUILD sert `tauri.localhost` (front embarqué), une WebView de DÉVELOPPEMENT
  // sert `localhost:1420` (Vite). Quand les deux cibles traînent sur le même port de débogage,
  // prendre la première revient à vérifier la mauvaise application — vécu : le script décrivait
  // l'ancienne instance de dev pendant que le build tournait à côté.
  const page = pages.find((c) => c.url.includes("tauri.localhost")) ?? pages[0];
  if (!page) {
    throw new Error(
      `aucune page dans ${cibles.length} cible(s). L'application a-t-elle été lancée avec ` +
        `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=${PORT} ?`,
    );
  }
  return page;
}

/** Client CDP minimal : un WebSocket, un compteur d'identifiants, une promesse par requête. */
class Cdp {
  private ws: WebSocket;
  private id = 0;
  private attente = new Map<number, { ok: (v: unknown) => void; ko: (e: Error) => void }>();

  /** Événements CDP retenus (erreurs et logs de la page) — vidés par `journal()`. */
  readonly journalEvenements: string[] = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
        result?: unknown;
        error?: { message: string };
      };
      if (msg.id === undefined) {
        // Une page blanche ne dit rien d'elle-même : c'est la console qui porte la cause
        // (import manquant, exception au montage, commande Tauri absente).
        if (msg.method === "Runtime.exceptionThrown") {
          const d = (msg.params?.exceptionDetails ?? {}) as {
            text?: string;
            exception?: { description?: string };
            url?: string;
            lineNumber?: number;
          };
          this.journalEvenements.push(
            `EXCEPTION ${d.exception?.description ?? d.text ?? "?"} (${d.url ?? "?"}:${d.lineNumber ?? "?"})`,
          );
        } else if (msg.method === "Runtime.consoleAPICalled") {
          const p = msg.params as {
            type: string;
            args: {
              value?: unknown;
              description?: string;
              preview?: { description?: string; properties?: { name: string; value?: string }[] };
            }[];
          };
          if (p.type === "error" || p.type === "warning") {
            // React formate ses avertissements en `%s`/`%o` + arguments : sans lire aussi la
            // `preview` des objets, le journal ne rendait que « ERROR %o », donc rien.
            const texte = p.args
              .map((a) => {
                if (a.value !== undefined) return String(a.value);
                if (a.description) return a.description;
                const props = a.preview?.properties?.map((x) => `${x.name}=${x.value}`).join(", ");
                return a.preview?.description ?? (props ? `{${props}}` : "");
              })
              .join(" ");
            this.journalEvenements.push(`${p.type.toUpperCase()} ${texte}`.slice(0, 600));
          }
        }
        return; // événement, pas une réponse
      }
      const p = this.attente.get(msg.id);
      if (!p) return;
      this.attente.delete(msg.id);
      if (msg.error) p.ko(new Error(msg.error.message));
      else p.ok(msg.result);
    });
  }

  static async ouvrir(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise<void>((ok, ko) => {
      ws.addEventListener("open", () => ok(), { once: true });
      ws.addEventListener("error", () => ko(new Error("WebSocket CDP refusé")), { once: true });
    });
    return new Cdp(ws);
  }

  envoyer<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.id;
    return new Promise<T>((ok, ko) => {
      this.attente.set(id, { ok: ok as (v: unknown) => void, ko });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.attente.delete(id)) ko(new Error(`${method} : pas de réponse en 20 s`));
      }, 20_000);
    });
  }

  /** Évalue du JS DANS la page et rend la valeur (sérialisable). */
  async evaluer<T>(expression: string): Promise<T> {
    const r = await this.envoyer<{ result: { value: T }; exceptionDetails?: { text: string } }>(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
    );
    if (r.exceptionDetails) throw new Error(`JS : ${r.exceptionDetails.text}`);
    return r.result.value;
  }

  fermer() {
    this.ws.close();
  }
}

const args = process.argv.slice(2);
const opt = (nom: string): string | undefined => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const cible = await trouverCible();
const cdp = await Cdp.ouvrir(cible.webSocketDebuggerUrl);
// Sans `Runtime.enable`, aucune exception ni aucun log n'est émis : une page blanche resterait
// muette. C'est la première chose à activer, avant toute action.
await cdp.envoyer("Runtime.enable");
await cdp.envoyer("Page.enable");
console.log(`cible : ${cible.title || "(sans titre)"} — ${cible.url}`);

// `--recharger` : recharge la page avant d'agir. Indispensable quand la WebView a démarré avant
// le serveur de développement (elle reste alors bloquée sur « connexion refusée » sans jamais
// réessayer d'elle-même) ou après un changement de front.
if (args.includes("--recharger")) {
  await cdp.envoyer("Page.navigate", { url: cible.url });
  await Bun.sleep(3000);
}

// `--vue <id>` : l'application persiste sa vue courante dans localStorage puis la relit au
// montage. On passe par l'événement de navigation interne quand il existe, sinon par un clic.
const vue = opt("vue");
if (vue) {
  await cdp.evaluer(`window.dispatchEvent(new CustomEvent("nie:vue", { detail: ${JSON.stringify(vue)} }))`);
  await Bun.sleep(500);
}

// `--clic <libellé>` : clique le premier élément cliquable dont le texte contient le libellé.
const clic = opt("clic");
if (clic) {
  const trouve = await cdp.evaluer<boolean>(`(() => {
    const cible = ${JSON.stringify(clic)}.toLowerCase();
    const noeuds = [...document.querySelectorAll('button, [role="button"], a, [role="tab"]')];
    const el = noeuds.find((n) => (n.textContent ?? "").trim().toLowerCase().includes(cible));
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    el.click();
    return true;
  })()`);
  if (!trouve) console.error(`clic : aucun élément ne porte « ${clic} »`);
  await Bun.sleep(1500);
}

// `--selecteur <css>` : clique le premier élément correspondant. Pour ce qu'un libellé ne
// désigne pas — un bouton d'icône, une ligne de tableau, un onglet sans texte.
const selecteur = opt("selecteur");
if (selecteur) {
  const trouve = await cdp.evaluer<boolean>(`(() => {
    const el = document.querySelector(${JSON.stringify(selecteur)});
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    el.click();
    return true;
  })()`);
  if (!trouve) console.error(`selecteur : rien ne correspond à « ${selecteur} »`);
  await Bun.sleep(1500);
}

// `--js <expression>` : évalue et imprime. Pour inspecter le DOM réel plutôt que le supposer —
// c'est ce qui remplace « le bouton doit bien s'appeler comme ça » par une vérification.
const js = opt("js");
if (js) {
  console.log("─── js ───");
  console.log(JSON.stringify(await cdp.evaluer(js), null, 2));
}

// Laisse le temps aux chargements déclenchés (décodage du VFS) de peupler l'écran.
const attente = Number(opt("attente") ?? 2500);
await Bun.sleep(attente);

if (args.includes("--texte")) {
  const texte = await cdp.evaluer<string>(`document.body.innerText`);
  console.log("─── texte visible ───");
  console.log(texte.split("\n").filter((l) => l.trim()).slice(0, 120).join("\n"));
}

if (cdp.journalEvenements.length) {
  console.log("─── erreurs de la page ───");
  for (const l of cdp.journalEvenements.slice(0, 30)) console.log(l);
}

const sortie = opt("out") ?? `capture/explorer-${Date.now()}.png`;
const { data } = await cdp.envoyer<{ data: string }>("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: false,
});
await Bun.write(sortie, Buffer.from(data, "base64"));
console.log(`capture : ${sortie}`);

cdp.fermer();
