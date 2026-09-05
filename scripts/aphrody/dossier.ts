#!/usr/bin/env bun
/**
 * Construit le dossier le plus complet possible sur un personnage :
 *   <sortie>/aphrody.json  — toutes les donnees, chaque champ portant sa source
 *   <sortie>/aphrody.ld    — le meme dossier en JSON-LD schema.org, pret a inserer
 *
 * Quatre sources, trois roles distincts :
 *   1. var/mirror.sqlite      LA donnee (extraite du jeu) — c'est elle qui fait autorite
 *   2. zukan.inazuma.jp       LE canon officiel L5 (numero de zukan, surnom EN, equipes,
 *                             tranche d'age, annee scolaire, description officielle)
 *   3. azalee.rosegriffon.fr  CE QUI EST DEJA PUBLIE — sert a mesurer l'ecart, pas a lire
 *   4. Fandom (API MediaWiki) UNIQUEMENT la liste des sections et des champs d'infobox,
 *                             c'est-a-dire une CHECKLIST DE COUVERTURE. Aucun texte de
 *                             Fandom n'est lu, stocke ni recopie — leur prose est sous
 *                             CC BY-SA et n'a rien a faire dans nos donnees.
 *
 * Profil bxc : `http` + `--force`. Mesure du 2026-09-05 sur ces quatre URL — `stealth` et
 * `max` rendent un corps VIDE avec un code de sortie 0, et bxc met ce vide en cache : les
 * appels suivants, meme avec un bon profil, resservent 2 octets. D'ou le `--force`
 * systematique. Un corps sous 500 octets est traite comme un echec, jamais comme une page.
 *
 * Usage :
 *   bun --bun scripts/aphrody/dossier.ts [base_slug] [--sortie <dir>] [--zukan <url>] [--hors-ligne]
 */

import { Database } from "bun:sqlite";
import { romaji, romajiNom } from "./kana.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const RACINE = resolve(dirname(new URL(import.meta.url).pathname), "..", "..");
const SITE = "https://azalee.rosegriffon.fr";
const CDN = "https://cdn.rosegriffon.fr";
const MIROIR = join(RACINE, "var", "mirror.sqlite");

// ---------------------------------------------------------------- arguments

function args() {
    const a = process.argv.slice(2);
    const drapeaux = new Set(["--sortie", "--zukan", "--fandom", "--google"]);
    const lire = (nom: string, defaut: string) => {
        const i = a.indexOf(nom);
        return i >= 0 && a[i + 1] ? a[i + 1]! : defaut;
    };
    const positionnels = a.filter((x, i) => !x.startsWith("--") && !drapeaux.has(a[i - 1] ?? ""));
    // `--zukan` est repetable : une URL par langue. Le zukan japonais porte le furigana et
    // les noms d'equipe en japonais, que la version anglaise ne rend pas du tout.
    const zukan = a.flatMap((x, i) => (x === "--zukan" && a[i + 1] ? [a[i + 1]!] : []));
    // `--fandom lang:Page`, repetable. Le wiki anglais est nettement plus structure que le
    // francais (Keshin, Mixi Max, Voicelines, Recruitment) : les deux valent d'etre compares.
    const fandom = a.flatMap((x, i) => (x === "--fandom" && a[i + 1] ? [a[i + 1]!] : []));
    return {
        fandom,
        google: lire("--google", ""),
        slug: positionnels[0] ?? "byron-love-aphrody",
        sortie: lire("--sortie", join(RACINE, "var", "aphrody")),
        zukan,
        horsLigne: a.includes("--hors-ligne"),
    };
}

// ---------------------------------------------------------------- bxc

/** Recupere une page en Markdown via bxc. Rend null plutot que de mentir sur un corps vide. */
async function bxc(url: string): Promise<string | null> {
    const p = Bun.spawn(["bxc", "scrape", url, "--markdown", "--profile", "http", "--force"], {
        // hors du depot : bunfig.toml y precharge nie-plugin, qui echoue sans `bun install`
        cwd: "/tmp",
        stdout: "pipe",
        stderr: "ignore",
    });
    const texte = await new Response(p.stdout).text();
    await p.exited;
    const corps = texte.replace(/^\[smartFetch\][^\n]*\n/gm, "").trim();
    if (corps.length < 500) {
        console.error(`  ! ${url} → ${corps.length} o, traite comme un echec`);
        return null;
    }
    return corps;
}

