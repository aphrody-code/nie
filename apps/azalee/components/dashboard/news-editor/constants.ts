import type { SerializedEditorState } from "lexical";

export const CATEGORIES = [
	{ color: "bg-blue-500", label: "Annonce", value: "announcement" },
	{ color: "bg-amber-500", label: "Événement", value: "event" },
	{ color: "bg-rose-500", label: "Critique", value: "critique" },
	{ color: "bg-purple-500", label: "Communauté", value: "community" },
] as const;

export const STATUS_OPTIONS = [
	{
		color: "bg-amber-500",
		label: "Brouillon",
		textColor: "text-amber-500",
		value: "draft",
	},
	{
		color: "bg-blue-500",
		label: "Programmé",
		textColor: "text-blue-500",
		value: "scheduled",
	},
	{
		color: "bg-green-500",
		label: "Publié",
		textColor: "text-green-500",
		value: "published",
	},
	{
		color: "bg-stone-500",
		label: "Archivé",
		textColor: "text-stone-500",
		value: "archived",
	},
] as const;

export const EMPTY_CONTENT: SerializedEditorState = {
	root: {
		children: [
			{
				children: [],
				direction: null,
				format: "",
				indent: 0,
				type: "paragraph",
				version: 1,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any,
		],
		direction: null,
		format: "",
		indent: 0,
		type: "root",
		version: 1,
	},
};

export const CROP_RATIO_PRESETS = [
	{ label: "21:9", value: 21 / 9 },
	{ label: "16:9", value: 16 / 9 },
	{ label: "4:3", value: 4 / 3 },
	{ label: "Libre", value: undefined },
] as const;
