/**
 * Les fichiers du jeu appartenant a un personnage, via la CLI `niers vfs find`.
 *
 * Pourquoi la CLI et pas une lecture directe : le VFS n'est pas sur le disque. Les assets
 * vivent dans les CPK, et ni `rg` ni `fd` n'en voient l'interieur — c'est note dans CLAUDE.md
 * et c'est la raison pour laquelle `inagle_game_assets` ne peut pas servir d'index (40 469 de
 * ses 40 471 lignes sont des PNG de menu).
 */

export type Asset = { chemin: string; octets: number; cpk: string | null; role: string };

/** Devine le role d'un fichier a partir de son chemin et de son extension. */
function role(chemin: string): string {
    const ext = chemin.split(".").pop()?.toLowerCase() ?? "";
    if (/_face/.test(chemin) && ext === "g4mg") return "modèle du visage";
    if (/_face/.test(chemin) && ext === "g4md") return "métadonnées du visage";
    if (ext === "g4tx" && /icon/.test(chemin)) return "icône";
    if (ext === "g4tx") return "textures";
    if (ext === "acb") return "banque de voix";
    if (ext === "awb") return "flux audio des voix";
    if (ext === "g4mg") return "modèle";
    if (ext === "g4sk") return "squelette";
    if (ext === "g4mt") return "animation";
    return ext || "inconnu";
}

export async function assets(code: string, timeoutMs = 180_000): Promise<Asset[]> {
    const p = Bun.spawn(["niers", "vfs", "find", code], { stdout: "pipe", stderr: "ignore" });
    const minuteur = setTimeout(() => p.kill(), timeoutMs);
    const txt = await new Response(p.stdout).text();
    await p.exited;
    clearTimeout(minuteur);

    return txt
        .split("\n")
        .flatMap((l) => {
            // « <octets>  <chemin>  [<cpk>] » — le cpk est absent sur un montage dump.
            // Le chemin doit porter un « / » : sans cette exigence, la ligne de total
            // (« 6 résultat(s) ») se fait parser comme un asset de 6 octets.
            const m = l.match(/^\s*(\d+)\s+(\S*\/\S*)\s*(?:\[([^\]]+)\])?\s*$/);
            if (!m) return [];
            return [{ chemin: m[2]!, octets: Number(m[1]), cpk: m[3] ?? null, role: role(m[2]!) }];
        })
        .sort((a, b) => b.octets - a.octets);
}
