/**
 * The application — one route state, one shell, one product.
 *
 * ## What was merged here, on 2026-09-12
 *
 * nie and Inacord were two frontends in one repository. The site owned `/` and the catalogues;
 * the workspace owned `/inacord`, and behind that route it mounted a SECOND application with its
 * own sidebar, top bar, command palette, toaster, current-view state and address-bar writer. A
 * game screen could not reach a tool; a tool reached a game screen by reloading the whole page;
 * `Ctrl+K` existed on one half of the product and not the other; and two Tailwind entry sheets
 * fought over the same sixty design tokens, so the palette depended on which screen you had
 * visited first.
 *
 * There is now one route state (`useGameNavigation`), one shell (`shell/UnifiedShell`), one
 * stylesheet (`app.css`) and one host adapter that provides the resource source. The workspace is
 * a screen of this application, lazily loaded like any other heavy screen — not an application.
 *
 * ## What is deliberately NOT framed by the shell
 *
 * The game, at `/`. It owns the whole viewport: a sidebar over the title screen would be the site
 * talking over the thing the site exists for.
 */
import { creerWebSource, type AssetSource, type VueCatalogue } from "@niers/asset-source";
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
import { useTheme } from "next-themes";
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { AVATAR, BANK, DOWNLOADS, EXPLORER, GALLERY, INACORD, LEGACY_ROUTES, MEDIA, MODES, SETTINGS, SHOP, canonicalRoute, recognizedRoutes } from "./entries";
import { useGameNavigation } from "./game/use-game-navigation";
import { StartupResources } from "./game/StartupResources";
import { GAME_REACHABLE } from "./host";
import { Modes } from "./pages/Modes";
import { Catalog } from "./pages/Catalog";
import { Avatar } from "./pages/Avatar";
import { Notice } from "./pages/screen-parts";
import { UnifiedShell, workspaceViewOf } from "./shell/UnifiedShell";
import { createWorkspaceActions, workspaceRoute } from "./shell/workspace-actions";
import { Game } from "./pages/Game";
import { PlayerBank } from "./screens/PlayerBank";
import { Shop } from "./screens/Shop";
import { TrophyGallery } from "./screens/TrophyGallery";
import { Settings } from "./pages/Settings";
import DownloadPage from "./inacord-web/DownloadPage";
import { HOME, splitLanguagePrefix } from "./routing";

/**
 * The workspace views, loaded on first opening.
 *
 * The site's entry bundle must not carry Monaco, the 3D viewport, the video decoder and the forge
 * because the product also contains them. This is the one boundary the merge keeps from the old
 * two-application split — it is a loading decision, not a navigation one.
 */
const Workspace = lazy(() => import("./desktop/Workspace").then(({ Workspace }) => ({ default: Workspace })));

/**
 * Hosts the real startup/game at root and the shared workspace on every other route.
 *
 * @param source the host's resource source. Absent, the browser source is built — which is what a
 * test mounting `<App />` alone, and the page itself, both want.
 */
export function App({ source }: { source?: AssetSource } = {}) {
	// La source ne dépend d'aucun état : la mémoriser évite de relancer la mesure des capacités
	// à chaque rendu.
	const resolved = useMemo(() => source ?? creerWebSource(), [source]);
	return (
		<AssetSourceProvider source={resolved}>
			<TexteDuJeu>
				<Site />
			</TexteDuJeu>
		</AssetSourceProvider>
	);
}

/**
 * Charge, une fois, la ligne du jeu de chaque libellé que le jeu écrit lui aussi.
 *
 * Ici et pas dans `Site` parce que le catalogue doit survivre aux changements d'écran : une
 * requête par navigation ferait clignoter les libellés à chaque aller-retour. Le lot entier tient
 * dans UNE requête GraphQL (`packages/inacord-ui/src/lib/game-text.ts`), et tant qu'elle n'a pas
 * répondu chaque composant affiche le texte écrit dans son code — donc rien n'attend le réseau.
 */
function TexteDuJeu({ children }: { children: ReactNode }) {
	const { gameLocale } = useSettings();
	return <GameTextProvider locale={gameLocale}>{children}</GameTextProvider>;
}

