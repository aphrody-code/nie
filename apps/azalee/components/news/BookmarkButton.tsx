"use client";

import { Bookmark } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { toggleBookmark } from "@/app/actions/bookmarks";
import { useAuth } from "@/components/providers/AuthProvider";
import { cn } from "@/lib/utils";

interface BookmarkButtonProps {
	articleId: string;
	initialBookmarked?: boolean;
	compact?: boolean;
}

export function BookmarkButton({
	articleId,
	initialBookmarked = false,
	compact,
}: BookmarkButtonProps) {
	const { user } = useAuth();
	const [bookmarked, setBookmarked] = useState(initialBookmarked);
	const [isPending, startTransition] = useTransition();

	if (!user) {
		return null;
	}

	const handleToggle = () => {
		const newState = !bookmarked;
		setBookmarked(newState);

		startTransition(async () => {
			try {
				const result = await toggleBookmark(articleId);
				setBookmarked(result.bookmarked);
				toast.success(result.bookmarked ? "Article sauvegardé" : "Article retiré des favoris");
			} catch {
				setBookmarked(!newState);
				toast.error("Erreur");
			}
		});
	};

	if (compact) {
		return (
			<button
				onClick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					handleToggle();
				}}
				disabled={isPending}
				className={cn(
					"inline-flex items-center text-xs transition-colors",
					bookmarked ? "text-primary" : "text-on-surface-variant/50 hover:text-primary"
				)}
			>
				<Bookmark className={cn("size-3.5", bookmarked && "fill-current")} />
			</button>
		);
	}

	return (
		<button
			onClick={handleToggle}
			disabled={isPending}
			className={cn(
				"inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all",
				bookmarked
					? "bg-primary/10 text-primary"
					: "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest hover:text-primary"
			)}
		>
			<Bookmark className={cn("size-4", bookmarked && "fill-current")} />
			<span>{bookmarked ? "Sauvegardé" : "Sauvegarder"}</span>
		</button>
	);
}
