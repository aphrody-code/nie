/**
 * La Banque — l'écran `chara_bank_menu` du jeu, dans le navigateur.
 *
 * ## Ce qui vient du jeu, et ce qui vient de l'hôte
 *
 * - Le **fond, les cadres et les guides** sont le layout du jeu : `GET /api/v1/menu/layout/chara_bank_menu`
 *   rend 25 objets avec leurs 25 sprites résolus, dessinés par `LayoutRender` sans qu'une
 *   position soit corrigée ici.
 * - Les **calques et leurs états** viennent du Lua : `POST /api/v1/menu/runtime/chara_bank_menu`
 *   reçoit `itemCounts` pour la liste et `OnEnter(layer, index)` à chaque déplacement du curseur.
 * - Les **personnages** viennent de `GET /api/v1/profile/complete` — et, tant que cette route
 *   n'est pas servie, du repli typé sur `GET /api/v1/game-data/charas`, dont les stats sont
 *   déjà celles du niveau 99 (cf. `game/roster.ts`).
 * - Les **libellés et les vignettes** de la liste, de la fiche et des guides sont dessinés par
 *   l'hôte : le layout ne porte ni portrait de personnage, ni ligne de liste. Ce n'est pas une
 *   reproduction pixel à pixel, et rien ici ne le prétend (mémoire `pixel-perfect`).
 *
 * ## Les touches
 *
 * Relevées sur `data/menu/bank_character_detail.png` : `Alt` ouvre le filtre, `X` cherche par
 * nom de joueur, `V` cache les stats, `Tab` change le tri, `Échap` revient. Aucun guide n'est
 * dessiné sans son gestionnaire — `GameHintBar` les branche tous les cinq.
 */
import {
	GameFilterPanel,
	GameHintBar,
	GameSearchBar,
	type GameFilterFamily,
	type GameFilterValue,
	GameCanvas,
	LayoutRender,
	useAssetSource,
} from "@niers/inacord-ui";
import { lireLayout, type LayoutJeu } from "@niers/inacord-ui/shell/game-layout";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createMenuRuntime, type MenuRuntimeResult } from "../game/menu-runtime";
import {
	filterRoster,
	moveCursor,
	PROFILE_LEVEL,
	ROSTER_STATS,
	rosterFamilies,
	rosterFromCharas,
	rosterPage,
	type RosterChara,
	type RosterEntry,
	type RosterFilter,
} from "../game/roster";
import { NativeText } from "../pages/NativeText";
import "./player-bank.css";

/** L'écran du jeu dont cette page est la reproduction. */
const SCREEN = "chara_bank_menu";

/**
 * La grille : 6 colonnes sur 4 rangées, mesurées sur `data/menu/bank_character_detail.png`.
 *
 * C'est aussi le `itemCounts` envoyé au Lua : la liste native ne connaît que les éléments de sa
 * page, et lui en annoncer 6 101 décrirait un état que le jeu n'a jamais.
 */
const COLUMNS = 6;
const ROWS = 4;
const PAGE_SIZE = COLUMNS * ROWS;

