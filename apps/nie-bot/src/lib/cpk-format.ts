/**
 * Noyau PUR du navigateur CPK : normalisation de chemin, pagination, rendu des
 * lignes, choix de l'aperçu et résumé des configs binaires décodées.
 *
 * Ce module ne connaît NI Discord NI le réseau — c'est délibéré : tout ce qui
 * est décidable sans appeler quoi que ce soit (quel dossier interroger ? quelle
 * tranche afficher ? quelle URL de contenu ? que dit ce JSON ?) vit ici et se
 * teste sans démarrer un service. Les appels HTTP sont dans `commands/cpk.ts`.
 *
 * ── CE QU'ON MANIPULE ──────────────────────────────────────────────────────
 * L'index CPK compte 250 800 fichiers (`/health` → `cpkFiles`), répartis sous
 * deux racines : `data/common` (193 540) et `data/dx11` (57 260). Tous les
 * chemins de l'index commencent par `data/` : un membre qui tape `dx11/menu`
 * viserait un dossier inexistant et obtiendrait une réponse vide, d'où le
 * préfixage automatique de `normaliserChemin`.
 *
 * ── LES URL D'APERÇU ───────────────────────────────────────────────────────
 * Le CDN décode le contenu des CPK EN DIRECT ; les fabricants d'URL sont ceux
 * de la bibliothèque (`@rosegriffon/azalee/cpk/shared`), pas des chaînes
 * réécrites ici — le wiki et le bot doivent montrer exactement la même chose.
 * Mesures du 13/8/2026 qui justifient les choix ci-dessous :
 *   - `…/gallery_img2/img_chronicle_artwork_0010.png` brut = **12 176 145 o** ;
 *     le même en `?w=800&format=webp` = **80 672 o**. Un embed ne pointe donc
 *     JAMAIS le PNG brut : toujours la variante bornée.
 *   - `/model-full/c05021090.glb` = 200, 175 072 o ; `/model-full/ear001.glb` =
 *     404. Tous les modèles ne sont pas assemblables : la fiche doit sonder.
 *   - `/cfg/<chemin>.json` répond 200 mais peut peser 4 079 928 o
 *     (`chara_param_1.03.66.00.cfg.bin`) → lecture BORNÉE obligatoire.
 *   - `HEAD` n'est accepté QUE sur une variante `?w=` (`cdn-variants.service`
 *     répond 200, y compris à froid). `/cfg/`, `/raw/` **et `/model-full/`**
 *     répondent **405** dès que nginx ne trouve pas le fichier sur disque : le
 *     sondage par `HEAD` doit donc toujours pouvoir retomber sur un `GET`.
 */
import {
	cpkAssetUrl,
	cpkAudioUrl,
	cpkCfgUrl,
	cpkPreviewKind,
	cpkRawUrl,
	cpkThumbUrl,
	cpkVideoUrl,
	previewKindLabel,
	segLabel,
	topLabel,
	type CpkDir,
	type CpkFile,
	type CpkPreviewKind,
} from "@rosegriffon/azalee/cpk/shared";

import { entierLisible as entierLisibleUi, formaterOctets } from "./ui/nombres";
import {
	MAX_CUSTOM_ID as MAX_CUSTOM_ID_UI,
	decoderEtat,
	encoderEtat,
	nombreDePages as nombreDePagesUi,
} from "./ui/etat";

export type { CpkDir, CpkFile, CpkPreviewKind };

// ─── Constantes de cadrage ──────────────────────────────────────────────────

/** Entrées (dossiers + fichiers) affichées par page de `/cpk parcourir`. */
export const ENTREES_PAR_PAGE = 12;

/** Résultats affichés par page de `/cpk chercher`. */
export const RESULTATS_PAR_PAGE = 10;

