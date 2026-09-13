/**
 * Le Lua du jeu, exécuté DANS la page.
 *
 * ## Ce que ça change
 *
 * La visibilité des objets d'un écran ne se lit nulle part : elle se calcule, en exécutant les
 * scripts Lua que le jeu embarque. `nie-site` le faisait pour le navigateur
 * (`/api/v1/menu/runtime/{screen}`), ce qui marche mais garde le jeu sur le serveur : la page
 * recevait un verdict, pas un moteur.
 *
 * Ici, c'est la vraie VM Lua 5.2.4 de PUC-Rio, compilée en WebAssembly
 * (`crates/engine/nie-lua-web`), appelant exactement le même `nie_lua::menu_runtime::replay` que
 * la route HTTP. La page charge les octets, exécute, et sait par elle-même quel objet l'écran
 * affiche.
 *
 * ## Pourquoi un SECOND module WebAssembly
 *
 * Le bundle du site est `wasm32-unknown-unknown`. Cette VM ne peut pas y vivre : `mlua-sys`
 * compile les sources C de Lua 5.2.4, qui réclament une libc (`setjmp`/`longjmp`, `malloc`) que
 * seul `wasm32-unknown-emscripten` fournit parmi les cibles wasm. Les deux modules cohabitent
 * donc, chacun sur sa cible — ce n'est pas une duplication, c'est la seule façon d'avoir les deux.
 *
 * ## Ce que le module EXIGE du moteur, mesuré sur l'artefact
 *
 * `nie_lua_web.wasm` déclare une **section `tag` (identifiant 13)** : mesuré sur le binaire
 * servi, 5 octets. Cette section n'existe que dans la proposition *exception handling* de
 * WebAssembly, et c'est une conséquence directe du mode de `longjmp` choisi à la compilation
 * (`-sSUPPORT_LONGJMP=wasm`, cf. `crates/engine/nie-lua-web/README.md`). Un moteur qui ne
 * l'implémente pas **refuse le module** — pas une erreur d'exécution, un refus d'instanciation.
 *
 * [`wasmExceptionsAvailable`] le détecte avant le téléchargement de 873 Ko, et
 * [`resolveMenuVisibility`] rend alors une table vide en le disant. Le repli existait déjà ;
 * ce qui change est qu'il porte désormais une RAISON au lieu d'un échec muet.
 *
 * ## L'état MESURÉ, le 2026-09-12 : la VM avorte
 *
 * Le module se télécharge (870 512 o), le catalogue de scripts répond, les vrais `.lua.bin` du
 * jeu sont chargés — et le replay meurt au premier chemin d'erreur de Lua :
 *
 * ```text
 * [nie-lua-web makeInvoke vii] fn table index=257 caught: Exception
 * [nie-lua-web fd2] fatal runtime error: Rust cannot catch foreign exceptions, aborting
 * ```
 *
 * La cause est le LIEN, pas ce fichier : l'artefact emscripten a été produit sans le support
 * JS des exceptions C++ (`setThrew`/`stackSave` ne sont pas exportés, cf. l'en-tête de
 * `nie-lua-web.ts`), donc le `longjmp` par lequel Lua remonte ses erreurs sort en exception JS
 * que Rust ne peut pas rattraper. Relier avec `-sSUPPORT_LONGJMP=emscripten` (ou
 * `-fwasm-exceptions`) est la marche suivante, et elle est de l'ordre du drapeau de build.
 *
 * En attendant, [`resolveMenuVisibility`] rend une table VIDE à la moindre défaillance : l'écran
 * retombe alors sur la visibilité que `nie-site` a résolue, et rien ne régresse. Ce fichier est
 * la plomberie que ce correctif rendra vivante, pas une promesse déjà tenue.
 *
 * ## Ce que ça ne prétendra pas non plus une fois réparé
 *
 * Le replay n'est pas complet : il rend `complete: false` dès qu'un rappel ou un appel hôte
 * reste non résolu, côté serveur comme ici. Un écran dont le jeu ne livre aucun script du même
 * nom — `shop_menu` a trois voisins et aucun homonyme — ne résout rien, et le dit.
 */
