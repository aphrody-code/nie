/**
 * Le layout d'un écran de menu, construit DANS la page.
 *
 * ## Ce que ça change
 *
 * Jusqu'ici le navigateur demandait le layout à `nie-site`
 * (`GET /api/v1/menu/layout/{screen}`) : il recevait un JSON déjà calculé, et l'écran n'existait
 * que parce qu'un serveur voulait bien le décrire. Le constructeur vit maintenant dans
 * `nie_formats::menu_screen`, au-dessus d'une source d'octets abstraite, et ce module branche
 * cette source sur des octets que la page télécharge elle-même depuis `/f/{path}`.
 *
 * Le même code, les mêmes octets, le même JSON — vérifié par
 * [`compareLayoutWithServer`], qui demande les deux et compare.
 *
 * ## Le protocole, en deux tours, et pourquoi
 *
 * 1. Les `.objbin` de l'écran, dont `/api/v1/screens/{screen}` donne les chemins.
 * 2. Leurs compagnons — squelette `.g4pkm`, texture `.g4tx` — dont le MÊME document donne la
 *    résolution (`items[].companions`), parce qu'un nom logique ne se résout qu'avec l'index du
 *    montage.
 *
 * Deux tours, parce qu'un `.objbin` ne se lit pas sans être téléchargé et que ce qu'il désigne
 * ne se connaît pas avant de l'avoir lu. C'est le jeu qui impose cet ordre, pas ce module.
 *
 * ## Ce que ça ne prétend pas
 *
 * Un fichier que le serveur ne rend pas n'est pas inventé : son calque sort dans
 * `diagnostics.objectsUnreadable`, et l'objet garde `transform: null` avec
 * `placementSource: "unresolved"`. Un layout construit avec la moitié des octets dit qu'il lui
 * manque la moitié des octets.
 */
import { ensureWasm } from "./bridge";
import { MenuScreenBuilder } from "../wasm/nie_wasm.js";

/** L'espace de fichiers du VFS servi par `nie-site`. */
const VFS_SPACE = "/f/";

/** Un calque, tel que `/api/v1/screens/{screen}` le publie. */
interface ScreenItem {
	layer: string;
	objbin: string | null;
	companions?: Record<string, string>;
}

/** L'écran, tel que `/api/v1/screens/{screen}` le publie. */
interface ScreenDetail {
	screen: string;
	cfg: string;
	canvas: [number, number];
	layers_missing: string[];
	items: ScreenItem[];
}

/** Ce que la construction a eu besoin de télécharger, et ce qu'elle n'a pas obtenu. */
export interface LayoutFetchReport {
	/** Chemins demandés au VFS. */
	requested: number;
	/** Chemins effectivement rendus. */
	received: number;
	/** Les chemins que le serveur n'a pas rendus, dans l'ordre. */
	missing: string[];
}

/** Un layout construit dans la page, et ce qu'il a coûté. */
export interface BuiltLayout {
	layout: unknown;
	fetched: LayoutFetchReport;
}

/** Les octets d'un chemin du VFS, ou `null` quand le site ne le rend pas. */
async function vfsBytes(path: string): Promise<Uint8Array | null> {
	const response = await fetch(`${VFS_SPACE}${path}`).catch(() => null);
	if (!response?.ok) return null;
	return new Uint8Array(await response.arrayBuffer());
}

/** La description d'un écran, ou `null` quand le site ne le connaît pas. */
async function screenDetail(screen: string): Promise<ScreenDetail | null> {
	const response = await fetch(`/api/v1/screens/${encodeURIComponent(screen)}`, {
		headers: { accept: "application/json" },
	}).catch(() => null);
	if (!response?.ok) return null;
	return (await response.json()) as ScreenDetail;
}

/** Une page de la route texte. */
interface TextPage {
	results?: {
		elements?: { hash: number; text: string }[];
		pages?: number;
		per_page?: number;
	};
}

/**
 * Les libellés d'une famille de texte, sous la forme `[[hash, texte], …]` que le constructeur
 * attend.
 *
 * ## Pourquoi c'est paginé, et pourquoi ce n'était pas une option
 *
 * `menu_text` compte 2 755 lignes en français et la route PLAFONNE `per_page` à 200 — mesuré le
 * 2026-09-13 : demander 5 000 en rend 200, sans erreur et sans le dire. Une première version
 * demandait donc 5 000 et construisait ses layouts avec 7 % du texte du jeu ; les libellés
 * manquants ne s'expliquaient par rien, puisque rien ne signalait la troncature.
 *
 * Les pages suivantes partent ensemble : quatorze requêtes parallèles, servies en
 * `max-age=86400`, une fois par langue et par session.
 *
 * Une locale que le jeu ne livre pas rend une table vide, donc un layout sans libellé — ce qui
 * est exact, et se voit dans le résultat.
 */