/**
 * Nombre de résultats demandés à `/api/cpk/search`.
 *
 * Le serveur plafonne à 1000 (`Math.min(num(query,"limit",200), 1000)`), mais
 * une recherche large (`q=a`) balaie 250 800 chemins : on en prend 200, on
 * pagine dessus, et on DIT au membre quand le plafond est atteint plutôt que de
 * lui laisser croire qu'il a tout vu.
 */
export const PLAFOND_RECHERCHE = 200;

/** Longueur minimale d'un motif de recherche (`searchFiles` rend `[]` en dessous). */
export const MOTIF_MINIMUM = 2;

/** Largeur demandée au CDN pour l'image d'un embed. */
export const LARGEUR_APERCU = 800;

/** Limite de pièce jointe d'un serveur Discord sans amélioration (10 Mo). */
export const LIMITE_PIECE_JOINTE_DISCORD_OCTETS = 10 * 1024 * 1024;

/**
 * Seuil réel d'envoi d'un GLB en pièce jointe.
 *
 * On garde 2 Mo de marge sous la limite Discord : l'enveloppe multipart, les
 * embeds et les composants comptent dans la même charge utile, et un refus
 * d'upload fait échouer la réponse ENTIÈRE (le membre ne voit alors plus rien).
 */
export const SEUIL_PIECE_JOINTE_OCTETS = 8 * 1024 * 1024;

/** Octets lus au maximum d'un `/cfg/*.json` avant d'abandonner l'extrait. */
export const OCTETS_APERCU_CONFIG = 256 * 1024;

/** Longueur maximale du bloc de code d'un extrait JSON (limite d'un champ : 1024). */
export const CARACTERES_EXTRAIT = 900;

/** Longueur maximale d'un `customId` Discord. */
export const MAX_CUSTOM_ID = MAX_CUSTOM_ID_UI;

/**
 * Longueur maximale d'une valeur d'autocomplétion Discord.
 *
 * Un seul chemin de l'index dépasse 100 caractères (mesuré sur les 250 800
 * entrées) : il est écarté des suggestions, mais reste tapable et consultable.
 */
export const MAX_VALEUR_AUTOCOMPLETION = 100;

// ─── Chemins ────────────────────────────────────────────────────────────────

/** Racine logique de l'index : `listDir("")` et `listDir("data")` sont équivalents. */
export const RACINE_CPK = "data";

/**
 * Normalise une saisie en chemin d'index.
 *
 * Retire les antislashs, les slashs redondants, les segments `.`/`..` (un
 * membre ne remonte pas l'arborescence par traversée), borne la longueur, et
 * **préfixe `data/`** quand il manque : sans ça, `dx11/menu` interroge un
 * dossier qui n'existe pas et l'API répond `{"dirs":[],"files":[]}` — une
 * réponse vide qui se lit comme « ce dossier n'a rien », alors qu'il a 40 000
 * fichiers.
 */
export function normaliserChemin(saisie: string): string {
	const segments = saisie
		.replaceAll("\\", "/")
		.split("/")
		.map((s) => s.trim())
		.filter((s) => s.length > 0 && s !== "." && s !== "..");
	if (segments.length === 0) {
		return "";
	}
	if (segments[0] !== RACINE_CPK) {
		segments.unshift(RACINE_CPK);
	}
	return segments.join("/").slice(0, 240);
}

/** Vrai si le chemin désigne la racine de l'index. */
export function estRacine(chemin: string): boolean {
	return chemin === "" || chemin === RACINE_CPK;
}

/** Chemin du dossier parent, `""` à la racine. */
export function cheminParent(chemin: string): string {
	const propre = normaliserChemin(chemin);
	const coupe = propre.lastIndexOf("/");
	return coupe <= 0 ? "" : propre.slice(0, coupe);
}

/** Une étape du fil d'Ariane. */
export interface EtapeAriane {
	/** Libellé humain (traduit quand le segment est connu). */
	libelle: string;
	/** Chemin complet de l'étape, utilisable tel quel par `/cpk parcourir`. */
	chemin: string;
}