import { createLuaRuntime, type LuaRuntime } from "../../../../crates/engine/nie-lua-web/js/nie-lua-web";

/** L'artefact emscripten, servi comme le module du jeu. */
const VM_URL = "/static/game/nie_lua_web.wasm";

/** Le `_setting.cfg.bin` d'un écran, d'où le replay tire la liste de ses calques. */
function settingPath(screen: string): string {
	return `data/common/gamedata/menu/cfg/${screen}_setting.cfg.bin`;
}

/**
 * Un module minimal dont la seule particularité est de déclarer une section `tag`.
 *
 * En-tête, un type `() -> ()`, puis la section 13 avec une balise de ce type. Aucun moteur
 * dépourvu de la proposition *exception handling* ne le valide, et aucun ne le refuse s'il
 * l'implémente : c'est la détection canonique, et elle ne coûte pas une requête réseau.
 */
const SONDE_EXCEPTIONS = new Uint8Array([
	0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // \0asm 1
	0x01, 0x04, 0x01, 0x60, 0x00, 0x00, //             type : 1 × () -> ()
	0x0d, 0x03, 0x01, 0x00, 0x00, //                   tag  : 1 × attribut 0, type 0
]);

/** Ce moteur implémente-t-il les exceptions WebAssembly, dont ce module dépend ? */
export function wasmExceptionsAvailable(): boolean {
	try {
		return WebAssembly.validate(SONDE_EXCEPTIONS);
	} catch {
		return false;
	}
}

let runtimePromise: Promise<LuaRuntime> | null = null;

/** Charge la VM une seule fois, même si deux écrans la demandent en même temps. */
function ensureRuntime(): Promise<LuaRuntime> {
	if (runtimePromise === null) {
		runtimePromise = (async () => {
			// Avant les 873 Ko : le module déclare une section `tag`, donc un moteur sans
			// exceptions WebAssembly le refusera de toute façon à l'instanciation.
			if (!wasmExceptionsAvailable()) {
				throw new Error(
					"ce moteur n'implémente pas les exceptions WebAssembly, que nie_lua_web.wasm exige",
				);
			}
			// Comme le module du jeu, ce nom est stable : il faut le revalider à chaque
			// déploiement plutôt que de le figer un an dans les caches.
			const response = await fetch(VM_URL, { cache: "no-cache" });
			if (!response.ok) throw new Error(`${VM_URL} → HTTP ${response.status}`);
			return createLuaRuntime(await response.arrayBuffer());
		})().catch((error) => {
			runtimePromise = null;
			throw error;
		});
	}
	return runtimePromise;
}

/** Une entrée du catalogue de scripts que `nie-site` publie. */
interface ScriptEntry {
	chemin: string;
}

/** Une page du catalogue. */
interface ScriptPage {
	elements?: ScriptEntry[];
	pages?: number;
}

/**
 * TOUTES les pages d'une requête au catalogue, pas la première.
 *
 * La route pagine par 50 par défaut et plafonne `per_page` à 200 — et elle le fait sans erreur,
 * en annonçant simplement `pages` dans sa réponse. Mesuré le 2026-09-13 : `?q=chara_edit` rend
 * 50 scripts sur 51, donc le rejeu d'un écran de l'éditeur d'avatar tournait déjà sans l'un des
 * siens. C'est le même défaut que la table de texte tronquée à 200 lignes sur 2 755, et il se
 * corrige de la même façon : lire `pages`, aller chercher le reste.
 *
 * Exporté pour être éprouvé seul : `resolveMenuVisibility` rend une table vide avant d'y arriver
 * dès que la VM ne se charge pas, ce qui est le cas dans un moteur de test sans WebAssembly —
 * la pagination ne serait donc jamais atteinte par un test qui passe par elle.
 */
