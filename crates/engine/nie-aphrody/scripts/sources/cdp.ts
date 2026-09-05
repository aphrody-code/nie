/**
 * Un vrai navigateur, pilote en CDP, sans aucune dependance ajoutee.
 *
 * Pourquoi ne pas passer par bxc : `bxc chrome launch` et `bxc chrome fetch` echouent tous
 * deux sur « no bin target named bxc-engine » (leur binaire Rust interne ne se construit pas
 * ici), et les profils `stealth` / `max` rendent en consequence un corps VIDE avec un code
 * de sortie 0. Chrome, lui, est bien installe (`/usr/local/bin/google-chrome`, Chrome for
 * Testing 147) : on le lance nous-memes et on parle CDP en WebSocket, que Bun fournit.
 *
 * Ce que ca debloque et que `fetch` ne peut pas faire : les pages dont le contenu est monte
 * en JavaScript, et surtout la LISTE DES REQUETES RESEAU — c'est ainsi qu'on trouve les
 * assets d'un visualiseur 3D, qui n'apparaissent dans aucun HTML.
 */

import { spawn } from "node:child_process";

const CHROME = ["/usr/local/bin/google-chrome", "/usr/local/bin/chromium", "/usr/bin/chromium"];

export type Capture = {
    url: string;
    html: string;
    titre: string | null;
    /** Toutes les requetes emises par la page, dans l'ordre. */
    reseau: { url: string; type: string; mime: string | null; taille: number | null }[];
};

async function attendre(port: number, delaiMs = 15000): Promise<string> {
    const fin = Date.now() + delaiMs;
    while (Date.now() < fin) {
        try {
            const r = await fetch(`http://127.0.0.1:${port}/json/version`);
            const j = (await r.json()) as { webSocketDebuggerUrl?: string; Browser?: string };
            // Le stub statique de bxc repond aussi sur /json/version : le distinguer, sinon
            // on croit parler a Chrome et toutes les pages ressortent vides.
            if (j.webSocketDebuggerUrl && !/^Bxc\//.test(j.Browser ?? "")) return j.webSocketDebuggerUrl;
        } catch {
            /* pas encore ouvert */
        }
        await Bun.sleep(200);
    }
    throw new Error(`aucun Chrome sur le port ${port} apres ${delaiMs} ms`);
}

/** Lance un Chrome headless jetable et rend de quoi le piloter puis le fermer. */
export async function navigateur(port = 9333) {
    const bin = CHROME.find((p) => Bun.file(p).size !== undefined) ?? CHROME[0]!;
    const profil = `/tmp/aphrody-chrome-${port}`;
    const proc = spawn(
        bin,
        [
            "--headless=new",
            `--remote-debugging-port=${port}`,
            `--user-data-dir=${profil}`,
            "--no-sandbox",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--hide-scrollbars",
            "--lang=ja-JP",
        ],
        { stdio: "ignore", detached: false },
    );
    const ws = await attendre(port);
    return {
        ws,
        fermer: () => {
            try {
                proc.kill("SIGTERM");
            } catch {
                /* deja mort */
            }
        },
    };
}

/**
 * Ouvre une URL dans un onglet neuf, laisse le JavaScript s'executer, et rend le DOM
 * *apres* montage plus la liste des requetes reseau.
 */
export async function capturer(wsNavigateur: string, url: string, attenteMs = 3500): Promise<Capture> {
    const cible = await fetch(`http://127.0.0.1:${new URL(wsNavigateur).port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
    const onglet = (await cible.json()) as { id: string; webSocketDebuggerUrl: string };
    const sock = new WebSocket(onglet.webSocketDebuggerUrl);
    const reseau: Capture["reseau"] = [];
    let id = 0;
    const attente = new Map<number, (v: unknown) => void>();

    const envoyer = (method: string, params: Record<string, unknown> = {}) =>
        new Promise<any>((res) => {
            const n = ++id;
            attente.set(n, res);
            sock.send(JSON.stringify({ id: n, method, params }));
        });

    await new Promise<void>((res, rej) => {
        sock.addEventListener("open", () => res());
        sock.addEventListener("error", () => rej(new Error(`CDP injoignable pour ${url}`)));
    });

    sock.addEventListener("message", (ev) => {
        const m = JSON.parse(String(ev.data)) as { id?: number; method?: string; params?: any; result?: unknown };
        if (m.id && attente.has(m.id)) {
            attente.get(m.id)!(m.result);
            attente.delete(m.id);
        } else if (m.method === "Network.responseReceived") {
            const r = m.params?.response ?? {};
            reseau.push({ url: r.url ?? "", type: m.params?.type ?? "", mime: r.mimeType ?? null, taille: r.encodedDataLength ?? null });
        }
    });

    await envoyer("Network.enable");
    await envoyer("Page.enable");
    await envoyer("Page.navigate", { url });
    await Bun.sleep(attenteMs);
    const doc = await envoyer("Runtime.evaluate", { expression: "document.documentElement.outerHTML", returnByValue: true });
    const titre = await envoyer("Runtime.evaluate", { expression: "document.title", returnByValue: true });
    sock.close();
    await fetch(`http://127.0.0.1:${new URL(wsNavigateur).port}/json/close/${onglet.id}`);

    return {
        url,
        html: String(doc?.result?.value ?? ""),
        titre: (titre?.result?.value as string) ?? null,
        reseau,
    };
}
