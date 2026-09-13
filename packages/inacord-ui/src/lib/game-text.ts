/**
 * L'interface parle avec les mots du jeu.
 *
 * ## Ce que ça change
 *
 * Les libellés du site sont écrits en dur, en français. `ui-text-map.ts` dit lesquels le jeu
 * écrit lui aussi, et sous quelle référence `(famille, hash)` — une mesure, relue une par une
 * sur `/api/v1/text`. Ce module s'en sert pour afficher, à l'exécution, la ligne que le jeu
 * livre dans la langue choisie : « Retour » devient « Back », « 戻る », « Zurück », sans qu'une
 * seule traduction ait été écrite ici.
 *
 * ## Pourquoi un LOT, et pas `useNativeText`
 *
 * `useNativeText` résout une référence par requête. Un écran en cite une centaine : cent
 * allers-retours pour afficher un menu. La route GraphQL du site
 * (`crates/tools/nie-site/src/routes/graphql.rs`, champ `texts`) résout jusqu'à 512 références
 * en un aller-retour, et décode chaque famille une seule fois côté serveur. Ce module envoie
 * donc la carte ENTIÈRE en une requête par langue, une fois.
 *
 * Vérifié de bout en bout le 2026-09-13, contre un `nie-site` local portant le VFS : les 103
 * références distinctes de la carte partent en UNE requête, 103 reviennent résolues en anglais,
 * 102 sans ambiguïté — `Retour` → `Back`, `Paramètres` → `Settings`, `Agilité` → `Agility`. La
 * seule ambiguë porte deux textes pour un hash, et [`gameText`] garde alors le libellé écrit à
 * la main plutôt que d'en choisir un.
 *
 * ## Ce que ça ne fait pas
 *
 * - Rien n'est traduit ici. Une langue que le jeu ne livre pas n'existe pas pour ce module.
 * - Un hash qui rend plusieurs lignes différentes n'est PAS tranché : le libellé écrit à la main
 *   reste affiché. Choisir la première serait deviner, et c'est précisément ce que la carte
 *   refuse (cf. `UiTextEntry.occurrences`).
 * - Un libellé absent de la carte reste tel quel, pour toujours : le jeu ne l'a jamais écrit.
 * - Rien n'est nettoyé ici. Le texte du jeu porte des codes de contrôle Level-5 (`[CG]…[C]`),
 *   mais `/api/v1/text` les retire déjà (`nie_data::text`) : vérifié le 2026-09-13 sur les 115
 *   valeurs françaises de la carte et sur 40 de leurs lignes ANGLAISES — zéro code résiduel.
 *   Ajouter un formatage ici dupliquerait `nie_core::azalee::game_text::format_game_text`, qui
 *   existe pour les textes que l'on décode SOI-MÊME, pas pour ceux que la route a assainis.
 */
import { useEffect, useSyncExternalStore } from "react";

import type { GameLocale } from "./settings";
import {
	applyTransform,
	UI_TEXT_MAP,
	UI_TEXT_VARIANTS,
	type UiTextEntry,
	type UiTextVariant,
} from "./ui-text-map";

/** Une référence telle que le jeu adresse une ligne. */
export interface GameTextRef {
	family: string;
	hash: string;
}

/**
 * Résout un lot de références dans une langue.
 *
 * Rend, par référence, TOUTES les lignes que ce hash porte — l'ambiguïté est transmise, pas
 * tranchée. La clé de la table est `${family}/${hash}`, en minuscules.
 */
export type GameTextResolver = (
	locale: GameLocale,
	refs: readonly GameTextRef[],
) => Promise<ReadonlyMap<string, readonly string[]>>;

/** La clé sous laquelle une référence est rangée. */
export function refKey(family: string, hash: string): string {
	return `${family}/${hash.toLowerCase()}`;
}

const BATCH_QUERY = `query($language: String!, $refs: [TextRef!]!) {
  texts(language: $language, refs: $refs) { family hash texts }
}`;

interface BatchResponse {
	data?: { texts?: { family: string; hash: string; texts: string[] }[] } | null;
	errors?: { message?: string }[];
}

/**
 * L'adaptateur navigateur : une requête POST sur la route GraphQL du site.
 *
 * Un hôte qui possède son propre VFS (Tauri, wasm) en fournit un autre ; le contrat est la
 * table rendue, pas le transport.
 */
export const fetchGameText: GameTextResolver = async (locale, refs) => {
	const response = await fetch("/api/v1/graphql", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ query: BATCH_QUERY, variables: { language: locale, refs } }),
	});
	if (!response.ok) throw new Error(`/api/v1/graphql → HTTP ${response.status}`);
	const body = (await response.json()) as BatchResponse;
	// GraphQL répond 200 même quand il refuse la requête : une origine qui ne sert pas encore
	// `texts` rend `{"data":null,"errors":[{"message":"Unknown field \"texts\"…"}]}` (mesuré en
	// production le 2026-09-13). Sans cette levée, la table revenait VIDE et l'interface gardait
	// ses libellés — le bon comportement, avec la cause invisible. C'est le défaut que
	// `ReplayOutput::missing` a corrigé côté Rust : « ça n'a pas marché » doit dire pourquoi.
	if (!body.data?.texts && body.errors?.length) {
		throw new Error(body.errors[0]?.message ?? "requête GraphQL refusée");
	}
	const resolved = new Map<string, readonly string[]>();
	for (const entry of body.data?.texts ?? []) {
		resolved.set(refKey(entry.family, entry.hash), entry.texts);
	}
	return resolved;
};

