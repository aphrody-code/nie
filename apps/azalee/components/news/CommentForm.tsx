"use client";

import { User } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { createComment } from "@/app/actions/comments";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@rosegriffon/ui";
import { isRemoteAvatar } from "@/lib/avatar";
import { cn } from "@/lib/utils";

const MAX_LENGTH = 2000;

interface CommentFormProps {
	articleId: string;
	parentId?: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	onSubmit: (comment: any) => void;
	onCancel?: () => void;
	placeholder?: string;
	autoFocus?: boolean;
}

export function CommentForm({
	articleId,
	parentId,
	onSubmit,
	onCancel,
	placeholder,
	autoFocus: _autoFocus = false,
}: CommentFormProps) {
	const { user, profile } = useAuth();
	const [content, setContent] = useState("");
	const [isPending, startTransition] = useTransition();
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const isReply = Boolean(parentId);
	const defaultPlaceholder =
		placeholder ?? (isReply ? "Écrire une réponse…" : "Écrire un commentaire…");
	const remaining = MAX_LENGTH - content.length;
	const isOverLimit = remaining < 0;
	const isEmpty = content.trim().length === 0;

	const avatarSrc = profile?.avatar_url ?? user?.image ?? null;
	// `full_name` n'est pas dans la liste blanche des colonnes lisibles en clé
	// anon : le lire renvoyait toujours undefined. On part du pseudo public.
	const displayName = profile?.username ?? user?.name ?? null;

	const autoResize = (el: HTMLTextAreaElement) => {
		el.style.height = "auto";
		const lineHeight = 24;
		const minHeight = lineHeight * 2;
		const maxHeight = lineHeight * 8;
		el.style.height = `${Math.min(Math.max(el.scrollHeight, minHeight), maxHeight)}px`;
	};

	const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		setContent(e.target.value);
		autoResize(e.target);
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (isEmpty || isOverLimit || isPending) {
			return;
		}

		startTransition(async () => {
			try {
				const comment = await createComment(articleId, content.trim(), parentId);
				setContent("");
				if (textareaRef.current) {
					textareaRef.current.style.height = "auto";
				}
				onSubmit(comment);
				toast.success(isReply ? "Réponse publiée" : "Commentaire publié");
			} catch (error) {
				const message = error instanceof Error ? error.message : "Erreur lors de la publication";
				toast.error(message);
			}
		});
	};

	if (!user) {
		return (
			<div className="flex items-center gap-3 bg-surface-container-low border border-outline-variant/10 rounded-2xl px-4 py-4">
				<div className="size-9 rounded-full bg-surface-container flex items-center justify-center shrink-0">
					<User className="size-4 text-on-surface-variant/50" />
				</div>
				<p className="text-sm text-on-surface-variant">
					<Link
						href="/login"
						className="text-primary font-medium hover:underline underline-offset-2"
					>
						Connectez-vous
					</Link>{" "}
					pour commenter.
				</p>
			</div>
		);
	}

	return (
		<form onSubmit={handleSubmit} className="flex gap-3">
			{/* Avatar */}
			<div className="shrink-0 pt-0.5">
				{avatarSrc ? (
					<Image
						src={avatarSrc}
						alt={displayName ?? ""}
						width={36}
						height={36}
						className="size-9 rounded-full object-cover ring-2 ring-outline-variant/20"
						unoptimized={isRemoteAvatar(avatarSrc)}
					/>
				) : (
					<div className="size-9 rounded-full bg-secondary-container flex items-center justify-center ring-2 ring-outline-variant/20">
						<User className="size-4 text-on-secondary-container" />
					</div>
				)}
			</div>

			{/* Zone de saisie */}
			<div className="flex-1 space-y-2">
				{displayName && (
					<p className="text-xs font-medium text-on-surface-variant">{displayName}</p>
				)}

				<div
					className={cn(
						"relative bg-surface-container-low border rounded-2xl transition-colors focus-within:border-primary/40",
						isOverLimit ? "border-red-500/40" : "border-outline-variant/10"
					)}
				>
					<textarea
						ref={textareaRef}
						value={content}
						onChange={handleChange}
						placeholder={defaultPlaceholder}
						rows={2}
						className="w-full resize-none bg-transparent px-4 pt-3 pb-14 sm:pb-10 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-hidden leading-relaxed"
						style={{ maxHeight: "192px", minHeight: "80px" }}
					/>

					{/* Footer interne */}
					<div className="absolute bottom-0 inset-x-0 flex items-center justify-between px-3 pb-2.5">
						<span
							className={cn(
								"text-xs tabular-nums",
								isOverLimit
									? "text-red-500 font-medium"
									: remaining <= 100
										? "text-amber-500"
										: "text-on-surface-variant/40"
							)}
						>
							{remaining}
						</span>

						<div className="flex items-center gap-2">
							{onCancel && (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={onCancel}
									className="h-10 sm:h-7 px-3 sm:px-2.5 text-xs rounded-xl text-on-surface-variant"
								>
									Annuler
								</Button>
							)}
							<Button
								type="submit"
								size="sm"
								disabled={isEmpty || isOverLimit || isPending}
								className="h-10 sm:h-7 px-4 sm:px-3 text-xs rounded-xl"
							>
								{isPending ? "…" : isReply ? "Répondre" : "Commenter"}
							</Button>
						</div>
					</div>
				</div>
			</div>
		</form>
	);
}
