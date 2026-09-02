"use client";

import { Heart } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { toggleReaction } from "@/app/actions/reactions";
import { useAuth } from "@/components/providers/AuthProvider";
import { cn } from "@/lib/utils";

interface LikeButtonProps {
	articleId: string;
	initialCount: number;
	initialLiked: boolean;
	compact?: boolean;
}

export function LikeButton({ articleId, initialCount, initialLiked, compact }: LikeButtonProps) {
	const { user } = useAuth();
	const [count, setCount] = useState(initialCount);
	const [liked, setLiked] = useState(initialLiked);
	const [isPending, startTransition] = useTransition();

	const handleToggle = () => {
		if (!user) {
			toast.error("Connecte-toi pour aimer cet article");
			return;
		}

		// Optimistic update
		const newLiked = !liked;
		setLiked(newLiked);
		setCount((c) => c + (newLiked ? 1 : -1));

		startTransition(async () => {
			try {
				const result = await toggleReaction(articleId);
				setLiked(result.reacted);
				setCount(result.count);
			} catch {
				// Revert on error
				setLiked(!newLiked);
				setCount((c) => c + (newLiked ? -1 : 1));
				toast.error("Erreur lors de la réaction");
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
					"inline-flex items-center gap-1 text-xs transition-colors",
					liked ? "text-red-500" : "text-on-surface-variant/50 hover:text-red-500"
				)}
			>
				<Heart className={cn("size-3.5", liked && "fill-current")} />
				{count > 0 && <span>{count}</span>}
			</button>
		);
	}

	return (
		<button
			onClick={handleToggle}
			disabled={isPending}
			className={cn(
				"inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all",
				liked
					? "bg-red-500/10 text-red-500"
					: "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest hover:text-red-500"
			)}
		>
			<Heart className={cn("size-4", liked && "fill-current")} />
			<span>{count}</span>
		</button>
	);
}
