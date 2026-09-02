"use client";

import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Edit, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@rosegriffon/ui";
import { deleteTweet } from "./actions";

export function TweetRow({ tweet }: { tweet: any }) {
	const [deleting, setDeleting] = useState(false);

	const handleDelete = async () => {
		if (!confirm("Supprimer ce tweet ?")) {
			return;
		}
		setDeleting(true);
		try {
			await deleteTweet(tweet.id);
			toast.success("Tweet supprimé");
		} catch {
			toast.error("Erreur lors de la suppression");
		} finally {
			setDeleting(false);
		}
	};

	return (
		<div className="flex gap-4 p-4 border-b border-outline-variant/10 hover:bg-surface-container-high transition-colors">
			<div className="size-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
				<span className="font-bold text-primary text-xs">X</span>
			</div>
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2 mb-1">
					<span className="font-bold text-on-surface text-sm">@{tweet.author_username}</span>
					<span className="text-xs text-on-surface-variant">
						{format(new Date(tweet.created_at), "d MMM yyyy HH:mm", { locale: fr })}
					</span>
				</div>
				<p className="text-sm text-on-surface line-clamp-3 whitespace-pre-wrap">{tweet.text}</p>
			</div>
			<div className="flex flex-col gap-2 shrink-0">
				<Button asChild size="icon" variant="ghost" className="rounded-full">
					<Link href={`/dashboard/tweets/${tweet.id}`}>
						<Edit className="size-4" />
					</Link>
				</Button>
				<Button
					size="icon"
					variant="ghost"
					className="rounded-full text-error hover:bg-error/10 hover:text-error"
					disabled={deleting}
					onClick={handleDelete}
				>
					<Trash2 className="size-4" />
				</Button>
			</div>
		</div>
	);
}
