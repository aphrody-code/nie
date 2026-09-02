/**
 * L'identité du bot — module PUR, sans jeton, sans E/S.
 *
 * ── POURQUOI SÉPARÉ DE `config.ts` ─────────────────────────────────────────
 * `config.ts` résout le JETON à l'import et lève quand il manque : c'est
 * voulu, un service sans jeton doit mourir au démarrage et non au premier
 * message. Mais la trousse de présentation (`lib/ui/theme.ts`) a besoin de la
 * couleur et du pied de page, et rien de plus. Si elle passait par `config`,
 * plus aucun test de mise en forme ne tournerait sans secret posé — or c'est
 * justement ce qu'on veut couvrir hors ligne.
 *
 * ── UN SEUL RÔLE, PAS DE PROFIL ────────────────────────────────────────────
 * Le bot d'origine (`apps/bot` du dépôt rg) porte DEUX identités derrière un
 * registre de profils : la communauté Rose Griffon et le jeu. Ce bot-ci ne
 * sert que le jeu, et le registre n'a donc plus rien à décider. Le supprimer
 * n'est pas une simplification cosmétique : un profil est un aiguillage, et un
 * aiguillage à une seule voie se contente d'ajouter un cas d'erreur
 * (`RG_PROFIL_BOT` mal orthographié démarrait le mauvais bot).
 */

/** Couleur d'accent — l'orange Azalée de la charte. */
export const COULEUR_HEX = "#F89C5A" as const;

/** Domaine porté par le pied de page des embeds. */
export const PIED_DE_PAGE = "azalee.rosegriffon.fr";

/** Icône ronde du pied de page. Servie en 200 par le site du wiki. */
export const ICONE_MARQUE = "https://azalee.rosegriffon.fr/RG_Azalee-logo.webp";

/** Nom lisible du bot, tel qu'il doit apparaître au membre. */
export const TITRE = "Azalée";

/**
 * Racine des liens publics.
 *
 * `NIE_BOT_URL_BASE` l'emporte quand elle est posée — pour une recette ou une
 * préversion. Une référence shell non substituée (`$AUTRE`) est ignorée : Bun
 * ne fait pas l'expansion des `$VAR` dans un fichier d'environnement, et la
 * chaîne littérale produirait des liens cassés.
 */
export function urlBase(env: Record<string, string | undefined> = Bun.env): string {
	const brut = (env.NIE_BOT_URL_BASE ?? "").trim();
	return brut === "" || brut.startsWith("$") ? "https://azalee.rosegriffon.fr" : brut;
}

/** Couleur d'embed (entier 24 bits) à partir d'un hexadécimal CSS. */
export function couleurDeMarque(couleurHex: string): number {
	const chiffres = couleurHex.startsWith("#") ? couleurHex.slice(1) : couleurHex;
	if (!/^[0-9a-fA-F]{6}$/.test(chiffres)) {
		throw new Error(`[marque] couleur invalide : "${couleurHex}" (attendu #RRGGBB).`);
	}
	return Number.parseInt(chiffres, 16);
}
