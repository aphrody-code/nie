"use client";

import {
	Archive,
	Check,
	CheckCircle,
	CloudUpload,
	Copy,
	Edit,
	ExternalLink,
	FileText,
	History,
	Link2,
	MoreHorizontal,
	Pin,
	PinOff,
	Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { exportToGoogleDrive } from "@/app/dashboard/import-google-doc/actions";
import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@rosegriffon/ui";

interface NewsActionsProps {
	newsId: string;
	slug: string;
	pinned?: boolean;
	currentStatus?: string;
}

const STATUS_OPTIONS = [
	{ color: "text-amber-500", icon: FileText, label: "Brouillon", value: "draft" },
	{ color: "text-green-500", icon: CheckCircle, label: "Publié", value: "published" },
	{ color: "text-stone-500", icon: Archive, label: "Archivé", value: "archived" },
];

export function NewsActions({
	newsId,
	slug,
	pinned = false,
	currentStatus = "draft",
}: NewsActionsProps) {
	const router = useRouter();

	const [loading, setLoading] = useState(false);

	const handleStatusChange = async (newStatus: string) => {
		if (newStatus === currentStatus) {
			return;
		}
		setLoading(true);
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const updateData: Record<string, any> = {
				status: newStatus,
				updated_at: new Date().toISOString(),
			};
			if (newStatus === "published" && currentStatus !== "published") {
				updateData.published_at = new Date().toISOString();
				updateData.scheduled_at = null;
			}
			if (newStatus === "draft" || newStatus === "archived") {
				updateData.scheduled_at = null;
			}

			const { updateArticleStatus } = await import("@/app/actions/articles");
			const result = await updateArticleStatus(newsId, newStatus, currentStatus);
			if (result.error) {
				throw new Error(result.error);
			}

			const label = STATUS_OPTIONS.find((s) => s.value === newStatus)?.label || newStatus;
			toast.success(`Statut changé en « ${label} »`);
			router.refresh();
		} catch {
			toast.error("Erreur lors du changement de statut");
		} finally {
			setLoading(false);
		}
	};

	const handleExport = async () => {
		setLoading(true);
		try {
			const result = await exportToGoogleDrive(newsId);
			if (result.success) {
				toast.success("Article exporté vers Google Drive !");
			} else {
				toast.error(`Erreur d'export : ${result.error}`);
			}
		} catch (error) {
			console.error("Export error:", error);
			toast.error("Erreur lors de l'exportation");
		} finally {
			setLoading(false);
		}
	};

	const handleCopyLink = async () => {
		const url = `${window.location.origin}/news/${slug}`;
		await navigator.clipboard.writeText(url);
		toast.success("Lien copié");
	};

	const handleCopySlug = async () => {
		await navigator.clipboard.writeText(slug);
		toast.success("Slug copié");
	};

	const handleDelete = async () => {
		if (
			!confirm("Êtes-vous sûr de vouloir supprimer cet article ? Cette action est irréversible.")
		) {
			return;
		}

		setLoading(true);
		try {
			const { deleteArticle } = await import("@/app/actions/articles");
			const result = await deleteArticle(newsId);
			if (result.error) {
				throw new Error(result.error);
			}

			toast.success("Article supprimé");
			router.refresh();
		} catch (error) {
			console.error("Error deleting news:", error);
			toast.error("Erreur lors de la suppression");
		} finally {
			setLoading(false);
		}
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="rounded-full hover:bg-surface-container-high"
					disabled={loading}
				>
					<MoreHorizontal className="size-5" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				className="rounded-2xl border-none shadow-2xl p-2 min-w-[200px] bg-surface-container-high"
			>
				<DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant px-3 py-2">
					Actions
				</DropdownMenuLabel>
				<DropdownMenuSeparator className="bg-outline-variant/10" />

				<DropdownMenuItem
					asChild
					className="rounded-xl focus:bg-primary/10 focus:text-primary transition-colors"
				>
					<Link href={`/dashboard/news/${newsId}`} className="cursor-pointer font-bold">
						<Edit className="mr-3 size-4" /> Modifier
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem
					asChild
					className="rounded-xl focus:bg-primary/10 focus:text-primary transition-colors"
				>
					<Link
						href={currentStatus === "published" ? `/news/${slug}` : `/news/${slug}?preview=true`}
						target="_blank"
						className="cursor-pointer font-bold"
					>
						<ExternalLink className="mr-3 size-4" /> Voir l&apos;aperçu
					</Link>
				</DropdownMenuItem>

				<DropdownMenuSeparator className="bg-outline-variant/10" />

				{/* Quick status change */}
				<DropdownMenuSub>
					<DropdownMenuSubTrigger className="rounded-xl focus:bg-primary/10 focus:text-primary transition-colors cursor-pointer font-bold">
						<Check className="mr-3 size-4" /> Changer le statut
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent className="rounded-2xl border-none shadow-2xl p-1.5 bg-surface-container-high min-w-[160px]">
						{STATUS_OPTIONS.map((opt) => (
							<DropdownMenuItem
								key={opt.value}
								onClick={() => handleStatusChange(opt.value)}
								disabled={opt.value === currentStatus}
								className={`rounded-xl transition-colors cursor-pointer font-bold ${
									opt.value === currentStatus
										? "opacity-50"
										: "focus:bg-primary/10 focus:text-primary"
								}`}
							>
								<opt.icon className={`mr-3 size-4 ${opt.color}`} />
								{opt.label}
								{opt.value === currentStatus && (
									<span className="ml-auto text-[10px] text-on-surface-variant/60">actuel</span>
								)}
							</DropdownMenuItem>
						))}
					</DropdownMenuSubContent>
				</DropdownMenuSub>

				<DropdownMenuItem
					onClick={async () => {
						setLoading(true);
						try {
							const { toggleArticlePin } = await import("@/app/actions/articles");
							const result = await toggleArticlePin(newsId, pinned);
							if (result.error) {
								throw new Error(result.error);
							}
							toast.success(pinned ? "Article retiré de la une" : "Article épinglé en une");
							router.refresh();
						} catch {
							toast.error("Erreur lors de la mise à jour");
						} finally {
							setLoading(false);
						}
					}}
					className="rounded-xl focus:bg-primary/10 focus:text-primary transition-colors cursor-pointer font-bold"
				>
					{pinned ? <PinOff className="mr-3 size-4" /> : <Pin className="mr-3 size-4" />}
					{pinned ? "Retirer de la une" : "Épingler en une"}
				</DropdownMenuItem>

				<DropdownMenuSeparator className="bg-outline-variant/10" />

				<DropdownMenuItem
					onClick={handleCopyLink}
					className="rounded-xl focus:bg-primary/10 focus:text-primary transition-colors cursor-pointer font-bold"
				>
					<Link2 className="mr-3 size-4" /> Copier le lien
				</DropdownMenuItem>
				<DropdownMenuItem
					onClick={handleCopySlug}
					className="rounded-xl focus:bg-primary/10 focus:text-primary transition-colors cursor-pointer font-bold"
				>
					<Copy className="mr-3 size-4" /> Copier le slug
				</DropdownMenuItem>

				<DropdownMenuItem
					onClick={async () => {
						setLoading(true);
						try {
							const { duplicateArticle } = await import("@/app/actions/articles");
							const result = await duplicateArticle(newsId);
							if ("id" in result) {
								toast.success("Article dupliqué");
								router.push(`/dashboard/news/${result.id}`);
							} else {
								toast.error(result.error);
							}
						} catch {
							toast.error("Erreur lors de la duplication");
						} finally {
							setLoading(false);
						}
					}}
					className="rounded-xl focus:bg-primary/10 focus:text-primary transition-colors cursor-pointer font-bold"
				>
					<Copy className="mr-3 size-4" /> Dupliquer
				</DropdownMenuItem>
				<DropdownMenuItem
					asChild
					className="rounded-xl focus:bg-primary/10 focus:text-primary transition-colors"
				>
					<Link href={`/dashboard/news/${newsId}/versions`} className="cursor-pointer font-bold">
						<History className="mr-3 size-4" /> Historique
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem
					onClick={handleExport}
					className="rounded-xl focus:bg-primary/10 focus:text-primary transition-colors cursor-pointer font-bold"
				>
					<CloudUpload className="mr-3 size-4" /> Exporter vers Drive
				</DropdownMenuItem>
				<DropdownMenuSeparator className="bg-outline-variant/10" />
				<DropdownMenuItem
					onClick={handleDelete}
					className="text-error font-bold rounded-xl focus:bg-error/10 focus:text-error transition-colors cursor-pointer"
				>
					<Trash2 className="mr-3 size-4" /> Supprimer
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
