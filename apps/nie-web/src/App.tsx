/**
 * The application — WebAssembly build of nie.exe.
 * Serves exclusively the real game and its authentic screens.
 */
import { creerWebSource, type AssetSource } from "@niers/asset-source";
import { type SanteApi, sante } from "@niers/asset-source/nie-site";
import {
	AssetSourceProvider,
	FournisseurNavigation,
	GameTextProvider,
	useApplySettings,
	useCapacites,
	useErreurSource,
} from "@niers/inacord-ui";
import { createStandardGamepadMenuSampler } from "@niers/inacord-ui/shell/menu-interaction";
import { useSettings } from "@niers/inacord-ui/lib/settings";
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import {
	AVATAR,
	BANK,
	CATALOGS,
	DATA,
	DOWNLOADS,
	EXPLORER,
	FORMATION,
	GALLERY,
	INACORD,
	LEGACY_ROUTES,
	MERGED_ROUTES,
	MEDIA,
	MODES,
	WIKI,
	SAVE,
	SETTINGS,
	SHOP,
	recognizedRoutes,
} from "./entries";
import type { VueCatalogue } from "@niers/asset-source";
import { useGameNavigation } from "./game/use-game-navigation";
import { StartupResources } from "./game/StartupResources";
import { useWasmReadiness } from "./game/wasm-readiness";
import { GAME_REACHABLE } from "./host";
import { Game } from "./pages/Game";
import { PlayerBank } from "./screens/PlayerBank";
import { Shop } from "./screens/Shop";
import { TrophyGallery } from "./screens/TrophyGallery";
import { SaveScreen } from "./screens/SaveScreen";
import { MyTeamScreen } from "./screens/MyTeamScreen";
import { Settings } from "./pages/Settings";
import { Avatar } from "./pages/Avatar";
import { WasmGameSurface, WASM_MODE_INDEX, type WasmMode } from "./pages/WasmGameSurface";
import { Modes } from "./pages/Modes";
import { Catalog } from "./pages/Catalog";
import { WikiCards } from "./pages/WikiCards";
import DownloadPage from "./inacord-web/DownloadPage";
import { UnifiedShell, workspaceViewOf } from "./shell/UnifiedShell";
import { createWorkspaceActions } from "./shell/workspace-actions";
import { HOME, splitLanguagePrefix } from "./routing";

import { hybridGameTextResolver } from "./game/hybrid-text-resolver";
import { initGlobalUiInteractions } from "./game/ui-sound";
import "./styles/ui-effects.css";

const Workspace = lazy(() => import("./desktop/Workspace").then(({ Workspace }) => ({ default: Workspace })));

/**
 * Hosts the authentic WebAssembly game at root and its native game screens.
 *
 * @param source the host's resource source. Absent, the browser source is built.
 */
export function App({ source }: { source?: AssetSource } = {}) {
	const resolved = useMemo(() => source ?? creerWebSource(), [source]);
	return (
		<AssetSourceProvider source={resolved}>
			<TexteDuJeu>
				<GameSite />
			</TexteDuJeu>
		</AssetSourceProvider>
	);
}

function TexteDuJeu({ children }: { children: ReactNode }) {
	const { gameLocale } = useSettings();
	return <GameTextProvider locale={gameLocale} resolver={hybridGameTextResolver}>{children}</GameTextProvider>;
}

