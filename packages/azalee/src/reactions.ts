/** Article reaction rules owned by the Azalée publishing product. */
export const REACTION_TYPES = ["like", "fire", "clap", "mind_blown", "sad"] as const;

export type ReactionType = (typeof REACTION_TYPES)[number];

export const REACTION_EMOJIS: Readonly<Record<ReactionType, string>> = {
	clap: "👏",
	fire: "🔥",
	like: "❤️",
	mind_blown: "🤯",
	sad: "😢",
};

export interface ReactionState {
	count: number;
	userReacted: boolean;
}

export type ReactionStates = Record<ReactionType, ReactionState>;

export interface ReactionRequest {
	articleId: string;
	reactionType: ReactionType;
}

export interface ReactionToggleResult {
	count: number;
	reacted: boolean;
}

const MAX_ARTICLE_ID_LENGTH = 512;

export function isReactionType(value: unknown): value is ReactionType {
	return typeof value === "string" && (REACTION_TYPES as readonly string[]).includes(value);
}

export function normalizeReactionArticleId(value: unknown): string {
	if (typeof value !== "string") {
		throw new TypeError("A reaction requires a string article identifier");
	}

	const articleId = value.trim();
	if (!articleId || articleId.length > MAX_ARTICLE_ID_LENGTH || articleId.includes("\0")) {
		throw new RangeError("Invalid reaction article identifier");
	}

	return articleId;
}

export function parseReactionRequest(
	articleId: unknown,
	reactionType: unknown = "like"
): ReactionRequest {
	return {
		articleId: normalizeReactionArticleId(articleId),
		reactionType: parseReactionType(reactionType),
	};
}

export function parseReactionType(value: unknown = "like"): ReactionType {
	if (!isReactionType(value)) throw new RangeError("Unsupported reaction type");
	return value;
}

export function createReactionStates(): ReactionStates {
	return Object.fromEntries(
		REACTION_TYPES.map((reactionType) => [reactionType, { count: 0, userReacted: false }])
	) as ReactionStates;
}

export function accumulateReactionStates(
	rows: Iterable<{ reactionType: unknown; userId: unknown }>,
	currentUserId?: string
): ReactionStates {
	const states = createReactionStates();
	for (const row of rows) {
		if (!isReactionType(row.reactionType)) continue;
		const state = states[row.reactionType];
		state.count += 1;
		if (currentUserId && row.userId === currentUserId) state.userReacted = true;
	}
	return states;
}
