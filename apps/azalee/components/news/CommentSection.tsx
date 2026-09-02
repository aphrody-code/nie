"use client";

import { MessageSquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getComments } from "@/app/actions/comments";
import { CommentForm } from "@/components/news/CommentForm";
import { CommentItem } from "@/components/news/CommentItem";
import type { Comment } from "@/components/news/CommentItem";
import { cn } from "@/lib/utils";

type SortOrder = "newest" | "oldest";

interface CommentSectionProps {
	articleId: string;
	initialCommentCount: number;
}

function CommentSkeleton() {
	return (
		<div className="space-y-4 animate-pulse">
			{[0, 1, 2].map((i) => (
				<div
					key={i}
					className="bg-surface-container-low border border-outline-variant/10 rounded-2xl p-4 space-y-3"
				>
					<div className="flex items-center gap-3">
						<div className="size-9 rounded-full bg-surface-container" />
						<div className="space-y-1.5 flex-1">
							<div className="h-3.5 w-28 rounded-full bg-surface-container" />
							<div className="h-3 w-16 rounded-full bg-surface-container" />
						</div>
					</div>
					<div className="space-y-2">
						<div className="h-3 w-full rounded-full bg-surface-container" />
						<div className="h-3 w-4/5 rounded-full bg-surface-container" />
					</div>
				</div>
			))}
		</div>
	);
}

export function CommentSection({ articleId, initialCommentCount }: CommentSectionProps) {
	const [comments, setComments] = useState<Comment[]>([]);
	const [count, setCount] = useState(initialCommentCount);
	const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
	const [loading, setLoading] = useState(true);

	const fetchComments = useCallback(async () => {
		setLoading(true);
		try {
			const data = await getComments(articleId, sortOrder);
			setComments(data);
			setCount(data.length);
		} catch {
			// Silently fail — l'état vide sera affiché
		} finally {
			setLoading(false);
		}
	}, [articleId, sortOrder]);

	useEffect(() => {
		fetchComments();
	}, [fetchComments]);

	const handleCommentCreated = (comment: Comment) => {
		if (sortOrder === "newest") {
			setComments((prev) => [comment, ...prev]);
		} else {
			setComments((prev) => [...prev, comment]);
		}
		setCount((c) => c + 1);
	};

	const handleCommentDeleted = (id: string) => {
		setComments((prev) => prev.filter((c) => c.id !== id));
		setCount((c) => Math.max(0, c - 1));
	};

	const handleCommentUpdated = (id: string, content: string) => {
		setComments((prev) => prev.map((c) => (c.id === id ? { ...c, content, is_edited: true } : c)));
	};

	return (
		<section className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between flex-wrap gap-3">
				<h2 className="flex items-center gap-2.5 text-lg font-bold text-on-surface">
					<MessageSquare className="size-5 text-primary" />
					Commentaires
					<span className="text-base font-normal text-on-surface-variant">({count})</span>
				</h2>

				{/* Tri */}
				<div className="flex items-center gap-1 bg-surface-container rounded-xl p-1">
					{(["newest", "oldest"] as const).map((order) => (
						<button
							key={order}
							onClick={() => setSortOrder(order)}
							className={cn(
								"px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
								sortOrder === order
									? "bg-surface-container-highest text-on-surface shadow-sm"
									: "text-on-surface-variant hover:text-on-surface"
							)}
						>
							{order === "newest" ? "Plus récents" : "Plus anciens"}
						</button>
					))}
				</div>
			</div>

			{/* Formulaire de nouveau commentaire */}
			<CommentForm articleId={articleId} onSubmit={handleCommentCreated} />

			{/* Liste des commentaires */}
			{loading ? (
				<CommentSkeleton />
			) : comments.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-12 text-center">
					<MessageSquare className="size-10 text-on-surface-variant/30 mb-3" />
					<p className="text-on-surface-variant/60 text-sm">
						Aucun commentaire. Soyez le premier !
					</p>
				</div>
			) : (
				<div className="space-y-3">
					{comments.map((comment) => (
						<CommentItem
							key={comment.id}
							comment={comment}
							articleId={articleId}
							onDelete={handleCommentDeleted}
							onUpdate={handleCommentUpdated}
							depth={0}
						/>
					))}
				</div>
			)}
		</section>
	);
}
