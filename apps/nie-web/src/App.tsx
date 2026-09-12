import { creerWebSource, type VueCatalogue } from "@niers/asset-source";
import { type SanteApi, sante } from "@niers/asset-source/nie-site";
import {
	AssetSourceProvider,
	FournisseurNavigation,
	useApplySettings,
	useCapacites,
	useErreurSource,
} from "@niers/inacord-ui";
import "@niers/inacord-ui/shell/game-tokens.css";
// Les classes `game-*` des écrans du jeu (Options, filtres), engendrées depuis les captures.
import "@niers/inacord-ui/shell/game-screens.css";
import { createStandardGamepadMenuSampler } from "@niers/inacord-ui/shell/menu-interaction";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ALIAS, AVATAR, DOWNLOADS, EXPLORER, INACORD, MEDIA, SETTINGS, recognizedRoutes } from "./entries";
import { useGameNavigation } from "./game/use-game-navigation";
import { StartupResources } from "./game/StartupResources";
import { Catalog } from "./pages/Catalog";
import { Avatar } from "./pages/Avatar";
import { Notice, SecondaryScreen } from "./pages/SecondaryScreen";
import { ExplorerInacord } from "./pages/ExplorerInacord";
import { Game } from "./pages/Game";
import { Settings } from "./pages/Settings";
import { Inacord } from "./pages/Inacord";
import { HOME, splitLanguagePrefix } from "./routing";

/** Hosts the real startup/game at root and the shared catalogue UI on explicit tool routes. */
export function App() {
	// La source ne dépend d'aucun état : la mémoriser évite de relancer la mesure des capacités
	// à chaque rendu.
	const source = useMemo(() => creerWebSource(), []);
	return (
		<AssetSourceProvider source={source}>
			<Site />
		</AssetSourceProvider>
	);
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
		if (startupReady || vfs === "absent") return;
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
		<StartupResources titleActive={vue === HOME && (openingPhase === "start" || openingPhase === "menu")} />
		{content}
	</FournisseurNavigation>;

	// Route changes may unmount Game, but the opening state belongs to this persistent host.
	if (vue === HOME) {
		return withHost(
			<Game
				gamepadSampler={gamepadSampler}
				phase={openingPhase}
				startupReady={startupReady}
				health={etat}
				startupFailed={vfs === "absent"}
				onPhaseChange={setOpeningPhase}
				onOpenAvatar={() => setVue(AVATAR)}
				onOpenSettings={() => setVue(SETTINGS)}
				onOpenMedia={() => setVue(MEDIA)}
				onOpenExplorer={() => setVue(EXPLORER)}
				onOpenInacord={() => setVue(INACORD)}
			/>
		);
	}

	// Settings and the secondary shell keep their Return controls available during VFS startup.
	if (vue === SETTINGS) {
		return withHost(<Settings prefixe={prefixe} onRetour={() => setVue(HOME)} />);
	}
	if (vue === AVATAR) {
		return withHost(<Avatar onBack={() => setVue(HOME)} gamepadSampler={gamepadSampler} />);
	}
	if (vue === INACORD || vue === DOWNLOADS) {
		return withHost(<Inacord view={vue} onHome={() => setVue(HOME)} onSelect={setVue} />);
	}
	if (vue === EXPLORER || (ALIAS as readonly string[]).includes(vue)) {
		return withHost(<ExplorerInacord onHome={() => setVue(HOME)} />);
	}

	return withHost(
			<SecondaryScreen currentView={vue} onSelect={setVue} health={etat}>
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
					<Catalog view={(vue === MEDIA ? "textures" : vue) as VueCatalogue} />
				)}
			</SecondaryScreen>
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
