/**
 * Un écran de menu, composé par le compositeur du jeu et peint sur un `<canvas>`.
 *
 * ## Pourquoi il remplace `LayoutRender`
 *
 * `LayoutRender` empile un `<img>` par objet et le place par un `transform` CSS. Le jeu, lui,
 * échantillonne en bilinéaire, tourne autour d'une ancre, teinte et sait mélanger en additif —
 * quatre opérations qu'un empilement de boîtes HTML ne fait pas et ne peut pas apprendre. Le
 * résultat ressemblait au menu sans jamais pouvoir l'égaler.
 *
 * Ici, les pixels viennent de `nie_formats::menu_layout` compilé en WebAssembly : le même code
 * que `nie-game --compose-layout` et que `/api/v1/menu/render/{screen}`.
 *
 * ## Ce qu'il n'affirme pas
 *
 * Rien ici ne dit que l'image est conforme à `nie.exe`. C'est la composition des données que le
 * layout porte ; un objet sans pixels est compté `skipped` et publié comme tel, jamais remplacé.
 */
import { useEffect, useRef, useState } from "react";
import { composeMenuScreen, type ComposeReport } from "./menu-composer";

export interface LayoutCanvasProps {
	/** Le layout, tel que l'écran l'a chargé. Sérialisé tel quel : aucune clé n'est réinterprétée. */
	layout: unknown;
	/** Largeur du canevas, en pixels du jeu. */
	width?: number;
	/** Hauteur du canevas, en pixels du jeu. */
	height?: number;
	/**
	 * `true` quand un objet dont la visibilité n'est PAS résolue doit être dessiné.
	 *
	 * C'est le cas du layout statique de `nie-site`, qui n'exécute aucun script et pose
	 * `visible: null` plutôt que d'affirmer une visibilité qu'il n'a pas mesurée.
	 *
	 * **Faux par défaut, et c'est une discipline, pas une timidité.** Composé à `true`, un layout
	 * statique dessine TOUT ce que l'écran contient — mesuré le 2026-09-12 : 78 objets pour la
	 * Banque, 206 pour la Boutique, 0 sauté, vrais pixels du jeu mais tous les panneaux
	 * mutuellement exclusifs empilés. Le jeu n'en montre qu'un sous-ensemble, et ce
	 * sous-ensemble vient de l'exécution Lua, que `nie-site` ne sert pas encore
	 * (`/api/v1/menu/runtime/{screen}` rend l'état résolu, dans un AUTRE schéma : la jointure
	 * reste à faire). En attendant, l'écran ne dessine que ce que la donnée établit.
	 *
	 * La composition complète reste consultable, elle, sur `/api/v1/menu/render/{screen}`, qui
	 * annonce sa politique dans `x-compose-visibility`.
	 */
	assumeUnknownVisible?: boolean;
	/** Le rapport de composition, quand l'appelant veut le publier. */
	onReport?: (report: ComposeReport) => void;
}

export function LayoutCanvas({
	layout,
	width = 1280,
	height = 720,
	assumeUnknownVisible = false,
	onReport,
}: LayoutCanvasProps) {
	const canvas = useRef<HTMLCanvasElement | null>(null);
	const [state, setState] = useState<"composing" | "drawn" | "unavailable">("composing");
	const [report, setReport] = useState<ComposeReport | null>(null);

	useEffect(() => {
		let mounted = true;
		setState("composing");
		composeMenuScreen(layout, assumeUnknownVisible, { width, height })
			.then(({ image, report: counts }) => {
				if (!mounted) return;
				const context = canvas.current?.getContext("2d");
				if (!context) {
					setState("unavailable");
					return;
				}
				context.putImageData(image, 0, 0);
				setReport(counts);
				setState("drawn");
				onReport?.(counts);
			})
			.catch(() => {
				// Une composition qui échoue laisse le canevas VIDE et le dit dans l'attribut :
				// dessiner autre chose à la place serait inventer un écran.
				if (mounted) setState("unavailable");
			});
		return () => {
			mounted = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- `onReport` ne doit pas recomposer.
	}, [layout, assumeUnknownVisible, width, height]);

	return (
		<canvas
			ref={canvas}
			width={width}
			height={height}
			data-render-source="wasm-compositor"
			data-compose-state={state}
			data-compose-drawn={report?.drawn ?? 0}
			data-compose-skipped={report?.skipped ?? 0}
			style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
		/>
	);
}