/**
 * Fil d'Ariane d'un dossier. Le premier segment après `data` passe par
 * `topLabel` (`dx11` → « DX11 (PC) »), les suivants par `segLabel`
 * (`menu` → « Menus », `_waza` → « Techniques (waza) »).
 */
export function filAriane(chemin: string): EtapeAriane[] {
	const propre = normaliserChemin(chemin);
	if (propre === "") {
		return [{ libelle: RACINE_CPK, chemin: RACINE_CPK }];
	}
	const segments = propre.split("/");
	const etapes: EtapeAriane[] = [];
	let cumul = "";
	for (const [index, segment] of segments.entries()) {
		cumul = cumul === "" ? segment : `${cumul}/${segment}`;
		const libelle = index === 0 ? segment : index === 1 ? topLabel(segment) : segLabel(segment);
		etapes.push({ libelle, chemin: cumul });
	}
	return etapes;
}

/** Fil d'Ariane rendu en une ligne. */
export function ligneAriane(chemin: string): string {
	return filAriane(chemin)
		.map((e) => e.libelle)
		.join(" › ");
}

/**
 * Chemin RELATIF de la page du wiki qui montre ce dossier ou ce fichier.
 *
 * La route catch-all `/cpk/[[...path]]` reconstitue le chemin d'index en
 * re-préfixant `data/` (`indexPathFromSegments`) : l'URL publique porte donc
 * l'arborescence SANS ce préfixe. Vérifié le 13/8/2026 :
 * `/cpk/dx11/menu/220_img/telop_waza/a000010.g4tx` → 200.
 */
export function cheminWiki(chemin: string): string {
	const relatif = normaliserChemin(chemin).replace(/^data\/?/, "");
	if (relatif === "") {
		return "/cpk";
	}
	return `/cpk/${relatif.split("/").map(encodeURIComponent).join("/")}`;
}

// ─── Pagination ─────────────────────────────────────────────────────────────

/** Nombre de pages nécessaires pour `total` entrées. */
export function nombreDePages(total: number, parPage: number): number {
	return nombreDePagesUi(total, parPage);
}

/**
 * Ramène un décalage dans les bornes et l'aligne sur une page.
 *
 * Sans plafond, un `offset` arbitraire venant d'un `customId` ferait demander à
 * SQLite une tranche au-delà de la fin : réponse vide, page blanche, et le
 * membre conclut que le dossier s'est vidé.
 */
export function bornerOffset(offset: number, total: number, parPage: number): number {
	if (!Number.isFinite(offset) || parPage <= 0) {
		return 0;
	}
	const dernier = (nombreDePages(total, parPage) - 1) * parPage;
	const aligne = Math.floor(Math.max(0, Math.trunc(offset)) / parPage) * parPage;
	return Math.min(aligne, Math.max(0, dernier));
}

/** Numéro de page (1-indexé) correspondant à un décalage. */
export function numeroPage(offset: number, parPage: number): number {
	if (parPage <= 0) {
		return 1;
	}
	return Math.floor(Math.max(0, offset) / parPage) + 1;
}

/** Découpe d'une page mixte « dossiers puis fichiers ». */
export interface TranchePage {
	/** Premier sous-dossier de la page (index dans la liste complète des dossiers). */
	debutDossiers: number;
	/** Sous-dossier suivant le dernier de la page. */
	finDossiers: number;
	/** `offset` à passer à `/api/cpk` pour la part fichiers de la page. */
	offsetFichiers: number;
	/** `limit` à passer à `/api/cpk` ; `0` = la page ne contient aucun fichier. */
	limiteFichiers: number;
}

/**
 * Découpe une page sur la séquence « tous les sous-dossiers, puis tous les
 * fichiers directs ».
 *
 * `/api/cpk` ne pagine QUE les fichiers (`limit`/`offset`) et renvoie toujours
 * la totalité des sous-dossiers — or `data/common/event/ev60` en compte 363,
 * bien plus que ce qu'un embed peut porter. On pagine donc sur la concaténation
 * des deux, ce qui reste cohérent avec l'ordre affiché.
 */