export async function catalogue(query: string): Promise<string[]> {
	const lire = async (page: number): Promise<ScriptPage | null> => {
		const response = await fetch(`/api/v1/lua/scripts?${query}&page=${page}&per_page=200`, {
			headers: { accept: "application/json" },
		}).catch(() => null);
		return response?.ok ? ((await response.json()) as ScriptPage) : null;
	};
	const premiere = await lire(1);
	if (premiere === null) return [];
	const entrees = [...(premiere.elements ?? [])];
	const pages = premiere.pages ?? 1;
	if (pages > 1) {
		const suivantes = await Promise.all(
			Array.from({ length: pages - 1 }, (_, index) => lire(index + 2)),
		);
		for (const page of suivantes) entrees.push(...(page?.elements ?? []));
	}
	return entrees.map(entry => entry.chemin);
}

/**
 * Les scripts d'un écran, par leur chemin VFS RÉEL.
 *
 * Le nom porte une version (`chara_bank_menu_6.00.09.00.lua.bin`) que la page ne peut pas
 * deviner : elle la demande au catalogue, qui la lit dans le VFS.
 */
async function scriptPaths(screen: string): Promise<string[]> {
	return (await catalogue(`q=${encodeURIComponent(screen)}`)).filter(
		(path) => path.startsWith("data/common/script/lua/menu/") && path.endsWith(".lua.bin"),
	);
}

const textesPromises = new Map<string, Promise<[number, string][]>>();

/**
 * Les libellés de menu de la langue demandée, `[[hash, ligne], …]`.
 *
 * Le site natif les lit dans son VFS avant de rejouer ; le module ne les avait pas, et le
 * différentiel (`crates/engine/nie-lua-web/scripts/differential.ts`) mesurait treize écrans sur
 * quatorze divergents rien que là-dessus. L'ABI `nie_lua_web_load_text` existe depuis le
 * 2026-09-13 ; ceci est ce qui la relie à la page.
 *
 * Mémorisé par langue : 2 755 lignes en français, quatorze pages de 200, servies en
 * `max-age=86400` — une fois par session, pas une fois par écran.
 *
 * `menu-layout.ts` s'en sert aussi : la construction d'un layout a besoin de la MÊME table pour
 * remplir ses slots de texte. Deux chargeurs mémorisés séparément — ce qu'ils étaient pendant
 * une heure — faisaient descendre 2 755 lignes deux fois par écran.
 */
export function menuTextLines(locale: string): Promise<[number, string][]> {
	const memo = textesPromises.get(locale);
	if (memo) return memo;
	const charge = (async () => {
		const lignes: [number, string][] = [];
		for (let page = 1; ; page += 1) {
			const reponse = await fetch(
				`/api/v1/text/${encodeURIComponent(locale)}/menu_text?page=${page}&per_page=200`,
				{ headers: { accept: "application/json" } },
			).catch(() => null);
			if (!reponse?.ok) break;
			const corps = (await reponse.json()) as {
				results?: { elements?: { hash: number; text: string }[]; pages?: number };
			};
			for (const ligne of corps.results?.elements ?? []) lignes.push([ligne.hash, ligne.text]);
			if (page >= (corps.results?.pages ?? 1)) break;
		}
		// Une table vide n'est pas mémorisée : le rejeu suivant réessaie, comme pour les includes.
		if (lignes.length === 0) textesPromises.delete(locale);
		return lignes;
	})();
	textesPromises.set(locale, charge);
	return charge;
}

let includesPromise: Promise<string[]> | null = null;

