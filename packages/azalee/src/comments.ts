/** Article comment rules owned by the Azalée publishing product. */
export const COMMENT_MAX_LENGTH = 2_000;
export const COMMENT_IDENTIFIER_MAX_LENGTH = 512;
export const COMMENT_MAX_REPLY_DEPTH = 2;

export const COMMENT_SORT_ORDERS = ["newest", "oldest", "popular"] as const;
export type CommentSortOrder = (typeof COMMENT_SORT_ORDERS)[number];

export interface CommentAuthor {
	id: string;
	username: string | null;
	fullName: string | null;
	avatarUrl: string | null;
}

export interface CommentRecord {
	id: string;
	content: string;
	isEdited: boolean;
	isPinned: boolean;
	createdAt: string;
	updatedAt: string;
	parentId: string | null;
	author: CommentAuthor;
	replyCount: number;
	likes: number;
	userLiked: boolean;
}

export interface CommentTreeNode extends CommentRecord {
	replies: CommentTreeNode[];
}

export function isCommentSortOrder(value: unknown): value is CommentSortOrder {
	return typeof value === "string" && (COMMENT_SORT_ORDERS as readonly string[]).includes(value);
}

export function normalizeCommentIdentifier(value: unknown, kind = "comment"): string {
	if (typeof value !== "string") {
		throw new TypeError(`A ${kind} identifier must be a string`);
	}

	const identifier = value.trim();
	if (!identifier || identifier.length > COMMENT_IDENTIFIER_MAX_LENGTH || identifier.includes("\0")) {
		throw new RangeError(`Invalid ${kind} identifier`);
	}

	return identifier;
}

export function normalizeCommentContent(value: unknown): string {
	if (typeof value !== "string") {
		throw new TypeError("A comment body must be a string");
	}

	const content = value.trim();
	if (!content || content.length > COMMENT_MAX_LENGTH) {
		throw new RangeError(`A comment must contain 1 to ${COMMENT_MAX_LENGTH} characters`);
	}

	return content;
}

export function commentReactionArticleId(commentId: unknown): string {
	return `comment:${normalizeCommentIdentifier(commentId)}`;
}

export function countRepliesByParentId(
	rows: Iterable<{ parentId: unknown }>
): ReadonlyMap<string, number> {
	const counts = new Map<string, number>();
	for (const row of rows) {
		if (typeof row.parentId !== "string" || !row.parentId) continue;
		counts.set(row.parentId, (counts.get(row.parentId) ?? 0) + 1);
	}
	return counts;
}

export function sortComments<T extends Pick<CommentRecord, "isPinned" | "createdAt" | "likes">>(
	comments: readonly T[],
	sortOrder: CommentSortOrder
): T[] {
	return [...comments].sort((left, right) => {
		if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1;
		if (sortOrder === "popular") return right.likes - left.likes;
		const chronological = left.createdAt.localeCompare(right.createdAt);
		return sortOrder === "oldest" ? chronological : -chronological;
	});
}

export function buildCommentTree(comments: readonly CommentRecord[]): CommentTreeNode[] {
	const nodes = new Map<string, CommentTreeNode>();
	for (const comment of comments) nodes.set(comment.id, { ...comment, replies: [] });

	const roots: CommentTreeNode[] = [];
	for (const node of nodes.values()) {
		const parent = node.parentId ? nodes.get(node.parentId) : undefined;
		if (!parent || parent.id === node.id || createsCycle(node, parent, nodes)) {
			roots.push(node);
		} else {
			parent.replies.push(node);
		}
	}
	return roots;
}

function createsCycle(
	node: CommentTreeNode,
	parent: CommentTreeNode,
	nodes: ReadonlyMap<string, CommentTreeNode>
): boolean {
	let cursor: CommentTreeNode | undefined = parent;
	const visited = new Set<string>();
	while (cursor) {
		if (cursor.id === node.id) return true;
		if (visited.has(cursor.id)) return true;
		visited.add(cursor.id);
		cursor = cursor.parentId ? nodes.get(cursor.parentId) : undefined;
	}
	return false;
}
