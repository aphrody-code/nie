/**
 * Le contexte qui porte le catalogue du jeu jusqu'aux composants.
 *
 * Séparé de `game-text.ts` parce que c'est du JSX ; la logique et le transport restent dans un
 * module que l'on peut tester sans rendre un arbre React.
 */
import { createContext, type ReactNode, useContext } from "react";

import { gameText, type GameTextResolver, useGameTextCatalogue } from "./game-text";
import type { GameLocale } from "./settings";

type Catalogue = ReturnType<typeof useGameTextCatalogue>;

/** `undefined` quand aucun fournisseur n'est monté : les libellés restent alors ceux du code. */
const ContexteTexteJeu = createContext<Catalogue>(undefined);

/**
 * Charge le catalogue une fois pour toute l'application et le rend disponible.
 *
 * Un hôte qui n'en monte pas voit exactement ce qu'il voyait avant : les libellés écrits à la
 * main. C'est la condition pour que cette substitution ne soit jamais un point de panne.
 */
export function GameTextProvider({
	locale,
	resolver,
	children,
}: {
	locale: GameLocale;
	resolver?: GameTextResolver;
	children: ReactNode;
}) {
	const catalogue = useGameTextCatalogue(locale, resolver);
	return <ContexteTexteJeu.Provider value={catalogue}>{children}</ContexteTexteJeu.Provider>;
}

/**
 * Le texte du jeu pour un libellé écrit à la main, ou le libellé lui-même.
 *
 * `useGameText("Retour")` rend « Back » en anglais, « 戻る » en japonais, et « Retour » partout
 * où la carte, le réseau ou la langue ne permettent pas de l'affirmer.
 */
export function useGameText(label: string): string {
	return gameText(useContext(ContexteTexteJeu), label);
}

/**
 * Le texte du jeu, posé dans le JSX.
 *
 * Un composant plutôt qu'un appel à [`useGameText`] parce qu'un hook ne peut pas être appelé
 * dans une boucle, une condition ou une fonction qui n'est pas un composant — et que c'est
 * exactement là que vivent la plupart des libellés d'un écran. `<GameText>Retour</GameText>`
 * fonctionne partout où « Retour » fonctionnait.
 *
 * L'enfant est une CHAÎNE, littérale (`<GameText>Retour</GameText>`) ou calculée
 * (`<GameText>{def.label}</GameText>`) : c'est elle qui sert de clé dans la carte, et c'est elle
 * qui reste affichée si la carte, le réseau ou la langue ne permettent pas d'affirmer mieux.
 * Rien ne peut donc disparaître de l'écran.
 */
export function GameText({ children }: { children: string }) {
	return <>{useGameText(children)}</>;
}