export function tranchePage(
	nbDossiers: number,
	nbFichiers: number,
	offset: number,
	parPage: number
): TranchePage {
	const total = Math.max(0, nbDossiers) + Math.max(0, nbFichiers);
	const debut = bornerOffset(offset, total, parPage);
	const debutDossiers = Math.min(debut, Math.max(0, nbDossiers));
	const finDossiers = Math.min(debut + parPage, Math.max(0, nbDossiers));
	const prisDossiers = Math.max(0, finDossiers - debutDossiers);
	const offsetFichiers = Math.max(0, debut - Math.max(0, nbDossiers));
	const limiteFichiers =
		offsetFichiers >= Math.max(0, nbFichiers) ? 0 : Math.max(0, parPage - prisDossiers);
	return { debutDossiers, finDossiers, offsetFichiers, limiteFichiers };
}

// ─── État transporté par les boutons ────────────────────────────────────────

/** Préfixe du `customId` des boutons de `/cpk parcourir`. */
export const PREFIXE_BOUTON_PARCOURS = "cpkd";

/** Préfixe du `customId` des boutons de `/cpk chercher`. */
export const PREFIXE_BOUTON_RECHERCHE = "cpkq";

export interface EtatParcours {
	chemin: string;
	offset: number;
}

export interface EtatRecherche {
	motif: string;
	offset: number;
}

/**
 * Encode l'état d'un parcours dans un `customId`.
 *
 * Le plus long dossier de l'index fait 66 caractères (mesuré sur les 250 800
 * entrées), donc l'identifiant tient toujours sous la limite de 100. `null`
 * reste néanmoins possible : le membre peut taper un chemin plus long.
 */
export function encoderParcours(etat: EtatParcours): string | null {
	return encoderEtat(PREFIXE_BOUTON_PARCOURS, [Math.max(0, Math.trunc(etat.offset)), etat.chemin]);
}

/** Décode un `customId` produit par `encoderParcours`. `null` si ce n'en est pas un. */
export function decoderParcours(customId: string): EtatParcours | null {
	const champs = decoderEtat(PREFIXE_BOUTON_PARCOURS, customId, 2);
	if (!champs) {
		return null;
	}
	const offset = Number.parseInt(champs[0] ?? "", 10);
	if (!Number.isFinite(offset) || offset < 0) {
		return null;
	}
	return { offset, chemin: champs[1] ?? "" };
}

/** Encode l'état d'une recherche dans un `customId` (`null` si le motif est trop long). */
export function encoderRecherche(etat: EtatRecherche): string | null {
	return encoderEtat(PREFIXE_BOUTON_RECHERCHE, [Math.max(0, Math.trunc(etat.offset)), etat.motif]);
}

/** Décode un `customId` produit par `encoderRecherche`. */
export function decoderRecherche(customId: string): EtatRecherche | null {
	const champs = decoderEtat(PREFIXE_BOUTON_RECHERCHE, customId, 2);
	if (!champs) {
		return null;
	}
	const offset = Number.parseInt(champs[0] ?? "", 10);
	const motif = champs[1] ?? "";
	if (!Number.isFinite(offset) || offset < 0 || motif.length < MOTIF_MINIMUM) {
		return null;
	}
	return { offset, motif };
}

// ─── Découpe d'une saisie de dossier (autocomplétion) ───────────────────────

/** Ce qu'il faut interroger pour suggérer des dossiers à partir d'une saisie. */
export interface SaisieDossier {
	/** Dossier à lister via `/api/cpk`. */
	parent: string;
	/** Préfixe à filtrer parmi ses sous-dossiers (casse ignorée). */
	filtre: string;
}

/**
 * Découpe une saisie en « dossier à lister » + « préfixe à filtrer ».
 *
 * Le slash final est significatif et se perd à la normalisation : `data/dx11/`
 * veut dire « montre-moi ce qu'il y a DEDANS », `data/dx11` veut dire « des
 * frères commençant par dx11 ». On le lit donc avant de normaliser.
 */
