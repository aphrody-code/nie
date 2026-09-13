/**
 * Compare le layout construit PAR LE MODULE WebAssembly à celui que la route rend.
 *
 * `compareLayoutWithServer` fait la même chose DANS la page ; celui-ci le fait sans navigateur,
 * en chargeant le module publié dans Bun, ce qui le rend exécutable depuis un terminal et donc
 * vérifiable avant un déploiement.
 *
 * ```sh
 * ./target/release/nie-site --listen 127.0.0.1:18099 &
 * bun --bun scripts/validation/compare-menu-layout.ts chara_bank_menu
 * bun --bun scripts/validation/compare-menu-layout.ts --sweep 30   # échantillon régulier
 * # ou, contre le site que `differential.ts` utilise :
 * NIE_SITE_BASE=http://127.0.0.1:8085 bun --bun scripts/validation/compare-menu-layout.ts main_menu
 * ```
 *
 * Mesuré le 2026-09-13, `--sweep 30` : **27 identiques au caractère près, 3 identiques hors
 * arrondi, 0 divergent**. Les trois écarts sont des `f32` voisins d'un ULP ; aucun objet ne
 * diverge au-delà. (Un premier relevé, sur un échantillon partiellement choisi à la main,
 * donnait 29/1/0 — le balayage régulier tire simplement plus d'écrans à rotation.)
 *
 * Le mode `--sweep` sort en échec dès qu'un écran DIVERGE au-delà de l'arrondi, ce qui en fait
 * une porte utilisable avant un déploiement, et pas seulement un outil de lecture. `shop_menu` : un écart sur 62, une rotation dont les deux `f32` sont voisins d'un
 * ULP (`-0.05235987529158592` contre `-0.05235988274216652`). La rotation vient de
 * `r10.atan2(r00)` et le chemin passe aussi par `sin`/`cos` : des fonctions de libm, différentes
 * sur `wasm32` (celle de Rust) et sur `x86-64` (celle du système). Le code est le même, la
 * bibliothèque mathématique ne l'est pas.
 *
 * La première exécution a trouvé autre chose : le module publié ne portait pas encore le champ
 * `instance`, ajouté le jour même à `menu_screen::build`. Un artefact préconstruit ne suit pas
 * une modification Rust — c'est ce que la table de `CLAUDE.md` recense, et cet outil le montre.
 */
import { readFileSync } from "node:fs";

// Le port est surchargeable : `differential.ts`, l'autre outil qui a besoin d'un site local,
// écoute sur 8085. Avoir deux valeurs codées en dur fait lancer le mauvais serveur et rend des
// résultats vides qui ressemblent à un échec de comparaison.
const BASE = process.env.NIE_SITE_BASE ?? "http://127.0.0.1:18099";
const ARGS = process.argv.slice(2);
/** `--sweep <n>` compare un ÉCHANTILLON RÉGULIER du catalogue au lieu d'un seul écran. */
const SWEEP = ARGS.includes("--sweep") ? Number(ARGS[ARGS.indexOf("--sweep") + 1] ?? 24) : 0;
const ECRAN = ARGS.find((a) => !a.startsWith("--") && Number.isNaN(Number(a))) ?? "chara_bank_menu";

const glue = await import("/home/ubuntu/niers/apps/nie-web/src/wasm/nie_wasm.js");
glue.initSync({ module: readFileSync("/home/ubuntu/niers/apps/nie-web/public/static/game/nie_wasm_bg.wasm") });

/** Compare un écran et rend son verdict, sans rien imprimer. */
async function verdictDe(ecran: string): Promise<string> {
  const proc = Bun.spawn(["bun", "--bun", import.meta.path, ecran], {
    env: { ...process.env, NIE_SITE_BASE: BASE },
    stdout: "pipe",
  });
  const sortie = await new Response(proc.stdout).text();
  await proc.exited;
  const ligne = sortie.split("\n").find((l) => /IDENTIQUES|DIFFÉRENTS|inconnu/.test(l));
  return ligne?.trim() ?? "sans verdict";
}

if (SWEEP > 0) {
  // Un échantillon RÉGULIER, pas les premiers : le catalogue est alphabétique et ses premiers
  // écrans sont tous de la même famille, ce qui mesurerait une famille plutôt que le jeu.
  const catalogue = await (await fetch(`${BASE}/api/v1/menu/screens`)).json();
  const noms: string[] = (catalogue.screens ?? [])
    .map((x: unknown) => (typeof x === "string" ? x : ((x as { screen?: string }).screen ?? "")))
    .filter(Boolean);
  const pas = Math.max(1, Math.ceil(noms.length / SWEEP));
  const echantillon = noms.filter((_, i) => i % pas === 0).slice(0, SWEEP);
  const comptes = { identiques: 0, arrondi: 0, divergents: 0, inconnus: 0 };
  for (const nom of echantillon) {
    const verdict = await verdictDe(nom);
    if (verdict.includes("hors arrondi")) comptes.arrondi += 1;
    else if (verdict.startsWith("IDENTIQUES")) comptes.identiques += 1;
    else if (verdict.includes("inconnu")) comptes.inconnus += 1;
    else {
      comptes.divergents += 1;
      console.log(`  ${nom} : ${verdict}`);
    }
  }
  console.log(
    `${echantillon.length} écrans | identiques ${comptes.identiques} | hors arrondi ${comptes.arrondi} | divergents ${comptes.divergents} | inconnus ${comptes.inconnus}`,
  );
  process.exit(comptes.divergents === 0 ? 0 : 1);
}