/**
 * Les scripts d'inclusion, que TOUS les écrans partagent.
 *
 * ## Pourquoi ils sont indispensables
 *
 * Un écran n'est pas autonome : il fait `INCLUDE("LUA_PROG_BASE")`, `LUA_LISTVIEW_INC`,
 * `LUA_CHARA_EDIT_MENU_INC`, et les fonctions qu'il appelle ensuite — `SetupEditWindowInfo`,
 * `SetupGaugeBar`, `UpdateManageCoroutineAll` — sont DÉFINIES là. Ne charger que les scripts
 * dont le nom ressemble à celui de l'écran laissait donc le rejeu sans ces définitions, et ce
 * qui manquait se lisait comme un manque de l'HÔTE alors que c'était un fichier non fourni.
 *
 * Mesuré le 2026-09-12 par `crates/engine/nie-lua/tests/menu_host_gap.rs` : sur 51 écrans
 * rejoués, fournir tout le corpus fait disparaître les cinq includes les plus bloquants ET les
 * sept fonctions qu'ils définissent, en tête de la liste des manques. Ce qui reste est du
 * `funcLuaMenuCommand` non reversé — 178 unités, un travail nommé, plus un symptôme.
 *
 * ## Le coût, mesuré
 *
 * 77 fichiers, 1 448 473 octets, servis en `max-age=86400`. Ils sont téléchargés une fois par
 * session et partagés par tous les écrans, pas une fois par écran.
 */
function includePaths(): Promise<string[]> {
	includesPromise ??= (async () => {
		const chemins = (await catalogue("q=include")).filter(
			(path) => path.startsWith("data/common/script/lua/include/") && path.endsWith(".lua.bin"),
		);
		// Un catalogue indisponible ne doit pas figer l'absence d'includes pour la SESSION.
		// `catalogue` ne lève pas — il rend une liste vide quand le réseau échoue — donc un
		// `.catch()` ne suffisait pas : il n'était jamais atteint, et une panne passagère
		// mémorisait « aucun include » jusqu'au rechargement de la page, ce qui retire à chaque
		// écran les fonctions que ses includes définissent. Seul un résultat NON VIDE est
		// mémorisé ; le vide est réessayé au rejeu suivant.
		if (chemins.length === 0) includesPromise = null;
		return chemins;
	})();
	return includesPromise;
}

/** Les octets d'un fichier du VFS, ou `null` quand le site ne l'a pas. */
async function vfsBytes(path: string): Promise<Uint8Array | null> {
	const response = await fetch(`/f/${path}`).catch(() => null);
	if (!response?.ok) return null;
	return new Uint8Array(await response.arrayBuffer());
}

/** L'état d'un objet, tel que le replay le rend. */
interface RuntimeObject {
	visible?: boolean;
	/**
	 * La visibilité par EXEMPLAIRE, quand une commande en a nommé un.
	 *
	 * Un objet de liste est un gabarit que le jeu réplique par emplacement d'attache ; le
	 * `2ᵉ` argument de `SetObjectVisible`/`SetPartVisible` désigne l'un d'eux. Le champ existait
	 * côté Rust (`CompiledMenuObject::visible_par_index`) et s'arrêtait à la frontière du
	 * navigateur, qui ne lisait que `visible` — donc masquait les 51 exemplaires ensemble.
	 */
	visible_par_index?: Record<string, boolean>;
}

/** Un calque et ses objets. */
interface RuntimeLayer {
	visible?: boolean;
	objects?: Record<string, RuntimeObject>;
}

/** La sortie du replay, réduite à ce que la composition emploie. */
interface ReplayOutput {
	scene?: { layers?: Record<string, RuntimeLayer> };
	complete?: boolean;
	/** Les manques que la VM a relevés — `ReplayOutput::missing` côté Rust. */
	missing?: string[];
	error?: string;
}

/**
 * CRC-32 d'un nom — la clé qui relie un objet du layout à son objet runtime.
 *
 * Réexporté depuis le module WebAssembly : c'est `nie_formats::cfgbin::crc32`, la fonction du
 * jeu, et non plus une boucle réécrite ici. Elle en avait trois copies dans le dépôt, qu'aucun
 * test ne comparait ; `crates/engine/nie-wasm/tests/model_render.rs` fixe désormais la
 * référence (`crc32("123456789") == 0xCBF43926`).
 *
 * Exige `ensureWasm()` au préalable, comme tout ce que le module calcule.
 */
export { crc32 } from "./bridge";