// ---------------------------------------------------------------- CRC32

const TABLE_CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

/** CRC32 (IEEE, celui de zlib) d'une chaine ASCII, en `0x` minuscule sur 8 chiffres. */
function crc32Hex(s: string): string {
    let c = 0xffffffff;
    for (let i = 0; i < s.length; i++) c = TABLE_CRC[(c ^ s.charCodeAt(i)) & 0xff]! ^ (c >>> 8);
    return "0x" + ((c ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------- gisement extrait

type Ligne = Record<string, unknown>;

function gisement(slugBase: string) {
    const db = new Database(MIROIR, { readonly: true });
    const variantes = db
        .query("select * from inagle_characters where base_slug = ?1 order by is_primary desc, zukan_order asc")
        .all(slugBase) as Ligne[];
    if (variantes.length === 0) throw new Error(`aucune ligne pour base_slug='${slugBase}' dans ${MIROIR}`);

    const principal = variantes[0]!;
    const codes = [...new Set(variantes.map((v) => String(v.internal_code)))];

    // Les techniques sont referencees par HASH, pas par code : `inagle_characters.skills`
    // porte des `{skillId:"0x62294D90", learnLevel:0}`. La colonne `inagle_skills.hash_id`
    // est NULL sur toute la table — la jointure se fait donc en recalculant le CRC32 du
    // code interne cote script (verifie : crc32("rho10010") == 0x62294D90).
    const apprentissage = new Map<string, number>(); // hash → niveau d'apprentissage
    for (const v of variantes) {
        try {
            for (const s of JSON.parse(String(v.skills ?? "[]")) as Ligne[]) {
                const h = String(s.skillId ?? "").toLowerCase();
                if (!h) continue;
                const lvl = Number(s.learnLevel ?? 0);
                apprentissage.set(h, Math.min(apprentissage.get(h) ?? lvl, lvl));
            }
        } catch {
            /* colonne absente ou non-JSON : on rend simplement zero technique */
        }
    }
    const toutes = db
        .query(
            `select internal_code, name_fr, name_en, name_ja, description_fr, description_en,
                    element, category, power_min, power_max, tp_cost, tension_cost, is_hyper,
                    image_url, video_url, thumbnail_url
               from inagle_skills`,
        )
        .all() as Ligne[];
    const skills = toutes
        .map((s) => ({ ...s, _hash: crc32Hex(String(s.internal_code)) }))
        .filter((s) => apprentissage.has(s._hash))
        .map((s) => ({ ...s, niveau_apprentissage: apprentissage.get(s._hash)! }))
        .sort((a, b) => a.niveau_apprentissage - b.niveau_apprentissage);
    const orphelins = [...apprentissage.keys()].filter((h) => !skills.some((s) => s._hash === h));

    const equipe = principal.team_id
        ? (db.query("select * from inagle_teams where id = ?1 or internal_code = ?1").get(String(principal.team_id)) as Ligne | null)
        : null;

    db.close();
    return { variantes, principal, codes, skills, equipe, orphelins };
}

// ---------------------------------------------------------------- zukan officiel

/** `ja` sauf si l'URL porte un segment de langue explicite (`/en/`). */
function localeZukan(url: string): "ja" | "en" {
    return /\/(en)\//.test(url) ? "en" : "ja";
}

/**
 * Lit le tableau de resultats du zukan. Une ligne = une version canonique du personnage.
 * La colonne du nom porte, en japonais seulement, le furigana a la suite des kanji :
 * « 亜風炉 照美 あふろ てるみ ». On le separe, c'est la lecture officielle et nous ne
 * l'avons dans aucun gisement.
 */
function parseZukan(md: string, locale: "ja" | "en" = "en") {
    // Le zukan japonais sert ses liens sans segment de langue : filtrer sur "/en/chara_param/"
    // ne matche AUCUNE ligne de la page JA, et le parseur rend zero version sans rien dire.
    const lignes = md.split("\n").filter((l) => l.trim().startsWith("|") && /\/(?:en\/)?chara_param\//.test(l));
    return lignes.map((l) => {
        const c = l.split("|").map((x) => x.trim());
        const cell = (i: number) => (c[i] ?? "").replace(/<br\/>/g, " · ").replace(/\\-/g, "—").trim();
        const nom = c[3] ?? "";
        const brut = ((nom.match(/\]\s*\(\/(?:en\/)?chara_param/) ? nom : nom).match(/\[([^\]]*?)\s*\]\(\/(?:en\/)?chara_param/) ?? [])[1] ?? "";
        // kanji + espace + kana : tout ce qui suit le premier bloc hiragana est le furigana
        const fura = locale === "ja" ? (brut.match(/^(\S+\s+\S+)\s+([\u3040-\u309f\s]+)$/) ?? null) : null;
        return {
            locale,
            numero: cell(2),
            nom: (nom.match(/\[!\[([^\]]+)\]/) ?? [])[1] ?? null,
            nom_complet: fura ? fura[1]!.trim() : brut.trim() || null,
            furigana: fura ? fura[2]!.replace(/\s+/g, " ").trim() : null,
            image: (nom.match(/\((https:\/\/[^\s)]+\.png)\)/) ?? [])[1] ?? null,
            lien_fiche: (nom.match(/\((\/(?:en\/)?chara_param\/[^\s)]+)\)/) ?? [])[1]?.replace(/%3D/g, "=") ?? null,
            lien_modele: (nom.match(/\((\/(?:en\/)?chara_model_view\/[^\s)]+)\)/) ?? [])[1] ?? null,
            surnom: cell(4),
            jeu: cell(5),
            genre: cell(6),
            element: cell(7),
            poste: cell(8),
            role: cell(9),
            tranche_age: cell(10),
            annee_scolaire: cell(11),
            equipes: cell(12).split(" · ").map((x) => x.trim()).filter(Boolean),
            description_officielle_en: cell(13).replace(/\s*·\s*/g, " ").replace(/\s+/g, " ").trim(),
        };
    });
}

// ---------------------------------------------------------------- Fandom : couverture seule

/** Rend la STRUCTURE d'une page Fandom (titres de sections, noms de champs). Jamais son texte. */
async function couvertureFandom(lang: string, page: string) {
    // fandom.com sert le wiki anglais a la racine, les autres langues sous /<lang>/
    const base = lang === "en" ? "https://inazuma-eleven.fandom.com" : `https://inazuma-eleven.fandom.com/${lang}`;
    const url = `${base}/api.php?action=parse&page=${encodeURIComponent(page)}&prop=sections%7Cwikitext&format=json`;
    const r = await fetch(url, { headers: { "user-agent": "azalee-coverage-audit/1.0 (comparaison de champs)" } });
    if (!r.ok) return null;
    const j = (await r.json()) as { parse?: { sections?: { level: string; line: string }[]; wikitext?: { "*": string } } };
    const wikitext = j.parse?.wikitext?.["*"] ?? "";
    const champs = [...wikitext.slice(0, 4000).matchAll(/^\|\s*([A-Za-zÀ-ÿ_0-9 ]+?)\s*=/gm)].map((m) => m[1]!.trim());
    const propre = (t: string) => t.replace(/<[^>]+>/g, "").trim();
    return {
        lang,
        page,
        url: `${base}/wiki/${encodeURIComponent(page)}`,
        sections: (j.parse?.sections ?? []).map((s) => ({ niveau: Number(s.level), titre: propre(s.line) })),
        champs_infobox: [...new Set(champs)],
        note: "structure seule — aucun texte de Fandom n'est lu ni repris (CC BY-SA)",
    };
}

// ---------------------------------------------------------------- recherche web

/**
 * Ce que le public cherche reellement, via l'autocompletion Google (`bxc google suggest`).
 *
 * Pourquoi l'autocompletion et pas la recherche : mesure du 2026-09-05 — `bxc search` ET
 * `bxc google search` rendent tous deux une liste VIDE sur ces requetes, tandis que
 * `suggest` repond (il est keyless et n'est pas derriere la meme protection). Et le
 * resultat est plus utile qu'une liste de liens : sur « 亜風炉 照美 » il rend 声優
 * (doubleur), 誕生日 (anniversaire), 読み方 (lecture), 背番号 (numero de maillot) — soit
 * exactement les champs que notre ecart de couverture signale comme manquants. Une demande
 * mesuree, pas supposee.
 */
async function suggestions(q: string) {
    if (!q) return null;
    const p = Bun.spawn(["bxc", "google", "suggest", q], { cwd: "/tmp", stdout: "pipe", stderr: "ignore" });
    const txt = await new Response(p.stdout).text();
    await p.exited;
    try {
        const l = JSON.parse(txt) as unknown;
        return { requete: q, suggestions: Array.isArray(l) ? (l as string[]) : [] };
    } catch {
        return { requete: q, suggestions: [] as string[] };
    }
}

// ---------------------------------------------------------------- ecart de couverture

type Couverture = { lang: string; champs_infobox: string[]; sections: { titre: string }[] };

function ecart(dossier: Ligne, wikis: Couverture[], zukan: ReturnType<typeof parseZukan>) {
    const vide = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
    const manquants: string[] = [];

    // Ce que le zukan officiel publie et que notre gisement laisse vide.
    const z = zukan[0];
    if (z) {
        const corr: [string, unknown, unknown][] = [
            ["nickname", ((dossier.identite ?? {}) as Ligne).surnom, z.surnom],
            ["age_group", ((dossier.identite ?? {}) as Ligne).tranche_age, z.tranche_age],
            ["school_year", ((dossier.identite ?? {}) as Ligne).annee_scolaire, z.annee_scolaire],
            ["teams", ((dossier.identite ?? {}) as Ligne).equipes, z.equipes],
            ["role", ((dossier.identite ?? {}) as Ligne).role, z.role],
        ];
        for (const [nom, notre, leur] of corr) if (vide(notre) && !vide(leur)) manquants.push(`zukan:${nom}`);
    }

    // Champs d'infobox Fandom sans equivalent chez nous (checklist, pas contenu).
    // Les infobox de Fandom n'ont pas de schema : les noms de champs varient d'une page a
    // l'autre. On normalise avant de comparer, sinon « Elément » et « Élément » comptent pour
    // deux manques distincts et le rapport ment sur son propre chiffre.
    const id = (dossier.identite ?? {}) as Ligne;
    const md = (dossier.medias ?? {}) as Ligne;
    const norm = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const equiv: Record<string, unknown> = {
        nom: id.nom_fr,
        "nom fr": id.nom_fr,
        "nom jp": id.nom_ja,
        "nom en": id.nom_en,
        "surnom fr": id.surnom,
        "surnom jp": id.surnom,
        image: md.portrait,
        sexe: id.genre,
        genre: id.genre,
        position: id.poste,
        equipe: id.equipes,
        classe: id.annee_scolaire,
        element: id.element,
        elemant: id.element,
        numero: id.zukan,
        "debut jeu": id.serie,
        // Le wiki anglais nomme ses champs en snake_case technique — meme donnee, autre cle.
        name: id.nom_fr,
        name_jp: id.nom_ja_officiel ?? id.nom_ja,
        name_dub: id.nom_en,
        nickname_jp: id.surnom_ja,
        nickname_dub: id.surnom,
        gender: id.genre,
        number: id.zukan,
        team: id.equipes,
        school_year: id.annee_scolaire,
        position: id.poste,
        element_en: id.element,
        debut_game: id.serie,
        // Toujours sans equivalent chez nous — c'est le resultat utile :
        birthday: undefined,
        seiyuu: undefined,
        va: undefined,
        debut_anime: undefined,
        debut_manga: undefined,
        // Sans equivalent chez nous, et c'est le resultat utile de la comparaison :
        anniversaire: undefined,
        nationalite: undefined,
        voix: undefined,
        "debut anime": undefined,
        "debut manga": undefined,
    };
    for (const w of wikis) {
        for (const champ of w.champs_infobox) if (vide(equiv[norm(champ)])) manquants.push(`fandom-${w.lang}:${champ}`);
        for (const s of w.sections) {
            const t = norm(s.titre);
            // Sections redigees ou factuelles que nos gisements ne portent pas du tout.
            if (/personnalit|personality|apparence|appearance|histoire|plot|recrutement|recruitment|voiceline|keshin|mixi|soul|armed/.test(t))
                manquants.push(`fandom-${w.lang}-section:${s.titre}`);
        }
    }
    return [...new Set(manquants)];
}

// ---------------------------------------------------------------- JSON-LD

function jsonLd(d: Ligne) {
    const id = d.identite as Ligne;
    const m = d.medias as Ligne;
    const url = `${SITE}/chara/${d.slug}`;
    const jeu = {
        "@type": "VideoGame",
        name: "Inazuma Eleven: Victory Road",
        publisher: { "@type": "Organization", name: "LEVEL-5 Inc." },
    };
    return {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": ["Person", "Thing"],
                "@id": `${url}#concept`,
                name: id.nom_fr,
                alternateName: [...new Set([id.nom_en, id.nom_ja, id.nom_ja_officiel, id.furigana, id.romaji, id.surnom, id.surnom_ja].filter(Boolean))],
                identifier: (d.codes_internes as string[])?.[0],
                description: id.description_fr ?? id.description_en,
                image: [m.portrait, ...((m.visages as string[]) ?? [])].filter(Boolean),
                url,
                mainEntityOfPage: { "@id": url },
                isPartOf: { "@id": `${SITE}#jeu` },
                inLanguage: "fr",
                subjectOf: ((d.techniques as Ligne[]) ?? []).map((s) => ({
                    "@type": "CreativeWork",
                    name: s.nom_fr ?? s.nom_en,
                    url: `${SITE}/skill/${s.internal_code}`,
                })),
                additionalProperty: [
                    ["Élément", id.element],
                    ["Poste", id.poste],
                    ["Numéro de zukan", id.zukan],
                    ["Série", id.serie],
                    ["Lecture (furigana)", id.furigana],
                    ["Romaji", id.romaji],
                    ["Nom japonais officiel", id.nom_ja_officiel],
                    ...Object.entries((d.statistiques as Ligne)?.niveau_99 ?? {}),
                ]
                    .filter(([, v]) => v !== null && v !== undefined && v !== "")
                    .map(([nom, valeur]) => ({ "@type": "PropertyValue", name: nom, value: valeur })),
            },
            { ...jeu, "@id": `${SITE}#jeu`, url: "https://www.inazuma.jp/victory-road/" },
            {
                "@type": "WebPage",
                "@id": url,
                url,
                name: `${id.nom_fr} — fiche complète`,
                isPartOf: { "@type": "WebSite", "@id": `${SITE}#site`, name: "Azalée", url: SITE },
                primaryImageOfPage: m.portrait,
                dateModified: d.genere_le,
                breadcrumb: {
                    "@type": "BreadcrumbList",
                    itemListElement: [
                        { "@type": "ListItem", position: 1, name: "Accueil", item: SITE },
                        { "@type": "ListItem", position: 2, name: "Joueurs", item: `${SITE}/chara` },
                        { "@type": "ListItem", position: 3, name: id.nom_fr, item: url },
                    ],
                },
            },
        ],
    };
}

