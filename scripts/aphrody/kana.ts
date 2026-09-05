/**
 * Translitteration kana → romaji (Hepburn modifie), deterministe et hors ligne.
 *
 * Pourquoi ici plutot qu'une API : `bxc google translate` rend un 429 des le second appel,
 * et une romanisation qui depend du reseau n'est pas reproductible — deux imports rendraient
 * deux slugs. Hepburn est une table fermee : la meme entree donne toujours la meme sortie.
 *
 * Le furigana du zukan japonais (« あふろ てるみ ») est la SEULE source de lecture officielle
 * dont nous disposons ; les kanji seuls ne se lisent pas (亜風炉 est un ateji).
 */

const BASE: Record<string, string> = {
    あ: "a", い: "i", う: "u", え: "e", お: "o",
    か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
    さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
    た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
    な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
    は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
    ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
    や: "ya", ゆ: "yu", よ: "yo",
    ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
    わ: "wa", ゐ: "i", ゑ: "e", を: "o", ん: "n",
    が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
    ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
    だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
    ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
    ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
    ゔ: "vu", ー: "-",
};

/** Digrammes : consonne + petit ya/yu/yo. « しゃ » = sha, pas shiya. */
const YOON: Record<string, string> = {
    きゃ: "kya", きゅ: "kyu", きょ: "kyo",
    しゃ: "sha", しゅ: "shu", しょ: "sho",
    ちゃ: "cha", ちゅ: "chu", ちょ: "cho",
    にゃ: "nya", にゅ: "nyu", にょ: "nyo",
    ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo",
    みゃ: "mya", みゅ: "myu", みょ: "myo",
    りゃ: "rya", りゅ: "ryu", りょ: "ryo",
    ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
    じゃ: "ja", じゅ: "ju", じょ: "jo",
    びゃ: "bya", びゅ: "byu", びょ: "byo",
    ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",
    てぃ: "ti", でぃ: "di", とぅ: "tu", どぅ: "du",
    ふぁ: "fa", ふぃ: "fi", ふぇ: "fe", ふぉ: "fo",
    うぃ: "wi", うぇ: "we", うぉ: "wo",
    ゔぁ: "va", ゔぃ: "vi", ゔぇ: "ve", ゔぉ: "vo",
};

/** Katakana → hiragana, pour n'avoir qu'une table a maintenir. */
function versHiragana(s: string): string {
    return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/**
 * Rend le romaji Hepburn d'une chaine kana. Les caracteres non-kana (espaces, latin,
 * ponctuation) passent tels quels — une chaine deja latine ressort inchangee.
 */
export function romaji(kana: string): string {
    const s = versHiragana(kana);
    let out = "";
    let i = 0;
    while (i < s.length) {
        const deux = s.slice(i, i + 2);
        if (YOON[deux]) {
            out += YOON[deux];
            i += 2;
            continue;
        }
        const c = s[i]!;
        if (c === "っ") {
            // Sokuon : redouble la consonne suivante. « はっと » → hatto.
            const suiv = YOON[s.slice(i + 1, i + 3)] ?? BASE[s[i + 1] ?? ""] ?? "";
            const cons = suiv.match(/^(ch|sh|ts|[kstnhfmyrwgzjdbpv])/)?.[1];
            out += cons === "ch" ? "t" : (cons?.[0] ?? "");
            i += 1;
            continue;
        }
        if (c === "ー") {
            // Allongement : redouble la derniere voyelle plutot qu'un tiret dans un slug.
            out += out.match(/[aeiou]$/)?.[0] ?? "";
            i += 1;
            continue;
        }
        if (c === "ん") {
            // « n » devient « n' » devant une voyelle ou un y, sinon la lecture est ambigue.
            const suiv = BASE[s[i + 1] ?? ""] ?? "";
            out += /^[aeiouy]/.test(suiv) ? "n'" : "n";
            i += 1;
            continue;
        }
        out += BASE[c] ?? c;
        i += 1;
    }
    return out;
}

/** Romaji en Majuscule Initiale par mot — la forme attendue pour un nom propre. */
export function romajiNom(kana: string): string {
    return romaji(kana)
        .split(/\s+/)
        .filter(Boolean)
        .map((m) => m.charAt(0).toUpperCase() + m.slice(1))
        .join(" ");
}