async function menuText(locale: string): Promise<[number, string][]> {
	const url = (page: number) =>
		`/api/v1/text/${encodeURIComponent(locale)}/menu_text?page=${page}&per_page=200`;
	const lire = async (page: number): Promise<TextPage | null> => {
		const response = await fetch(url(page), { headers: { accept: "application/json" } }).catch(() => null);
		return response?.ok ? ((await response.json()) as TextPage) : null;
	};

	const premiere = await lire(1);
	if (premiere === null) return [];
	const lignes = [...(premiere.results?.elements ?? [])];
	const pages = premiere.results?.pages ?? 1;
	if (pages > 1) {
		const suivantes = await Promise.all(
			Array.from({ length: pages - 1 }, (_, index) => lire(index + 2)),
		);
		for (const page of suivantes) lignes.push(...(page?.results?.elements ?? []));
	}
	return lignes.map(line => [line.hash, line.text]);
}

/**
 * Construit le layout d'un écran dans la page.
 *
 * @param screen le stem du `_setting.cfg.bin`, tel que `/api/v1/screens` le nomme.
 * @param locale la langue des libellés.
 * @param visibility CRC32 du nom d'un objet → ce que l'exécution Lua en dit
 * ([`resolveMenuVisibility`](./lua-runtime.ts)). Une table vide laisse chaque `visible` à `null`.
 * @returns `null` quand le site ne connaît pas l'écran — il n'y a alors rien à construire.
 */
export async function buildMenuLayout(
	screen: string,
	locale: string,
	visibility: ReadonlyMap<number, boolean> = new Map(),
): Promise<BuiltLayout | null> {
	const [detail] = await Promise.all([screenDetail(screen), ensureWasm()]);
	if (detail === null) return null;
	// Un serveur qui ne publie pas `companions` ne peut pas résoudre un seul nom logique, donc
	// aucun objet n'aura de pose et `loadMenuLayout` retombera de toute façon sur la route. Le
	// vérifier ICI économise le tour de chauffe : sans ce test, la Banque téléchargeait ses 25
	// `.objbin` (27 728 octets, mesurés le 2026-09-12) avant de conclure qu'elle n'en ferait
	// rien. C'est un contrôle sur la DONNÉE, pas sur une version : le jour où le champ est
	// servi, il s'efface de lui-même.
	if (!detail.items.some((item) => item.companions && Object.keys(item.companions).length > 0)) {
		return null;
	}

	const builder = new MenuScreenBuilder(
		JSON.stringify({
			screen: detail.screen,
			cfg: detail.cfg,
			canvas: detail.canvas,
			items: detail.items.map(item => ({ layer: item.layer, objbin: item.objbin })),
			layersMissing: detail.layers_missing,
		}),
	);
	const missing: string[] = [];
	let requested = 0;
	let received = 0;

	const charger = async (paths: readonly string[]) => {
		requested += paths.length;
		await Promise.all(
			paths.map(async path => {
				const bytes = await vfsBytes(path);
				if (bytes === null) {
					missing.push(path);
					return;
				}
				builder.provide_file(path, bytes);
				received += 1;
			}),
		);
	};

	try {
		// Premier tour : les `.objbin`. Sans eux le constructeur ne sait même pas ce qu'il lui
		// manque — c'est dans leurs octets que les compagnons sont nommés.
		await charger(builder.required_files());

		// Second tour : les compagnons que ces objets désignent. La résolution du nom logique
		// vient du serveur, qui seul porte l'index du montage ; les octets, eux, viennent du VFS
		// comme les autres.
		const resolution = new Map<string, string>();
		for (const item of detail.items) {
			for (const [logical, path] of Object.entries(item.companions ?? {})) {
				resolution.set(logical, path);
			}
		}
		const compagnons: string[] = [];
		for (const logical of builder.required_companions()) {
			const path = resolution.get(logical);
			// Un nom logique que le serveur n'a pas résolu reste non résolu : le constructeur
			// laissera l'objet sans pose plutôt que de deviner un chemin.
			if (path === undefined) continue;
			builder.provide_companion(logical, path);
			compagnons.push(path);
		}
		await charger(compagnons);

		const visibilityJson = JSON.stringify(Object.fromEntries([...visibility].map(([id, value]) => [String(id), value])));
		const layout = JSON.parse(
			builder.build(locale, JSON.stringify(await menuText(locale)), visibilityJson),
		) as unknown;
		return { layout, fetched: { requested, received, missing } };
	} finally {
		builder.free();
	}
}

