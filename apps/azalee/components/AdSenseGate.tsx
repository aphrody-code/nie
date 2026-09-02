"use client";

/**
 * Charge AdSense partout **sauf** sur les pages plein écran.
 *
 * Les annonces automatiques posent une bannière d'ancrage en bas de fenêtre, avec le z-index
 * maximal. Sur l'éditeur d'avatar — un écran de jeu qui occupe tout l'affichage — elle recouvrait
 * la barre de commandes sur environ 85 pixels de haut.
 *
 * Le script n'est donc pas chargé sur ces routes, plutôt que masqué après coup : masquer une
 * annonce déjà servie compte comme une impression non visible, ce que la régie interdit.
 */

import { AdSenseScript } from "@rosegriffon/ui";
import { usePathname } from "next/navigation";

/** Routes qui occupent tout l'écran et n'admettent donc aucune annonce. */
const PLEIN_ECRAN = ["/avatar", "/jeu"];

export function AdSenseGate() {
	const chemin = usePathname();
	if (chemin && PLEIN_ECRAN.some((p) => chemin === p || chemin.startsWith(`${p}/`))) {
		return null;
	}
	return <AdSenseScript />;
}
