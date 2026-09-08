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
import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { ALIAS, AVATAR, EXPLORER, MEDIA, MENU, SETTINGS, recognizedRoutes } from "./entries";
import { Catalog } from "./pages/Catalog";
import { Loading } from "./pages/Loading";
import { Avatar } from "./pages/Avatar";
import { Notice, SecondaryScreen } from "./pages/SecondaryScreen";
import { Explorateur } from "./pages/Explorer";
import { Jeu } from "./pages/Game";
import { MenuPrincipal } from "./pages/MainMenu";
import { Settings } from "./pages/Settings";
import { HOME, pathForEntry, requestedEntry, splitLanguagePrefix } from "./routing";

/**
 * Coquille de nie.
 *
 * L'hôte n'a qu'un rôle : construire sa source et la monter. Tout le reste vient de
 * `@niers/inacord-ui` — la même interface que celle d'Inacord, dans la DA du menu principal du
 * jeu. C'est le point de la manœuvre.
 */
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

/**
 * L'application : une entrée courante, un écran.
 *
 * Il n'y a plus qu'UNE coquille. L'accueil est le menu principal reconstruit, les autres écrans
 * sont le même décor avec la rangée d'entrées réduite à une barre — voir `pages/SecondaryScreen.tsx` pour
 * ce que cette unification a remplacé.
 */