export function decouperSaisieDossier(saisie: string): SaisieDossier {
	const brut = saisie.replaceAll("\\", "/").trimEnd();
	const propre = normaliserChemin(brut);
	if (propre === "") {
		return { parent: "", filtre: "" };
	}
	if (brut.endsWith("/")) {
		return { parent: propre, filtre: "" };
	}
	const coupe = propre.lastIndexOf("/");
	if (coupe <= 0) {
		// `data` seul : rien à filtrer, on propose les racines.
		return { parent: "", filtre: "" };
	}
	return { parent: propre.slice(0, coupe), filtre: propre.slice(coupe + 1) };
}

/** Compare un nom à un préfixe, casse et accents de bord ignorés. */
export function correspondPrefixe(nom: string, filtre: string): boolean {
	if (filtre === "") {
		return true;
	}
	return nom.toLowerCase().startsWith(filtre.toLowerCase());
}

// ─── Formats lisibles ───────────────────────────────────────────────────────

/**
 * Entier groupé par milliers, avec une espace ORDINAIRE.
 *
 * `toLocaleString("fr-FR")` insère des espaces fines insécables (U+202F) qui
 * rendent toute assertion de test fragile ; on formate donc à la main.
 */
export function entierLisible(valeur: number): string {
	return entierLisibleUi(valeur);
}

/** Taille en octets rendue lisible (`12 Mo`, `171 Ko`, `7,3 Ko`). */
export function octetsLisibles(octets: number | null | undefined): string {
	return formaterOctets(octets, "taille inconnue");
}

/** Vrai si un contenu de cette taille peut partir en pièce jointe Discord. */
export function tientEnPieceJointe(octets: number | null | undefined): boolean {
	return typeof octets === "number" && octets > 0 && octets <= SEUIL_PIECE_JOINTE_OCTETS;
}

/**
 * Vrai si le CDN a refusé la MÉTHODE, pas la ressource.
 *
 * Mesuré le 13/8/2026, et c'est le piège central de ce fichier :
 * `nie-model-serve` répond **405 à toute requête HEAD**, même pour un modèle
 * parfaitement assemblable. `HEAD /model-full/c11010034.glb` → **405** ;
 * `GET` du même → **200 `model/gltf-binary`, 70 936 octets**. nginx ne répond
 * 200 en HEAD que lorsque le GLB est déjà posé sur disque
 * (`try_files $uri @model_live`, `alias /home/ubuntu/niers/var/model-cache/`),
 * ce qui ne couvre que **5 655 des 15 533 codes de modèle de l'index**.
 *
 * Lire un 405 comme « ce contenu n'existe pas » ferait donc annoncer « pas de
 * modèle » sur près des deux tiers de l'index — d'où la retombée sur un `GET`
 * dont on relâche le corps.
 */
export function methodeRefusee(statut: number): boolean {
	return statut === 405 || statut === 501;
}

/** Nom de fichier d'une pièce jointe, dérivé d'une URL de contenu. */
export function nomPieceJointe(url: string, repli: string): string {
	const sansRequete = url.split("?")[0] ?? url;
	const dernier = sansRequete.split("/").pop() ?? "";
	return dernier.length > 0 ? dernier : repli;
}

// ─── Rendu des lignes ───────────────────────────────────────────────────────

/** Ligne de liste d'un sous-dossier. */
export function ligneDossier(dossier: CpkDir): string {
	const traduit = segLabel(dossier.name);
	const suffixe = traduit === dossier.name ? "" : ` *(${traduit})*`;
	const compte = entierLisible(dossier.count);
	return `📁 \`${dossier.name}/\`${suffixe} — ${compte} fichier${dossier.count > 1 ? "s" : ""}`;
}

/** Ligne de liste d'un fichier (nom + famille d'aperçu). */
export function ligneFichier(fichier: CpkFile): string {
	return `📄 \`${fichier.name}\` — ${previewKindLabel(cpkPreviewKind(fichier.ext))}`;
}