// ---------------------------------------------------------------- main

const o = args();
console.error(`dossier « ${o.slug} »`);

const g = gisement(o.slug);
const p = g.principal;
console.error(`  extrait : ${g.variantes.length} variantes, ${g.codes.length} codes, ${g.skills.length} techniques`);

let zukan: ReturnType<typeof parseZukan> = [];
let zukanJa: ReturnType<typeof parseZukan> = [];
let wikis: Couverture[] = [];
let web: Awaited<ReturnType<typeof suggestions>> = null;
let publiee: string | null = null;

if (!o.horsLigne) {
    const cibles = o.fandom.length
        ? o.fandom.map((x) => {
              const i = x.indexOf(":");
              return i > 0 ? { lang: x.slice(0, i), page: x.slice(i + 1) } : { lang: "fr", page: x };
          })
        : [{ lang: "fr", page: String(p.name_fr ?? "").replace(/ Aphrody$/, "").replace(/ /g, "_") }];
    const [pagesZukan, mdPage, cov, g6] = await Promise.all([
        Promise.all(o.zukan.map(async (u) => ({ url: u, md: await bxc(u) }))),
        bxc(`${SITE}/chara/${o.slug}`),
        Promise.all(cibles.map((c) => couvertureFandom(c.lang, c.page))),
        suggestions(o.google),
    ]);
    for (const { url, md } of pagesZukan) {
        if (!md) continue;
        const lu = parseZukan(md, localeZukan(url));
        if (lu[0]?.locale === "ja") zukanJa = lu;
        else zukan = lu;
    }
    // Si une seule langue a ete fournie, elle sert de reference pour les deux.
    if (zukan.length === 0) zukan = zukanJa;
    publiee = mdPage;
    wikis = cov.filter((x): x is NonNullable<typeof x> => x !== null);
    web = g6;
    console.error(
        `  zukan : ${zukan.length} versions EN, ${zukanJa.length} JA · azalee : ${publiee ? "lue" : "non lue"}` +
            ` · fandom : ${wikis.map((w) => `${w.lang}=${w.sections.length} sections`).join(", ") || "indisponible"}` +
            (web ? ` · suggest : ${web.suggestions.length} requetes` : ""),
    );
}

