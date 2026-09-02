import type { Database } from "@rosegriffon/db";

/**
 * Statut d'un article/chronique.
 */
export const ARTICLE_STATUS = ["draft", "published", "scheduled", "archived"] as const;
export type ArticleStatus = (typeof ARTICLE_STATUS)[number];

/**
 * Application source d'un article.
 */
export const ARTICLE_APP = ["azalee", "website", "bot"] as const;
export type ArticleApp = (typeof ARTICLE_APP)[number];

/** Article complet (Row). */
export type Article = Database["public"]["Tables"]["articles"]["Row"];

/** Article avec status typé. */
export type ArticleWithStatus = Omit<Article, "status"> & {
	status: ArticleStatus | null;
};

/** Catégorie d'article. */
export type ArticleCategory = Database["public"]["Tables"]["article_categories"]["Row"];

/** Commentaire sur un article. */
export type ArticleComment = Database["public"]["Tables"]["article_comments"]["Row"];

/** Réaction à un article. */
export type ArticleReaction = Database["public"]["Tables"]["article_reactions"]["Row"];

/** Série d'articles. */
export type ArticleSeries = Database["public"]["Tables"]["article_series"]["Row"];

/** Chronique (legacy or specific format). */
export type Chronicle = Database["public"]["Tables"]["chronicles"]["Row"];

/** Résultat de recherche unifié. */
export interface SearchHit {
	kind: "article" | "chronique";
	id: string;
	title: string;
	slug: string;
	excerpt: string | null;
	app: string | null;
	created_at: string | Date;
}

// --- Helpers --------------------------------------------------------------

export function isArticleStatus(value: unknown): value is ArticleStatus {
	return typeof value === "string" && (ARTICLE_STATUS as readonly string[]).includes(value);
}

export function isPublished(article: { status: string | null }): boolean {
	return article.status === "published";
}