/** Ligne de résultat de recherche : le chemin complet, la famille en second. */
export function ligneResultat(fichier: CpkFile): string {
	return `\`${fichier.path}\`\n↳ ${previewKindLabel(cpkPreviewKind(fichier.ext))}`;
}

// ─── Aperçu ─────────────────────────────────────────────────────────────────

/** Ce que la fiche d'un fichier peut montrer, décidé sur la seule extension. */
export interface ApercuCpk {
	/** Famille de preview (`image`, `model`, `config`, `sound`, `movie`, `package`, `text`, `raw`). */
	famille: CpkPreviewKind;
	/** Libellé humain de la famille. */
	libelle: string;
	/** Image bornée à poser dans l'embed (`?w=800&format=webp`), ou `null`. */
	image: string | null;
	/** URL du contenu décodé (PNG pleine résolution, GLB, JSON, WAV, MP4…). */
	contenu: string;
	/** URL des octets bruts décompressés — toujours disponible. */
	brut: string;
	/** Vrai si `contenu` est un JSON dont on peut extraire un aperçu textuel. */
	configJson: boolean;
	/** Vrai si `contenu` est un GLB, donc soumis à la limite de pièce jointe. */
	modele3d: boolean;
}

/** Ce dont `apercuCpk` a besoin — le sous-ensemble utile de `CpkFileMeta`. */
export interface EntreeApercu {
	path: string;
	ext: string;
}

/**
 * Décide de l'aperçu d'un fichier.
 *
 * Les URL viennent des fabricants de `@rosegriffon/azalee/cpk/shared` : le bot
 * ne réécrit aucun chemin CDN, sinon il finirait par montrer autre chose que le
 * wiki.
 */
export function apercuCpk(entree: EntreeApercu): ApercuCpk {
	const famille = cpkPreviewKind(entree.ext);
	const brut = cpkRawUrl(entree.path);
	const base: Omit<ApercuCpk, "contenu" | "image"> = {
		famille,
		libelle: previewKindLabel(famille),
		brut,
		configJson: famille === "config",
		modele3d: famille === "model",
	};

	if (famille === "image") {
		return {
			...base,
			// Le PNG pleine résolution reste le lien « original » ; l'embed, lui,
			// ne porte QUE la variante bornée (12 Mo mesurés sur une illustration
			// de galerie contre 80 Ko en `?w=800&format=webp`).
			contenu: cpkAssetUrl(entree.path, entree.ext) ?? brut,
			image: cpkThumbUrl(entree.path, entree.ext, LARGEUR_APERCU),
		};
	}
	if (famille === "model") {
		return { ...base, contenu: cpkAssetUrl(entree.path, entree.ext) ?? brut, image: null };
	}
	if (famille === "config") {
		return { ...base, contenu: cpkCfgUrl(entree.path), image: null };
	}
	if (famille === "sound") {
		return { ...base, contenu: cpkAudioUrl(entree.path), image: null };
	}
	if (famille === "movie") {
		return { ...base, contenu: cpkVideoUrl(entree.path), image: null };
	}
	return { ...base, contenu: brut, image: null };
}

/**
 * Liens à montrer pour un contenu que la fiche n'affiche pas elle-même
 * (texte, archive G4PK, son, vidéo).
 *
 * Quand aucun décodeur ne couvre le format, `contenu` EST déjà l'URL des octets
 * bruts : afficher deux fois la même URL sous deux libellés différents ferait
 * croire à deux ressources, dont une « décodée » qui n'existe pas.
 */
export function liensContenu(apercu: ApercuCpk): string {
	if (apercu.contenu === apercu.brut) {
		return [
			`[Octets bruts du CPK](${apercu.brut})`,
			"Aucun décodeur du CDN ne couvre ce format : le fichier est servi tel qu'il sort de l'archive.",
		].join("\n");
	}
	return [
		`[${apercu.libelle} — décodage à la demande](${apercu.contenu})`,
		`[Octets bruts du CPK](${apercu.brut})`,
	].join("\n");
}