/** One current route and opening state; returning from a tool resumes its main menu. */
function Site() {
	const gamepadSampler = useMemo(() => createStandardGamepadMenuSampler(), []);
	const capacites = useCapacites();
	const erreurSource = useErreurSource();
	const [etat, setEtat] = useState<SanteApi | null>(null);

	// Les réglages d'apparence (thème, densité, mouvement, taille du texte, zoom) prennent
	// effet sur `<html>` dès ici, sur TOUS les écrans — un réglage enregistré qui ne change
	// rien serait un défaut, et l'écran des Options ne doit pas être le seul à le voir.
	useApplySettings();

	// ONE theme owner: the settings store. next-themes keeps painting the `light`/`dark` class the
	// Inacord palette reads, but it no longer decides anything — before this, its own default
	// ("dark") and the store's ("system") were two writers on the same `<html>`, and merely opening
	// the Options screen adopted next-themes' value into the store, flipping the whole product to
	// dark for good. Measured on 2026-09-12: `/settings` then `/medias` came back dark.
	const { setTheme } = useTheme();
	const { theme } = useSettings();
	useEffect(() => {
		setTheme(theme);
	}, [theme, setTheme]);

	// Le prefixe de langue de l'URL courante. Il ne change pas pendant la session : changer de
	// langue est une navigation entiere, servie par nie-site, pas un changement d'etat local.
	const prefixe = useMemo(() => splitLanguagePrefix(window.location.pathname).prefix, []);

	const {
		view: vue,
		openingPhase,
		setOpeningPhase,
		navigate: setVue,
		navigateLink: naviguer,
	} = useGameNavigation(INITIAL_ROUTES, document.getElementById("racine")?.dataset.route);
	const actions = useMemo(() => createWorkspaceActions(setVue), [setVue]);

	// Une adresse héritée mène à l'écran, puis s'efface : `/avatar` ouvre `chara_edit_menu` et
	// l'URL devient celle du jeu, en REMPLAÇANT l'entrée d'historique — un « précédent » qui
	// ramènerait sur l'ancienne adresse la ferait rediriger encore, en boucle.
	useEffect(() => {
		const canonical = LEGACY_ROUTES[vue];
		if (canonical) setVue(canonical, undefined, { replace: true });
	}, [vue, setVue]);

	// L'index du VFS se monte EN FOND côté serveur (`EtatSite::monter_vfs_en_fond`) : au premier
	// appel il répond `en_cours`. Une sonde unique fige donc l'écran d'attente pour toujours —
	// le site n'apprendrait jamais que le catalogue est devenu joignable. On resonde tant que
	// l'état n'est pas tranché, et on s'arrête dès qu'il l'est (`pret` comme `absent`).
	const vfs = etat?.capacites?.vfs ?? null;
	const startupReady = Boolean(
		etat?.capacites.vfs === "pret" &&
		etat.capacites.vfs_entrees > 0 &&
		etat.capacites.vfs_contenu &&
		etat.capacites.gisement &&
		etat.capacites.anime &&
		etat.capacites.bundle
	);
	useEffect(() => {
		// `sante()` reads the HTTP origin that serves the site. The native window has none: polling
		// it there would retry a rejected promise every two seconds, forever, for a screen that is
		// not drawn.
		if (!GAME_REACHABLE || startupReady || vfs === "absent") return;
		const ac = new AbortController();
		let minuteur: ReturnType<typeof setTimeout> | undefined;
		const sonder = () => {
			sante(ac.signal)
				.then(setEtat)
				.catch(() => {
					/* l'erreur est déjà portée par le fournisseur */
				})
				.finally(() => {
					if (!ac.signal.aborted) minuteur = setTimeout(sonder, PERIODE_SONDE_MS);
				});
		};
		sonder();
		return () => {
			ac.abort();
			if (minuteur !== undefined) clearTimeout(minuteur);
		};
	}, [startupReady, vfs]);

	// Le catalogue est-il consultable ? `capacites` vaut `null` tant que la mesure court : on
	// distingue « on ne sait pas encore » de « rien ne marche », au lieu d'afficher des vues
	// vides pendant la premiere seconde.
	const pret = Boolean(capacites?.vfs);
	const withHost = (content: ReactNode) => <FournisseurNavigation naviguer={naviguer}>
		{GAME_REACHABLE ? (
			<StartupResources titleActive={vue === HOME && (openingPhase === "start" || openingPhase === "menu")} />
		) : null}
		{content}
	</FournisseurNavigation>;

	// Route changes may unmount Game, but the opening state belongs to this persistent host.
	if (vue === HOME && GAME_REACHABLE) {
		return withHost(
			<Game
				gamepadSampler={gamepadSampler}
				phase={openingPhase}
				startupReady={startupReady}
				health={etat}
				startupFailed={vfs === "absent"}
				onPhaseChange={setOpeningPhase}
				onOpenBank={() => setVue(BANK)}
				onOpenGallery={() => setVue(GALLERY)}
				onOpenShop={() => setVue(SHOP)}
				onOpenAvatar={() => setVue(AVATAR)}
				onOpenSettings={() => setVue(SETTINGS)}
				onOpenMedia={() => setVue(MEDIA)}
				onOpenModes={() => setVue(MODES)}
				onOpenExplorer={() => setVue(EXPLORER)}
				onOpenInacord={() => setVue(INACORD)}
			/>
		);
	}

	// Inside the native window there is no game at `/`: the root opens the workspace, on the
	// Explorer, which is what the desktop application has always opened on.
	const route = vue === HOME ? workspaceRoute("explorer") : vue;

	// Every screen but the game is framed by the ONE shell: the sidebar, its collapse state, the
	// top bar, the command palette and the notifications.
	const shell = (content: ReactNode) =>
		withHost(<UnifiedShell current={route} onSelect={setVue}>{content}</UnifiedShell>);

	// The Options screen is the game's, and it already carries the workspace's own tool actions
	// (`pages/Settings.tsx`). `/inacord/settings` is therefore the same screen, not a second one.
	if (route === SETTINGS || route === workspaceRoute("settings")) {
		return shell(<Settings prefixe={prefixe} onRetour={() => setVue(HOME)} />);
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

	// Les modes portent leur fiche dans le chemin : `/modes` liste, `/modes/<slug>` ouvre.
	// La page lit le slug elle-meme, ce qui evite d'inscrire les douze slugs du serveur ici.
	if (route === MODES || route.startsWith(`${MODES}/`)) {
		return shell(<Modes prefix={prefixe} route={route} />);
	}

	// The Explorer is ONE implementation. `/explorateur` and the two URLs inherited from the
	// screens it absorbed (`/recherche`, `/donnees`) open the workspace's Explorer, the mature one
	// — tabs, pins, thumbnails, context menus, mod staging — instead of the reduced copy the site
	// used to carry beside it.
	const workspaceView = workspaceViewOf(route);
	if (workspaceView !== null) {
		return shell(
			<Suspense fallback={<div className="grid h-full place-items-center text-sm text-ink-faint">Ouverture de la vue…</div>}>
				<Workspace view={workspaceView} actions={actions} />
			</Suspense>
		);
	}

	return shell(
			<div style={{ padding: "var(--jeu-espace-xl)" }}>
				{erreurSource ? (
					// Le detail technique de la panne ne s'affiche pas : il ne dit rien a qui consulte
					// le site, et le seul geste utile — reessayer — ne depend pas de lui.
					<Notice tone="alerte">
						Le site ne parvient pas à joindre ses ressources. Réessayez dans un instant.
					</Notice>
				) : !capacites || vfs === null || vfs === "en_cours" ? (
					<Notice>Chargement…</Notice>
				) : !pret ? (
					<Notice>
						Le catalogue est en cours de préparation. Il s'affichera dès qu'il sera prêt.
					</Notice>
				) : (
					// `/medias` et les quatre URL heritees menent toutes ici. La seconde arrive sur
					// SA vue ; la premiere, qui n'en designe aucune, ouvre sur les textures — le
					// catalogue le plus large (54 203 fichiers) et le seul dont la grille montre
					// quelque chose sans qu'on ait rien reglé.
					<Catalog view={(route === MEDIA ? "textures" : route) as VueCatalogue} />
				)}
			</div>
	);
}

/**
 * Les entrées reconnues au tout premier rendu, avant la réponse du serveur.
 *
 * Elles servent à lire l'URL d'arrivée : sans elles, ouvrir `/textures` directement afficherait
 * l'accueil le temps d'un aller-retour réseau, puis basculerait — un saut visible qu'aucune
 * donnée ne justifie.
 */
const INITIAL_ROUTES = recognizedRoutes(null);

/**
 * Période entre deux sondes de `/api/v1/health`, tant que le VFS n'est pas tranché.
 *
 * Deux secondes : assez court pour que la bascule vers le menu ne se fasse pas attendre, assez
 * long pour qu'une attente de plusieurs minutes ne représente que quelques dizaines de requêtes
 * sur une route qui ne lit qu'un état déjà en mémoire.
 */
const PERIODE_SONDE_MS = 2000;
