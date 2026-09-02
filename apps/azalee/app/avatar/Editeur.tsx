"use client";

/**
 * L'éditeur d'avatar du jeu, monté avec ses propres éléments.
 *
 * ## Règle de composition
 *
 * Tout ce qui s'affiche ici existe dans le jeu : ses sprites, sa police, ses libellés, ses voix.
 * Pas d'identifiant technique, pas de hachage à l'écran, pas d'icône de bibliothèque web. Un
 * élément absent du jeu est absent d'ici.
 *
 * - les **libellés** viennent de `menu_text` par hachage (`libelles.ts`) ;
 * - la **structure** des écrans vient des `objbin` du jeu (`structure.ts`) ;
 * - les **sprites** viennent des atlas `menu/161_avatar/avatar01`, `menu/20_cmn`, `font/` ;
 * - les **briques** (curseur, vignette, ligne, note) sont dans `ui.tsx` ;
 * - les **panneaux** des six onglets sont dans `panneaux.tsx`.
 *
 * ## Géométrie du cadre
 *
 * Relevée sur les captures du jeu (2560×1440) : bandeau jusqu'à y = 163 ; plaques de rubrique de
 * x = 34 à 533, première à y = 253, hauteur 71, pas 90,5 ; panneau de x = 1583 à 2556, y = 237.
 *
 * La position des widgets EST dans les fichiers du jeu — `nie_formats::menu::attach_slots` la
 * résout depuis les `CMenuAttachLocator`, et le layout exporté place 14 des 18 objets de cet écran
 * dans son canevas. Le relevé sur captures reste utilisé parce que la conversion de ces transforms
 * en coordonnées écran (ancre, échelle, repère) n'est pas encore juste, pas parce que la donnée
 * manquerait. Cf. `/avatar/layout/<ecran>.json`.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import { definirPhotoDepuisAvatar } from "./actions";
import { H, MORPHOLOGIES, resolveur } from "./libelles";
import { Modele3D } from "./Modele3D";
import { Partage } from "./PanneauPartage";
import { encoder, specDe, valeursDepuisChoix, verifierSpec } from "./partage";
import {
	CentreStats,
	PanHabits,
	PanNom,
	PanPersonnalite,
	PanPhysionomie,
	PanStatsBase,
	PanStyle,
	PanVisage,
	PanVoix,
	type Contexte,
} from "./panneaux";
import { RUBRIQUES_STATS, RUBRIQUES_VISAGE } from "./structure";
import type { Catalogue } from "./types";
import { A01, BLEU, Curseur, FONT, Sprite, Txt } from "./ui";

/**
 * Proportions **mesurées** sur les captures du jeu (2560×1440), en pourcentage du cadre.
 *
 * Relevé par balayage de pixels, pas à l'œil : le bandeau bleu s'arrête à y = 166 ; les plaques de
 * rubrique occupent x = 2 à 533, la première de y = 263 à 333 (hauteur 71, pas 90,6) ; le panneau
 * de droite va de x = 1614 au bord droit et de y = 262 à 1285.
 */
const G = {
	bandeauH: (166 / 1440) * 100,
	colonneX: 0,
	colonneW: (533 / 2560) * 100,
	rubriqueY: (263 / 1440) * 100,
	rubriqueH: (71 / 1440) * 100,
	rubriquePas: (90.6 / 1440) * 100,
	panneauX: (1614 / 2560) * 100,
	panneauY: (262 / 1440) * 100,
	panneauW: ((2560 - 1614) / 2560) * 100,
	panneauH: ((1285 - 262) / 1440) * 100,
	ongletsX: [50, 56.8, 63.5, 70.2, 77, 83.8],
} as const;

/** Teintes du bandeau, échantillonnées sur les captures. */
const C = { bandeauGauche: "#0EAFFF", bandeauDroite: "#1067F8" } as const;

const MM = "/dx11/menu/100_mainmenu/mainmenu90/mainmenu90_02_2";
const MM2 = "/dx11/menu/100_mainmenu/mainmenu90/mainmenu90_02";
/** Les sprites du bandeau de guide du bas. Ce ne sont PAS ceux de `20_cmn/cmn03` : le layout
 *  exporté de `chara_edit_menu` désigne `mainmenu01_06_base_button_guide`,
 *  `mainmenu01_10_return_arrow_button_guide` et `mainmenu01_12_next_button_guide`. Les sprites
 *  `cmn03/cmd_back_base01` et `cmd_press_btn_base_on01` qui étaient posés ici sont des fonds de
 *  bouton CYAN — d'où les deux rectangles turquoise là où le jeu montre des pilules blanches
 *  translucides (l'alpha de `mainmenu01_12` plafonne à 60 %). */
const MM1 = "/dx11/menu/100_mainmenu/mainmenu01";
/** Sol du jeu sous le sprite de fond : la couleur de sa dernière ligne opaque. */
const SOL = "#BEF2FC";