const face = (code: string) => `${CDN}/dx11/menu/200_icon/10_icon_chr/face/${code}_l.png`;
const stat = (n: string) => ({
    lv1: p[`stat_lv1_${n}`] ?? null,
    lv99: p[`stat_${n}`] ?? null,
});

const dossier: Ligne = {
    slug: o.slug,
    genere_le: new Date().toISOString(),
    identite: {
        nom_fr: p.name_fr,
        nom_en: p.name_en,
        nom_ja: p.name_ja,
        nom_ja_officiel: zukanJa[0]?.nom_complet ?? null,
        furigana: zukanJa[0]?.furigana ?? null,
        // Calcule hors ligne depuis le furigana officiel : deterministe, donc rejouable.
        // `bxc google translate` aurait pu le rendre, mais il tombe en 429 des le 2e appel
        // et deux imports donneraient deux romanisations differentes.
        romaji: zukanJa[0]?.furigana ? romajiNom(zukanJa[0].furigana) : null,
        romaji_surnom: zukanJa[0]?.surnom ? romaji(zukanJa[0].surnom) : null,
        surnom: p.nickname ?? zukan[0]?.surnom ?? null,
        surnom_ja: zukanJa[0]?.surnom ?? null,
        zukan: p.zukan_order,
        zukan_officiel: zukan.map((z) => z.numero),
        serie: p.series,
        element: p.element,
        poste: p.position,
        genre: p.gender ?? zukan[0]?.genre ?? null,
        rarete: p.rarity_label ?? p.rarity,
        constellation: p.constellation,
        tranche_age: p.age_group ?? zukan[0]?.tranche_age ?? null,
        annee_scolaire: p.school_year ?? zukan[0]?.annee_scolaire ?? null,
        equipes: (() => {
            try {
                const t = JSON.parse(String(p.teams ?? "[]"));
                return Array.isArray(t) && t.length ? t : (zukan[0]?.equipes ?? []);
            } catch {
                return zukan[0]?.equipes ?? [];
            }
        })(),
        role: zukan[0]?.role ?? null,
        role_ja: zukanJa[0]?.role ?? null,
        equipes_ja: zukanJa[0]?.equipes ?? [],
        serie_ja: zukanJa[0]?.jeu ?? null,
        description_fr: p.description_fr,
        description_en: p.description_en,
        description_ja: p.description_ja,
        description_officielle_en: zukan[0]?.description_officielle_en ?? null,
        description_officielle_ja: zukanJa[0]?.description_officielle_en ?? null,
    },
    codes_internes: g.codes,
    variantes: g.variantes.map((v) => ({
        slug: v.slug,
        url: `${SITE}/chara/${v.slug}`,
        code: v.internal_code,
        serie: v.series,
        poste: v.position,
        principale: !!v.is_primary,
    })),
    statistiques: {
        total: p.stat_total,
        niveau_1: Object.fromEntries(["frappe", "controle", "technique", "pression", "physique", "agilite", "intelligence"].map((n) => [n, p[`stat_lv1_${n}`] ?? null])),
        niveau_99: Object.fromEntries(["frappe", "controle", "technique", "pression", "physique", "agilite", "intelligence"].map((n) => [n, p[`stat_${n}`] ?? null])),
        progression: Object.fromEntries(["frappe", "controle", "technique", "pression", "physique", "agilite", "intelligence"].map((n) => [n, stat(n)])),
    },
    techniques: g.skills.map((s) => ({
        internal_code: s.internal_code,
        hash: (s as Ligne)._hash,
        niveau_apprentissage: (s as Ligne).niveau_apprentissage,
        nom_fr: s.name_fr,
        nom_en: s.name_en,
        nom_ja: s.name_ja,
        description_fr: s.description_fr,
        element: s.element,
        categorie: s.category,
        puissance: [s.power_min, s.power_max],
        cout_tp: s.tp_cost ?? s.tension_cost,
        hyper: !!s.is_hyper,
        url: `${SITE}/skill/${s.internal_code}`,
        telop: `${CDN}/dx11/menu/220_img/telop_waza/fr/${s.internal_code}.png`,
        video: s.video_url ?? null,
        vignette: s.thumbnail_url ?? null,
    })),
    equipe: g.equipe
        ? {
              nom_fr: g.equipe.name_fr,
              nom_en: g.equipe.name_en,
              nom_ja: g.equipe.name_ja,
              emblem: g.equipe.emblem_url,
              url: `${SITE}/equipe/${g.equipe.internal_code ?? g.equipe.id}`,
          }
        : null,
    medias: {
        portrait: p.image_url ?? zukan[0]?.image ?? null,
        visages: g.codes.map(face),
        zukan: zukan.map((z) => ({ jeu: z.jeu, image: z.image, fiche: z.lien_fiche ? `https://zukan.inazuma.jp${z.lien_fiche}` : null, modele_3d: z.lien_modele ? `https://zukan.inazuma.jp${z.lien_modele}` : null })),
        modele_3d: p.model_id ? `${SITE}/modeles/${p.model_id}` : null,
    },
    sources: {
        extrait: { fichier: "var/mirror.sqlite", table: "inagle_characters", lignes: g.variantes.length, confiance: "cle" },
        zukan: {
            urls: o.zukan,
            versions_en: zukan.length,
            versions_ja: zukanJa.length,
            confiance: "cle",
            note: "canon officiel LEVEL-5 ; le zukan japonais est la seule source du furigana",
        },
        azalee: { url: `${SITE}/chara/${o.slug}`, lue: !!publiee, octets: publiee?.length ?? 0, confiance: "publie" },
        techniques_orphelines: g.orphelins,
        fandom: wikis.length
            ? { role: "checklist de couverture uniquement — aucun texte lu ni repris", wikis }
            : null,
        demande_publique: web,
    },
    couverture: { manquants: [] as string[] },
};

// L'ecart se mesure sur le dossier assemble : il se calcule apres, pas dans l'initialiseur.
(dossier.couverture as Ligne).manquants = ecart(dossier, wikis, zukan);

mkdirSync(o.sortie, { recursive: true });
const fJson = join(o.sortie, "aphrody.json");
const fLd = join(o.sortie, "aphrody.ld");
writeFileSync(fJson, JSON.stringify(dossier, null, 2) + "\n");
writeFileSync(fLd, JSON.stringify(jsonLd(dossier), null, 2) + "\n");

console.error(`\n  ${fJson}`);
console.error(`  ${fLd}`);
console.error(`  ${(dossier.couverture as Ligne).manquants as string[]}`.replace(/,/g, ", "));
