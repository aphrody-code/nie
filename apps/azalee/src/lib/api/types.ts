// --- Crawler Types ---

export interface PatchNoteSummary {
	id: string;
	title: string;
	date: string;
	platform: string[]; // "ps", "steam", "switch", etc.
	url: string;
	featured_image?: string | null;
}

export interface PatchNoteDetail extends PatchNoteSummary {
	content_html: string;
}

export interface TopicSummary {
	id: string;
	title: string;
	date: string;
	url: string;
	category?: string;
	thumbnail?: string | null;
}

export interface TopicDetail extends TopicSummary {
	content_html: string;
	images?: string[];
}

export type ZukanContentType = "character_list" | "skill_list" | "item_list" | "unknown";

export interface ZukanCharacter {
	id: string;
	name: string;
	nickname?: string;
	image?: string;
	detailUrl?: string;
	rarity?: string;
	position?: string;
	element?: string;
	gender?: string;
}

export interface ZukanSkill {
	name: string;
	type?: string;
	videoUrl?: string;
}

export interface ZukanResult {
	type: ZukanContentType;
	url: string;
	data: unknown[];
	count: number;
}

// --- Twitter Types ---

export interface TwitterUser {
	type: string;
	userName: string;
	url: string;
	id: string;
	name: string;
	isBlueVerified: boolean;
	profilePicture: string;
	coverPicture: string;
	description: string;
	location: string;
	followers: number;
	following: number;
	canDm: boolean;
	createdAt: string;
	favouritesCount: number;
	mediaCount: number;
	statusesCount: number;
	unavailable: boolean;
}

export interface Tweet {
	type: string;
	id: string;
	url: string;
	text: string;
	source: string;
	retweetCount: number;
	replyCount: number;
	likeCount: number;
	quoteCount: number;
	viewCount: number;
	createdAt: string;
	lang: string;
	isReply: boolean;
	inReplyToId?: string;
	author: TwitterUser;
	retweeted_tweet?: Tweet;
}

export interface TwitterResponse<T> {
	tweets?: T[];
	data?: T;
	has_next_page?: boolean;
	next_cursor?: string;
	status?: string;
	message?: string;
	error?: number;
}

// --- Schedule Types ---

export interface StreamSchedule {
	id: string;
	day_of_week: number;
	streamer_name: string;
	start_time: string;
	end_time: string;
	category: string;
	status: "active" | "cancelled" | "special";
	notes?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
}
