declare module "bun" {
	interface Env {
		CRON_SECRET: string;
		AZALEE_URL: string;
		WEBSITE_URL: string;
		DATABASE_URL: string;
		SUPABASE_SERVICE_ROLE_KEY: string;
		NEXT_PUBLIC_SUPABASE_URL: string;
		DISCORD_BOT_TOKEN?: string;
		DISCORD_TOKEN?: string;
		DISCORD_GUILD_ID?: string;
		DISCORD_ANNOUNCE_SECRET?: string;
		DISCORD_WIKI_ANNOUNCEMENTS_CHANNEL_ID?: string;
		DISCORD_WEBSITE_ANNOUNCEMENTS_CHANNEL_ID?: string;
		DISCORD_NEWS_CHANNEL_ID?: string;
	}
}
export {};