// ─── Configs binaires décodées ──────────────────────────────────────────────

/**
 * Résume un `/cfg/*.json`.
 *
 * Le décodeur rend deux formes, toutes deux relevées le 13/8/2026 :
 *   - **RDBN** — `{"format":"rdbn","lists":[{"count":8,"name":"…","rows":[…]}]}`
 *   - **T2b**  — `{"format":"T2b","entries":[{"name":"…","children":[…],"variables":[…]}]}`
 * Toute autre forme retombe sur `null` : on n'invente pas un résumé.
 */
export function resumerConfig(valeur: unknown): string | null {
	if (typeof valeur !== "object" || valeur === null) {
		return null;
	}
	const objet = valeur as { format?: unknown; lists?: unknown; entries?: unknown };
	const format = typeof objet.format === "string" ? objet.format : null;

	if (Array.isArray(objet.lists)) {
		const listes = objet.lists as Array<{ name?: unknown; count?: unknown }>;
		const lignes = listes
			.slice(0, 8)
			.map((liste) => {
				const nom = typeof liste.name === "string" ? liste.name : "(sans nom)";
				const compte = typeof liste.count === "number" ? liste.count : 0;
				return `• \`${nom}\` — ${entierLisible(compte)} ligne${compte > 1 ? "s" : ""}`;
			})
			.join("\n");
		const reste = listes.length > 8 ? `\n… et ${listes.length - 8} autres listes` : "";
		return `Format **${format ?? "rdbn"}** · ${entierLisible(listes.length)} liste${
			listes.length > 1 ? "s" : ""
		}\n${lignes}${reste}`;
	}

	if (Array.isArray(objet.entries)) {
		const entrees = objet.entries as Array<{ name?: unknown; children?: unknown }>;
		const lignes = entrees
			.slice(0, 8)
			.map((entree) => {
				const nom = typeof entree.name === "string" ? entree.name : "(sans nom)";
				const enfants = Array.isArray(entree.children) ? entree.children.length : 0;
				return `• \`${nom}\` — ${entierLisible(enfants)} enfant${enfants > 1 ? "s" : ""}`;
			})
			.join("\n");
		const reste = entrees.length > 8 ? `\n… et ${entrees.length - 8} autres blocs` : "";
		return `Format **${format ?? "T2b"}** · ${entierLisible(entrees.length)} bloc${
			entrees.length > 1 ? "s" : ""
		} racine\n${lignes}${reste}`;
	}

	return format === null ? null : `Format **${format}**`;
}

/**
 * Rend un texte dans un bloc de code borné.
 *
 * Le bloc DOIT être fermé même après troncature : un ``` orphelin transforme le
 * reste de l'embed en code et rend la fiche illisible.
 */
export function blocCode(texte: string, langage = "", maxContenu = CARACTERES_EXTRAIT): string {
	const ouverture = `\`\`\`${langage}\n`;
	const fermeture = "\n```";
	const propre = texte.replaceAll("```", "'''");
	const contenu =
		propre.length > maxContenu ? `${propre.slice(0, Math.max(0, maxContenu - 1))}…` : propre;
	return `${ouverture}${contenu}${fermeture}`;
}

/**
 * Extrait présentable d'un JSON de configuration.
 *
 * `complet` dit si le corps distant a été lu en entier : dans ce cas on
 * ré-indente proprement, sinon on montre les octets tels quels (ré-indenter un
 * JSON tronqué est impossible, et prétendre le contraire serait un mensonge).
 */
export function extraitConfig(texte: string, complet: boolean): string {
	if (complet) {
		try {
			return blocCode(JSON.stringify(JSON.parse(texte), null, 1), "json");
		} catch {
			// Corps illisible : on le montre brut plutôt que de masquer le problème.
		}
	}
	return blocCode(texte, "json");
}
