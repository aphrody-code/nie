/**
 * Nettoyage du texte de jeu IEVR pour l'affichage wiki.
 *
 * Le texte décodé des dictionnaires Level5 contient des codes rich-text de la
 * famille `[C...]` (couleur / style : `[CG]`, `[CR]`, `[CPASSIVE01]`, `[CWIN_BLUE01]`…)
 * qui n'ont aucun sens hors du moteur. Pire, dans beaucoup de lignes (surtout
 * japonaises) les CROCHETS sont MAL PLACÉS (scramble) : `[CG2]卵[C]` peut sortir
 * `CG2][卵C]`. On retire donc :
 *   - les codes `[C...]` bien formés ;
 *   - les mots-clés de contrôle `C...` collés à un crochet (scramble) ;
 *   - les crochets ORPHELINS (non appariés) qui restent.
 *
 * On NE supprime JAMAIS de contenu réel : lettres latines, CJK, ponctuation,
 * sauts de ligne `\n`, espaces pleine-chasse CJK (U+3000), glyphes de position
 * `[GK] [DF] [MF] [FW] [PG]` (conservés tels quels) et toute autre paire de
 * crochets équilibrée non-`[C...]` (placeholders `[$gaiji_…]`, libellés comme
 * `[WARNING]`, `[MIL]`, `[Substitute Player]`…).
 *
 * Fonction PURE et client-safe (aucun I/O, aucun I/O serveur).
 *
 * Exemples de référence (voir test inline `scripts`/probe) :
 *   "Vous avez trouvé une [CG]cannette abandonnée[C]."
 *     -> "Vous avez trouvé une cannette abandonnée."
 *   "は　１０００円をわたして\nCG2][卵C]と[CG2][牛乳C]を[買った！"
 *     -> "は　１０００円をわたして\n卵と牛乳を買った！"
 *   "ヘルプのなかには　CR][長押しC]で\nすぐに　[見られるものもあります。"
 *     -> "ヘルプのなかには　長押しで\nすぐに　見られるものもあります。"
 */

/** Glyphes de POSITION à préserver tels quels (libellés de poste de jeu). */
const POSITION_GLYPHS = ["GK", "DF", "MF", "FW", "PG"] as const;

/**
 * Sentinelles (zone à usage privé Unicode) pour mettre les glyphes de position
 * à l'abri pendant le retrait des codes / crochets orphelins, puis les restaurer.
 * Ces points de code n'apparaissent pas dans le texte du jeu.
 */
const GLYPH_SENTINEL_BASE = 0xf8f0;

// Codes rich-text Level5 de la famille `[C...]` : mot-clé = `C` suivi de
// MAJUSCULES, chiffres et `_` (couvre `C`, `CG`, `CG2`, `CR`, `CN`, `CDN`,
// `CMODE03`, `CPASSIVE01`, `CTACTICS01`, `CWIN_BLUE01`…). On reste sur du
// MAJUSCULE strict pour ne PAS toucher les placeholders `[$gaiji_…_c11010010]`
// (minuscule).
const C_KEYWORD = "C[A-Z0-9_]*";
const RE_WELL_FORMED = new RegExp(`\\[${C_KEYWORD}\\]`, "g"); // [CG] [CPASSIVE01]…
// scramble `卵C]`, `CG2]` : le mot-clé NE doit PAS être précédé d'une lettre latine
// (sinon on mangerait la queue d'un mot comme `[ABC]` -> `AB`). Les vrais cas de
// scramble sont précédés de CJK / crochet / espace / début — jamais d'une lettre A-Za-z.
const RE_KEYWORD_CLOSE = new RegExp(`(?<![A-Za-z])${C_KEYWORD}\\]`, "g");
const RE_OPEN_KEYWORD = new RegExp(`\\[${C_KEYWORD}`, "g"); // scramble : `[CG2` (sans fermeture)

/** Remplace les glyphes de position par des sentinelles inviolables. */
function protectGlyphs(input: string): string {
	let out = input;
	POSITION_GLYPHS.forEach((g, i) => {
		out = out.split(`[${g}]`).join(String.fromCodePoint(GLYPH_SENTINEL_BASE + i));
	});
	return out;
}

/** Restaure les glyphes de position depuis leurs sentinelles. */
function restoreGlyphs(input: string): string {
	let out = input;
	POSITION_GLYPHS.forEach((g, i) => {
		out = out.split(String.fromCodePoint(GLYPH_SENTINEL_BASE + i)).join(`[${g}]`);
	});
	return out;
}

/**
 * Retire les codes `[C...]` (bien formés ET scramblés). Itère jusqu'à stabilité :
 * un retrait peut en révéler un autre (codes adjacents/imbriqués).
 */
function stripControlCodes(input: string): string {
	let prev: string;
	let out = input;
	let guard = 0;
	do {
		prev = out;
		out = out.replace(RE_WELL_FORMED, "");
		out = out.replace(RE_KEYWORD_CLOSE, "");
		out = out.replace(RE_OPEN_KEYWORD, "");
		guard++;
	} while (out !== prev && guard < 8);
	return out;
}

/**
 * Supprime UNIQUEMENT les crochets orphelins (non appariés). Les paires
 * équilibrées `[…]` (placeholders, libellés) sont conservées intactes. On apparie
 * via une pile : tout `[` sans `]` correspondant et tout `]` sans `[` est retiré.
 */
function stripOrphanBrackets(input: string): string {
	if (!input.includes("[") && !input.includes("]")) return input;
	const chars = [...input];
	const stack: number[] = [];
	const drop = new Set<number>();
	for (let i = 0; i < chars.length; i++) {
		const c = chars[i];
		if (c === "[") {
			stack.push(i);
		} else if (c === "]") {
			if (stack.length > 0) stack.pop();
			else drop.add(i); // `]` orphelin
		}
	}
	for (const i of stack) drop.add(i); // `[` orphelins restants
	if (drop.size === 0) return input;
	return chars.filter((_, i) => !drop.has(i)).join("");
}

/**
 * Normalise les espaces : réduit les suites d'espaces ASCII à un seul et retire
 * les espaces ASCII en fin de chaque ligne. Préserve `\n` et les espaces
 * pleine-chasse CJK (U+3000). N'ajoute aucune ligne vide.
 */
function normalizeWhitespace(input: string): string {
	let out = input.replace(/ {2,}/g, " ");
	out = out
		.split("\n")
		.map((line) => line.replace(/ +$/, ""))
		.join("\n");
	return out;
}

/**
 * Nettoie une chaîne de texte de jeu brute pour l'affichage.
 * NFC -> retrait codes `[C...]` -> retrait crochets orphelins -> espaces.
 */
export function formatGameText(raw: string): string {
	if (!raw) return raw;
	let s = raw.normalize("NFC");
	s = protectGlyphs(s);
	s = stripControlCodes(s);
	s = stripOrphanBrackets(s);
	s = restoreGlyphs(s);
	s = normalizeWhitespace(s);
	return s;
}
