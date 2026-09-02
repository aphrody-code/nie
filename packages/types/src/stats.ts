/**
 * Statistiques unifiées Rose Griffon.
 */

export interface WebsiteStats {
	totalVisits: number;
	uniqueVisitors: number;
	pageViews: number;
	avgTimeOnSiteMs: number;
	bounceRate: number;
}

export interface DiscordServerStats {
	memberCount: number;
	onlineCount: number;
	boostCount: number;
	boostLevel: number;
	messageCount24h: number;
}

export interface ArticleStats {
	articleId: string;
	views: number;
	shares: number;
	comments: number;
	reactions: Record<string, number>;
}

/** Global Dashboard Stats. */
export interface GlobalStats {
	website: WebsiteStats;
	discord: DiscordServerStats;
	lastUpdated: string;
}

/** Dashboard metrics for bot/admin. */
export interface DashboardStats {
	profiles_total: number;
	profiles_24h: number;
	admins: number;
	banned: number;
	articles_published: number;
	articles_draft: number;
	events_upcoming: number;
	events_past: number;
	team_members: number;
	discord_members: number;
	generated_at: string;
}
