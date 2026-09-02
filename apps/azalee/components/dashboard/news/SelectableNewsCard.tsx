"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuGroup,
	ContextMenuItem,
	ContextMenuLabel,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "@rosegriffon/ui";
import {
	Archive,
	CheckCircle,
	Copy,
	Edit,
	ExternalLink,
	FileText,
	Trash2,
} from "@/lib/icons-config";
import { cn } from "@/lib/utils";
import type { NewsItem } from "@/types/news";
import { NewsCard } from "./news-card";

interface SelectableNewsCardProps {
	item: NewsItem;
	selected: boolean;
	onToggle: () => void;
}

const QUICK_STATUS = [
	{
		color: "text-amber-500",
		icon: FileText,
		label: "Brouillon",
		value: "draft",
	},
	{
		color: "text-green-500",
		icon: CheckCircle,
		label: "Publié",
		value: "published",
	},
	{
		color: "text-stone-500",
		icon: Archive,
		label: "Archivé",
		value: "archived",
	},
];

export function SelectableNewsCard({ item, selected, onToggle }: SelectableNewsCardProps) {
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const slug = item.slug || "";

	const handleCopyLink = async () => {
		const url = `${window.location.origin}/news/${slug}`;
		await navigator.clipboard.writeText(url);
		toast.success("Lien copié");
	};

	const handleStatusChange = async (newStatus: string) => {
		if (newStatus === item.status) {
			return;
		}
		setBusy(true);
		try {
			const { updateArticleStatus } = await import("@/app/actions/articles");
			const result = await updateArticleStatus(item.id, newStatus, item.status);
			if (result.error) {
				throw new Error(result.error);
			}
			const label = QUICK_STATUS.find((s) => s.value === newStatus)?.label || newStatus;
			toast.success(`Statut changé en « ${label} »`);
			router.refresh();
		} catch {
			toast.error("Erreur lors du changement de statut");
		} finally {
			setBusy(false);
		}
	};

	const handleDuplicate = async () => {
		setBusy(true);
		try {
			const { duplicateArticle } = await import("@/app/actions/articles");
			const result = await duplicateArticle(item.id);
			if ("id" in result) {
				toast.success("Article dupliqué");
				router.push(`/dashboard/news/${result.id}`);
			} else {
				toast.error(result.error);
			}
		} catch {
			toast.error("Erreur lors de la duplication");
		} finally {
			setBusy(false);
		}
	};

	const handleDelete = async () => {
		if (
			!confirm("Êtes-vous sûr de vouloir supprimer cet article ? Cette action est irréversible.")
		) {
			return;
		}
		setBusy(true);
		try {
			const { deleteArticle } = await import("@/app/actions/articles");
			const result = await deleteArticle(item.id);
			if (result.error) {
				throw new Error(result.error);
			}
			toast.success("Article supprimé");
			router.refresh();
		} catch {
			toast.error("Erreur lors de la suppression");
		} finally {
			setBusy(false);
		}
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div className={cn("relative", busy && "pointer-events-none opacity-60")}>
					{/* Checkbox overlay */}
					<button
						type="button"
						onClick={(e) => {
							e.preventDefault();
							e.stopPropagation();
							onToggle();
						}}
						className="absolute top-3 left-3 z-20 flex size-6 items-center justify-center rounded-lg border border-outline-variant/30 bg-surface/80 backdrop-blur-sm transition-all hover:border-primary"
						aria-label={selected ? "Désélectionner" : "Sélectionner"}
					>
						<div
							className={cn(
								"flex size-4 items-center justify-center rounded transition-all",
								selected && "bg-primary"
							)}
						>
							{selected && (
								<svg
									className="size-3 text-on-primary"
									viewBox="0 0 12 12"
									fill="none"
									aria-hidden="true"
								>
									<path
										d="M2 6L5 9L10 3"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
							)}
						</div>
					</button>

					{/* Selection ring */}
					<div
						className={cn(
							"rounded-[26px] transition-all duration-200",
							selected && "ring-2 ring-primary ring-offset-2 ring-offset-background"
						)}
					>
						<NewsCard item={item} />
					</div>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent className="min-w-[200px] rounded-2xl border-none bg-surface-container-high p-2 shadow-2xl">
				<ContextMenuLabel className="px-3 py-2 font-black text-[10px] text-on-surface-variant uppercase tracking-widest">
					Actions rapides
				</ContextMenuLabel>
				<ContextMenuSeparator className="bg-outline-variant/10" />

				<ContextMenuGroup>
					<ContextMenuItem
						asChild
						className="rounded-xl font-bold focus:bg-primary/10 focus:text-primary"
					>
						<Link href={`/dashboard/news/${item.id}`}>
							<Edit /> Modifier
							<ContextMenuShortcut>E</ContextMenuShortcut>
						</Link>
					</ContextMenuItem>
					<ContextMenuItem
						asChild
						className="rounded-xl font-bold focus:bg-primary/10 focus:text-primary"
					>
						<Link
							href={item.status === "published" ? `/news/${slug}` : `/news/${slug}?preview=true`}
							target="_blank"
						>
							<ExternalLink /> Voir l&apos;aperçu
						</Link>
					</ContextMenuItem>
				</ContextMenuGroup>

				<ContextMenuSeparator className="bg-outline-variant/10" />

				<ContextMenuSub>
					<ContextMenuSubTrigger className="rounded-xl font-bold focus:bg-primary/10 focus:text-primary">
						Statut
					</ContextMenuSubTrigger>
					<ContextMenuSubContent className="min-w-[160px] rounded-2xl border-none bg-surface-container-high p-1.5 shadow-2xl">
						{QUICK_STATUS.map((opt) => (
							<ContextMenuItem
								key={opt.value}
								onSelect={() => handleStatusChange(opt.value)}
								disabled={opt.value === item.status}
								className="rounded-xl font-bold focus:bg-primary/10 focus:text-primary"
							>
								<opt.icon className={cn("mr-1", opt.color)} />
								{opt.label}
								{opt.value === item.status && (
									<ContextMenuShortcut className="opacity-60">actuel</ContextMenuShortcut>
								)}
							</ContextMenuItem>
						))}
					</ContextMenuSubContent>
				</ContextMenuSub>

				<ContextMenuItem
					onSelect={handleDuplicate}
					className="rounded-xl font-bold focus:bg-primary/10 focus:text-primary"
				>
					<Copy /> Dupliquer
				</ContextMenuItem>
				<ContextMenuItem
					onSelect={handleCopyLink}
					className="rounded-xl font-bold focus:bg-primary/10 focus:text-primary"
				>
					<ExternalLink /> Copier le lien
				</ContextMenuItem>

				<ContextMenuSeparator className="bg-outline-variant/10" />

				<ContextMenuItem
					variant="destructive"
					onSelect={handleDelete}
					className="rounded-xl font-bold"
				>
					<Trash2 /> Supprimer
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}
