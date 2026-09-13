/**
 * La lecture VALIDEE d'un layout de menu exporte par `nie-game --export-layout`.
 *
 * ## Ce module lit ; il ne dessine plus
 *
 * Un layout est une DONNEE : des objets, chacun avec sa transformation, sa priorite de dessin,
 * sa texture et ses fentes de texte. Ce qui la PEINT est `nie_formats::menu_layout`, compile en
 * WebAssembly et partage avec l'hote natif — un seul rasteriseur, verifie des deux cotes par
 * `scripts/validation/compare-menu-layout.ts`.
 *
 * Ce fichier portait en plus une seconde implementation en CSS : ordre de peinture, position
 * absolue, URL de texture, decoupe du balisage de couleur. Elle n'avait plus AUCUN appelant de
 * production depuis que le compositeur a pris le rendu, et elle dupliquait les memes regles dans
 * un second langage, libre de deriver sans que rien ne le dise. Elle a ete retiree le
 * 2026-09-13 ; le decoupage du balisage `[C...]`, lui, a rejoint le compositeur, qui est
 * l'endroit qui PEINT (`colour_spans` / `plain_label`).
 *
 * ## Ce que l'export donne, et ce qu'il ne donne PAS
 *
 * Current exports identify placement provenance explicitly. A centered bind pose is not proof
 * of missing geometry; unresolved objects carry null source transforms and are not painted.
 * Ancestor fallback remains a labelled heuristic rather than native runtime placement proof.
 *
 * `lireLayout` ne corrige rien et n'invente rien : il rend ce que la donnee dit, et ECHOUE
 * bruyamment sur une forme qu'il ne reconnait pas. Un `as LayoutJeu` ne verifierait rien — un
 * reexport qui renommerait `objects` rendrait une page vide, sans message, typecheck vert.
 */
/** Les dimensions logiques du canevas du menu. `mainmenu01` : 1280x720. */
export interface CanvasLayout {
	w: number;
	h: number;
}

/**
 * La transformation d'un objet.
 *
 * `anchorX`/`anchorY` sont exprimes en fraction de la taille de l'objet : `0.5` place le point
 * (x, y) au centre de l'objet, `0` en haut a gauche. Toutes les valeurs exportees valent `0.5`.
 */
export interface TransformLayout {
	x: number;
	y: number;
	anchorX: number;
	anchorY: number;
	scaleX: number;
	scaleY: number;
	/** Rotation. Toutes les valeurs exportees valent `0` — cf. [`OptionsStyle.uniteRotation`]. */
	rot: number;
}

/** La texture d'un objet, telle que l'export la designe. */
export interface SpriteLayout {
	/** Chemin VFS SANS le prefixe `data/` — c'est le piege principal, cf. [`cheminVfsSprite`]. */
	logicalPath: string;
	/** Chemin PNG relatif tel que l'exporteur le suggere. Non employe pour construire l'URL. */
	pngUrl?: string | null;
	w: number;
	h: number;
}

/** Une fente de texte, remplie par la localisation au moment de l'export. */
export interface SlotTexte {
	slot: string;
	text: string;
}

/** Un objet du layout. */
export interface ObjetLayout {
	name: string;
	/** Missing on legacy exports; explicit unresolved objects must not be painted. */
	placementSource?: "unresolved" | "g4pkm-pose" | "g4pkm-ancestor-fallback" | "attach-locator";
	/** Ordre de peinture. Croissant = dessine par-dessus, cf. [`objetsTries`]. */
	drawPriority: number;
	visible: boolean;
	transform: TransformLayout;
	sprite?: SpriteLayout | null;
	text?: SlotTexte[] | null;
	parent?: string | null;
	charModel?: unknown;
	primitive?: unknown;
	drawType?: number;
}

/** Un layout complet, tel que `nie-game --runtime --export-layout` l'ecrit. */
export interface LayoutJeu {
	/** Nom de l'ecran (`mainmenu01`). */
	screen: string;
	/** Langue des fentes de texte au moment de l'export. */
	locale?: string;
	generatedBy?: string;
	canvas: CanvasLayout;
	objects: ObjetLayout[];
}