/** Toutes les références de la carte, dédupliquées — ce qu'une requête de lot demande. */
export function mappedRefs(): GameTextRef[] {
	const seen = new Set<string>();
	const refs: GameTextRef[] = [];
	for (const entry of [...UI_TEXT_MAP, ...UI_TEXT_VARIANTS]) {
		const key = refKey(entry.family, entry.hash);
		if (seen.has(key)) continue;
		seen.add(key);
		refs.push({ family: entry.family, hash: entry.hash });
	}
	return refs;
}

/** Le libellé → l'entrée de la carte qui le décrit. Construit une fois. */
const BY_LABEL = new Map<string, UiTextEntry | UiTextVariant>([
	...UI_TEXT_MAP.map(entry => [entry.label, entry] as const),
	...UI_TEXT_VARIANTS.map(entry => [entry.label, entry] as const),
]);

/**
 * Ce que le lot a rendu pour une langue.
 *
 * `undefined` tant que la requête n'a pas répondu ; une table vide quand elle a échoué. Dans les
 * deux cas l'appelant affiche le libellé écrit à la main, donc rien ne clignote vers du vide.
 */
type Catalogue = ReadonlyMap<string, readonly string[]>;

interface Slot {
	value?: Catalogue;
	pending?: Promise<void>;
}

function createStore() {
	const slots = new Map<string, Slot>();
	const listeners = new Set<() => void>();
	let revision = 0;
	return {
		slots,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		snapshot: () => revision,
		notify() {
			revision += 1;
			for (const listener of listeners) listener();
		},
	};
}

const stores = new WeakMap<GameTextResolver, ReturnType<typeof createStore>>();

function storeOf(resolver: GameTextResolver) {
	let store = stores.get(resolver);
	if (!store) {
		store = createStore();
		stores.set(resolver, store);
	}
	return store;
}

/**
 * La langue dans laquelle la carte a été MESURÉE.
 *
 * `UiTextEntry.fr` porte la ligne française du jeu, et `UI_TEXT_MAP` ne contient que des
 * libellés dont le français est identique au texte écrit dans le composant. Dans cette langue,
 * la substitution rend donc exactement ce qui est déjà à l'écran : la requête coûterait un
 * aller-retour pour n'afficher aucune différence. C'est la langue par défaut du site
 * (`SETTINGS_DEFAULTS.gameLocale`), donc le cas le plus fréquent de tous.
 */
const LOCALE_MESUREE = "fr";

/**
 * Faut-il demander le catalogue pour cette langue ?
 *
 * Extrait en fonction pure pour que la règle s'éprouve sans rendre un arbre React : un hook qui
 * décide de ne rien faire ne se teste autrement qu'en observant une absence de requête.
 */
export function needsCatalogue(locale: GameLocale): boolean {
	return locale !== LOCALE_MESUREE;
}

/**
 * Charge, une fois par langue, la ligne du jeu de chaque libellé de la carte.
 *
 * Monté à la racine par l'hôte. Les composants appellent [`gameText`] ; ce hook est ce qui rend
 * leur appel non vide.
 *
 * Ne demande RIEN dans la langue où la carte a été mesurée : voir [`LOCALE_MESUREE`].
 */
export function useGameTextCatalogue(
	locale: GameLocale,
	resolver: GameTextResolver = fetchGameText,
): Catalogue | undefined {
	const store = storeOf(resolver);
	useSyncExternalStore(store.subscribe, store.snapshot, () => 0);
	useEffect(() => {
		if (!needsCatalogue(locale)) return;
		const existing = store.slots.get(locale);
		if (existing?.value || existing?.pending) return;
		const slot: Slot = {};
		slot.pending = resolver(locale, mappedRefs())
			.then(value => {
				slot.value = value;
			})
			// Un lot qui échoue laisse une table VIDE, pas une absence : réessayer en boucle
			// ferait battre le réseau pour un texte que l'écran affiche déjà en dur.
			.catch(() => {
				slot.value = new Map();
			})
			.finally(() => {
				slot.pending = undefined;
				store.notify();
			});
		store.slots.set(locale, slot);
	}, [locale, resolver, store]);
	return store.slots.get(locale)?.value;
}

/**
 * Le texte à afficher pour un libellé écrit à la main.
 *
 * Rend le libellé lui-même quand la carte ne le connaît pas, quand le lot n'a pas encore
 * répondu, ou quand le hash porte plusieurs lignes différentes dans cette langue — trois cas où
 * substituer serait deviner.
 */
export function gameText(catalogue: Catalogue | undefined, label: string): string {
	const entry = BY_LABEL.get(label);
	if (!entry || !catalogue) return label;
	const texts = catalogue.get(refKey(entry.family, entry.hash));
	if (!texts || texts.length === 0) return label;
	// Plusieurs lignes partagent le hash : sans une mise en page native qui en désigne une, il
	// n'y a pas de raison de préférer l'une à l'autre.
	const unique = new Set(texts);
	if (unique.size !== 1) return label;
	const text = texts[0];
	return "transform" in entry ? applyTransform(entry.transform, text) : text;
}
