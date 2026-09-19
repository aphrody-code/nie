/**
 * The browser host — the application, with the resources the origin serves.
 *
 * It provides three things and nothing else: the stylesheet, the theme class that `next-themes`
 * writes on `<html>`, and a boundary so a crash in one screen does not leave a blank document.
 * The source is the web one (`creerWebSource`), built by `App` itself when no host supplies one.
 */
import { ThemeProvider } from "next-themes";
import { poserFeuilleSprites } from "@niers/inacord-ui/config/sprites";
import { App } from "./App";
import { ErrorBoundary } from "./game/ErrorBoundary";
import "./app.css";

/**
 * La feuille de sprites vient du VFS, pas d'un fichier recopié dans `public/`.
 *
 * Le défaut de `@niers/inacord-ui` est `/icon_common2.webp`, qui existe pour Inacord et pour la
 * construction bureau mais PAS pour le web : `apps/nie-web/public/` ne le porte pas, et la
 * requête répond 404. Les badges de poste du radar de statistiques se dessinaient donc vides.
 *
 * `nie-site` sert la texture du jeu, par langue, et c'est la MÊME image que le jeu dessine :
 * `/assets/tex/dx11/menu/200_icon/15_icon_common2/fr/icon_common2.png` rend 74 158 octets. La
 * poser ici plutôt que d'ajouter un quatrième exemplaire statique évite un asset de plus à
 * resynchroniser à chaque mise à jour du jeu.
 */
poserFeuilleSprites("/assets/tex/dx11/menu/200_icon/15_icon_common2/fr/icon_common2.png");

export default function BrowserHost() {
	return (
		<ErrorBoundary zone="Application">
			<ThemeProvider attribute="class" defaultTheme="light" forcedTheme="light" enableSystem={false}>
				<App />
			</ThemeProvider>
		</ErrorBoundary>
	);
}