/**
 * L'echelle qui fait tenir le canevas dans une zone, sans le deformer.
 *
 * Le rapport est le MEME sur les deux axes : etirer un menu concu en 16/9 pour remplir une
 * fenetre plus haute deplacerait chaque widget d'une quantite differente selon sa position,
 * et aucun repere ne permettrait plus de comparer le rendu a la reference.
 *
 * Rend `0` pour une zone vide ou non encore mesuree — l'appelant distingue ainsi « pas encore
 * mesure » de « mesure a 1 ».
 */
export function echellePourZone(zoneL: number, zoneH: number, canvas: CanvasLayout): number {
	if (!(zoneL > 0) || !(zoneH > 0) || !(canvas.w > 0) || !(canvas.h > 0)) return 0;
	return Math.min(zoneL / canvas.w, zoneH / canvas.h);
}

/** Normalizes static text slots and runtime `SetText`/`SetObjectNum` values to one render shape. */
function normalizeLayoutText(value: unknown): SlotTexte[] | null {
	if (value === null || value === undefined) return null;
	if (typeof value === "string" || typeof value === "number") {
		return [{ slot: "runtime", text: String(value) }];
	}
	if (!Array.isArray(value)) return null;
	return value.flatMap((slot, index) => {
		if (!slot || typeof slot !== "object") return [];
		const candidate = slot as Partial<SlotTexte>;
		if (typeof candidate.text !== "string") return [];
		return [{ slot: typeof candidate.slot === "string" ? candidate.slot : `slot-${index}`, text: candidate.text }];
	});
}

/**
 * Valide un layout charge depuis un JSON, et le type.
 *
 * Un `as LayoutJeu` sur un import JSON ne verifie RIEN : un reexport qui renommerait `objects`
 * ou perdrait `canvas` rendrait une page vide, sans message, et le typecheck resterait vert.
 * Cette fonction echoue bruyamment a la place — l'echec le plus cher d'une interface est celui
 * qui s'affiche correctement en n'ayant rien a montrer.
 */
export function lireLayout(valeur: unknown): LayoutJeu {
	const brut = valeur as Partial<LayoutJeu> | null;
	if (!brut || typeof brut !== "object") {
		throw new Error("layout : la valeur n'est pas un objet");
	}
	const canvas = brut.canvas;
	if (!canvas || !(canvas.w > 0) || !(canvas.h > 0)) {
		throw new Error("layout : `canvas` absent ou de dimensions nulles");
	}
	if (!Array.isArray(brut.objects)) {
		throw new Error("layout : `objects` absent ou n'est pas un tableau");
	}
	const objects = brut.objects.map((object, index) => {
		const candidate = object as ObjetLayout & { text?: unknown };
		if (!candidate || typeof candidate.name !== "string" || (!candidate.transform && candidate.placementSource !== "unresolved")) {
			throw new Error(`layout : l'objet ${index} n'a ni nom ni transformation`);
		}
		if (candidate.placementSource !== undefined && !["unresolved", "g4pkm-pose", "g4pkm-ancestor-fallback", "attach-locator"].includes(candidate.placementSource)) {
			throw new Error(`layout : unknown placement source for object ${index}`);
		}
		return {
			...candidate,
			// Internal compatibility shape only; unresolved objects are excluded from painting
			// and geometry metrics. The source JSON keeps their transform explicitly null.
			transform: candidate.transform ?? { x: 0, y: 0, scaleX: 1, scaleY: 1, rot: 0, anchorX: 0, anchorY: 0 },
			text: normalizeLayoutText(candidate.text),
		};
	});
	return {
		screen: typeof brut.screen === "string" ? brut.screen : "?",
		locale: brut.locale,
		generatedBy: brut.generatedBy,
		canvas: { w: canvas.w, h: canvas.h },
		objects,
	};
}