function Site() {
	const capacites = useCapacites();
	const erreurSource = useErreurSource();
	const [etat, setEtat] = useState<SanteApi | null>(null);
	const [playing, setPlaying] = useState(false);

	// Les réglages d'apparence (thème, densité, mouvement, taille du texte, zoom) prennent
	// effet sur `<html>` dès ici, sur TOUS les écrans — un réglage enregistré qui ne change
	// rien serait un défaut, et l'écran des Options ne doit pas être le seul à le voir.
	useApplySettings();

	// Le prefixe de langue de l'URL courante. Il ne change pas pendant la session : changer de
	// langue est une navigation entiere, servie par nie-site, pas un changement d'etat local.
	const prefixe = useMemo(() => splitLanguagePrefix(window.location.pathname).prefix, []);

	// Les entrees reconnues dans l'URL. L'accueil n'en fait PAS partie : il vit a la racine, et
	// `requestedEntry` rend `null` pour elle — y ajouter `home` créerait un second chemin
	// vers la meme page.
	// Les ROUTES reconnues, pas les tuiles : `/recherche` et `/donnees` mènent à un mode de
	// l'explorateur sans figurer au menu.
	const routes = useMemo(() => recognizedRoutes(etat), [etat]);

	// L'entree courante vit dans l'URL, pas seulement en memoire : sans cela, un lien vers un
	// catalogue ne mene qu'a l'accueil, le bouton « precedent » quitte le site, et un
	// rechargement perd ou l'on etait.
	const [vue, setVueEtat] = useState<string>(() => {
		const routeServeur = document.getElementById("racine")?.dataset.route;
		return requestedEntry(INITIAL_ROUTES, window.location, routeServeur) ?? HOME;
	});

	/** Change de vue ET d'URL, sans recharger la page. */
	const setVue = (suivante: string) => {
		setVueEtat(suivante);
		const url = new URL(window.location.href);
		url.pathname = pathForEntry(prefixe, suivante);
		window.history.pushState({ vue: suivante }, "", url);
	};

	/**
	 * La navigation que les composants portés du wiki utilisent.
	 *
	 * Ils appelaient `next/link`, qui n'existe pas ici : l'adaptateur du paquet partagé rend un
	 * vrai `<a href>` et ne détourne le clic simple **que** si l'hôte sait faire mieux. Cet
	 * hôte sait : il change d'écran sans recharger. Un chemin qui ne désigne aucune entrée
	 * connue est laissé au navigateur — le détourner mènerait à un écran vide au lieu d'une
	 * page servie.
	 */
	const naviguer = React.useCallback(
		(href: string) => {
			const route = splitLanguagePrefix(
				new URL(href, window.location.origin).pathname
			).route.replace(/^\//, "");
			if (route && INITIAL_ROUTES.includes(route)) setVue(route);
			else window.location.assign(href);
		},
		// `setVue` est recréé à chaque rendu et ne dépend que de `prefixe` : le suivre ferait
		// remonter un contexte neuf à chaque frappe, et remonterait tout l'arbre porté.
		[prefixe]
	);

	// Le bouton « precedent » doit ramener a la vue precedente, pas sortir du site. Une URL qui
	// ne designe aucune entree est l'accueil — c'est aussi ce qui ramene au menu depuis un
	// catalogue.
	useEffect(() => {
		const surRetour = () => {
			setVueEtat(requestedEntry(routes, window.location) ?? HOME);
		};
		window.addEventListener("popstate", surRetour);
		return () => window.removeEventListener("popstate", surRetour);
	}, [routes]);

	// L'index du VFS se monte EN FOND côté serveur (`EtatSite::monter_vfs_en_fond`) : au premier
	// appel il répond `en_cours`. Une sonde unique fige donc l'écran d'attente pour toujours —
	// le site n'apprendrait jamais que le catalogue est devenu joignable. On resonde tant que
	// l'état n'est pas tranché, et on s'arrête dès qu'il l'est (`pret` comme `absent`).
	const vfs = etat?.capacites?.vfs ?? null;
	useEffect(() => {
		if (vfs === "pret" || vfs === "absent") return;
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
	}, [vfs]);

	// Le catalogue est-il consultable ? `capacites` vaut `null` tant que la mesure court : on
	// distingue « on ne sait pas encore » de « rien ne marche », au lieu d'afficher des vues
	// vides pendant la premiere seconde.
	const pret = Boolean(capacites?.vfs);

	// The root opens on the VFS-backed main menu. The WASM simulation remains the action behind
	// Match/Victory Road instead of exposing its temporary dark menu as the site's identity.
	if (vue === HOME) {
		return playing ? (
			<Jeu />
		) : (
			<div style={{ position: "fixed", inset: 0, background: "var(--jeu-ciel-clair)" }}>
				<MenuPrincipal
					view={vue}
					onChoose={setVue}
					onPlay={() => setPlaying(true)}
					health={etat}
					ready={pret}
					failed={Boolean(erreurSource)}
				/>
			</div>
		);
	}

	// Tant que le serveur n'a pas tranché sur son VFS, les écrans qui en DÉPENDENT montrent
	// l'écran d'attente du jeu plutôt qu'un menu dont aucune entrée ne mènerait à quelque
	// chose. La panne, elle, est un état tranché : elle s'affiche dans le même écran, avec
	// l'humeur correspondante.
	if (vfs === null || vfs === "en_cours") {
		return (
			// Même raison qu'en dessous : `GameCanvas` prend la hauteur de son parent.
			<div style={{ position: "fixed", inset: 0 }}>
				<Loading health={etat} failed={Boolean(erreurSource)} />
			</div>
		);
	}

	// Le menu de navigation reste atteignable, mais il n'est plus la page d'accueil : les
	// catalogues restent servis, ils ne sont simplement plus la première chose qu'on voit.
	if (vue === MENU) {
		return (
			// `fixed; inset: 0` et non `height: 100vh` : la seconde forme depend de la hauteur de
			// tous ses ancetres, et il suffit qu'un seul ne la propage pas pour que la zone mesuree
			// soit plus courte que la fenetre. Le canevas se met alors a l'echelle d'une hauteur
			// qu'il n'a pas, et laisse une bande vide en bas — sans qu'aucune valeur soit fausse.
			<div style={{ position: "fixed", inset: 0, background: "var(--jeu-ciel-clair)" }}>
				<MenuPrincipal
					view={vue}
					onChoose={setVue}
					onPlay={() => {
						setPlaying(true);
						setVue(HOME);
					}}
					health={etat}
					ready={pret}
					failed={Boolean(erreurSource)}
				/>
			</div>
		);
	}

	// Les Options sont un écran ENTIER du jeu, comme l'accueil : pas de barre au-dessus, la
	// touche Échap ramène au menu. Elles ne dépendent pas du catalogue — on y arrive même
	// quand le VFS n'est pas prêt.
	if (vue === SETTINGS) {
		return <Settings prefixe={prefixe} onRetour={() => setVue(MENU)} />;
	}

	return (
		<FournisseurNavigation naviguer={naviguer}>
			<SecondaryScreen currentView={vue} onSelect={setVue} health={etat}>
				{erreurSource ? (
					// Le detail technique de la panne ne s'affiche pas : il ne dit rien a qui consulte
					// le site, et le seul geste utile — reessayer — ne depend pas de lui.
					<Notice tone="alerte">
						Le site ne parvient pas à joindre ses ressources. Réessayez dans un instant.
					</Notice>
				) : !capacites ? (
					<Notice>Chargement…</Notice>
				) : !pret ? (
					<Notice>Le catalogue est en cours de préparation. Il s'affichera dès qu'il sera prêt.</Notice>
				) : vue === AVATAR ? (
					<Avatar />
				) : vue === EXPLORER || (ALIAS as readonly string[]).includes(vue) ? (
					// Les deux URL héritées mènent ici : l'explorateur EST la page de recherche et
					// de données, son panneau de droite en porte le contenu.
					<Explorateur />
				) : (
					// `/medias` et les quatre URL heritees menent toutes ici. La seconde arrive sur
					// SA vue ; la premiere, qui n'en designe aucune, ouvre sur les textures — le
					// catalogue le plus large (54 203 fichiers) et le seul dont la grille montre
					// quelque chose sans qu'on ait rien reglé.
					<Catalog view={(vue === MEDIA ? "textures" : vue) as VueCatalogue} />
				)}
			</SecondaryScreen>
		</FournisseurNavigation>
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