/** CRC-32 d'un nom de calque : `layer_id == crc32(nom)` dans les scènes du menu. */
function crc32(value: string): number {
	let crc = 0xffffffff;
	for (const byte of new TextEncoder().encode(value)) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/** Le calque de la liste de la banque, tel que le layout le nomme. */
const LIST_LAYER = crc32("team14_01_chara_bank_list");

/** Le layout de l'écran, validé par `lireLayout` — un JSON mal formé échoue bruyamment. */
async function loadLayout(signal: AbortSignal): Promise<LayoutJeu> {
	const response = await fetch(`/api/v1/menu/layout/${SCREEN}`, { signal, headers: { accept: "application/json" } });
	if (!response.ok) throw new Error("Layout unavailable");
	return lireLayout(await response.json());
}

/** Une réponse de `/api/v1/game-data/charas`, vérifiée avant d'être liée à la liste. */
function readCharas(value: unknown): RosterChara[] {
	if (!Array.isArray(value)) throw new Error("charas: not an array");
	return value.filter((row): row is RosterChara =>
		Boolean(row) && typeof row === "object"
		&& typeof (row as RosterChara).chara_param_id === "string"
		&& typeof (row as RosterChara).name === "string"
		&& Boolean((row as RosterChara).stats));
}

/**
 * Le vivier : le profil complet s'il est servi, le repli typé sinon.
 *
 * `/api/v1/profile/complete` répond `404` tant que la route n'est pas déployée. Ce n'est pas
 * une panne à afficher : la même mesure existe sur `game-data/charas`, et l'origine retenue est
 * portée par chaque entrée (`origin`) plutôt que devinée par l'écran.
 */
async function loadRoster(signal: AbortSignal): Promise<RosterEntry[]> {
	const profile = await fetch("/api/v1/profile/complete", { signal, headers: { accept: "application/json" } })
		.catch(() => null);
	if (profile?.ok) {
		const body = await profile.json() as { charas?: unknown };
		const charas = Array.isArray(body?.charas) ? readCharas(body.charas) : [];
		if (charas.length > 0) {
			return charas.map((chara) => ({
				chara, level: PROFILE_LEVEL, stats: chara.stats, skills: chara.skills, origin: "profile" as const,
			}));
		}
	}
	const response = await fetch("/api/v1/game-data/charas", { signal, headers: { accept: "application/json" } });
	if (!response.ok) throw new Error("Roster unavailable");
	return rosterFromCharas(readCharas(await response.json()));
}

export interface PlayerBankProps {
	/** `Échap` et le bouton de retour : le menu principal. */
	onBack: () => void;
}

export function PlayerBank({ onBack }: PlayerBankProps) {
	// Le portrait n'est pas dans le layout : la source de l'hôte le résout, ou rien ne s'affiche.
	const face = useAssetSource().urlTexture;
	const [layout, setLayout] = useState<LayoutJeu | null>(null);
	const [layoutFailed, setLayoutFailed] = useState(false);
	const [entries, setEntries] = useState<readonly RosterEntry[] | null>(null);
	const [rosterFailed, setRosterFailed] = useState(false);
	const [filter, setFilter] = useState<RosterFilter>({});
	const [search, setSearch] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const [filterOpen, setFilterOpen] = useState(false);
	const [hideStats, setHideStats] = useState(false);
	const [byName, setByName] = useState(false);
	const [cursor, setCursor] = useState(0);
	const [runtimeState, setRuntimeState] = useState<"loading" | "observed" | "partial" | "unavailable">("loading");
	const [runtime, setRuntime] = useState<MenuRuntimeResult | null>(null);
	const [textures, setTextures] = useState({ loaded: 0, total: 0 });
	const seen = useRef(new Set<string>());

	useEffect(() => {
		const controller = new AbortController();
		loadLayout(controller.signal).then(setLayout, () => { if (!controller.signal.aborted) setLayoutFailed(true); });
		loadRoster(controller.signal).then(setEntries, () => { if (!controller.signal.aborted) setRosterFailed(true); });
		return () => controller.abort();
	}, []);

	const session = useMemo(
		() => createMenuRuntime(SCREEN, { locale: "fr", itemCounts: { [LIST_LAYER]: PAGE_SIZE } }),
		[],
	);
	const receive = useCallback((result: MenuRuntimeResult) => {
		setRuntime(result);
		setRuntimeState(result.complete ? "observed" : "partial");
	}, []);
	useEffect(() => {
		session.replay([]).then(receive, () => setRuntimeState("unavailable"));
		return () => session.abort();
	}, [session, receive]);

	const retained = useMemo(() => {
		const list = filterRoster(entries ?? [], filter, search);
		return byName ? [...list].sort((a, b) => a.chara.name.localeCompare(b.chara.name, "fr")) : list;
	}, [entries, filter, search, byName]);
	const page = useMemo(() => rosterPage(retained, cursor, PAGE_SIZE), [retained, cursor]);
	const focused = page.cursor >= 0 ? retained[page.cursor] ?? null : null;

	// Le Lua reçoit chaque changement de curseur : c'est lui qui décide de l'état de la liste.
	useEffect(() => {
		if (page.cursorInPage < 0 || !session.snapshot?.callbacks.includes("OnEnter")) return;
		session.dispatch({ callback: "OnEnter", args: [LIST_LAYER, page.cursorInPage] })
			.then(receive, () => { /* une frappe superseded n'est pas une panne */ });
	}, [session, receive, page.cursorInPage]);

	const move = useCallback((step: "item" | "row" | "page", direction: 1 | -1) => {
		setCursor((current) => moveCursor(current, retained.length, step, direction, COLUMNS, PAGE_SIZE));
	}, [retained.length]);

	// Les flèches et Échap : la navigation de la grille, hors des dialogues.
	useEffect(() => {
		if (filterOpen) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
			const target = event.target;
			const editing = target instanceof HTMLElement && (target.tagName === "INPUT" || target.isContentEditable);
			if (event.key === "Escape") {
				event.preventDefault();
				if (searchOpen) { setSearchOpen(false); setSearch(""); return; }
				onBack();
				return;
			}
			if (editing) return;
			const moves: Record<string, [("item" | "row" | "page"), 1 | -1] | undefined> = {
				ArrowRight: ["item", 1], ArrowLeft: ["item", -1],
				ArrowDown: ["row", 1], ArrowUp: ["row", -1],
				w: ["page", -1], c: ["page", 1], PageUp: ["page", -1], PageDown: ["page", 1],
			};
			const step = moves[event.key];
			if (step) { event.preventDefault(); move(step[0], step[1]); }
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [move, onBack, filterOpen, searchOpen]);

	const families = useMemo<readonly GameFilterFamily[]>(
		() => rosterFamilies(entries ?? []).map((family) => ({
			id: family.id,
			label: family.label,
			icon: family.label.slice(0, 1),
			mode: "multi" as const,
			options: family.options.map((option) => ({ value: option.value, label: option.value, count: option.count })),
		})),
		[entries],
	);

	const onTexture = useCallback((name: string, loaded: boolean) => {
		if (seen.current.has(name)) return;
		seen.current.add(name);
		setTextures((current) => ({ loaded: current.loaded + (loaded ? 1 : 0), total: current.total + 1 }));
	}, []);

	const hints = useMemo(() => [
		{ key: "Tab", keyLabel: "Tab", label: byName ? "Par nom" : "Par acquisition", onActivate: () => setByName((v) => !v) },
		{ key: "v", keyLabel: "V", label: hideStats ? "Afficher les stats" : "Cacher les stats", onActivate: () => setHideStats((v) => !v) },
		{ key: "x", keyLabel: "X", label: "Chercher par nom de joueur", onActivate: () => setSearchOpen(true) },
		{ key: "Alt", keyLabel: "Alt", label: `Filtre : ${Object.values(filter).some((v) => v.length > 0) ? "ON" : "OFF"}`, onActivate: () => setFilterOpen(true) },
		{ key: "Escape", keyLabel: "Esc", label: "Retour", onActivate: onBack, fromInputs: true },
	], [byName, hideStats, filter, onBack]);

	return (
		<section
			className="player-bank"
			aria-label="Banque"
			data-screen={SCREEN}
			data-render-source="vfs-layout"
			data-lua-observation={runtimeState}
			data-runtime-layers={runtime ? Object.keys(runtime.scene.layers).length : 0}
			data-layout-objects={layout?.objects.length ?? 0}
			data-textures={`${textures.loaded}/${textures.total}`}
			data-roster={entries?.length ?? 0}
			data-retained={retained.length}
			data-origin={entries?.[0]?.origin ?? "none"}
		>
			<GameCanvas canvas={layout?.canvas ?? { w: 1280, h: 720 }}>
				{layout ? (
					<LayoutRender layout={layout} visiblesSeules={false} onTexture={onTexture} />
				) : null}

				<header className="player-bank__title">
					<NativeText text="Banque" height={28} />
				</header>

				<div className="player-bank__grid" role="listbox" aria-label="Personnages de la banque" aria-activedescendant={focused ? `bank-item-${focused.chara.chara_param_id}` : undefined}>
					{page.items.map((entry, index) => {
						const active = index === page.cursorInPage;
						return (
							<button
								key={entry.chara.chara_param_id}
								id={`bank-item-${entry.chara.chara_param_id}`}
								type="button"
								role="option"
								aria-selected={active}
								data-state={active ? "focused" : "idle"}
								className="player-bank__card"
								onClick={() => setCursor(page.index * PAGE_SIZE + index)}
							>
								{face ? (
									<img
										className="player-bank__face"
										alt=""
										loading="lazy"
										src={face(`data/dx11/chara/face/${entry.chara.internal_code}.g4tx`)}
										onError={(event) => { event.currentTarget.style.visibility = "hidden"; }}
									/>
								) : null}
								<span className="player-bank__level">Nv. {entry.level}</span>
								<span className="player-bank__name">{entry.chara.name}</span>
								<span className="player-bank__tags">{entry.chara.element} · {entry.chara.main_position}</span>
							</button>
						);
					})}
					{page.items.length === 0 ? <p className="player-bank__empty">{rosterFailed ? "La banque est indisponible." : entries ? "Aucun personnage retenu." : "Chargement…"}</p> : null}
				</div>

				<footer className="player-bank__counts">
					<span>Disponibles : {retained.length}</span>
					<span>Page {page.index + 1} / {page.count}</span>
					{layoutFailed ? <span role="alert">Le layout du jeu est indisponible.</span> : null}
				</footer>

				<aside className="player-bank__detail" aria-label="Fiche du personnage">
					{focused ? (
						<>
							<h2 className="player-bank__detail-name">{focused.chara.name}</h2>
							<p className="player-bank__detail-tags">
								{focused.chara.element} · {focused.chara.main_position}
								{focused.chara.sub_position && focused.chara.sub_position !== focused.chara.main_position ? ` / ${focused.chara.sub_position}` : ""}
								{focused.chara.team ? ` · ${focused.chara.team}` : ""}
							</p>
							<p className="player-bank__detail-level">Niv. {focused.level}</p>
							{focused.chara.description ? <p className="player-bank__detail-desc">{focused.chara.description}</p> : null}
							{hideStats ? null : (
								<dl className="player-bank__stats">
									{ROSTER_STATS.map((stat) => (
										<div key={stat.key}>
											<dt>{stat.label}</dt>
											<dd>{focused.stats[stat.key]}</dd>
										</div>
									))}
									<div><dt>Total</dt><dd>{focused.stats.total}</dd></div>
								</dl>
							)}
							<ul className="player-bank__skills">
								{focused.skills.map((skill) => <li key={skill}>{skill}</li>)}
							</ul>
						</>
					) : null}
				</aside>

				{searchOpen ? (
					<div className="player-bank__search">
						<GameSearchBar value={search} onChange={setSearch} placeholder="Nom de joueur" autoFocus />
					</div>
				) : null}

				{filterOpen ? (
					<GameFilterPanel
						className="player-bank__filters"
						families={families}
						value={filter}
						count={retained.length}
						total={entries?.length ?? 0}
						countUnit="personnages"
						onConfirm={(value: GameFilterValue) => { setFilter(value); setCursor(0); setFilterOpen(false); }}
						onClose={() => setFilterOpen(false)}
					/>
				) : null}
			</GameCanvas>

			<GameHintBar className="player-bank__hints" hints={hints} enabled={!filterOpen} />
		</section>
	);
}
