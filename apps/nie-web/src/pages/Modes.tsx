/**
 * Les modes de jeu — les onglets du menu principal, et ce dont chacun est fait.
 *
 * ## Ce que cette page ajoute au wiki qu'elle remplace
 *
 * Azalée servait `/mode` et `/mode/<slug>` en lisant les JSON de `niers mode export` : elle
 * pouvait NOMMER les écrans d'un mode, pas les montrer. Ici, chaque écran est demandé à
 * `GET /api/v1/menu/render/<ecran>`, qui compose le calque, les objets de menu et les textures
 * du jeu et rend un PNG. La page n'est donc plus une liste de noms de fichiers.
 *
 * Mesuré le 2026-09-13 sur `victory-road` : **23 de ses 24 écrans reviennent en PNG**, et
 * `victory_road_final_tournament_menu` répond `504`. L'écran qui ne revient pas le dit à sa
 * place, au lieu de laisser un cadre vide — un rendu manquant est une information sur le
 * moteur, pas un défaut d'affichage à masquer.
 *
 * ## Le nom d'un mode vient du jeu, pas d'ici
 *
 * Chaque mode porte un `label_hash` : le CRC-32 sous lequel `menu_text.cfg.bin` écrit son nom.
 * La page résout ce hash dans la langue choisie, en UN aller-retour pour les douze
 * (`fetchGameText`, route GraphQL `texts`). Mesuré le 2026-09-13 : **9 des 12 modes** rendent
 * leur nom dans les quatre langues demandées — « Modo Competición », « Modo Crónica »,
 * « キズナステーション », « Estación Kizuna ». Les trois autres (`chara-edit`, `bb-stadium`,
 * `play-guide`) n'ont PAS de `label_hash` : le catalogue rend alors le nom qu'il porte, et la
 * page ne prétend pas qu'il vient du jeu.
 *
 * Le reste des libellés passe par [`GameText`], qui substitue la ligne du jeu quand le jeu écrit
 * exactement ce mot. Mesuré sur ce corpus : « Retour », « Informations », « Ouvrir »,
 * « Détails », « Tout », « Type » y sont ; « Écrans », « Calques », « Scripts » et
 * « Composants » n'y sont pas — `nie.exe` ne nomme pas ses propres fichiers dans son interface.
 * Ces mots-là restent écrits ici, et `scripts/validation/ui-text-map.py` les compte comme
 * manquants plutôt que de les faire passer pour du texte du jeu.
 *
 * ## Ce qui vient du serveur, et rien d'autre
 *
 * - `GET /api/v1/modes` : les modes catalogués, leur note et lesquels sont officiels.
 * - `GET /api/v1/modes/<slug>` : les écrans, les calques, les `objbin`, les `g4pkm`, les `g4tx`,
 *   les composants, les scripts, et les comptes qui vont avec — tous comptés sur le VFS.
 *
 * Les comptes affichés sont ceux de la réponse. La page n'en calcule aucun : un total recalculé
 * ici pourrait s'écarter de celui que le serveur publie, et c'est le serveur qui a lu les
 * fichiers.
 */
import { useEffect, useMemo, useState } from "react";
import {
	GameCountBadge,
	GameHeaderBar,
	GamePanel,
	GameText,
	GLYPHES,
	Link,
} from "@niers/inacord-ui";
import { fetchGameText, refKey, type GameTextRef } from "@niers/inacord-ui/lib/game-text";
import { useSettings } from "@niers/inacord-ui/lib/settings";
import { MODES } from "../entries";

/** La famille de texte qui porte le nom des modes. */
const LABEL_FAMILY = "menu_text";

/** Un mode tel que la liste le publie. */
interface ModeSummary {
	slug: string;
	label: string;
	official: boolean;
	prefixes: string[];
	icon_region: string | null;
	label_hash: string | null;
	note: string | null;
}

/** Un écran d'un mode, avec le fichier de réglages dont il sort. */
interface ModeScreen {
	screen: string;
	cfg: string;
	bytes: number;
	layers: string[];
	focus: number;
}

/** La fiche d'un mode. Les clés des comptes sont celles du serveur. */
interface ModeSheet {
	slug: string;
	label: string;
	label_hash?: string | null;
	official: boolean;
	prefixes: string[];
	screens: ModeScreen[];
	components: { type_name: string; count: number }[];
	scripts: { path: string; bytes: number; instructions: number; functions: number }[];
	counts: Record<string, number>;
}

/**
 * Les comptes, dans l'ordre où ils sont montrés, avec leur libellé.
 *
 * La liste est explicite pour que l'ordre ne dépende pas de celui d'un objet. Une clé que le
 * serveur ajouterait sans figurer ici s'affiche quand même, sous son nom brut : on ne perd pas
 * une mesure parce qu'on ne l'a pas prévue.
 */
const COUNT_LABELS: Record<string, string> = {
	screens: "écrans",
	layers: "calques",
	objbins: "objbin",
	g4pkm: "maillages g4pkm",
	g4tx: "textures g4tx",
	component_types: "types de composants",
	components: "composants",
	scripts: "scripts Lua",
	focus: "objets focalisables",
	text_slots: "emplacements de texte",
	unreadable: "fichiers illisibles",
};

