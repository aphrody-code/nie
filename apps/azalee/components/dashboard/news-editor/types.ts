import type { SerializedEditorState } from "lexical";

export interface NewsEditorFormProps {
	initialData?: {
		id?: string;
		title?: string | null;
		slug?: string | null;
		content?: string | SerializedEditorState | null;
		category?: string | null;
		status?: string | null;
		excerpt?: string | null;
		featured_image_url?: string | null;
		featured_image_alt?: string | null;
		tags?: string[] | null;
		published_at?: string | null;
		scheduled_at?: string | null;
		meta_title?: string | null;
		meta_description?: string | null;
	};
}

export interface CropData {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface EditorState {
	title: string;
	content: SerializedEditorState;
	slug: string;
	category: string;
	status: string;
	excerpt: string;
	imageUrl: string;
	metaTitle: string;
	metaDescription: string;
}
