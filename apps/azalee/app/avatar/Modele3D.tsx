"use client";

/**
 * Le modèle au centre de l'écran, sans habillage.
 *
 * Le visualiseur commun (`CharacterModelViewer`) impose un fond opaque, un rapport 3:4 et un
 * bouton de téléchargement : trois éléments que le jeu n'a pas, et le fond masquait sa scène.
 * Ici, seul le `model-viewer` est monté, sur fond transparent, aux dimensions du conteneur.
 *
 * Le script du composant est celui déjà servi par azalée (`/vendor/model-viewer.min.js`) : la
 * politique de sécurité n'autorise que l'origine du site, aucun script tiers n'est chargé.
 */

import { useEffect, useRef, useState } from "react";

const SCRIPT = "/vendor/model-viewer.min.js";

let chargement: Promise<void> | null = null;

/** Charge le composant une seule fois pour toute la page. */
function chargerModelViewer(): Promise<void> {
	if (typeof window === "undefined") return Promise.resolve();
	if (customElements.get("model-viewer")) return Promise.resolve();
	chargement ??= new Promise<void>((resolve, reject) => {
		const existant = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
		if (existant) {
			existant.addEventListener("load", () => resolve());
			existant.addEventListener("error", () => reject(new Error("script indisponible")));
			return;
		}
		const script = document.createElement("script");
		script.type = "module";
		script.src = SCRIPT;
		script.addEventListener("load", () => resolve());
		script.addEventListener("error", () => {
			chargement = null;
			reject(new Error("script indisponible"));
		});
		document.head.appendChild(script);
	});
	return chargement;
}

export function Modele3D({ url }: { url: string }) {
	const hote = useRef<HTMLDivElement>(null);
	const [pret, setPret] = useState(false);

	useEffect(() => {
		let annule = false;
		chargerModelViewer()
			.then(() => {
				if (!annule) setPret(true);
			})
			.catch(() => {
				/* sans le composant, la scène reste sans modèle plutôt qu'avec un cadre d'erreur */
			});
		return () => {
			annule = true;
		};
	}, []);

	useEffect(() => {
		if (!pret || !hote.current) return;
		const boite = hote.current;
		boite.innerHTML = "";
		const mv = document.createElement("model-viewer");
		mv.setAttribute("alt", "");
		mv.setAttribute("camera-controls", "");
		mv.setAttribute("touch-action", "pan-y");
		mv.setAttribute("exposure", "1");
		mv.setAttribute("shadow-intensity", "0");

		// Cadrage fixe, plutôt que le cadrage automatique sur la boîte englobante : celui-ci
		// changeait de distance à chaque pièce ajoutée, si bien que l'avatar rapetissait ou
		// grandissait sans raison visible. La cible vise le buste — l'avatar mesure de 1,25 m à
		// 2,08 m selon la morphologie, et viser le milieu le garde entier dans le cadre.
		mv.setAttribute("camera-target", "0m 0.85m 0m");
		mv.setAttribute("camera-orbit", "0deg 82deg 3.2m");
		mv.setAttribute("field-of-view", "28deg");
		mv.setAttribute("min-field-of-view", "12deg");
		mv.setAttribute("max-field-of-view", "45deg");

		// Les gestes sont LIBRES : tourner, zoomer et déplacer la vue. Le jeu n'en propose que deux,
		// mais sur le web on attend d'un modèle qu'il se manipule entièrement — et l'on ne peut pas
		// s'approcher d'un détail sans pouvoir recentrer dessus.
		//
		// Les bornes restent larges plutôt qu'absentes : elles empêchent seulement de passer sous
		// le sol ou de s'éloigner au point de perdre l'avatar de vue.
		mv.setAttribute("min-camera-orbit", "auto 15deg 0.5m");
		mv.setAttribute("max-camera-orbit", "auto 155deg 8m");
		mv.setAttribute("interaction-prompt", "none");
		mv.style.width = "100%";
		mv.style.height = "100%";
		mv.style.backgroundColor = "transparent";
		mv.setAttribute("src", url);
		boite.appendChild(mv);
		return () => {
			boite.innerHTML = "";
		};
	}, [pret, url]);

	return <div ref={hote} className="size-full" />;
}