/** Les six onglets, dans l'ordre du jeu, avec l'icône et le hachage de leur libellé. */
const ONGLETS = [
	{ cle: "style", icone: "icon_menu_avatar01", hash: H.ongletStyle },
	{ cle: "physionomie", icone: "icon_menu_avatar02", hash: H.ongletPhysionomie },
	{ cle: "visage", icone: "icon_menu_avatar03", hash: H.ongletVisage },
	{ cle: "habits", icone: "icon_menu_avatar04", hash: H.ongletHabits },
	{ cle: "stats", icone: "icon_menu_avatar05", hash: H.ongletStats },
	{ cle: "nom", icone: "icon_menu_avatar06", hash: H.ongletNom },
] as const;

type Onglet = (typeof ONGLETS)[number]["cle"];

/**
 * Les commandes de la barre du bas, par onglet — celles que les captures du jeu montrent.
 *
 * Chaque entrée est `[badge de touche, hachage du libellé]`. Les badges sont les gaiji du jeu
 * (`gaiji_mouse_l`, `gaiji_arrow_ud`, `gaiji_x`…), pas des glyphes de police web.
 */
const COMMANDES: Record<Onglet, [string, string][]> = {
	style: [
		["gaiji_mouse_l", H.choisir],
		["gaiji_arrow_ud", H.zoom],
		["gaiji_arrow_lr", H.tourner],
		["gaiji_n", H.expression],
		["gaiji_v", H.modele],
	],
	physionomie: [
		["gaiji_mouse_l", H.choisir],
		["gaiji_arrow_ud", H.zoom],
		["gaiji_arrow_lr", H.tourner],
		["gaiji_n", H.expression],
		["gaiji_v", H.modele],
	],
	visage: [
		["gaiji_mouse_l", H.choisir],
		["gaiji_arrow_ud", H.zoom],
		["gaiji_arrow_lr", H.tourner],
		["gaiji_n", H.expression],
		["gaiji_x", H.cacherCheveux],
		["gaiji_v", H.modele],
	],
	habits: [
		["gaiji_mouse_l", H.choisir],
		["gaiji_arrow_ud", H.zoom],
		["gaiji_arrow_lr", H.tourner],
		["gaiji_x", H.cacherCheveux],
		["gaiji_v", H.modele],
	],
	stats: [
		["gaiji_mouse_l", H.choisir],
		["gaiji_arrow_ud", H.zoom],
		["gaiji_arrow_lr", H.tourner],
		["gaiji_x", H.apercuPoses],
		["gaiji_v", H.modele],
	],
	nom: [
		["gaiji_mouse_l", H.choisir],
		["gaiji_arrow_ud", H.zoom],
		["gaiji_arrow_lr", H.tourner],
		["gaiji_x", H.voirApparence],
		["gaiji_v", H.modele],
	],
};

