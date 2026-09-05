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
import { assets, type Asset } from "./sources/vfs.ts";
import { lirePet } from "./sources/pet.ts";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const RACINE = resolve(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..");
const SITE = "https://azalee.rosegriffon.fr";
const CDN = "https://cdn.rosegriffon.fr";
const MIROIR = join(RACINE, "var", "mirror.sqlite");

// ---------------------------------------------------------------- arguments

function args() {
    const a = process.argv.slice(2);
    const drapeaux = new Set(["--sortie", "--zukan", "--fandom", "--google", "--fiche", "--base"]);
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
    // Les fiches `chara_param` ne sont pas devinables : leurs URL viennent des colonnes
    // `lien_fiche` du tableau de resultats. `--fiche auto` les suit toutes seules.
    const fiche = a.flatMap((x, i) => (x === "--fiche" && a[i + 1] ? [a[i + 1]!] : []));
    return {
        fandom,
        fiche,
        // Le dossier produit par `export_aphrody` (Rust). C'est LA source des donnees du jeu :
        // ce script ne la refait pas, il l'enrichit de ce qui vient du dehors.
        base: lire("--base", join(RACINE, "apps", "azalee", "data", "aphrody-dossier.json")),
        google: lire("--google", ""),
        slug: positionnels[0] ?? "byron-love-aphrody",
        // Par defaut, le dossier va DANS la crate : `crates/engine/nie-aphrody` est la source
        // de verite du depot sur Aphrody, et elle embarque ces deux fichiers par
        // `include_str!`. Les ecrire ailleurs produirait une copie qui se perimerait en
        // silence — c'est exactement ce qui est arrive aux empreintes de son README.
        sortie: lire("--sortie", join(RACINE, "crates", "engine", "nie-aphrody", "assets", "dossier")),
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

    // Auras : `data.auras` porte des {skillId, learnLevel}, et `inagle_auras.id` vaut
    // « aura_<skillId> ». La jointure est donc directe — inutile de chercher un wap0xxxx
    // dans le JSON, il n'y en a pas (premiere version de ce script : 0 aura trouvee).
    const niveauAura = new Map<string, number>();
    for (const v of variantes) {
        try {
            for (const a of (JSON.parse(String(v.data ?? "{}")) as Ligne).auras as Ligne[] ?? [])
                if (a.skillId) niveauAura.set(`aura_${String(a.skillId)}`, Number(a.learnLevel ?? 0));
        } catch {
            /* colonne `data` absente ou non-JSON */
        }
    }
    const auras = niveauAura.size
        ? (db
              .query(
                  `select id, name_fr, name_en, name_ja, description_fr, element_id, sub_type, asset_code, image_url
                     from inagle_auras where id in (${[...niveauAura.keys()].map(() => "?").join(",")})`,
              )
              .all(...niveauAura.keys()) as Ligne[]).map((a) => ({ ...a, niveau_apprentissage: niveauAura.get(String(a.id)) ?? null }))
        : [];

    // Dialogues : on ne retient QUE le decompte et les references de scene. Le texte reste
    // dans le gisement — le dossier dit ou regarder, il ne recopie pas les repliques.
    //
    // Limite mesuree, et il faut la dire : `inagle_event_subtitles` n'a AUCUN lien vers un
    // personnage. `line_label` est un identifiant de ligne (« ev02_00800_010_530 »), pas un
    // locuteur. La seule liaison possible ici est la mention du nom dans le texte, ce qui
    // ne trouve que les repliques ou quelqu'un le nomme — pas les siennes. Sur Aphrody :
    // 1 scene, alors que la page publiee en annonce 11. Ce compte-la vient d'une autre
    // source (probablement var/niers.sqlite), non branchee ici : ne pas presenter le
    // chiffre du dossier comme le nombre de ses dialogues.
    const motifs = [principal.nickname, principal.name_fr, principal.name_en]
        .flatMap((x) => (x ? [String(x)] : []))
        .concat(String(principal.name_ja ?? "").split(/\s+/).filter((x) => x.length > 1));
    const dial = motifs.length
        ? (db
              .query(
                  `select event_id, count(*) as repliques from inagle_event_subtitles
                    where ${motifs.map(() => "text_ja like ? or text_fr like ? or text_en like ?").join(" or ")}
                    group by event_id order by repliques desc limit 40`,
              )
              .all(...motifs.flatMap((m) => [`%${m}%`, `%${m}%`, `%${m}%`])) as Ligne[])
        : [];

    db.close();
    return { variantes, principal, codes, skills, equipe, orphelins, auras, dialogues: dial };
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

// ---------------------------------------------------------------- fiche zukan (chara_param)

const STATS_JA: Record<string, string> = {
    キック: "frappe", コントロール: "controle", テクニック: "technique",
    プレッシャー: "pression", フィジカル: "physique", アジリティ: "agilite",
    インテリジェンス: "intelligence",
};
const STATS_EN: Record<string, string> = {
    Kick: "frappe", Control: "controle", Technique: "technique", Pressure: "pression",
    Physical: "physique", Agility: "agilite", Intelligence: "intelligence",
};

/**
 * Lit une fiche `chara_param` du zukan. C'est la page la plus riche du site officiel :
 * elle porte la methode d'obtention, les routes de chronique, les equipes par jeu et les
 * parametres officiels par niveau — soit la section « Recruitment » que notre couverture
 * signalait comme absente.
 *
 * Le Markdown melange le formulaire de recherche et le resultat : tout ce qui precede
 * « 検索結果 » / « Search Results » est du formulaire et doit etre jete, sinon on prend les
 * libelles des filtres (les 9 jeux, les 4 elements) pour des donnees du personnage.
 */
function parseFiche(md: string, locale: "ja" | "en") {
    const i = md.search(/検索結果|Search Results/);
    const corps = i > 0 ? md.slice(i) : md;
    const lignes = corps.split("\n");

    // « * キック » puis un tableau |Lv50| / |104| quelques lignes plus bas.
    const table = locale === "ja" ? STATS_JA : STATS_EN;
    const parametres: Record<string, Record<string, number>> = {};
    for (let j = 0; j < lignes.length; j++) {
        const nom = lignes[j]!.replace(/^\s*\*\s*/, "").trim();
        const cle = table[nom];
        if (!cle) continue;
        const fenetre = lignes.slice(j + 1, j + 8);
        const entetes = fenetre.find((l) => /\|\s*Lv\s*\d+/i.test(l));
        const valeurs = fenetre.find((l) => /^\s*\|[\s\d|]+\|\s*$/.test(l));
        if (!entetes || !valeurs) continue;
        const niveaux = [...entetes.matchAll(/Lv\s*(\d+)/gi)].map((m) => `lv${m[1]}`);
        const nombres = valeurs.split("|").map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).map(Number);
        if (niveaux.length && niveaux.length === nombres.length) {
            for (const [k, niv] of niveaux.entries()) (parametres[niv] ??= {})[cle] = nombres[k]!;
        }
    }

    // Libelles de la fiche qui suivent les puces d'une section sans lui appartenir : sans
    // cette liste, « ポジション » (le libelle « Poste ») ressort comme une equipe de IE3.
    const ETIQUETTES = /^(ポジション|属性|年代区分|学年|性別|キャラカテゴリ|Position|Element|Age Group|School Year|Gender|Character Role)$/;

    /** Contenu d'une section : les puces qui suivent un intitule, jusqu'a la puce suivante. */
    const section = (etiquette: RegExp) => {
        const d = lignes.findIndex((l) => etiquette.test(l));
        if (d < 0) return [];
        const out: string[] = [];
        for (const l of lignes.slice(d + 1, d + 25)) {
            const m = l.match(/^\s*\*\s+(.+?)\s*$/);
            const v = m?.[1]?.replace(/\s+/g, " ").trim();
            if (v && ETIQUETTES.test(v)) break;
            if (m && v && !/^\\?<|^\[/.test(v)) out.push(v);
            else if (out.length && l.trim() && !/^\s*\*/.test(l)) break;
        }
        return out;
    };

    const apres = (etiquette: RegExp) => {
        const l = lignes.find((x) => etiquette.test(x));
        return l ? l.replace(etiquette, "").replace(/^\s*\*\s*/, "").trim() || null : null;
    };

    return {
        locale,
        parametres,
        obtention: apres(/入手方法|How to Obtain/),
        constellations: section(/入手方法|How to Obtain/),
        routes: {
            football_frontier: section(/フットボールフロンティアルート|Football Frontier/),
            aliea: section(/エイリアルート|Aliea/),
            ff_international: section(/ＦＦインターナショナルルート|FF International/),
        },
        equipes_par_jeu: Object.fromEntries(
            lignes
                .flatMap((l, j) => {
                    const m = l.match(/^\s*(イナズマイレブン[0-9]?|Inazuma Eleven ?[0-9]?)\s*$/);
                    if (!m) return [];
                    const eq = section(new RegExp(`^\\s*${m[1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`));
                    return eq.length ? [[m[1]!.trim(), eq] as const] : [];
                })
                .slice(0, 12),
        ),
        tranche_age: apres(/年代区分|Age Group/),
        annee_scolaire: apres(/学年|School Year/),
        genre: apres(/性別|Gender/),
        categorie: apres(/キャラカテゴリ|Character Role/),
    };
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

// ---------------------------------------------------------------- Markdown

/** Le dossier en Markdown : la forme lisible, celle qu'on relit et qu'on cite. */
function markdown(d: Ligne): string {
    const id = d.identite as Ligne;
    const st = d.statistiques as Ligne;
    const md = d.medias as Ligne;
    const fo = d.fiche_officielle as Ligne | null;
    const L: string[] = [];
    const champ = (nom: string, v: unknown) =>
        v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)
            ? null
            : `| ${nom} | ${Array.isArray(v) ? v.join(", ") : v} |`;

    L.push(`# ${id.nom_fr}`, "");
    if (id.nom_ja_officiel) L.push(`**${id.nom_ja_officiel}**${id.furigana ? ` (${id.furigana})` : ""}${id.romaji ? ` — ${id.romaji}` : ""}`, "");
    if (md.portrait) L.push(`![${id.nom_fr}](${md.portrait})`, "");

    L.push("## Identité", "", "| Champ | Valeur |", "|---|---|");
    for (const [n, v] of [
        ["Nom (FR)", id.nom_fr], ["Nom (EN)", id.nom_en], ["Nom (JA)", id.nom_ja_officiel ?? id.nom_ja],
        ["Furigana", id.furigana], ["Romaji", id.romaji], ["Surnom", id.surnom], ["Surnom (JA)", id.surnom_ja],
        ["N° zukan (interne)", id.zukan], ["N° zukan (officiel)", id.zukan_officiel],
        ["Série", id.serie], ["Série (JA)", id.serie_ja], ["Élément", id.element], ["Poste", id.poste],
        ["Genre", id.genre], ["Rareté", id.rarete], ["Constellation", id.constellation],
        ["Tranche d'âge", id.tranche_age], ["Année scolaire", id.annee_scolaire],
        ["Rôle", id.role], ["Équipes", id.equipes], ["Équipes (JA)", id.equipes_ja],
        ["Codes internes", d.codes_internes],
    ] as [string, unknown][]) {
        const l = champ(n, v);
        if (l) L.push(l);
    }
    L.push("");

    for (const [titre, cle] of [["Description (FR)", "description_fr"], ["Description (EN)", "description_en"], ["Description (JA)", "description_ja"]] as const) {
        if (id[cle]) L.push(`**${titre}** — ${String(id[cle]).replace(/\n/g, " ")}`, "");
    }

    if (fo) {
        L.push("## Fiche officielle LEVEL-5", "");
        if (fo.obtention) L.push(`**Obtention** — ${fo.obtention}`, "");
        if ((fo.constellations as string[])?.length) L.push(`**Constellations** — ${(fo.constellations as string[]).join(" · ")}`, "");
        for (const [nom, v] of Object.entries((fo.routes ?? {}) as Record<string, string[]>))
            if (v.length) L.push(`**Route ${nom.replace(/_/g, " ")}** — ${v.join(" · ")}`, "");
        for (const [jeu, eq] of Object.entries((fo.equipes_par_jeu ?? {}) as Record<string, string[]>))
            L.push(`**${jeu}** — ${eq.join(" · ")}`, "");
        L.push(`Source : ${fo.url}`, "");
    }

    L.push("## Statistiques", "", `Total : **${st.total}**`, "", "| Attribut | Niv. 1 | Niv. 99 |", "|---|---:|---:|");
    for (const k of Object.keys((st.niveau_99 ?? {}) as Ligne))
        L.push(`| ${k} | ${(st.niveau_1 as Ligne)[k] ?? "—"} | ${(st.niveau_99 as Ligne)[k] ?? "—"} |`);
    L.push("");

    const cz = st.controle_zukan as Ligne[] | null;
    if (cz?.length) {
        L.push("### Croisement avec les paramètres publiés par LEVEL-5", "");
        for (const c of cz) {
            L.push(`**${c.niveau}** — zukan : ${Object.entries(c.zukan as Ligne).map(([k, v]) => `${k} ${v}`).join(", ")}`, "");
            L.push(`> ${c.note}`, "");
        }
    }

    const tech = (d.techniques as Ligne[]) ?? [];
    if (tech.length) {
        L.push(`## Techniques (${tech.length})`, "", "| Niv. | Nom | Élément | Type | Puissance | TP |", "|---:|---|---|---|---|---:|");
        for (const t of tech)
            L.push(`| ${t.niveau_apprentissage ?? "—"} | [${t.nom_fr ?? t.nom_en}](${t.url}) | ${t.element ?? "—"} | ${t.categorie ?? "—"} | ${(t.puissance as number[])?.join("–") ?? "—"} | ${t.cout_tp ?? "—"} |`);
        L.push("");
    }

    const au = (d.auras as Ligne[]) ?? [];
    if (au.length) {
        L.push(`## Auras (${au.length})`, "", "| Niv. | Code | Nom | Type | Description |", "|---:|---|---|---|---|");
        for (const a of au) L.push(`| ${a.niveau_apprentissage ?? "—"} | ${a.code} | ${a.nom_fr ?? a.nom_en ?? "—"} | ${a.type ?? "—"} | ${String(a.description_fr ?? "—").replace(/\n/g, " ")} |`);
        L.push("");
    }

    const av = (d.assets_vfs ?? {}) as Record<string, Ligne[]>;
    const nAssets = Object.values(av).flat().length;
    if (nAssets) {
        L.push(`## Fichiers du jeu (${nAssets})`, "", "Extraits du VFS — les CPK, que ni `rg` ni `fd` ne savent lire.", "");
        for (const [code, liste] of Object.entries(av)) {
            L.push(`### \`${code}\``, "", "| Rôle | Octets | Chemin |", "|---|---:|---|");
            for (const a of liste) L.push(`| ${a.role} | ${a.octets} | \`${a.chemin}\` |`);
            L.push("");
        }
    }

    const di = d.dialogues as Ligne | null;
    if (di && Number(di.repliques)) {
        L.push("## Dialogues", "", `**${di.repliques}** répliques réparties sur **${di.scenes}** scènes.`, "");
        L.push(`> ${di.note}`, "");
        L.push("| Scène | Répliques |", "|---|---:|");
        for (const r of ((di.references as Ligne[]) ?? []).slice(0, 20)) L.push(`| \`${r.event_id}\` | ${r.repliques} |`);
        L.push("");
    }

    L.push("## Médias", "");
    if ((md.visages as string[])?.length) L.push(...(md.visages as string[]).map((u, i) => `- Visage ${(d.codes_internes as string[])[i] ?? i} : ${u}`), "");
    for (const z of (md.zukan as Ligne[]) ?? [])
        L.push(`- ${z.jeu} : ${z.image ?? "—"}${z.fiche ? ` · [fiche](${z.fiche})` : ""}${z.modele_3d ? ` · [modèle 3D](${z.modele_3d})` : ""}`);
    L.push("");

    const dem = (d.sources as Ligne).demande_publique as Ligne | null;
    if ((dem?.suggestions as string[])?.length) {
        L.push("## Ce que le public cherche", "", "Autocomplétion Google — une demande mesurée, pas supposée.", "");
        L.push(...(dem!.suggestions as string[]).map((q) => `- ${q}`), "");
    }

    const manq = (d.couverture as Ligne).manquants as string[];
    if (manq.length) {
        L.push("## Ce qui nous manque encore", "");
        L.push("Mesuré contre la structure des wikis (titres de sections et noms de champs uniquement) :", "");
        L.push(...manq.map((m) => `- ${m}`), "");
    }

    const jeu = d.jeu as Ligne | null;
    if (jeu) {
        L.push("## Données du jeu — dossier `export_aphrody`", "");
        L.push(`Produit par \`${jeu.produit_par}\`, lu depuis \`${jeu.source}\`.`, "");
        const idj = jeu.identite as Ligne | null;
        if (idj) {
            L.push("| Champ | Valeur |", "|---|---|");
            for (const [k, v] of Object.entries(idj)) {
                if (v === null || v === undefined || v === "") continue;
                L.push(`| ${k} | ${typeof v === "object" ? JSON.stringify(v) : v} |`);
            }
            L.push("");
        }
        const pj = jeu.profil as Ligne | null;
        if (pj) {
            L.push("### Profil", "");
            for (const [k, v] of Object.entries(pj)) if (v) L.push(`- **${k}** : ${v}`);
            L.push("");
        }
        const st = jeu.stats as Ligne | null;
        if (st) {
            const niveaux = Object.keys(st);
            const attrs = [...new Set(niveaux.flatMap((n) => Object.keys((st[n] ?? {}) as Ligne)))];
            L.push("### Statistiques par niveau", "", `| Attribut | ${niveaux.join(" | ")} |`, `|---|${niveaux.map(() => "---:").join("|")}|`);
            for (const a of attrs) L.push(`| ${a} | ${niveaux.map((n) => (st[n] as Ligne)?.[a] ?? "—").join(" | ")} |`);
            L.push("");
        }
        const dj = jeu.dialogues as unknown[] | Ligne | null;
        if (dj) {
            const n = Array.isArray(dj) ? dj.length : Object.keys(dj).length;
            L.push(`### Dialogues — ${n} scènes`, "", "> Références seulement : le texte reste dans le gisement.", "");
        }
        const rj = jeu.references as unknown[] | null;
        if (Array.isArray(rj) && rj.length) L.push(`### Références et clins d'œil — ${rj.length}`, "");
    }

    const pt = d.pet as Ligne | null;
    if (pt) {
        const at = pt.atlas as Ligne;
        L.push("## Le pet — `crates/engine/nie-aphrody`", "");
        L.push(`**${pt.nom}** v${pt.version_sprite} — ${pt.description}`, "");
        L.push(`> ${pt.lien_au_personnage}`, "");
        L.push(
            `Atlas **${at.largeur}×${at.hauteur}** : ${at.colonnes}×${at.lignes} cellules de ` +
                `${(at.cellule as Ligne).largeur}×${(at.cellule as Ligne).hauteur}, ${at.cellules_inutilisees} inutilisées. ` +
                `WebP ${at.conteneur_webp} ${at.gain_webp}.`,
            "",
        );
        if (at.webp_decode_identique_au_png)
            L.push(
                "Le WebP et le PNG **décodent vers les mêmes pixels** — empreinte RGBA identique " +
                    `(\`${String(at.sha256_rgba_png).slice(0, 16)}…\`). Le WebP n'est pas une version dégradée, ` +
                    "c'est le même RGBA dans un autre conteneur.",
                "",
            );
        L.push(`### Animations — ${(pt.animations as Ligne[]).length} pour ${pt.total_frames} frames`, "");
        L.push("| Animation | Frames | Ligne | Genre | Durée |", "|---|---:|---:|---|---:|");
        for (const a of pt.animations as Ligne[])
            L.push(`| ${a.nom} | ${a.frames} | ${a.ligne} | ${a.genre ?? "—"} | ${a.duree_ms ? `${a.duree_ms} ms` : "—"} |`);
        L.push("");
    }

    const hom = d.homonymes as Ligne | null;
    if (hom) {
        L.push("## Ce qui ne partage que le nom", "");
        for (const [k, v] of Object.entries(hom)) L.push(`- **${k}** — ${v}`);
        L.push("");
    }

    L.push("## Sources", "");
    for (const [nom, v] of Object.entries(d.sources as Ligne)) {
        if (!v) continue;
        L.push(`- **${nom}** — ${JSON.stringify(v).slice(0, 300)}`);
    }
    L.push("", "## JSON-LD", "", "```json", JSON.stringify(jsonLd(d), null, 2), "```", "");
    return L.join("\n");
}

// ---------------------------------------------------------------- main

const o = args();
console.error(`dossier « ${o.slug} »`);

/**
 * Le dossier Rust (`cargo run --bin export_aphrody`), s'il est la.
 *
 * Il existait AVANT ce script et croise deja chara_param + skill_config + aura_skill_config :
 * identite complete, epithetes, kana, stats lv1/lv50/lv99, variantes, series, dialogues,
 * assets, references. Le redoubler serait une faute — ce script ne fait que l'ENRICHIR de ce
 * qu'il ne peut pas savoir : le canon officiel du zukan, le romaji, ce que les wikis
 * documentent et pas nous, ce que le public cherche.
 */
function dossierRust(): Ligne | null {
    try {
        const f = Bun.file(o.base);
        if (f.size === 0) return null;
        return JSON.parse(readFileSync(o.base, "utf8")) as Ligne;
    } catch {
        return null;
    }
}
const rust = dossierRust();
console.error(
    rust
        ? `  base Rust : ${Object.keys(rust).length} blocs (${o.base.replace(RACINE + "/", "")})`
        : `  base Rust ABSENTE (${o.base}) — lancer: cargo run --bin export_aphrody --features serde,std`,
);

const g = gisement(o.slug);
const p = g.principal;
console.error(`  extrait : ${g.variantes.length} variantes, ${g.codes.length} codes, ${g.skills.length} techniques`);

let zukan: ReturnType<typeof parseZukan> = [];
let zukanJa: ReturnType<typeof parseZukan> = [];
let wikis: Couverture[] = [];
let web: Awaited<ReturnType<typeof suggestions>> = null;
let fiches: ReturnType<typeof parseFiche>[] = [];
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
    // Les fiches detaillees : celles demandees, sinon celles que le tableau vient de nous
    // donner (une par version, dans chaque langue disponible).
    const urlsFiches = o.fiche.length
        ? o.fiche
        : [...zukan, ...zukanJa].map((z) => z.lien_fiche).filter((x): x is string => !!x).map((x) => `https://zukan.inazuma.jp${x}`);
    const vues = new Set<string>();
    const aLire = urlsFiches.filter((u) => !vues.has(u) && (vues.add(u), true)).slice(0, 8);
    fiches = (await Promise.all(aLire.map(async (u) => {
        const md = await bxc(u);
        return md ? { ...parseFiche(md, localeZukan(u)), url: u } : null;
    }))).filter((x): x is NonNullable<typeof x> => x !== null);

    publiee = mdPage;
    wikis = cov.filter((x): x is NonNullable<typeof x> => x !== null);
    web = g6;
    console.error(
        `  zukan : ${zukan.length} versions EN, ${zukanJa.length} JA · azalee : ${publiee ? "lue" : "non lue"}` +
            ` · fandom : ${wikis.map((w) => `${w.lang}=${w.sections.length} sections`).join(", ") || "indisponible"}` +
            ` · fiches : ${fiches.length}` +
            (web ? ` · suggest : ${web.suggestions.length} requetes` : ""),
    );
}

// Les vrais fichiers du jeu, un lot par code interne. C'est la seule source complete :
// le VFS n'est pas sur le disque et aucun index SQL ne le remplace.
const assetsVfs: Record<string, Asset[]> = {};
if (!o.horsLigne) {
    for (const code of g.codes) {
        const a = await assets(code).catch(() => [] as Asset[]);
        if (a.length) assetsVfs[code] = a;
    }
    console.error(`  vfs : ${Object.values(assetsVfs).flat().length} fichiers pour ${Object.keys(assetsVfs).length} codes`);
}

// Le pet est lu depuis la crate, sans la compiler : elle embarque ces memes fichiers par
// include_bytes!/include_str!.
const pet = lirePet(RACINE);
if (pet) console.error(`  pet : ${pet.total_frames} frames, ${pet.animations.length} animations, atlas ${pet.atlas.colonnes}x${pet.atlas.lignes}`);

const face = (code: string) => `${CDN}/dx11/menu/200_icon/10_icon_chr/face/${code}_l.png`;
const stat = (n: string) => ({
    lv1: p[`stat_lv1_${n}`] ?? null,
    lv99: p[`stat_${n}`] ?? null,
});

const dossier: Ligne = {
    slug: o.slug,
    genere_le: new Date().toISOString(),
    // Ce que le dossier Rust apporte, repris tel quel plutot que recalcule.
    jeu: rust
        ? {
              source: o.base.replace(RACINE + "/", ""),
              produit_par: "cargo run --bin export_aphrody --features serde,std",
              identite: rust.identity ?? null,
              profil: rust.profile ?? null,
              stats: rust.stats ?? null,
              variantes: rust.variants ?? null,
              series: rust.series ?? null,
              dialogues: rust.dialogues ?? null,
              assets: rust.assets ?? null,
              references: rust.references ?? null,
          }
        : null,
    // Le pet est la MEME entite que le personnage, sous une autre forme : son manifeste dit
    // « faithfully based on official full-body and facial assets » et le decrit comme le
    // milieu de terrain de Zeus. Une premiere version de ce dossier le rangeait parmi les
    // homonymes — c'etait faux, et le nom de la crate y invite.
    pet: pet
        ? {
              ...pet,
              // Le detail frame par frame est volumineux et rarement utile ici : on garde les
              // rectangles dans le JSON, mais le Markdown n'en montre que la synthese.
              lien_au_personnage: "meme entite : mascotte tiree des assets officiels du personnage",
          }
        : null,
    // Ce qui, en revanche, ne partage QUE le nom.
    homonymes: {
        crate_aphrody_re: "crates/forge/aphrody-re — primitives de reverse-engineering (triage PE/ELF, chaines, desassemblage x86). Aucun rapport avec le personnage.",
        site_aphrody: "aphrody.com — le site d'outils et d'assets (crate nie-site), projet aphrody-dev. Le nom vient du personnage, le contenu n'a rien a voir.",
    },
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
    fiche_officielle: (() => {
        const f = fiches.find((x) => x.locale === "ja") ?? fiches[0];
        if (!f) return null;
        return {
            url: (f as Ligne).url,
            obtention: f.obtention,
            constellations: f.constellations,
            routes: f.routes,
            equipes_par_jeu: f.equipes_par_jeu,
            tranche_age: f.tranche_age,
            annee_scolaire: f.annee_scolaire,
            categorie: f.categorie,
            parametres: f.parametres,
        };
    })(),
    statistiques: {
        total: p.stat_total,
        // `data.stats` porte lv1, lv50 ET lv99 : le niveau 50 n'a pas a etre interpole.
        niveaux_stockes: (() => {
            try {
                return ((JSON.parse(String(p.data ?? "{}")) as Ligne).stats ?? null) as Ligne | null;
            } catch {
                return null;
            }
        })(),
        niveau_1: Object.fromEntries(["frappe", "controle", "technique", "pression", "physique", "agilite", "intelligence"].map((n) => [n, p[`stat_lv1_${n}`] ?? null])),
        niveau_99: Object.fromEntries(["frappe", "controle", "technique", "pression", "physique", "agilite", "intelligence"].map((n) => [n, p[`stat_${n}`] ?? null])),
        progression: Object.fromEntries(["frappe", "controle", "technique", "pression", "physique", "agilite", "intelligence"].map((n) => [n, stat(n)])),
        // Croisement avec les parametres publies par LEVEL-5. Un ecart n'est pas une erreur
        // en soi — c'est un fait a expliquer avant d'aligner quoi que ce soit.
        controle_zukan: (() => {
            const f = fiches.find((x) => Object.keys(x.parametres).length);
            if (!f) return null;
            // `data.stats` nomme ses attributs en anglais ; le zukan, chez nous, en francais.
            const EN_CLE: Record<string, string> = {
                frappe: "kick", controle: "control", technique: "technique", pression: "pressure",
                physique: "physical", agilite: "agility", intelligence: "intelligence",
            };
            let stockes: Ligne | null = null;
            try {
                stockes = ((JSON.parse(String(p.data ?? "{}")) as Ligne).stats ?? null) as Ligne | null;
            } catch {
                stockes = null;
            }
            return Object.entries(f.parametres).map(([niveau, vals]) => ({
                niveau,
                zukan: vals,
                notre: Object.fromEntries(Object.keys(vals).map((k) => [k, (stockes?.[niveau] as Ligne)?.[EN_CLE[k] ?? k] ?? p[`stat_${k}`] ?? null])),
                ecart: Object.fromEntries(
                    Object.entries(vals).map(([k, v]) => {
                        const notre = Number((stockes?.[niveau] as Ligne)?.[EN_CLE[k] ?? k] ?? (niveau === "lv99" ? p[`stat_${k}`] : NaN));
                        return [k, Number.isFinite(notre) ? v - notre : null];
                    }),
                ),
                note: stockes?.[niveau] ? "ecart mesure, meme niveau des deux cotes" : "niveau absent du gisement : ecart non calculable",
            }));
        })(),
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
    auras: g.auras.map((a) => ({
        code: a.asset_code,
        nom_fr: a.name_fr,
        nom_en: a.name_en,
        nom_ja: a.name_ja,
        description_fr: a.description_fr,
        type: a.sub_type,
        niveau_apprentissage: (a as Ligne).niveau_apprentissage,
        image: a.image_url,
    })),
    dialogues: {
        scenes: g.dialogues.length,
        repliques: g.dialogues.reduce((n, d) => n + Number(d.repliques ?? 0), 0),
        references: g.dialogues.map((d) => ({ event_id: d.event_id, repliques: d.repliques })),
        note:
            "scenes ou le personnage est NOMME — inagle_event_subtitles ne porte aucun lien vers un " +
            "locuteur, ce n'est donc pas le compte de ses repliques. Texte non recopie.",
    },
    assets_vfs: assetsVfs,
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
const fMd = join(o.sortie, "aphrody.md");
writeFileSync(fJson, JSON.stringify(dossier, null, 2) + "\n");
writeFileSync(fMd, markdown(dossier));

console.error(`\n  ${fJson}`);
console.error(`  ${fMd}`);
console.error("  (rejouer `cargo test -p nie-aphrody` : le dossier embarque est verifie par 5 tests)");
console.error(`  ${(dossier.couverture as Ligne).manquants as string[]}`.replace(/,/g, ", "));
