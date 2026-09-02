export interface NewsAuthor {
	full_name: string | null;
	avatar_url: string | null;
	username?: string | null;
	bio?: string | null;
}

export interface NewsItem {
	id: string;
	slug: string;
	title: string;
	excerpt: string | null;
	category: string;
	status: string;
	featured_image_url: string | null;
	published_at: string | null;
	created_at: string;
	updated_at?: string | null;
	author: NewsAuthor | null;
	original_url?: string;
	content?: string;
}
