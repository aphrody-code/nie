"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { toggleReaction } from "@/app/actions/reactions";
import { useAuth } from "@/components/providers/AuthProvider";
import type { ReactionType } from "@/lib/reaction-types";
import { cn } from "@/lib/utils";

const REACTIONS: Array<{ type: ReactionType; emoji: string; label: string }> = [
	{ emoji: "❤️", label: "J'aime", type: "like" },
	{ emoji: "🔥", label: "Enflammé", type: "fire" },
	{ emoji: "👏", label: "Bravo", type: "clap" },
	{ emoji: "🤯", label: "Époustouflant", type: "mind_blown" },
	{ emoji: "😢", label: "Triste", type: "sad" },
];

interface ReactionState {
	count: number;
	userReacted: boolean;
}

interface ReactionBarProps {
	articleId: string;
	initialReactions: Record<string, ReactionState>;
}

export function ReactionBar({ articleId, initialReactions }: ReactionBarProps) {
	const { user } = useAuth();
	const [reactions, setReactions] = useState<Record<string, ReactionState>>(() => {
		const state: Record<string, ReactionState> = {};
		for (const r of REACTIONS) {
			state[r.type] = initialReactions[r.type] ?? { count: 0, userReacted: false };
		}
		return state;
	});
	const [pending, setPending] = useState<ReactionType | null>(null);
	const [, startTransition] = useTransition();

	const handleReaction = (type: ReactionType) => {
		if (!user) {
			toast.error("Connecte-toi pour réagir");
			return;
		}

		if (pending) {
			return;
		}

		const current = reactions[type];
		const newReacted = !current.userReacted;

		// Optimistic update
		setReactions((prev) => ({
			...prev,
			[type]: {
				count: current.count + (newReacted ? 1 : -1),
				userReacted: newReacted,
			},
		}));
		setPending(type);

		startTransition(async () => {
			try {
				const result = await toggleReaction(articleId, type);
				setReactions((prev) => ({
					...prev,
					[type]: {
						count: result.count,
						userReacted: result.reacted,
					},
				}));
			} catch {
				// Rollback
				setReactions((prev) => ({
					...prev,
					[type]: current,
				}));
				toast.error("Erreur lors de la réaction");
			} finally {
				setPending(null);
			}
		});
	};

	return (
		<div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
			{REACTIONS.map((r) => {
				const state = reactions[r.type];
				const isActive = state.userReacted;
				const isLoading = pending === r.type;

				return (
					<button
						key={r.type}
						onClick={() => handleReaction(r.type)}
						disabled={isLoading}
						title={r.label}
						aria-label={`${r.label}${state.count > 0 ? ` (${state.count})` : ""}`}
						className={cn(
							"inline-flex items-center justify-center gap-1 min-h-11 sm:min-h-0 px-3 sm:px-2.5 py-1 rounded-full text-xs font-medium",
							"border transition-all duration-150 shrink-0",
							"select-none cursor-pointer",
							isActive
								? "bg-primary/10 border-primary/30 text-on-surface"
								: "bg-surface-container border-outline-variant/30 text-on-surface-variant hover:bg-surface-container-high hover:border-outline-variant/60",
							isLoading && "opacity-60 cursor-not-allowed"
						)}
					>
						<span className="text-sm leading-none">{r.emoji}</span>
						{state.count > 0 && (
							<span
								className={cn(
									"tabular-nums",
									isActive ? "text-on-surface" : "text-on-surface-variant/70"
								)}
							>
								{state.count}
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
}
