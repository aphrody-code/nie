"use client";

// Google AdSense — chargeur de script et emplacement publicitaire, partagés par
// les deux sites Next. Les identifiants vivent dans `../lib/adsense` (module pur,
// lisible depuis un composant serveur).
//
// Trois pièces sont nécessaires pour que Google accepte de servir des annonces,
// et il en manque toujours une quand rien ne s'affiche :
//   1. ce script, présent sur toutes les pages ;
//   2. la balise `<meta name="google-adsense-account">`, posée par les layouts
//      via `metadata.other` — c'est elle que la vérification du tableau de bord
//      cherche ;
//   3. le fichier `public/ads.txt` de chaque application, qui déclare le même
//      éditeur en forme `pub-…` (sans le préfixe `ca-`).
//
// Les annonces automatiques se règlent depuis le tableau de bord AdSense : le
// chargeur suffit, il n'y a aucun emplacement à écrire dans les pages. `AdUnit`
// ne sert qu'aux blocs placés à la main, qui exigent un identifiant
// d'emplacement (`data-ad-slot`) créé au préalable côté AdSense.

import Script from "next/script";
import * as React from "react";

import { ADSENSE_CLIENT } from "../lib/adsense";
import { cn } from "../lib/utils";

declare global {
	interface Window {
		adsbygoogle?: unknown[];
	}
}

/**
 * Charge `adsbygoogle.js`. À poser une seule fois, dans le layout racine.
 *
 * `strategy="afterInteractive"` laisse la page devenir interactive avant de
 * charger le script publicitaire : une balise collée dans le `<head>` retarde le
 * premier rendu, ce que Google lui-même pénalise via les Core Web Vitals.
 */
export function AdSenseScript({ client = ADSENSE_CLIENT }: { client?: string }) {
	if (!client) {
		return null;
	}

	return (
		<Script
			async
			crossOrigin="anonymous"
			id="google-adsense"
			src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`}
			strategy="afterInteractive"
		/>
	);
}

export interface AdUnitProps extends Omit<React.ComponentProps<"div">, "children"> {
	/** `data-ad-slot` — identifiant de l'emplacement créé dans le tableau de bord. */
	slot: string;
	/** `data-ad-format` : `auto` = bloc adaptatif, `fluid` = annonce in-article. */
	format?: string;
	/** `false` empêche l'élargissement automatique sur mobile. */
	fullWidthResponsive?: boolean;
	client?: string;
}

/**
 * Emplacement publicitaire manuel. Inutile pour les annonces automatiques.
 *
 * Le conteneur réserve une hauteur minimale : sans elle, l'insertion de
 * l'annonce décale le contenu déjà lu (Cumulative Layout Shift).
 */
export function AdUnit({
	className,
	client = ADSENSE_CLIENT,
	format = "auto",
	fullWidthResponsive = true,
	slot,
	...props
}: AdUnitProps) {
	const pousse = React.useRef(false);

	React.useEffect(() => {
		// Un seul `push` par emplacement : en développement React monte deux fois,
		// et le second push fait échouer le remplissage avec « All ins elements in
		// the DOM with class=adsbygoogle already have ads in them ».
		if (pousse.current) {
			return;
		}
		pousse.current = true;
		try {
			(window.adsbygoogle = window.adsbygoogle || []).push({});
		} catch {
			// Bloqueur de publicité ou script indisponible : l'emplacement reste vide,
			// ce qui ne doit jamais casser la page qui l'héberge.
		}
	}, []);

	return (
		<div
			className={cn("min-h-24 w-full overflow-hidden text-center", className)}
			data-slot="ad-unit"
			{...props}
		>
			<ins
				className="adsbygoogle block w-full"
				data-ad-client={client}
				data-ad-format={format}
				data-ad-slot={slot}
				data-full-width-responsive={fullWidthResponsive ? "true" : "false"}
				style={{ display: "block" }}
			/>
		</div>
	);
}