function GameSite() {
	const gamepadSampler = useMemo(() => createStandardGamepadMenuSampler(), []);
	const capacites = useCapacites();

	useEffect(() => {
		return initGlobalUiInteractions();
	}, []);
	const erreurSource = useErreurSource();
	const [etat, setEtat] = useState<SanteApi | null>(null);
	const { ready: wasmReady, failed: wasmFailed, retry: retryWasm } = useWasmReadiness(GAME_REACHABLE);

	useApplySettings();

	const prefixe = useMemo(() => splitLanguagePrefix(window.location.pathname).prefix, []);

	const {
		view: vue,
		openingPhase,
		setOpeningPhase,
		navigate: setVue,
		navigateLink: naviguer,
	} = useGameNavigation(INITIAL_ROUTES, document.getElementById("racine")?.dataset.route);

	// Une adresse héritée mène à l'écran officiel du jeu, en remplaçant l'historique
	useEffect(() => {
		const canonical = LEGACY_ROUTES[vue];
		if (canonical && canonical !== vue) {
			setVue(canonical, undefined, { replace: true });
			return;
		}
		// Et une adresse FUSIONNÉE mène à la page qui a absorbé la sienne, avec le paramètre qui
		// ouvre la bonne surface : sans lui, `inacord/gallery` atterrirait sur la grille des
		// succès plutôt que sur la galerie qu'elle servait. Cf. `MERGED_ROUTES`.
		const merged = MERGED_ROUTES[vue];
		if (merged) {
			const url = new URL(window.location.href);
			url.pathname = `${prefixe}/${merged.route}`;
			url.search = merged.search;
			setVue(merged.route, url, { replace: true });
		}
	}, [vue, setVue, prefixe]);

	const vfs = etat?.capacites?.vfs ?? null;
	const startupReady = Boolean(
		wasmReady &&
		etat?.capacites.vfs === "pret" &&
		etat.capacites.vfs_entrees > 0 &&
		etat.capacites.vfs_contenu &&
		etat.capacites.gisement &&
		etat.capacites.anime &&
		etat.capacites.bundle
	);

	useEffect(() => {
		if (!GAME_REACHABLE || vfs === "absent") return;
		const ac = new AbortController();
		let minuteur: ReturnType<typeof setTimeout> | undefined;
		let requestActive = false;
		const delay = startupReady ? 30_000 : PERIODE_SONDE_MS;
		const sonder = () => {
			if (document.visibilityState === "hidden" || requestActive || ac.signal.aborted) return;
			if (minuteur !== undefined) {
				clearTimeout(minuteur);
				minuteur = undefined;
			}
			requestActive = true;
			sante(ac.signal)
				.then(setEtat)
				.catch(() => {})
				.finally(() => {
					requestActive = false;
					if (!ac.signal.aborted) minuteur = setTimeout(sonder, delay);
				});
		};
		sonder();
		const reprendre = () => {
			if (!ac.signal.aborted && document.visibilityState === "visible") sonder();
		};
		window.addEventListener("focus", reprendre);
		document.addEventListener("visibilitychange", reprendre);
		return () => {
			ac.abort();
			if (minuteur !== undefined) clearTimeout(minuteur);
			window.removeEventListener("focus", reprendre);
			document.removeEventListener("visibilitychange", reprendre);
		};
	}, [startupReady, vfs]);

	useEffect(() => {
		if (vue === HOME || vue === "menu") return;
		const cancel = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
			const target = event.target;
			if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"]')) return;
			if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')) return;
			event.preventDefault();
			setVue(HOME);
		};
		window.addEventListener("keydown", cancel);
		return () => window.removeEventListener("keydown", cancel);
	}, [vue, setVue]);

	const withHost = (content: ReactNode) => (
		<FournisseurNavigation naviguer={naviguer}>
			{GAME_REACHABLE ? (
				<StartupResources titleActive={vue === HOME && (openingPhase === "start" || openingPhase === "menu")} />
			) : null}
			<div className="nie-game-viewport" data-surface-owner="game" style={{ width: "100vw", height: "100vh", overflow: "hidden", position: "relative" }}>
				{content}
			</div>
		</FournisseurNavigation>
	);

	const publicWorkspaceRoute = GAME_REACHABLE && vue !== INACORD && !vue.startsWith(`${INACORD}/`);
	const actions = useMemo(
		() => createWorkspaceActions(setVue, publicWorkspaceRoute ? EXPLORER : undefined),
		[setVue, publicWorkspaceRoute],
	);

	const shell = (content: ReactNode) =>
		withHost(<UnifiedShell current={vue} onSelect={setVue}>{content}</UnifiedShell>);

	const renderGame = () => (
		<Game
			gamepadSampler={gamepadSampler}
			phase={openingPhase}
			startupReady={startupReady}
			health={etat}
			startupFailed={vfs === "absent" || wasmFailed}
			onRetryStartup={wasmFailed ? retryWasm : undefined}
			onPhaseChange={setOpeningPhase}
			onOpenBank={() => setVue(BANK)}
			onOpenGallery={() => setVue(GALLERY)}
			onOpenShop={() => setVue(SHOP)}
			onOpenAvatar={() => setVue(AVATAR)}
			onOpenSettings={() => setVue(SETTINGS)}
			onSelectMode={(mode) => setVue(mode)}
			onOpenModes={(slug) => setVue(slug ? `${MODES}/${slug}` : MODES)}
			onOpenSave={() => setVue(SAVE)}
			onOpenTeam={() => setVue(FORMATION)}
		/>
	);

	// Root `/` ou `/menu` : exécution du jeu WebAssembly authentique
	if (vue === HOME || vue === "menu") {
		return withHost(renderGame());
	}

	// Modes de jeu authentiques exécutés dans le runtime WebAssembly
	if (vue in WASM_MODE_INDEX) {
		return withHost(
			<WasmGameSurface
				mode={vue as WasmMode}
				onBack={() => setVue(HOME)}
				gamepadSampler={gamepadSampler}
			/>
		);
	}

	// Écrans authentiques du jeu (interface native plein écran, sans chrome de bureau Inacord)
	if (vue === SETTINGS) {
		return withHost(<Settings prefixe={prefixe} onRetour={() => setVue(HOME)} publicOnly={true} />);
	}
	if (vue === BANK) {
		return withHost(<PlayerBank onBack={() => setVue(HOME)} />);
	}
	if (vue === GALLERY) {
		return withHost(<TrophyGallery onBack={() => setVue(HOME)} />);
	}
	if (vue === SHOP) {
		return withHost(<Shop onBack={() => setVue(HOME)} />);
	}
	if (vue === AVATAR) {
		return withHost(<Avatar onBack={() => setVue(HOME)} gamepadSampler={gamepadSampler} />);
	}
	if (vue === SAVE) {
		return withHost(<SaveScreen onBack={() => setVue(HOME)} />);
	}
	if (vue === FORMATION) {
		return withHost(<MyTeamScreen onBack={() => setVue(HOME)} onLaunchMatch={(mode) => setVue(mode)} />);
	}

	// Téléchargements Inacord
	if (vue === DOWNLOADS) {
		return shell(<div className="inacord-downloads"><DownloadPage /></div>);
	}

	// Fiches du wiki : les cartes montées sur les routes `/api/v1/wiki/*`
	if (vue === WIKI) {
		return shell(<WikiCards />);
	}

	// Fiches et catalogue des modes de jeu
	if (vue === MODES || vue.startsWith(`${MODES}/`)) {
		return shell(<Modes prefix={prefixe} route={vue} />);
	}

	// Catalogues de médias (textures, modèles, sons, vidéos)
	if (CATALOGS.includes(vue as (typeof CATALOGS)[number]) || vue === MEDIA) {
		return shell(
			<div style={{ padding: "var(--jeu-espace-xl)", width: "100%", height: "100%", overflow: "auto" }}>
				<Catalog view={(vue === MEDIA ? "textures" : vue) as VueCatalogue} />
			</div>
		);
	}

	// Espaces de travail et outils (explorateur, éditeur 3D, recherche, données, Inacord)
	const workspaceView = workspaceViewOf(vue);
	if (workspaceView !== null) {
		return shell(
			<Suspense fallback={<div className="grid h-full place-items-center text-sm text-ink-faint">Chargement…</div>}>
				<Workspace view={workspaceView} actions={actions} publicMode={publicWorkspaceRoute} />
			</Suspense>
		);
	}

	// Toute route non reconnue renvoie vers le jeu principal
	return withHost(renderGame());
}

const INITIAL_ROUTES = recognizedRoutes(null);
const PERIODE_SONDE_MS = 2000;
