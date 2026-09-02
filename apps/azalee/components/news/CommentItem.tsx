"use client";

import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { ChevronDown, MessageSquare, Pencil, Pin, Trash2, User } from "lucide-react";
import Image from "next/image";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteComment, getReplies, updateComment } from "@/app/actions/comments";
import { CommentForm } from "@/components/news/CommentForm";
import { useAuth } from "@/components/providers/AuthProvider";
import { Badge, Button } from "@rosegriffon/ui";
import { isRemoteAvatar } from "@/lib/avatar";
import { cn } from "@/lib/utils";

export interface Comment {
	id: string;
	content: string;
	is_edited: boolean;
	is_pinned: boolean;
	created_at: string;
	parent_id: string | null;
	author: {
		id: string;
		username: string | null;
		full_name: string | null;
		avatar_url: string | null;
	};
	reply_count?: number;
}

const MAX_DEPTH = 2;
const EDIT_MAX_LENGTH = 2000;

function timeAgo(date: string): string {
	const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
	if (seconds < 60) {
		return "à l'instant";
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `il y a ${minutes} min`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return `il y a ${hours}h`;
	}
	const days = Math.floor(hours / 24);
	if (days < 30) {
		return `il y a ${days}j`;
	}
	return format(new Date(date), "d MMM yyyy", { locale: fr });
}

interface CommentItemProps {
	comment: Comment;
	articleId: string;
	onDelete: (id: string) => void;
	onUpdate: (id: string, content: string) => void;
	depth?: number;
}