/**
 * Construit le layout dans la page ET le demande au serveur, puis dit s'ils coïncident.
 *
 * C'est la seule façon honnête d'affirmer « le même code » : les deux surfaces compilent la même
 * fonction, mais elles ne lisent pas les octets par le même chemin, et c'est là que deux
 * implémentations se mettent à diverger.
 *
 * ## Ce qui est exclu, et pourquoi
 *
 * - **Les diagnostics** : `layersMissing` dépend du montage, pas du calcul.
 * - **`visible`** : il vient du REJEU, pas du constructeur. Le serveur exécute le Lua et résout
 *   76 objets sur 78 ; la page passe la table que `resolveMenuVisibility` lui a rendue, souvent
 *   vide. Le comparer mesurerait l'écart des ENTRÉES et rendrait « différent » à chaque appel.
 *
 * ## Ce que la comparaison a DÉJÀ trouvé
 *
 * Exécutée hors navigateur contre un `nie-site` local (2026-09-13, module chargé dans Bun) :
 * `chara_bank_menu` 78 objets, `gallery_menu` 7, `chara_edit_menu` 18 — **identiques**. Sur
 * `shop_menu`, un seul écart sur 62 objets, et il est instructif :
 *
 * ```text
 * rot  nav -0.05235987529158592   srv -0.05235988274216652
 * ```
 *
 * Deux `f32` voisins d'un ULP, et la cause est localisable : la rotation vient de
 * `r10.atan2(r00)` (`nie_formats::g4pkm`), et le chemin de transformation passe encore par `sin`
 * et `cos`. Ce sont des fonctions de libm, dont l'implémentation N'EST PAS la même sur `wasm32`
 * (celle que Rust embarque) et sur `x86-64` (celle du système) ; `sqrt`, lui, est exact par
 * IEEE-754 et ne peut pas y contribuer. Le code est le même — c'est la bibliothèque
 * mathématique de la cible qui diffère, et aucun réglage de ce dépôt ne l'aligne.
 *
 * Une comparaison exacte le rapporte donc comme une différence. C'en est une, d'un ULP sur une
 * rotation de −3°, et il faut le savoir avant de conclure à une divergence de logique.
 */
export async function compareLayoutWithServer(
	screen: string,
	locale: string,
): Promise<{ equal: boolean; browser: unknown; server: unknown } | null> {
	const [built, response] = await Promise.all([
		buildMenuLayout(screen, locale),
		fetch(`/api/v1/menu/layout/${encodeURIComponent(screen)}?locale=${encodeURIComponent(locale)}`, {
			headers: { accept: "application/json" },
		}).catch(() => null),
	]);
	if (built === null || !response?.ok) return null;
	const server = (await response.json()) as Record<string, unknown>;
	const browser = built.layout as Record<string, unknown>;
	const comparable = (objets: unknown) =>
		JSON.stringify(
			(Array.isArray(objets) ? objets : []).map((objet) => {
				const { visible, ...reste } = objet as Record<string, unknown>;
				return reste;
			}),
		);
	return {
		equal: comparable(browser.objects) === comparable(server.objects),
		browser: browser.objects,
		server: server.objects,
	};
}

/** Ce qu'un layout construit dit de lui-même, réduit à ce qui décide de l'employer. */
interface LayoutDiagnostics {
	transformsUnresolved?: number;
}

/**
 * Le layout d'un écran : construit dans la page quand la page en a les moyens, demandé au
 * serveur sinon.
 *
 * ## Pourquoi un repli, et sur quelle mesure
 *
 * La page ne peut pas résoudre seule un nom logique de compagnon (`team14_01.g4pkm`) : cette
 * résolution dépend de l'index du montage, et `/api/v1/screens/{screen}` la publie dans
 * `items[].companions`. Un serveur qui ne porte pas encore ce champ laisse la page sans aucune
 * pose — le layout serait syntaxiquement valide et visuellement vide.
 *
 * Le repli se décide donc sur une MESURE, pas sur une exception : si aucun objet n'a de
 * transformation résolue alors que l'écran en déclare, la page demande le layout au serveur. La
 * condition se désarme d'elle-même le jour où le champ est servi ; rien à retirer ensuite.
 *
 * [`buildMenuLayout`] coupe même avant : un détail d'écran sans un seul `companions` rend `null`
 * sans rien télécharger, parce que la construction ne peut alors rien résoudre. Sans cette
 * coupe, chaque visite d'un écran payait ses `.objbin` pour finir sur la route de toute façon.
 *
 * Le coût mesuré du chemin navigateur sur `chara_bank_menu`, le 2026-09-12 : 25 requêtes,
 * 27 728 octets au total, servis en `max-age=86400` — donc une fois par jour et par visiteur.
 */
export async function loadMenuLayout(
	screen: string,
	locale: string,
	signal?: AbortSignal,
): Promise<unknown> {
	const serveur = async () => {
		const response = await fetch(
			`/api/v1/menu/layout/${encodeURIComponent(screen)}?locale=${encodeURIComponent(locale)}`,
			{ signal, headers: { accept: "application/json" } },
		);
		if (!response.ok) throw new Error("Layout unavailable");
		return (await response.json()) as unknown;
	};

	const built = await buildMenuLayout(screen, locale).catch(() => null);
	if (built === null) return serveur();
	const layout = built.layout as { objects?: unknown[]; diagnostics?: LayoutDiagnostics };
	const objets = layout.objects?.length ?? 0;
	const nonResolus = layout.diagnostics?.transformsUnresolved ?? objets;
	if (objets === 0 || nonResolus >= objets) return serveur();
	return layout;
}
