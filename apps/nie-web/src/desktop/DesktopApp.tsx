/**
 * Inacord Desktop Application — authoring, reverse engineering, and VFS workspace.
 * Kept exclusively for desktop / dev builds (mode === 'desktop').
 */
import type { AssetSource, VueCatalogue } from "@nie/asset-source";
import { creerDesktopSource } from "./lib/desktop-source";
import { type SanteApi, sante } from "@nie/asset-source/nie-site";
import {
	AssetSourceProvider,
	FournisseurNavigation,
	GameTextProvider,
	useApplySettings,
	useCapacites,
	useErreurSource,
} from "@nie/inacord-ui";
import { createStandardGamepadMenuSampler } from "@nie/inacord-ui/shell/menu-interaction";
import { useSettings } from "@nie/inacord-ui/lib/settings";
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import {
	AVATAR,
	BANK,
	DOWNLOADS,
	EXPLORER,
	GALLERY,
	INACORD,
	LEGACY_ROUTES,
	MEDIA,
	MEDIA_LANDING,
	MODES,
	SETTINGS,
	SHOP,
	recognizedRoutes,
} from "../entries";
import { useGameNavigation } from "../game/use-game-navigation";
import { StartupResources } from "../game/StartupResources";
import { useWasmReadiness } from "../game/wasm-readiness";
import { GAME_REACHABLE } from "../host";
import { Modes } from "../pages/Modes";
import { Catalog } from "../pages/Catalog";
import { Avatar } from "../pages/Avatar";
import { ScreenStatus } from "../pages/screen-parts";
import { UnifiedShell, workspaceViewOf } from "../shell/UnifiedShell";
import { createWorkspaceActions, workspaceRoute } from "../shell/workspace-actions";
import { Game } from "../pages/Game";
import { PlayerBank } from "../screens/PlayerBank";
import { Shop } from "../screens/Shop";
import { TrophyGallery } from "../screens/TrophyGallery";
import { CinemaView } from "./components/CinemaView";
import { Settings } from "../pages/Settings";
import DownloadPage from "../inacord-web/DownloadPage";
import { HOME, splitLanguagePrefix } from "../routing";

const Workspace = lazy(() => import("./Workspace").then(({ Workspace }) => ({ default: Workspace })));

export function DesktopApp({ source }: { source?: AssetSource } = {}) {
	const { gameDir } = useSettings();
	const resolved = useMemo(() => source ?? (creerDesktopSource ? creerDesktopSource(gameDir) : ({} as AssetSource)), [source, gameDir]);
	return (
		<AssetSourceProvider source={resolved}>
			<TexteDuJeu>
				<DesktopSite />
			</TexteDuJeu>
		</AssetSourceProvider>
	);
}

function TexteDuJeu({ children }: { children: ReactNode }) {
	const { gameLocale } = useSettings();
	return <GameTextProvider locale={gameLocale}>{children}</GameTextProvider>;
}

function DesktopSite() {
	const gamepadSampler = useMemo(() => createStandardGamepadMenuSampler(), []);
	const capacites = useCapacites();
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
	const publicWorkspaceRoute = GAME_REACHABLE && vue !== INACORD && !vue.startsWith(`${INACORD}/`);
	const actions = useMemo(
		() => createWorkspaceActions(setVue, publicWorkspaceRoute ? EXPLORER : undefined),
		[setVue, publicWorkspaceRoute],
	);

	useEffect(() => {
		const canonical = LEGACY_ROUTES[vue];
		if (canonical) setVue(canonical, undefined, { replace: true });
	}, [vue, setVue]);

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
		const delay = startupReady ? 30_000 : 2000;
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

	const pret = Boolean(capacites?.vfs);
	const withHost = (content: ReactNode) => (
		<FournisseurNavigation naviguer={naviguer}>
			{GAME_REACHABLE ? (
				<StartupResources titleActive={vue === HOME && (openingPhase === "start" || openingPhase === "menu")} />
			) : null}
			{content}
		</FournisseurNavigation>
	);

	if (vue === HOME && GAME_REACHABLE) {
		return withHost(
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
			/>
		);
	}

	const route = vue === HOME ? workspaceRoute("explorer") : vue;
	const shell = (content: ReactNode) =>
		withHost(<UnifiedShell current={route} onSelect={setVue}>{content}</UnifiedShell>);

	if (route === SETTINGS || route === workspaceRoute("settings")) {
		return shell(<Settings prefixe={prefixe} onRetour={() => setVue(HOME)} publicOnly={route === SETTINGS} />);
	}
	if (route === BANK) {
		return shell(<PlayerBank onBack={() => setVue(HOME)} />);
	}
	if (route === GALLERY) {
		return shell(<TrophyGallery onBack={() => setVue(HOME)} />);
	}
	if (route === SHOP) {
		return shell(<Shop onBack={() => setVue(HOME)} />);
	}
	if (route === AVATAR) {
		return shell(<Avatar onBack={() => setVue(HOME)} gamepadSampler={gamepadSampler} />);
	}
	if (route === DOWNLOADS) {
		return shell(<div className="inacord-downloads"><DownloadPage /></div>);
	}
	if (route === MEDIA) {
		return shell(<CinemaView />);
	}
	if (route === MODES || route.startsWith(`${MODES}/`)) {
		return shell(<Modes prefix={prefixe} route={route} />);
	}

	const workspaceView = workspaceViewOf(route);
	if (workspaceView !== null) {
		return shell(
			<Suspense fallback={<div className="grid h-full place-items-center text-sm text-ink-faint">Ouverture de la vue…</div>}>
				<Workspace view={workspaceView} actions={actions} publicMode={publicWorkspaceRoute} />
			</Suspense>
		);
	}

	return shell(
		<div style={{ padding: "var(--jeu-espace-xl)" }}>
			{erreurSource ? (
				<ScreenStatus state="unavailable" />
			) : !capacites || vfs === null || vfs === "en_cours" ? (
				<ScreenStatus state="loading" />
			) : !pret ? (
				<ScreenStatus state="loading" />
			) : (
				<Catalog view={(route === MEDIA ? "textures" : route) as VueCatalogue} />
			)}
		</div>
	);
}

const INITIAL_ROUTES = recognizedRoutes(null);