/** Le slug porté par la route, ou `null` sur la liste. */
function slugOf(route: string): string | null {
	const rest = route.startsWith(`${MODES}/`) ? route.slice(MODES.length + 1) : "";
	return rest.split("/")[0] || null;
}

/**
 * Le nom des modes, lu dans le texte du jeu, dans la langue choisie.
 *
 * Un hash qui rend plusieurs lignes différentes n'est PAS tranché — le catalogue garde son nom.
 * Choisir la première serait deviner, ce que `gameText` refuse déjà pour les libellés d'écran.
 */
function useModeLabels(hashes: readonly (string | null)[]): ReadonlyMap<string, string> {
	const { gameLocale } = useSettings();
	const [labels, setLabels] = useState<ReadonlyMap<string, string>>(new Map());
	const key = hashes.filter(Boolean).join(",");

	useEffect(() => {
		const refs: GameTextRef[] = key
			.split(",")
			.filter(Boolean)
			.map((hash) => ({ family: LABEL_FAMILY, hash }));
		if (refs.length === 0) {
			setLabels(new Map());
			return;
		}
		let cancelled = false;
		fetchGameText(gameLocale, refs)
			.then((resolved) => {
				if (cancelled) return;
				const unique = new Map<string, string>();
				for (const ref of refs) {
					const texts = resolved.get(refKey(ref.family, ref.hash));
					if (texts?.length === 1 && texts[0]) unique.set(ref.hash.toLowerCase(), texts[0]);
				}
				setLabels(unique);
			})
			.catch(() => {
				// La route texte n'a pas répondu : le catalogue garde son nom, comme le fait
				// `gameText` quand le réseau manque. Rien ne disparaît de l'écran.
				if (!cancelled) setLabels(new Map());
			});
		return () => {
			cancelled = true;
		};
	}, [gameLocale, key]);

	return labels;
}

/** Le nom d'un mode : celui du jeu s'il est lisible, sinon celui du catalogue. */
function modeLabel(labels: ReadonlyMap<string, string>, hash: string | null | undefined, fallback: string): string {
	return (hash && labels.get(hash.toLowerCase())) || fallback;
}

/**
 * Lit toutes les pages d'une route de liste.
 *
 * Chaque route de liste de `nie-site` pagine et CLIPPE en silence : demander plus que
 * `PER_PAGE_MAX` rend le maximum sans erreur, et seule la clé `pages` le dit. Un `per_page` fixe
 * est un défaut qui attend que le corpus grossisse.
 */
async function fetchAll<T>(url: string, signal: AbortSignal): Promise<T[]> {
	const collected: T[] = [];
	let page = 1;
	for (;;) {
		const response = await fetch(`${url}?page=${page}&per_page=200`, {
			signal,
			headers: { accept: "application/json" },
		});
		if (!response.ok) throw new Error(`${url} indisponible`);
		const body = (await response.json()) as { results: { elements: T[]; pages: number } };
		collected.push(...body.results.elements);
		if (page >= body.results.pages) return collected;
		page += 1;
	}
}

/** Le catalogue des modes, et la fiche de l'un d'eux. */
export function Modes({ route, prefix }: { route: string; prefix: string }) {
	const slug = useMemo(() => slugOf(route), [route]);
	return slug ? <ModeSheetView prefix={prefix} slug={slug} /> : <ModeListView prefix={prefix} />;
}

function ModeListView({ prefix }: { prefix: string }) {
	const [modes, setModes] = useState<ModeSummary[] | null>(null);
	const [error, setError] = useState(false);

	useEffect(() => {
		const controller = new AbortController();
		setError(false);
		fetchAll<ModeSummary>("/api/v1/modes", controller.signal)
			.then((value) => {
				if (!controller.signal.aborted) setModes(value);
			})
			.catch(() => {
				if (!controller.signal.aborted) setError(true);
			});
		return () => controller.abort();
	}, []);

	const hashes = useMemo(() => (modes ?? []).map((mode) => mode.label_hash), [modes]);
	const labels = useModeLabels(hashes);
	const official = modes?.filter((mode) => mode.official).length ?? 0;

	return (
		<section aria-label="Modes" className="space-y-4">
			<GameHeaderBar icon={GLYPHES.livre} title={<GameText>Modes</GameText>}>
				{modes ? <GameCountBadge count={modes.length} icon={GLYPHES.livre} unit="mode" /> : null}
				{modes ? (
					<span>
						{official} <GameText>officiels</GameText>
					</span>
				) : null}
			</GameHeaderBar>
			{error ? (
				<p role="alert">Le catalogue des modes n'est pas disponible pour le moment.</p>
			) : null}
			{!modes && !error ? <p>Chargement…</p> : null}
			{modes ? (
				<ul className="grid gap-3 sm:grid-cols-2">
					{modes.map((mode) => (
						<li key={mode.slug}>
							<GamePanel
								role="region"
								title={modeLabel(labels, mode.label_hash, mode.label)}
								watermark={GLYPHES.livre}
							>
								<p className="text-sm">
									{mode.official
										? "Le jeu énumère lui-même ce mode."
										: "Mode catalogué à partir de ses écrans ; le jeu ne l'énumère pas."}
								</p>
								{mode.note ? <p className="text-sm text-ink-faint">{mode.note}</p> : null}
								<p className="text-xs text-ink-faint">
									<GameText>Type</GameText> : {mode.prefixes.join(", ")}
								</p>
								<Link href={`${prefix}/${MODES}/${mode.slug}`}>
									<GameText>Ouvrir</GameText>
								</Link>
							</GamePanel>
						</li>
					))}
				</ul>
			) : null}
		</section>
	);
}