export function Editeur({ catalogue, cdn }: { catalogue: Catalogue; cdn: string }) {
	const [onglet, setOnglet] = useState<Onglet>("style");
	const [rubrique, setRubrique] = useState(0);
	const [choix, setChoixBrut] = useState<Record<number, string>>({});
	const [valeurs, setValeursBrut] = useState<Record<string, number>>({});
	const [pages, setPagesBrut] = useState<Record<string, number>>({});
	const [genre, setGenre] = useState(0);
	const [morphologie, setMorphologie] = useState(0);
	const [ligneOuverte, setLigneOuverte] = useState<string | null>(null);
	const [champs, setChampsBrut] = useState<Record<string, string>>({});
	const [voix, setVoix] = useState<string | null>(null);
	const [enregistrement, demarrerEnregistrement] = useTransition();
	const [messageFin, setMessageFin] = useState<string | null>(null);
	const [partageOuvert, setPartageOuvert] = useState(false);
	const audio = useRef<HTMLAudioElement | null>(null);

	const lib = useMemo(() => resolveur(catalogue), [catalogue]);
	const txt = useCallback((hash: string) => lib(hash)?.libelle ?? "", [lib]);

	/**
	 * Pose un choix, et traite le cas particulier des ÉCHANTILLONS DE VISAGE.
	 *
	 * Les 36 parts de la catégorie 1 ne portent ni maille ni texture — leur `resource` n'est qu'un
	 * nom, `preset_01_normal` et suivants. Les sélectionner ne pouvait donc rien changer.
	 *
	 * Un échantillon est une RECETTE : il fixe d'un coup les traits des autres rubriques. Le
	 * catalogue ne dit pas laquelle, aussi la recette est-elle **dérivée du rang** de l'échantillon,
	 * de façon déterministe — chaque rubrique reçoit une part choisie par un pas premier, ce qui
	 * évite que deux échantillons voisins ne se ressemblent. C'est une reconstitution assumée : le
	 * comportement est celui attendu d'un échantillon, la correspondance exacte n'est pas établie.
	 */
	const setChoix = useCallback(
		(cat: number, id: string) => {
			if (cat !== 1) {
				setChoixBrut((c) => ({ ...c, [cat]: c[cat] === id ? "" : id }));
				return;
			}
			const presets = catalogue.categories.find((c) => c.faceSettingType === 1);
			const rang = Math.max(0, presets?.parts.findIndex((p) => p.id === id) ?? 0);
			// Les rubriques qu'un échantillon fixe : forme, cheveux, frange, yeux, pupilles,
			// reflets, nez, bouche, sourcils, oreilles.
			const PAS: Record<number, number> = {
				2: 1, 4: 7, 5: 3, 6: 5, 7: 3, 8: 2, 9: 3, 10: 5, 11: 7, 12: 2,
			};
			setChoixBrut((c) => {
				const suite: Record<number, string> = { ...c, 1: c[1] === id ? "" : id };
				if (suite[1] === "") return suite;
				for (const [type, pas] of Object.entries(PAS)) {
					const t = Number(type);
					const cat2 = catalogue.categories.find((x) => x.faceSettingType === t);
					const n = cat2?.parts.length ?? 0;
					if (n > 0) suite[t] = cat2!.parts[(rang * pas) % n]!.id;
				}
				return suite;
			});
		},
		[catalogue.categories],
	);
	const setValeur = useCallback(
		(cle: string, v: number) => setValeursBrut((s) => ({ ...s, [cle]: v })),
		[],
	);
	const setPage = useCallback(
		(cle: string, n: number) => setPagesBrut((s) => ({ ...s, [cle]: n })),
		[],
	);
	const setChamp = useCallback(
		(cle: string, v: string) => setChampsBrut((s) => ({ ...s, [cle]: v })),
		[],
	);

	/** Joue une banque de voix du jeu, décodée à la volée. */
	const jouer = useCallback(
		(banque: string) => {
			audio.current?.pause();
			const el = new Audio(`${cdn}/audio/common/sound_asset/en/${banque}.acb`);
			audio.current = el;
			setVoix(banque);
			el.onended = () => setVoix(null);
			void el.play().catch(() => setVoix(null));
		},
		[cdn],
	);

	// Modèle affiché au centre : l'avatar est un EMPILEMENT de pièces, pas un modèle unique. On
	// assemble le visage de la morphologie courante (mapping fourni par le catalogue) avec chaque
	// part choisie qui possède un modèle sous `20_EDIT/`, et `/model-avatar/` rend le GLB combiné.
	const modeleUrl = useMemo(() => {
		// Le SQUELETTE de la morphologie choisie, et rien d'autre : le serveur en déduit le corps
		// habillé qui va avec. L'appariement corps↔squelette est mesuré (chaque variante de corps
		// épouse un squelette à 33 mm près, tout autre appariement dépassant 194 mm) et vit dans
		// `nie_formats::assemble::avatar_bodies_for_skeleton` — pas ici.
		//
		// Le squelette est celui que le catalogue donne : `modeles2` de la part de la catégorie 17
		// pointe `_bodySK/<code>_edit/<code>_edit.g4sk`. C'est cette pièce, et elle seule, qui fait
		// changer la silhouette avec le genre et la taille — de 1,25 m à 2,08 m selon le choix.
		// La part se retrouve par son NOM, pas par son rang : la catégorie 17 compte 13 entrées
		// (7 masculines et 6 féminines) alors que le curseur de physionomie en pilote 8. Chaque
		// morphologie du catalogue a exactement une part `edit_body_<nom>`, et les variantes
		// féminines partagent le squelette de leur équivalent — `smallfemale` comme `small`
		// pointent `c000201_edit`, ce qui rend le genre sans effet ici.
		const catMorpho = catalogue.categories.find((c) => c.faceSettingType === 17);
		// Le GENRE et la MORPHOLOGIE sont deux réglages distincts de l'interface, mais le jeu, lui,
		// les fond dans une seule liste : `male` et `female` y sont deux morphologies parmi les
		// huit. Sans ce raccord, changer le genre ne changeait rien au modèle — l'état `genre`
		// pilotait l'interface sans jamais atteindre l'URL.
		const morphos = catalogue.modelesDeBase.morphologies;
		const nomBrut = morphos[morphologie];
		const nomMorpho =
			genre === 1 && nomBrut === "male"
				? "female"
				: genre === 0 && nomBrut === "female"
					? "male"
					: nomBrut;
		const partMorpho =
			catMorpho?.parts.find((p) => p.id === choix[17]) ??
			catMorpho?.parts.find((p) => p.resource === `edit_body_${nomMorpho}`);
		const cheminSk = partMorpho?.modeles2?.find((m) => m.endsWith(".g4sk"));
		const squelette = cheminSk?.split("/").pop()?.replace(/\.g4sk$/, "");

		const pieces: string[] = [];
		if (squelette) pieces.push(`_bodySK/${squelette}`);

		// La MAILLE de tête ne dépend que de deux choses : la morphologie et le nez. Les 42 entrées
		// de `visages` sont indexées nez-major et ne portent que 7 ressources distinctes par
		// morphologie. Tout le reste du visage (forme, yeux, pupilles, sourcils, bouche) est de la
		// TEXTURE, pas de la géométrie.
		const catNez = catalogue.categories.find((c) => c.faceSettingType === 9);
		const iNez = Math.max(0, catNez?.parts.findIndex((p) => p.id === choix[9]) ?? 0);
		const visage = catalogue.modelesDeBase.visages[iNez] ?? catalogue.modelesDeBase.visages[0];
		const res = visage?.resources[morphologie] ?? visage?.resources[0];
		if (res) pieces.push(`_facebase/${res}`);

		// Chaque rubrique choisie apporte soit une MAILLE (`.g4md` — coiffure, oreilles,
		// accessoire), soit une COUCHE DE TEXTURE (`.g4tx` sous `_facetex` — peau, yeux, pupilles,
		// reflets, sourcils, bouche). Les secondes sont de loin les plus nombreuses, et c'est
		// pourquoi tant de rubriques semblaient sans effet tant que seules les mailles étaient
		// envoyées : le visage du jeu n'est pas une planche par combinaison, c'est un empilement.
		const couches: string[] = [];
		for (const c of catalogue.categories) {
			// À défaut de choix, la PREMIÈRE part de la rubrique. Sans ce repli, l'avatar de départ
			// arrivait sans yeux, sans bouche et sans sourcils : `choix` est vide tant que rien n'a
			// été sélectionné, alors que le jeu, lui, ouvre l'éditeur sur un visage complet.
			// Quelle part exacte le jeu retient au départ n'est pas établi — la première est un
			// défaut assumé, pas un relevé.
			const id = choix[c.faceSettingType];
			const part = id ? c.parts.find((p) => p.id === id) : c.parts[0];
			if (!part) continue;

			// `modeles` ET `modeles2` : une coiffure est en DEUX morceaux, l'avant (`_hairF`) et
			// l'arrière (`_hairB`). Sur les 98 coiffures, 45 n'ont QUE `modeles2` — ne lire que
			// `modeles` les rendait chauves — et les 53 autres perdaient leur nuque.
			const mailles = [...part.modeles, ...(part.modeles2 ?? [])].filter(
				(m) => m.includes("/20_EDIT/") && m.endsWith(".g4md"),
			);
			if (mailles.length > 0) {
				for (const maille of mailles) {
					const bouts = maille.split("/20_EDIT/")[1]?.split("/");
					const dossier = bouts?.[0];
					const nom = bouts?.[1]?.replace(/\.g4md$/, "");
					if (dossier && nom) pieces.push(`${dossier}/${nom}`);
				}
				continue;
			}

			const texture = part.modeles.find(
				(m) => m.includes("/_facetex/") && m.endsWith(".g4tx"),
			);
			if (texture) {
				const rel = texture.split("/_facetex/")[1]?.replace(/\.g4tx$/, "");
				if (rel) couches.push(rel);
			}
		}

		if (pieces.length === 0) return null;
		// Dédupliqué comme les couches : deux rubriques peuvent désigner la même maille, et le
		// serveur l'incorporerait deux fois, superposée à elle-même.
		const piecesUniques = [...new Set(pieces)];
		// Les familles sont numérotées dans leur ordre de superposition — `00_face` la peau, puis
		// `01_eye`, `02_pupil`, `03_highlight`, `04_eyebrow`, `05_mouth` : trier par nom donne
		// l'ordre d'empilement sans avoir à le décider.
		// Dédupliqué : deux rubriques distinctes peuvent désigner la même planche (les types 3 et
		// 13 pointent tous deux `00_face`), et chacune coûterait un décodage de 2048×1024.
		const uniques = [...new Set(couches)].sort();

		// La TEINTE. Le canal rouge des planches de `_facetex` porte la carnation : la couleur de
		// peau choisie y va. Les valeurs RGB des palettes ne vivent que dans la mémoire du jeu —
		// `niers mem palettes` les relève et les fusionne dans le catalogue sous `couleursRgb`.
		// À défaut de choix, la route retombe sur la couleur des recettes du jeu.
		const rgbDe = (type: number): string | null => {
			const cat = catalogue.categories.find((c) => c.faceSettingType === type);
			const i = valeurs[`couleur.${type}`];
			const id = cat?.couleurs?.[i ?? -1];
			return id ? (catalogue.couleursRgb?.[id]?.rgb ?? null) : null;
		};
		// Les TROIS canaux de teinte du visage : le rouge porte la carnation, le vert l'iris, le
		// bleu reste clair. La couleur d'œil est la catégorie 6, celle de peau la 3.
		const peau = rgbDe(3);
		const iris = rgbDe(6);
		const teinte =
			peau || iris ? `&tint=${peau ?? "F3CAC1"},${iris ?? "533B3B"},FFFFFF` : "";

		// La chevelure a sa propre couleur (catégorie 4, 98 coupes et 65 teintes). Sa planche est
		// NEUTRE dans les fichiers — `hair_10` vaut 255,255,255 partout — donc sans cette couleur
		// l'avatar porte un casque blanc. La route la multiplie sur la planche.
		const cheveux = rgbDe(4);
		const teinteCheveux = cheveux ? `&hair=${cheveux}` : "";

		// La MORPHOLOGIE désigne le corps exact. Le squelette seul ne suffit pas : il n'en réduit
		// le choix qu'à deux, et c'est la corpulence mesurée qui départage — `female` a les épaules
		// plus étroites et le tour de taille plus large que `male`, `big` un tour de taille de
		// 0,99 m quand `muscle`, aussi grand, garde 0,65. La table vit côté serveur.
		const morpho = nomMorpho ? `&morpho=${nomMorpho}` : "";

		// La TAILLE : quinze crans, que le jeu fait correspondre à une stature de 1,25 m à 2,08 m.
		// Le modèle est mis à l'échelle côté serveur.
		const cranTaille = valeurs["taille"];
		const taille = cranTaille === undefined ? "" : `&taille=${cranTaille}`;

		// La FORME DE VISAGE : ses six parts ne désignent aucune ressource dans le catalogue
		// (`resource = 0xFFFFFFFF`), le choix ne pouvait donc rien changer. La route l'applique en
		// déformant la tête ; on lui transmet le rang de la part choisie.
		const catForme = catalogue.categories.find((c) => c.faceSettingType === 2);
		const iForme = catForme?.parts.findIndex((p) => p.id === choix[2]) ?? -1;
		const forme = iForme >= 0 ? `&forme=${iForme}` : "";

		// Les HABITS — col (19), manches (20), ourlet (21). Leurs parts ne portent aucune maille ni
		// texture, rien qu'un nom de découpe (`fashion_collar`, `fashion_shoulder_baring`,
		// `fashion_shirt_out`, `fashion_navel_baring`) : la route ajuste la coupe du maillot.
		const rangDe = (type: number) => {
			const cat = catalogue.categories.find((c) => c.faceSettingType === type);
			const i = cat?.parts.findIndex((p) => p.id === choix[type]) ?? -1;
			return Math.max(0, i);
		};
		const habits = `&habits=${rangDe(19)},${rangDe(20)},${rangDe(21)}`;

		const q =
			uniques.length > 0
				? `?face=${encodeURIComponent(uniques.join(","))}${teinte}${teinteCheveux}${morpho}${taille}${forme}${habits}`
				: `${teinte}${teinteCheveux}${morpho}${taille}${forme}${habits}`.replace("&", "?");
		return `${cdn}/model-avatar/${piecesUniques.join("+")}.glb${q}`;
	}, [
		genre,
		valeurs,
		catalogue.couleursRgb,
		catalogue.modelesDeBase.visages,
		catalogue.modelesDeBase.morphologies,
		catalogue.categories,
		choix,
		morphologie,
		cdn,
	]);

	/** Applique l'avatar composé comme photo du compte : la vignette du visage choisi. */
	const appliquer = useCallback(() => {
		const cat = catalogue.categories.find((c) => c.faceSettingType === 1);
		const id = choix[1];
		const icone =
			cat?.parts.find((p) => p.id === id)?.icone ??
			cat?.parts.find((p) => p.icone)?.icone ??
			null;
		if (!icone) return;
		demarrerEnregistrement(async () => {
			const r = await definirPhotoDepuisAvatar(icone);
			setMessageFin(r.error ?? null);
		});
	}, [catalogue.categories, choix]);

	const ctx: Contexte = {
		cdn,
		catalogue,
		lib,
		txt,
		choix,
		setChoix,
		valeurs,
		setValeur,
		page: pages,
		setPage,
		genre,
		setGenre,
		morphologie,
		setMorphologie,
		rubrique,
		ligneOuverte,
		setLigneOuverte,
	};

	const iOnglet = ONGLETS.findIndex((o) => o.cle === onglet);

	/** Les rubriques de la colonne, selon l'onglet : dix pour le visage, trois pour les stats. */
	const rubriques = useMemo(() => {
		if (onglet === "visage") {
			return catalogue.rubriques
				.slice(0, 10)
				.map((r, i) => ({ ...r, icone: RUBRIQUES_VISAGE[i]?.icone ?? i + 1 }));
		}
		if (onglet === "stats") {
			return catalogue.rubriques
				.slice(10, 13)
				.map((r, i) => ({ ...r, icone: RUBRIQUES_STATS[i]?.icone ?? i + 11 }));
		}
		return [];
	}, [catalogue.rubriques, onglet]);

	// L'écran est monté dans `document.body` : posé dans le flux de la page, il restait sous la
	// navigation d'azalée, qui le décalait et le rognait.
	// Le défilement de la page n'est PAS verrouillé : l'éditeur reste une page du site, pas une
	// fenêtre modale. On la bloquait pour imiter le plein écran du jeu, au prix d'une page où la
	// molette ne faisait rien — ce qui déroute sur un écran court ou un portable.
	const [monte, setMonte] = useState(false);
	useEffect(() => setMonte(true), []);

	/** Le contenu du panneau de droite, selon l'onglet et la rubrique ouverte. */
	const panneau = (() => {
		switch (onglet) {
			case "style":
				return <PanStyle ctx={ctx} />;
			case "physionomie":
				return <PanPhysionomie ctx={ctx} />;
			case "visage":
				return <PanVisage ctx={ctx} />;
			case "habits":
				return <PanHabits ctx={ctx} />;
			case "stats":
				return rubrique === 0 ? (
					<PanStatsBase ctx={ctx} />
				) : rubrique === 1 ? (
					<PanPersonnalite ctx={ctx} />
				) : (
					<PanVoix ctx={ctx} jouer={jouer} enCours={voix} />
				);
			case "nom":
				return <PanNom ctx={ctx} champs={champs} setChamp={setChamp} />;
		}
	})();

	// Le CODE de l'avatar courant. La spécification vient du catalogue ; si elle est absente ou
	// incohérente, on n'affiche pas de code plutôt que d'en fabriquer un qui ne se relirait pas.
	const codePartage = useMemo(() => {
		const spec = specDe(catalogue);
		if (!spec || verifierSpec(spec) !== null) return null;
		return encoder(spec, valeursDepuisChoix(catalogue, spec, choix, genre, morphologie));
	}, [catalogue, choix, genre, morphologie]);

	/** Rétablit un avatar enregistré dans l'éditeur. */
	const restaurer = useCallback(
		(a: {
			choix: Record<number, string>;
			valeurs: Record<string, number>;
			champs: Record<string, string>;
			genre: number;
			morphologie: number;
		}) => {
			setChoixBrut(a.choix ?? {});
			setValeursBrut(a.valeurs ?? {});
			setChampsBrut(a.champs ?? {});
			setGenre(a.genre ?? 0);
			setMorphologie(a.morphologie ?? 0);
			setPartageOuvert(false);
		},
		[],
	);

	const etatAEnregistrer = useMemo(
		() => ({ choix, valeurs, champs, genre, morphologie }),
		[choix, valeurs, champs, genre, morphologie],
	);

	// Le portail n'existe qu'une fois le composant monté côté navigateur. Ce retour est POSÉ ICI,
	// après tous les `use*` : plus haut, il en sautait trois (`codePartage`, `restaurer`,
	// `etatAEnregistrer`) au premier rendu et les faisait apparaître au second — React compte les
	// crochets par position, et rendre plus de crochets qu'au rendu précédent lève une exception.
	if (!monte) return null;

	return createPortal(
		<div
			className="flex items-center justify-center"
			style={{
				// `position` et `inset` en style INLINE, pas par classe : la classe utilitaire ne
				// suffisait pas ici — l'élément restait dans le flux et sa hauteur se limitait à son
				// contenu, laissant paraître le fond de la page sous l'écran sur ~80 px.
				position: "fixed",
				top: 0,
				left: 0,
				width: "100%",
				height: "100%",
				zIndex: 2147483000,
				backgroundImage: `url(${cdn}${A01}/avatar01_00/avatar01_00.png)`,
				backgroundSize: "100% auto",
				backgroundPosition: "top center",
				backgroundRepeat: "no-repeat",
				backgroundColor: SOL,
			}}
		>
			<div className="absolute inset-0 overflow-hidden">
				{/* Le modèle, à l'emprise MESURÉE sur le vrai jeu (et non estimée).
				    Deux captures du même écran, l'une avant que l'avatar soit chargé et l'autre
				    après, différenciées puis seuillées, donnent sa boîte englobante : 215 × 609 px
				    à (533, 381) sur 1920 × 1080, stable du seuil 25 % au seuil 35 %. L'ancienne
				    emprise (730 × 907) faisait cadrer `model-viewer` sur toute la hauteur, d'où une
				    tête démesurée au milieu de la scène. */}
				{modeleUrl && (
					<div
						className="absolute"
						style={{ left: "27.76%", top: "35.28%", width: "11.20%", height: "56.39%" }}
					>
						<Modele3D url={modeleUrl} />
					</div>
				)}

				{/* Panneau central des statistiques : le jeu le pose à gauche du panneau de droite,
				    entre le modèle et lui (emprise relevée sur la capture de « Stats de base »). */}
				{onglet === "stats" && rubrique === 0 && (
					<div
						className="absolute"
						style={{ left: "41.4%", top: "18%", width: "19%", height: "70.5%" }}
					>
						<CentreStats ctx={ctx} />
					</div>
				)}

				{/* Bandeau, titre et onglets */}
				<div
					className="absolute inset-x-0 top-0 flex items-center"
					style={{
						height: `${G.bandeauH}%`,
						background: `linear-gradient(90deg, ${C.bandeauGauche} 0%, ${C.bandeauDroite} 100%)`,
					}}
				>
					<span className="ml-[2%] flex h-full shrink-0 items-center gap-[1vw]">
						<Sprite cdn={cdn} src={`${MM2}/icon_header_avatar01.png`} className="h-[62%] w-auto" />
						{/* `max-w-full` rognait le titre ("Éditeur d'avatai") : le texte du jeu est une
						    image, sa largeur doit rester libre. */}
						<Txt
							t={txt(H.titre)}
							cdn={cdn}
							couleur="FFFFFF"
							h="42%"
							className="!max-w-none"
						/>
					</span>

					{/* Badges de bascule d'onglet, aux deux bouts de la rangée, comme le jeu. */}
					<Sprite
						cdn={cdn}
						src={`${FONT}/gaiji_a.png`}
						className="absolute h-[26%] w-auto"
						style={{ left: `${G.ongletsX[0] - 5}%`, top: "38%" }}
					/>
					<Sprite
						cdn={cdn}
						src={`${FONT}/gaiji_e.png`}
						className="absolute h-[26%] w-auto"
						style={{ left: `${G.ongletsX[5] + 5}%`, top: "38%" }}
					/>

					{/* La tuile de l'onglet ACTIF : `icon_base01` de `mainmenu90_02_2`, un parallélogramme
					    bleu de 352 × 264 dont seuls ~64 % de la hauteur sont opaques (le reste est un
					    halo). Le jeu la montre à 132 × 90 px, centrée sur l'icône active ; le sprite
					    complet occupe donc ~140 px, soit 112 % de la hauteur du bandeau. Sans elle,
					    l'onglet actif ne se distinguait que par son icône pleine. */}
					<Sprite
						cdn={cdn}
						src={`${MM}/icon_base01.png`}
						className="pointer-events-none absolute -translate-x-1/2 w-auto"
						style={{ left: `${G.ongletsX[iOnglet]}%`, top: "2.4%", height: "112%" }}
					/>

					{ONGLETS.map((o, i) => (
						<span key={o.cle}>
							<button
								type="button"
								onClick={() => {
									setOnglet(o.cle);
									setRubrique(0);
									setLigneOuverte(null);
								}}
								aria-label={txt(o.hash)}
								className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
								style={{ left: `${G.ongletsX[i]}%`, height: "58%" }}
							>
								<Sprite
									cdn={cdn}
									src={`${MM}/${o.icone}_${onglet === o.cle ? "on" : "off"}.png`}
									className="size-full object-contain"
								/>
							</button>
							{/* Chevron de séparation entre deux onglets. */}
							{i < ONGLETS.length - 1 && (
								<Sprite
									cdn={cdn}
									src={`${MM}/icon_menu_arrow01.png`}
									className="absolute h-[22%] w-auto"
									style={{
										left: `${(G.ongletsX[i]! + G.ongletsX[i + 1]!) / 2}%`,
										top: "40%",
									}}
								/>
							)}
						</span>
					))}
				</div>

				{/* Languette du libellé de l'onglet actif.
				    L'emprise relevée à l'œil sur la capture du jeu (22 % × 5,7 % au lieu de
				    26 % × 4,2 %) a été ESSAYÉE puis retirée : mesurée, elle fait passer la région
				    `ergot_onglet` de 0,4971 à 0,4860 de SSIM. Le sprite `edit_type_base01` n'a pas
				    les mêmes marges transparentes que la forme visible du jeu ; recaler la boîte
				    sans recaler le sprite déplace l'erreur au lieu de la réduire. */}
				{iOnglet >= 0 && (
					<div
						className="absolute flex -translate-x-1/2 items-center justify-center"
						style={{
							left: `${G.ongletsX[iOnglet]}%`,
							top: `${G.bandeauH}%`,
							width: "26%",
							height: "4.2%",
						}}
					>
						<Sprite
							cdn={cdn}
							src={`${A01}/avatar01_03/edit_type_base01.png`}
							className="absolute inset-0 size-full"
						/>
						<Txt
							t={txt(ONGLETS[iOnglet]!.hash)}
							cdn={cdn}
							couleur="FFFFFF"
							h="74%"
							className="relative"
						/>
					</div>
				)}

				{/* Entrée d'un code d'avatar, sous le titre */}
				<button
					type="button"
					onClick={() => setPartageOuvert(true)}
					className="absolute flex items-center gap-[0.5vw] rounded-r-[0.3vw] bg-[#0B3E86]/70 py-[0.35%] pl-[1%] pr-[1.5%] transition hover:bg-[#0B3E86]"
					style={{ left: 0, top: `${G.bandeauH + 1.2}%` }}
				>
					<Sprite cdn={cdn} src={`${FONT}/gaiji_tab.png`} className="h-[1vw] w-auto" />
					<Txt t={txt(H.codeAvatar)} cdn={cdn} couleur="FFFFFF" h="1vw" />
				</button>

				{/* Colonne des rubriques */}
				{rubriques.map((r, i) => {
					const on = i === rubrique;
					return (
						<button
							key={r.hash}
							type="button"
							onClick={() => {
								setRubrique(i);
								setLigneOuverte(null);
							}}
							className="absolute flex items-center"
							style={{
								left: `${G.colonneX}%`,
								width: `${G.colonneW}%`,
								top: `${G.rubriqueY + i * G.rubriquePas}%`,
								height: `${G.rubriqueH}%`,
							}}
						>
							<Sprite
								cdn={cdn}
								src={`${A01}/avatar01_02/list_base01_${on ? "on" : "off"}.png`}
								className="absolute inset-0 size-full"
							/>
							{on && <Curseur cdn={cdn} className="absolute left-[-4%] h-[80%]" />}
							<Sprite
								cdn={cdn}
								src={`${A01}/avatar01_02/icon_edit_list${String(r.icone).padStart(2, "0")}_${on ? "on" : "off"}.png`}
								className="relative ml-[5%] h-[60%] w-auto"
							/>
							<Txt
								t={r.libelle}
								cdn={cdn}
								couleur={on ? "FFFFFF" : BLEU}
								h="44%"
								className="relative ml-[5%]"
							/>
						</button>
					);
				})}

				{/* Panneau de droite */}
				<div
					className="absolute"
					style={{
						left: `${G.panneauX}%`,
						top: `${G.panneauY}%`,
						width: `${G.panneauW}%`,
						height: `${G.panneauH}%`,
					}}
				>
					{/* Le sprite du panneau est gris (225) alors que le jeu l'affiche blanc : sa teinte
					    est posée au rendu, par le même mécanisme qui colore les palettes. Le facteur
					    ci-dessous porte 225 à 255, la valeur mesurée sur les captures. */}
					<Sprite
						cdn={cdn}
						src={`${A01}/avatar01_10/edit_win_base01.png`}
						className="absolute inset-0 size-full"
						style={{ filter: "brightness(1.133)" }}
					/>
					{/* Le panneau DÉFILE : certaines rubriques (98 coupes, 40 sourcils) débordent, et
					    leur fin était inatteignable. `overscroll-contain` évite que la molette ne
					    fasse défiler la page une fois le panneau au bout. */}
					<div className="relative flex h-full flex-col overflow-y-auto overscroll-contain px-[6%] py-[3%] [scrollbar-color:rgba(255,255,255,.45)_transparent] [scrollbar-width:thin]">
						{panneau}
					</div>
				</div>

				{/* Bandeau d'aide du bas, que le jeu affiche sur l'écran de nom */}
				{onglet === "nom" && (
					<div
						className="absolute inset-x-0 flex items-center bg-[#2A5C93]/55 py-[0.6%] pl-[2%]"
						style={{ bottom: "8.5%" }}
					>
						<Txt t={txt(H.aideNom)} cdn={cdn} couleur="FFFFFF" h="1.1vw" />
					</div>
				)}

				{/* Barre du bas : retour, commandes, validation */}
				<div className="absolute inset-x-0 bottom-0 flex items-center" style={{ height: "8.5%" }}>
					<button type="button" className="relative ml-[1.5%] h-[64%]" aria-label="Retour">
						<Sprite
							cdn={cdn}
							src={`${MM1}/mainmenu01_10/mainmenu01_10.png`}
							className="h-full w-auto"
						/>
					</button>
					{/* Échelle relevée sur la capture du jeu : le bloc de commandes y couvre 975 px
					    (x 380 → 1355) contre 625 px ici, soit un facteur 1,56 — d'où 1,15vw → 1,8vw
					    et un écart de groupe porté en proportion. */}
					<span className="ml-[4%] flex items-center gap-[3vw]">
						{COMMANDES[onglet].map(([badge, hash]) => (
							<span key={badge + hash} className="flex items-center gap-[0.6vw]">
								<Sprite cdn={cdn} src={`${FONT}/${badge}.png`} className="h-[1.5vw] w-auto" />
								<Txt t={txt(hash)} cdn={cdn} couleur="FFFFFF" h="1.8vw" />
							</span>
						))}
					</span>
					<button
						type="button"
						onClick={onglet === "nom" ? appliquer : () => {
							const i = ONGLETS.findIndex((o) => o.cle === onglet);
							const suivant = ONGLETS[Math.min(i + 1, ONGLETS.length - 1)];
							if (suivant) {
								setOnglet(suivant.cle);
								setRubrique(0);
							}
						}}
						disabled={enregistrement}
						className="relative ml-auto mr-[1.5%] flex h-[62%] items-center justify-center"
					>
						<Sprite
							cdn={cdn}
							src={`${MM1}/mainmenu01_12/mainmenu01_12.png`}
							className="absolute inset-0 size-full"
						/>
						<span className="relative flex items-center gap-[0.6vw] px-[1.4vw]">
							<Sprite cdn={cdn} src={`${FONT}/gaiji_e.png`} className="h-[1.1vw] w-auto" />
							<Txt
								t={txt(onglet === "nom" ? H.termine : H.suivant)}
								cdn={cdn}
								couleur="FFFFFF"
								h="1.25vw"
							/>
						</span>
					</button>
				</div>

				{/* Message d'échec de l'enregistrement, dans la forme des notes du jeu */}
				{messageFin && (
					<div className="
       absolute inset-x-[30%] bottom-[12%] flex items-center gap-[1vw] rounded-[0.3vw] bg-white/90 px-[2%] py-[1%]
     ">
						<Sprite cdn={cdn} src={`${FONT}/gaiji_system02.png`} className="h-[1.6vw] w-auto" />
						<Txt t={messageFin} cdn={cdn} h="1.05vw" />
					</div>
				)}
			</div>

			{partageOuvert && (
				<Partage
					etat={etatAEnregistrer}
					code={codePartage}
					restaurer={restaurer}
					fermer={() => setPartageOuvert(false)}
				/>
			)}
		</div>,
		document.body,
	);
}

/** Les morphologies du jeu, réexportées pour les écrans qui les nomment. */
export { MORPHOLOGIES };
