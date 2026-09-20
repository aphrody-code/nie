/**
 * Les fiches du wiki — la page qui donne enfin une adresse aux cartes déjà écrites.
 *
 * ## Pourquoi cette page existe
 *
 * Le dépôt portait dix-huit composants `*Card` sous `components/wiki/`, et **treize** n'étaient
 * rendus par aucune route servie (relevé le 2026-09-20). Ce n'était pas de l'abandon : six
 * d'entre eux avaient été écrits contre des routes `/api/v1/wiki/*` qui répondaient
 * `503 Wiki resource unavailable` en production, parce que le miroir range ses entiers en TEXT
 * (cf. `nie_wiki::mirror::entier_souple`). Les routes réparées, les cartes n'avaient plus qu'à
 * être montées.
 *
 * ## Ce que la page ne fait pas
 *
 * Elle ne réinvente pas les cartes, et elle n'en écrit aucune : chaque famille rend le composant
 * partagé, par son adaptateur `desktop/components/wiki/` quand il en existe un — ce sont eux qui
 * savent résoudre une image dans le VFS, et les dupliquer ici ferait une seconde recette.
 *
 * Elle n'affiche pas non plus les familles dont la carte ne correspond pas aux données servies.
 * `DropsCard` décrit un butin d'objet (`win_treasure` / `item_emission`) ; `/api/v1/wiki/drops`
 * rend des bonus passifs par équipe. Les brancher l'un sur l'autre remplirait une carte de
 * champs vides et se lirait comme une donnée manquante plutôt que comme un modèle qui ne
 * s'applique pas.
 */
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { fetchJson } from "@niers/asset-source";
import { CapsuleCard, CostumeCard } from "@niers/inacord-ui/components/wiki/wiki/GachaCard";
import { CoachCard } from "@niers/inacord-ui/components/wiki/wiki/CoachCard";
import { QuestCard } from "@niers/inacord-ui/components/wiki/wiki/QuestCard";
import { StadiumCard } from "@niers/inacord-ui/components/wiki/wiki/StadiumCard";
import { AuraCard } from "../desktop/components/wiki/AuraCard";
import { ShopCard } from "../desktop/components/wiki/ShopCard";
import { TacticCard } from "../desktop/components/wiki/TacticCard";

/** Une famille du wiki : d'où viennent ses lignes, et quelle carte les rend. */
export interface WikiFamily {
	/** Segment d'URL et clé de l'onglet. */
	id: string;
	/** Libellé français de l'onglet. */
	label: string;
	/** Route servie, relative à l'origine. */
	path: string;
	/**
	 * Nombre de lignes relevé le 2026-09-20 sur `var/mirror.sqlite`.
	 *
	 * Il n'est pas affiché : c'est une valeur de test, qui dit qu'une famille a répondu ce
	 * jour-là. Le compte montré à l'écran est toujours celui de la réponse reçue.
	 */
	measured: number;
	/** Extrait la liste de lignes d'une réponse — chaque route a sa propre enveloppe. */
	rows: (body: unknown) => Record<string, unknown>[];
	/** Rend une ligne. La clé de liste est fournie par l'appelant. */
	card: (row: Record<string, unknown>) => ReactNode;
}

/** Lit une clé en chaîne, `undefined` si absente ou vide — jamais une chaîne « null ». */
function text(row: Record<string, unknown>, key: string): string | undefined {
	const value = row[key];
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	// Le miroir écrit littéralement `\N` pour une absence ; l'afficher serait une donnée inventée.
	return trimmed === "" || trimmed === "\\N" || trimmed === "\\\\N" ? undefined : trimmed;
}