function ModeSheetView({ slug, prefix }: { slug: string; prefix: string }) {
	const [sheet, setSheet] = useState<ModeSheet | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const controller = new AbortController();
		setSheet(null);
		setError(null);
		fetch(`/api/v1/modes/${encodeURIComponent(slug)}`, {
			signal: controller.signal,
			headers: { accept: "application/json" },
		})
			.then(async (response) => {
				if (response.status === 404) throw new Error("Ce mode n'est pas au catalogue.");
				if (!response.ok) throw new Error("La fiche de ce mode n'est pas disponible.");
				return (await response.json()) as ModeSheet;
			})
			.then((value) => {
				if (!controller.signal.aborted) setSheet(value);
			})
			.catch((cause: unknown) => {
				if (controller.signal.aborted) return;
				setError(cause instanceof Error ? cause.message : "La fiche de ce mode n'est pas disponible.");
			});
		return () => controller.abort();
	}, [slug]);

	const hashes = useMemo(() => [sheet?.label_hash ?? null], [sheet]);
	const labels = useModeLabels(hashes);
	const title = sheet ? modeLabel(labels, sheet.label_hash, sheet.label) : slug;

	return (
		<section aria-label={title} className="space-y-4">
			<GameHeaderBar icon={GLYPHES.livre} title={title}>
				<Link href={`${prefix}/${MODES}`}>
					<GameText>Retour</GameText>
				</Link>
			</GameHeaderBar>
			{error ? <p role="alert">{error}</p> : null}
			{!sheet && !error ? <p>Chargement…</p> : null}
			{sheet ? (
				<>
					<GamePanel role="region" title={<GameText>Détails</GameText>} watermark={GLYPHES.cube}>
						<dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
							{Object.entries(sheet.counts).map(([key, value]) => (
								<div key={key}>
									<dt className="text-xs text-ink-faint">{COUNT_LABELS[key] ?? key}</dt>
									<dd className="text-lg">{value.toLocaleString("fr")}</dd>
								</div>
							))}
						</dl>
					</GamePanel>
					<GamePanel role="region" title="Écrans" watermark={GLYPHES.image}>
						<ul className="space-y-6">
							{sheet.screens.map((screen) => (
								<li key={screen.screen}>
									<ScreenRender screen={screen} />
								</li>
							))}
						</ul>
					</GamePanel>
					<GamePanel role="region" title="Composants" watermark={GLYPHES.arbre}>
						<ul className="columns-2 text-sm sm:columns-3">
							{sheet.components.map((component) => (
								<li key={component.type_name}>
									{component.type_name} · {component.count}
								</li>
							))}
						</ul>
					</GamePanel>
					<GamePanel role="region" title="Scripts" watermark={GLYPHES.livre}>
						<ul className="space-y-1 text-sm">
							{sheet.scripts.map((script) => (
								<li key={script.path}>
									<code>{script.path}</code> — {script.functions} fonctions,{" "}
									{script.instructions.toLocaleString("fr")} instructions
								</li>
							))}
						</ul>
					</GamePanel>
				</>
			) : null}
		</section>
	);
}

/**
 * Un écran et son rendu.
 *
 * L'image est demandée en `loading="lazy"` : une fiche porte jusqu'à 24 écrans, et le plus lourd
 * mesuré fait 1,2 Mio. Les charger tous d'emblée ferait payer 24 rendus pour en regarder un.
 */
function ScreenRender({ screen }: { screen: ModeScreen }) {
	const [failed, setFailed] = useState(false);
	return (
		<figure className="space-y-2">
			<figcaption className="text-sm">
				<code>{screen.screen}</code> — {screen.layers.length} calques, {screen.focus} focalisables,{" "}
				{screen.bytes.toLocaleString("fr")} o de réglages
			</figcaption>
			{failed ? (
				// Le serveur n'a pas rendu cet écran. C'est une mesure, pas un trou à combler :
				// l'afficher vide laisserait croire que l'écran est vide.
				<p className="text-sm text-ink-faint">
					Le serveur n'a pas rendu cet écran. Les fichiers qu'il liste, eux, sont là.
				</p>
			) : (
				<img
					alt={screen.screen}
					className="max-w-full rounded"
					loading="lazy"
					onError={() => setFailed(true)}
					src={`/api/v1/menu/render/${encodeURIComponent(screen.screen)}`}
				/>
			)}
		</figure>
	);
}