/** Ce que le replay a établi pour un écran. */
export interface ResolvedVisibility {
	/** Identifiant d'objet (CRC32 de son nom) → visible. */
	byObject: Map<number, boolean>;
	/**
	 * `"<crc32>:<rang>"` → visible, pour les exemplaires qu'une commande a nommés.
	 *
	 * Se lit AVANT `byObject` : un exemplaire nommé l'emporte sur la visibilité du gabarit. La
	 * table est presque toujours creuse — mesuré sur `chara_edit_parts_menu` : 6 objets sur 2
	 * index — parce que les scripts ne commandent pas les exemplaires un par un.
	 */
	byInstance: Map<string, boolean>;
	/** `false` dès qu'un rappel ou un appel hôte reste non résolu — comme côté serveur. */
	complete: boolean;
	/** Ce qui a manqué, nommé. Vide quand `complete` est vrai. */
	missing: string[];
}

/**
 * Exécute le Lua d'un écran dans la page et rend la visibilité qu'il établit.
 *
 * Rend une table VIDE quand le jeu ne livre aucun script de ce nom, quand la VM ne se charge pas
 * ou quand le replay échoue : l'appelant ne dessine alors que ce que la donnée établit par
 * ailleurs, au lieu de supposer.
 */
export async function resolveMenuVisibility(screen: string): Promise<ResolvedVisibility> {
	// Chaque sortie anticipée porte SA raison. Rendre partout la même table vide confondait
	// « la VM ne s'est pas chargée » avec « rien ne manque » : deux états opposés, un seul
	// résultat, et personne pour distinguer un rejeu parfait d'un rejeu qui n'a pas eu lieu.
	const echec = (raison: string): ResolvedVisibility => ({
		byObject: new Map(),
		byInstance: new Map(),
		complete: false,
		missing: [raison],
	});
	let runtime: LuaRuntime;
	try {
		runtime = await ensureRuntime();
	} catch (erreur) {
		return echec(`VM Lua indisponible : ${erreur instanceof Error ? erreur.message : erreur}`);
	}
	const [ecran, includes] = await Promise.all([scriptPaths(screen), includePaths()]);
	const paths = [...new Set([...ecran, ...includes])];
	if (ecran.length === 0) return echec(`aucun script de menu nommé ${screen}`);

	runtime.clearScripts();
	runtime.loadText(await menuTextLines("fr"));
	const setting = settingPath(screen);
	const fichiers = await Promise.all([setting, ...paths].map(async (path) => [path, await vfsBytes(path)] as const));
	let charges = 0;
	for (const [path, bytes] of fichiers) {
		if (!bytes) continue;
		runtime.loadScript(path, bytes);
		charges += 1;
	}
	if (charges === 0) return echec("aucun script n'a pu être téléchargé");

	let output: ReplayOutput;
	try {
		output = JSON.parse(runtime.replay(screen, JSON.stringify({ locale: "fr" }))) as ReplayOutput;
	} catch (erreur) {
		return echec(`rejeu interrompu : ${erreur instanceof Error ? erreur.message : erreur}`);
	}
	if (output.error) return echec(output.error);
	if (!output.scene?.layers) return echec("le rejeu n'a rendu aucune scène");

	const byObject = new Map<number, boolean>();
	const byInstance = new Map<string, boolean>();
	for (const layer of Object.values(output.scene.layers)) {
		// Un objet d'un calque caché ne s'affiche pas, quoi qu'il dise de lui-même.
		const layerVisible = layer.visible !== false;
		for (const [id, objet] of Object.entries(layer.objects ?? {})) {
			byObject.set(Number(id), layerVisible && objet.visible === true);
			for (const [rang, visible] of Object.entries(objet.visible_par_index ?? {})) {
				byInstance.set(`${id}:${rang}`, layerVisible && visible === true);
			}
		}
	}
	return {
		byObject,
		byInstance,
		complete: output.complete === true,
		missing: output.missing ?? [],
	};
}

/** Exposé pour le test : la mémoïsation d'un échec ne se voit qu'en interrogeant deux fois. */
export const includePathsForTests = includePaths;