export function CommentItem({
	comment,
	articleId,
	onDelete,
	onUpdate,
	depth = 0,
}: CommentItemProps) {
	const { user, isAdmin } = useAuth();
	const [isPending, startTransition] = useTransition();

	// States
	const [showReplyForm, setShowReplyForm] = useState(false);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [isEditing, setIsEditing] = useState(false);
	const [editContent, setEditContent] = useState(comment.content);

	// Replies
	const [replies, setReplies] = useState<Comment[]>([]);
	const [repliesLoaded, setRepliesLoaded] = useState(false);
	const [repliesLoading, setRepliesLoading] = useState(false);
	const [replyCount, setReplyCount] = useState(comment.reply_count ?? 0);

	const isOwner = user?.id === comment.author.id;
	const canEdit = isOwner;
	const canDelete = isOwner || isAdmin;

	const authorName = comment.author.full_name ?? comment.author.username ?? "Utilisateur inconnu";

	// Chargement des réponses
	const handleLoadReplies = async () => {
		if (repliesLoaded) {
			setRepliesLoaded(false);
			setReplies([]);
			return;
		}
		setRepliesLoading(true);
		try {
			const data = await getReplies(comment.id);
			setReplies(data);
			setRepliesLoaded(true);
		} catch {
			toast.error("Impossible de charger les réponses");
		} finally {
			setRepliesLoading(false);
		}
	};

	// Ajout d'une réponse
	const handleReplyCreated = (reply: Comment) => {
		setReplies((prev) => [...prev, reply]);
		setReplyCount((c) => c + 1);
		if (!repliesLoaded) {
			setRepliesLoaded(true);
		}
		setShowReplyForm(false);
	};

	// Suppression d'une réponse imbriquée
	const handleReplyDeleted = (id: string) => {
		setReplies((prev) => prev.filter((r) => r.id !== id));
		setReplyCount((c) => Math.max(0, c - 1));
	};

	// Mise à jour d'une réponse imbriquée
	const handleReplyUpdated = (id: string, content: string) => {
		setReplies((prev) => prev.map((r) => (r.id === id ? { ...r, content, is_edited: true } : r)));
	};

	// Suppression du commentaire
	const handleDelete = () => {
		startTransition(async () => {
			try {
				await deleteComment(comment.id);
				onDelete(comment.id);
				toast.success("Commentaire supprimé");
			} catch {
				toast.error("Impossible de supprimer le commentaire");
				setShowDeleteConfirm(false);
			}
		});
	};

	// Sauvegarde de l'édition
	const handleEditSave = () => {
		const trimmed = editContent.trim();
		if (!trimmed || trimmed === comment.content || trimmed.length > EDIT_MAX_LENGTH) {
			return;
		}

		startTransition(async () => {
			try {
				await updateComment(comment.id, trimmed);
				onUpdate(comment.id, trimmed);
				setIsEditing(false);
				toast.success("Commentaire modifié");
			} catch {
				toast.error("Impossible de modifier le commentaire");
			}
		});
	};

	const editRemaining = EDIT_MAX_LENGTH - editContent.length;

	return (
		<div className={cn(depth > 0 && "pl-4 border-l-2 border-outline-variant/15")}>
			<div className="bg-surface-container-low border border-outline-variant/10 rounded-2xl p-4 space-y-3">
				{/* Header */}
				<div className="flex items-start justify-between gap-2">
					<div className="flex items-center gap-2.5 min-w-0">
						{/* Avatar */}
						{comment.author.avatar_url ? (
							<Image
								src={comment.author.avatar_url}
								alt={authorName}
								width={36}
								height={36}
								className="size-9 rounded-full object-cover shrink-0 ring-2 ring-outline-variant/15"
								unoptimized={isRemoteAvatar(comment.author.avatar_url)}
							/>
						) : (
							<div className="size-9 rounded-full bg-secondary-container flex items-center justify-center shrink-0 ring-2 ring-outline-variant/15">
								<User className="size-4 text-on-secondary-container" />
							</div>
						)}

						{/* Nom + temps */}
						<div className="min-w-0">
							<div className="flex items-center gap-2 flex-wrap">
								<span className="text-sm font-semibold text-on-surface truncate">{authorName}</span>
								{comment.is_pinned && (
									<Badge className="inline-flex items-center gap-1 bg-primary/10 text-primary border-none rounded-lg px-1.5 py-0.5 text-[10px] font-semibold">
										<Pin className="size-2.5" />
										Épinglé
									</Badge>
								)}
								{comment.is_edited && (
									<span className="text-[10px] text-on-surface-variant/50 italic">(modifié)</span>
								)}
							</div>
							<span className="text-xs text-on-surface-variant/50">
								{timeAgo(comment.created_at)}
							</span>
						</div>
					</div>

					{/* Actions rapides */}
					{(canEdit || canDelete) && !isEditing && (
						<div className="flex items-center gap-1 shrink-0">
							{canEdit && (
								<button
									onClick={() => {
										setEditContent(comment.content);
										setIsEditing(true);
										setShowDeleteConfirm(false);
									}}
									className="inline-flex items-center justify-center min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 p-1.5 rounded-xl text-on-surface-variant/50 hover:text-on-surface hover:bg-surface-container transition-colors"
									title="Modifier"
								>
									<Pencil className="size-3.5" />
								</button>
							)}
							{canDelete && (
								<button
									onClick={() => setShowDeleteConfirm((v) => !v)}
									className={cn(
										"inline-flex items-center justify-center min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 p-1.5 rounded-xl transition-colors",
										showDeleteConfirm
											? "text-red-500 bg-red-500/10"
											: "text-on-surface-variant/50 hover:text-red-500 hover:bg-surface-container"
									)}
									title="Supprimer"
								>
									<Trash2 className="size-3.5" />
								</button>
							)}
						</div>
					)}
				</div>

				{/* Confirmation de suppression */}
				{showDeleteConfirm && (
					<div className="flex items-center justify-between gap-3 bg-red-500/5 border border-red-500/15 rounded-xl px-3 py-2.5">
						<p className="text-xs text-on-surface">Supprimer ce commentaire ?</p>
						<div className="flex items-center gap-2">
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setShowDeleteConfirm(false)}
								className="h-10 sm:h-6 px-2.5 text-xs rounded-lg text-on-surface-variant"
							>
								Annuler
							</Button>
							<Button
								size="sm"
								disabled={isPending}
								onClick={handleDelete}
								className="h-10 sm:h-6 px-2.5 text-xs rounded-lg bg-red-500 hover:bg-red-600 text-white"
							>
								{isPending ? "…" : "Supprimer"}
							</Button>
						</div>
					</div>
				)}

				{/* Contenu ou mode édition */}
				{isEditing ? (
					<div className="space-y-2">
						<div
							className={cn(
								"relative border rounded-xl bg-surface-container transition-colors focus-within:border-primary/40",
								editContent.length > EDIT_MAX_LENGTH
									? "border-red-500/40"
									: "border-outline-variant/15"
							)}
						>
							<textarea
								value={editContent}
								onChange={(e) => setEditContent(e.target.value)}
								rows={3}
								className="w-full resize-none bg-transparent px-3 pt-3 pb-14 sm:pb-9 text-sm text-on-surface focus:outline-hidden leading-relaxed"
								style={{ minHeight: "80px" }}
							/>
							<div className="absolute bottom-0 inset-x-0 flex items-center justify-between px-3 pb-2">
								<span
									className={cn(
										"text-xs tabular-nums",
										editRemaining < 0
											? "text-red-500 font-medium"
											: editRemaining <= 100
												? "text-amber-500"
												: "text-on-surface-variant/40"
									)}
								>
									{editRemaining}
								</span>
								<div className="flex items-center gap-1.5">
									<Button
										variant="ghost"
										size="sm"
										onClick={() => setIsEditing(false)}
										className="h-10 sm:h-6 px-2.5 text-xs rounded-lg text-on-surface-variant"
									>
										Annuler
									</Button>
									<Button
										size="sm"
										disabled={
											isPending ||
											!editContent.trim() ||
											editContent.trim() === comment.content ||
											editContent.length > EDIT_MAX_LENGTH
										}
										onClick={handleEditSave}
										className="h-10 sm:h-6 px-2.5 text-xs rounded-lg"
									>
										{isPending ? "…" : "Enregistrer"}
									</Button>
								</div>
							</div>
						</div>
					</div>
				) : (
					<p className="text-sm text-on-surface leading-relaxed whitespace-pre-wrap break-words">
						{comment.content}
					</p>
				)}

				{/* Bouton répondre */}
				{!isEditing && user && depth < MAX_DEPTH && (
					<div>
						<button
							onClick={() => setShowReplyForm((v) => !v)}
							className={cn(
								"inline-flex items-center gap-1.5 text-xs font-medium transition-colors rounded-lg px-3 py-1 min-h-11 sm:min-h-0",
								showReplyForm
									? "text-primary bg-primary/5"
									: "text-on-surface-variant/60 hover:text-primary hover:bg-primary/5"
							)}
						>
							<MessageSquare className="size-3.5" />
							Répondre
						</button>
					</div>
				)}
			</div>

			{/* Formulaire de réponse */}
			{showReplyForm && (
				<div className="mt-3 pl-2">
					<CommentForm
						articleId={articleId}
						parentId={comment.id}
						onSubmit={handleReplyCreated}
						onCancel={() => setShowReplyForm(false)}
						autoFocus
					/>
				</div>
			)}

			{/* Bouton "Voir X réponses" */}
			{replyCount > 0 && depth < MAX_DEPTH && (
				<div className="mt-2 pl-2">
					<button
						onClick={handleLoadReplies}
						disabled={repliesLoading}
						className="inline-flex items-center gap-1.5 text-xs font-medium text-primary/70 hover:text-primary transition-colors disabled:opacity-50"
					>
						<ChevronDown
							className={cn("size-3.5 transition-transform", repliesLoaded && "rotate-180")}
						/>
						{repliesLoading
							? "Chargement…"
							: repliesLoaded
								? "Masquer les réponses"
								: `Voir ${replyCount} réponse${replyCount > 1 ? "s" : ""}`}
					</button>
				</div>
			)}

			{/* Réponses imbriquées */}
			{repliesLoaded && replies.length > 0 && (
				<div className="mt-3 space-y-3">
					{replies.map((reply) => (
						<CommentItem
							key={reply.id}
							comment={reply}
							articleId={articleId}
							onDelete={handleReplyDeleted}
							onUpdate={handleReplyUpdated}
							depth={depth + 1}
						/>
					))}
				</div>
			)}
		</div>
	);
}