const reponse = await fetch(`${BASE}/api/v1/screens/${ECRAN}`);
if (!reponse.ok) {
	console.log(`écran ${ECRAN} inconnu du site (HTTP ${reponse.status})`);
	process.exit(0);
}
const detail = await reponse.json();
const builder = new glue.MenuScreenBuilder(JSON.stringify({
	screen: detail.screen,
	cfg: detail.cfg,
	canvas: detail.canvas,
	items: detail.items.map((i: any) => ({ layer: i.layer, objbin: i.objbin })),
	layersMissing: detail.layers_missing,
}));

const octets = async (chemin: string) => {
	const r = await fetch(`${BASE}/f/${chemin}`);
	return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
};
let charges = 0;
for (const chemin of builder.required_files()) {
	const b = await octets(chemin);
	if (b) { builder.provide_file(chemin, b); charges += 1; }
}
const resolution = new Map<string, string>();
for (const item of detail.items) {
	for (const [logique, chemin] of Object.entries(item.companions ?? {})) resolution.set(logique, chemin as string);
}
let compagnons = 0;
for (const logique of builder.required_companions()) {
	const chemin = resolution.get(logique);
	if (!chemin) continue;
	builder.provide_companion(logique, chemin);
	const b = await octets(chemin);
	if (b) { builder.provide_file(chemin, b); compagnons += 1; }
}

const pages: [number, string][] = [];
for (let page = 1; ; page += 1) {
	const body = await (await fetch(`${BASE}/api/v1/text/fr/menu_text?page=${page}&per_page=200`)).json();
	for (const l of body.results?.elements ?? []) pages.push([l.hash, l.text]);
	if (page >= (body.results?.pages ?? 1)) break;
}

const navigateur = JSON.parse(builder.build("fr", JSON.stringify(pages), "{}"));
const serveur = await (await fetch(`${BASE}/api/v1/menu/layout/${ECRAN}?locale=fr`)).json();
builder.free();

// `visible` vient du REJEU, pas du constructeur : le serveur exécute le Lua, la page passe ici
// une table vide. Le comparer mesurerait la différence des ENTRÉES, pas celle du code.
const sansVisible = (o: any[]) => JSON.stringify(o.map(({ visible, ...reste }) => reste));
const a = sansVisible(navigateur.objects);
const b = sansVisible(serveur.objects);
console.log(`écran ${ECRAN} : ${charges} objbin, ${compagnons} compagnons, ${pages.length} lignes de texte`);
console.log(`objets navigateur ${navigateur.objects.length} | serveur ${serveur.objects.length}`);
// Un écart peut n'être que le plancher libm : on le CLASSE au lieu de le confondre avec une
// divergence de logique. Le seuil est RELATIF et vaut 1e-6, soit environ huit ULP d'un `f32`
// (dont l'epsilon est 1,19e-7) : assez large pour absorber `atan2`/`sin`/`cos` d'une libm à
// l'autre — l'écart mesuré sur `shop_menu` vaut 1,4e-7 relatif, et un seuil de 1e-7 le classait
// à tort — assez étroit pour qu'une vraie divergence, qui déplace un objet de pixels entiers,
// reste signalée.
const voisins = (x: unknown, y: unknown) =>
	typeof x === "number" && typeof y === "number" &&
	(x === y || Math.abs(x - y) <= Math.max(Math.abs(x), Math.abs(y)) * 1e-6);
const structurel = (x: any, y: any): boolean => {
	if (voisins(x, y)) return false;
	if (x === null || y === null || typeof x !== "object" || typeof y !== "object") {
		return JSON.stringify(x) !== JSON.stringify(y);
	}
	const cles = [...new Set([...Object.keys(x), ...Object.keys(y)])];
	return cles.some(c => structurel(x[c], y[c]));
};
const sansVisibleObjets = (o: any[]) => o.map(({ visible, ...reste }) => reste);
const ecartsStructurels = sansVisibleObjets(navigateur.objects)
	.map((o, i) => structurel(o, sansVisibleObjets(serveur.objects)[i]))
	.filter(Boolean).length;
console.log(
	a === b
		? "IDENTIQUES"
		: ecartsStructurels === 0
			? "IDENTIQUES hors arrondi (plancher libm)"
			: `DIFFÉRENTS : ${ecartsStructurels} objet(s) divergent au-delà de l'arrondi`,
);
if (a !== b && ecartsStructurels > 0) {
	for (let i = 0; i < Math.max(navigateur.objects.length, serveur.objects.length); i += 1) {
		const x = JSON.stringify(navigateur.objects[i]), y = JSON.stringify(serveur.objects[i]);
		if (x !== y) {
			const na = JSON.parse(x ?? "{}"), sa = JSON.parse(y ?? "{}");
			const cles = [...new Set([...Object.keys(na), ...Object.keys(sa)])];
			for (const c of cles) {
				const v1 = JSON.stringify(na[c]), v2 = JSON.stringify(sa[c]);
				if (v1 !== v2) console.log(`  index ${i}, champ ${c}: nav=${v1?.slice(0,120)} srv=${v2?.slice(0,120)}`);
			}
			break;
		}
	}
}