/** Lit une clé en nombre, `undefined` si elle n'en est pas un. */
function num(row: Record<string, unknown>, key: string): number | undefined {
	const value = row[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Les lignes d'une réponse, quelle que soit son enveloppe.
 *
 * Les neuf routes n'ont pas le même contrat : `/coaches` rend un tableau nu, `/capsules` un
 * `{data}`, `/trophies` un `{trophies}`, `/drops` un `{drops}`. Plutôt que d'écrire le nom de
 * champ de chacune — quatre littéraux qui se désynchroniseront un par un — on prend le tableau
 * que la réponse porte. Une enveloppe à deux tableaux casserait cette règle ; il n'y en a pas,
 * et le test le vérifie sur les formes réelles.
 */
export function wikiRowsFromResponse(body: unknown): Record<string, unknown>[] {
	const keep = (value: unknown): value is Record<string, unknown>[] =>
		Array.isArray(value) && value.every(item => typeof item === "object" && item !== null && !Array.isArray(item));
	if (keep(body)) return body;
	if (typeof body !== "object" || body === null) return [];
	for (const value of Object.values(body)) if (keep(value)) return value;
	return [];
}

/** Les huit familles montées, dans l'ordre des onglets. */
export const WIKI_FAMILIES: readonly WikiFamily[] = [
	{
		id: "auras",
		label: "Auras & Keshin",
		path: "/api/v1/wiki/auras?limit=200",
		measured: 460,
		rows: wikiRowsFromResponse,
		card: row => (
			<AuraCard
				id={String(row.id ?? "")}
				name={text(row, "nameFr") ?? text(row, "nameEn") ?? String(row.id ?? "")}
				description={text(row, "descriptionFr") ?? text(row, "descriptionEn")}
				assetCode={text(row, "assetCode")}
				subType={text(row, "subType") ?? ""}
				category={text(row, "auraType") ?? text(row, "categorySlug") ?? ""}
				image={text(row, "imageUrl")}
			/>
		),
	},
	{
		id: "tactics",
		label: "Tactiques",
		path: "/api/v1/wiki/tactics?limit=200",
		measured: 81,
		rows: wikiRowsFromResponse,
		card: row => (
			<TacticCard
				id={String(row.id ?? row.internalCode ?? "")}
				name={text(row, "nameFr") ?? text(row, "name") ?? String(row.id ?? "")}
				// `TacticCard` ne porte pas de description : sa surface est la bannière telop et
				// le nom. Lui en passer une serait ajouter un champ que la carte n'affiche pas.
				categoryLabel={text(row, "source") === "inagle_special_tactics" ? "Tactique spéciale" : "Tactique"}
			/>
		),
	},
	{
		id: "quests",
		label: "Quêtes",
		path: "/api/v1/wiki/quests",
		measured: 182,
		rows: wikiRowsFromResponse,
		card: row => (
			<QuestCard
				quest={{
					id: String(row.id ?? ""),
					title: text(row, "title") ?? String(row.id ?? ""),
					titles: (row.titles as { en?: string } | undefined) ?? {},
					kind: text(row, "kind") ?? "main",
					phase: (row.phase as string | number | null | undefined) ?? null,
					area: num(row, "area") ?? null,
				}}
			/>
		),
	},
	{
		id: "shops",
		label: "Boutiques",
		path: "/api/v1/wiki/shops",
		measured: 15,
		rows: wikiRowsFromResponse,
		card: row => (
			<ShopCard
				shopId={num(row, "shopId") ?? 0}
				name={text(row, "name") ?? String(row.shopId ?? "")}
				nameJa={text(row, "nameJa") ?? null}
				itemCount={num(row, "itemCount") ?? 0}
				categories={(row.categories as { category: string; count: number }[] | undefined) ?? []}
			/>
		),
	},
	{
		id: "coaches",
		label: "Entraîneurs",
		path: "/api/v1/wiki/coaches",
		measured: 102,
		rows: wikiRowsFromResponse,
		card: row => (
			<CoachCard
				id={num(row, "id") ?? 0}
				name={text(row, "name") ?? String(row.id ?? "")}
				role={text(row, "role") ?? ""}
				roleLabel={text(row, "role") ?? "—"}
				playstyleLabel={text(row, "playstyle") ?? null}
				elementLabel={text(row, "element") ?? null}
				stat={text(row, "stat") ?? null}
				buff={text(row, "buff") ?? null}
				// Les visages d'entraîneur sont des `.g4tx` du VFS, et la carte attend une URL
				// d'image. Sans adaptateur de décodage ici, on rend le repli de la carte plutôt
				// qu'une balise cassée : `renderImage` n'est appelé que si `faceUrl` existe.
				renderImage={() => null}
			/>
		),
	},
	{
		id: "stadiums",
		label: "Stades",
		path: "/api/v1/wiki/stadiums",
		measured: 81,
		rows: wikiRowsFromResponse,
		card: row => (
			<StadiumCard
				id={String(row.id ?? "")}
				code={String(row.id ?? "")}
				title={text(row, "imagePath")?.split("/").pop() ?? String(row.id ?? "")}
				index={num(row, "index") ?? null}
			/>
		),
	},
	{
		id: "capsules",
		label: "Capsules",
		path: "/api/v1/wiki/capsules?limit=200",
		measured: 740,
		rows: wikiRowsFromResponse,
		card: row => (
			<CapsuleCard
				prize={{
					id: String(row.id ?? ""),
					contentRef: String(row.contentRef ?? ""),
					poolRef: String(row.poolRef ?? ""),
				}}
			/>
		),
	},
	{
		id: "costumes",
		label: "Costumes",
		path: "/api/v1/wiki/costumes?limit=200",
		measured: 577,
		rows: wikiRowsFromResponse,
		card: row => (
			<CostumeCard
				costume={{
					index: num(row, "index") ?? 0,
					type: num(row, "type") ?? 0,
					typeLabel: text(row, "typeLabel") ?? "Standard",
					modelRef: String(row.modelRef ?? ""),
					flag1: num(row, "flag1") ?? 0,
					flag2: num(row, "flag2") ?? 0,
				}}
			/>
		),
	},
] as const;

/** La famille que désigne un identifiant, la première par défaut. */
export function wikiFamilyFor(id: string | null | undefined): WikiFamily {
	return WIKI_FAMILIES.find(family => family.id === id) ?? WIKI_FAMILIES[0]!;
}

/** Identifiant de famille lu dans une URL (`?famille=`). */
export function wikiFamilyFromUrl(input: string): string {
	return new URL(input, "http://localhost").searchParams.get("famille") ?? WIKI_FAMILIES[0]!.id;
}

/** URL de la page pour une famille — la première est l'adresse courte. */
export function wikiHrefForFamily(input: string, id: string): string {
	const url = new URL(input, "http://localhost");
	if (id && id !== WIKI_FAMILIES[0]!.id) url.searchParams.set("famille", id);
	else url.searchParams.delete("famille");
	return `${url.pathname}${url.search}`;
}

/** Les fiches du wiki, une famille à la fois. */
export function WikiCards() {
	const [familyId, setFamilyId] = useState(() =>
		typeof window === "undefined" ? WIKI_FAMILIES[0]!.id : wikiFamilyFromUrl(window.location.href),
	);
	const family = useMemo(() => wikiFamilyFor(familyId), [familyId]);
	const [state, setState] = useState<{ rows: Record<string, unknown>[]; error: string | null; loading: boolean }>({
		rows: [],
		error: null,
		loading: true,
	});

	useEffect(() => {
		const controller = new AbortController();
		setState({ rows: [], error: null, loading: true });
		fetchJson<unknown>(family.path, { signal: controller.signal, retries: 1, timeoutMs: 20_000 })
			.then(body => setState({ rows: family.rows(body), error: null, loading: false }))
			.catch((error: unknown) => {
				if (controller.signal.aborted) return;
				setState({ rows: [], error: error instanceof Error ? error.message : String(error), loading: false });
			});
		return () => controller.abort();
	}, [family]);

	return (
		<div className="flex h-full flex-col gap-3 p-6">
			<div className="flex flex-wrap items-center gap-1.5 border-b border-app-line pb-2" role="tablist" aria-label="Familles du wiki">
				{WIKI_FAMILIES.map(entry => {
					const active = entry.id === family.id;
					return (
						<button
							key={entry.id}
							role="tab"
							aria-selected={active}
							type="button"
							className={`state-layer rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
								active
									? "border-primary bg-primary text-on-primary"
									: "border-outline-variant/30 text-on-surface-variant hover:text-on-surface"
							}`}
							onClick={() => {
								setFamilyId(entry.id);
								if (typeof window !== "undefined")
									window.history.replaceState(window.history.state, "", wikiHrefForFamily(window.location.href, entry.id));
							}}
						>
							{entry.label}
						</button>
					);
				})}
			</div>
			{state.loading && <p className="text-sm text-on-surface-variant">Chargement de « {family.label} »…</p>}
			{state.error && (
				<p role="alert" className="text-sm text-error">
					{family.label} : {state.error}
				</p>
			)}
			{!state.loading && !state.error && (
				<p className="text-sm text-on-surface-variant">
					{state.rows.length.toLocaleString("fr-FR")} fiche{state.rows.length > 1 ? "s" : ""}
				</p>
			)}
			<div className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3 overflow-auto">
				{state.rows.map((row, index) => (
					<div key={`${family.id}:${String(row.id ?? index)}`}>{family.card(row)}</div>
				))}
			</div>
		</div>
	);
}
