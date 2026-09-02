"use client";

import {
	ArrowLeft,
	Check,
	ChevronDown,
	Clock,
	Cloud,
	CloudOff,
	ExternalLink,
	Eye,
	FileText,
	Loader2,
	MessageSquare,
	Redo2,
	Save,
	SlidersHorizontal,
	Type,
} from "lucide-react";
import Link from "next/link";
import {
	Button,
	TabsList,
	TabsTrigger,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@rosegriffon/ui";
import { cn } from "@/lib/utils";
import { STATUS_OPTIONS } from "./constants";

interface EditorHeaderProps {
	status: string;
	wordCount: number;
	readTime: number;
	hasUnsavedChanges: boolean;
	lastAutoSave: Date | null;
	lastServerSave: Date | null;
	isSaving: boolean;
	showPreview: boolean;
	loading: boolean;
	title: string;
	slug?: string;
	initialId?: string;
	initialStatus?: string;
	activeTab: string;
	shareOnDiscord: boolean;
	onTogglePreview: () => void;
	onSaveDraft: () => void;
	onSaveAndContinue: () => void;
	onRevertToDraft: () => void;
	onPublish: () => void;
	onShareOnDiscordChange: (value: boolean) => void;
}

export function EditorHeader({
	status,
	wordCount,
	readTime,
	hasUnsavedChanges,
	lastAutoSave,
	lastServerSave,
	isSaving,
	showPreview,
	loading,
	title,
	slug,
	initialId,
	initialStatus,
	activeTab,
	shareOnDiscord,
	onTogglePreview,
	onSaveDraft: _onSaveDraft,
	onSaveAndContinue,
	onRevertToDraft,
	onPublish,
	onShareOnDiscordChange,
}: EditorHeaderProps) {
	const currentStatus = STATUS_OPTIONS.find((s) => s.value === status);
	const isPublished = status === "published" || initialStatus === "published";
	const previewUrl = slug ? (isPublished ? `/news/${slug}` : `/news/${slug}?preview=true`) : null;

	// Dernier enregistrement (serveur > localStorage)
	const lastSaveTime = lastServerSave || lastAutoSave;
	const lastSaveLabel = lastSaveTime
		? `${lastSaveTime.getHours().toString().padStart(2, "0")}:${lastSaveTime.getMinutes().toString().padStart(2, "0")}`
		: null;

	return (
		<header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-outline-variant/30">
			<div className="flex items-center justify-between px-3 md:px-6 py-2.5 gap-2">
				{/* Left: Back + Status + Save indicator */}
				<div className="flex items-center gap-2 sm:gap-3 min-w-0">
					<Link href="/dashboard/news">
						<Button
							variant="ghost"
							size="icon"
							className="rounded-full size-10 sm:size-12 text-on-surface-variant hover:bg-surface-container shrink-0"
						>
							<ArrowLeft className="size-5" />
						</Button>
					</Link>

					<div className="hidden sm:flex items-center gap-2">
						<div className={cn("size-2 rounded-full", currentStatus?.color)} />
						<span
							className={cn("text-xs font-bold uppercase tracking-wider", currentStatus?.textColor)}
						>
							{currentStatus?.label}
						</span>
					</div>

					{/* Save state indicator */}
					<div className="hidden md:flex items-center gap-1.5 text-[10px] text-on-surface-variant/50">
						{isSaving ? (
							<>
								<Loader2 className="size-3 animate-spin" />
								<span>Sauvegarde…</span>
							</>
						) : hasUnsavedChanges ? (
							<>
								<CloudOff className="size-3" />
								<span>Non sauvegardé</span>
							</>
						) : lastServerSave ? (
							<>
								<Cloud className="size-3 text-green-500" />
								<span>Serveur à {lastSaveLabel}</span>
							</>
						) : lastAutoSave ? (
							<>
								<Check className="size-3" />
								<span>Brouillon local</span>
							</>
						) : null}
					</div>
				</div>

				{/* Center: Tabs */}
				<TabsList className="bg-surface-container-low rounded-full h-10 p-1 shrink-0">
					<TabsTrigger
						value="content"
						className={cn(
							"rounded-full px-4 sm:px-5 text-xs font-medium transition-all data-[state=active]:bg-secondary-container data-[state=active]:text-on-secondary-container data-[state=active]:shadow-none",
							activeTab !== "content" && "text-on-surface-variant"
						)}
					>
						<FileText className="size-3.5 mr-1.5" />
						<span className="hidden sm:inline">Contenu</span>
					</TabsTrigger>
					<TabsTrigger
						value="metadata"
						className={cn(
							"rounded-full px-4 sm:px-5 text-xs font-medium transition-all data-[state=active]:bg-secondary-container data-[state=active]:text-on-secondary-container data-[state=active]:shadow-none",
							activeTab !== "metadata" && "text-on-surface-variant"
						)}
					>
						<SlidersHorizontal className="size-3.5 mr-1.5" />
						<span className="hidden sm:inline">Métadonnées</span>
					</TabsTrigger>
				</TabsList>

				{/* Right: Actions */}
				<div className="flex items-center gap-1.5 sm:gap-2">
					{/* Word count badge */}
					<div className="hidden lg:flex items-center gap-1.5 text-[11px] text-on-surface-variant/60 bg-surface-container-low px-3 py-1.5 rounded-full">
						<Type className="size-3" />
						<span>{wordCount} mots</span>
						<span className="text-on-surface-variant/30">|</span>
						<Clock className="size-3" />
						<span>{readTime} min</span>
					</div>

					{/* Preview toggle */}
					<Button
						variant="ghost"
						size="sm"
						onClick={onTogglePreview}
						className={cn(
							"rounded-full h-10 sm:h-12 px-3 sm:px-4 text-xs font-medium gap-1.5",
							showPreview ? "bg-primary/10 text-primary" : "text-on-surface-variant"
						)}
					>
						<Eye className="size-4" />
						<span className="hidden sm:inline">Aperçu</span>
					</Button>

					{/* External preview link */}
					{previewUrl && initialId && (
						<Button
							variant="ghost"
							size="icon"
							asChild
							className="rounded-full size-10 sm:size-12 text-on-surface-variant/60 hover:text-on-surface"
						>
							<Link href={previewUrl} target="_blank" title="Voir sur le site">
								<ExternalLink className="size-4" />
							</Link>
						</Button>
					)}

					{/* Discord share toggle */}
					<Button
						variant="ghost"
						size="icon"
						onClick={() => onShareOnDiscordChange(!shareOnDiscord)}
						className={cn(
							"rounded-full size-10 sm:size-12",
							shareOnDiscord ? "bg-[#5865F2]/10 text-[#5865F2]" : "text-on-surface-variant/40"
						)}
						title={shareOnDiscord ? "Partage Discord activé" : "Partage Discord désactivé"}
					>
						<MessageSquare className="size-4" />
					</Button>

					{/* Save actions — differs based on article status */}
					{isPublished ? (
						// Article publié : menu déroulant avec options
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									disabled={loading || !title}
									className="rounded-full h-10 sm:h-12 px-4 sm:px-5 font-bold text-xs gap-1.5 bg-primary text-on-primary hover:bg-primary/90"
									size="sm"
								>
									{loading ? (
										<Loader2 className="animate-spin size-4" />
									) : (
										<>
											<Save className="size-3.5" />
											<span className="hidden sm:inline">Mettre à jour</span>
											<span className="sm:hidden">MAJ</span>
											<ChevronDown className="size-3 ml-1" />
										</>
									)}
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent
								align="end"
								className="rounded-2xl border-none shadow-2xl p-2 min-w-[200px] bg-surface-container-high"
							>
								<DropdownMenuItem
									onClick={onPublish}
									className="rounded-xl focus:bg-primary/10 focus:text-primary transition-colors cursor-pointer font-bold"
								>
									<Save className="mr-3 size-4" />
									Mettre à jour et quitter
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={onSaveAndContinue}
									className="rounded-xl focus:bg-primary/10 focus:text-primary transition-colors cursor-pointer font-bold"
								>
									<Check className="mr-3 size-4" />
									Sauvegarder et continuer
								</DropdownMenuItem>
								<DropdownMenuSeparator className="bg-outline-variant/10" />
								<DropdownMenuItem
									onClick={onRevertToDraft}
									className="rounded-xl focus:bg-amber-500/10 focus:text-amber-600 transition-colors cursor-pointer font-bold text-amber-600"
								>
									<Redo2 className="mr-3 size-4" />
									Repasser en brouillon
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					) : (
						// Article non publié : bouton Sauvegarder + bouton Publier
						<>
							<Button
								onClick={onSaveAndContinue}
								disabled={loading || !title}
								variant="outline"
								size="sm"
								className="rounded-full h-10 sm:h-12 px-3 sm:px-4 text-xs font-medium gap-1.5"
							>
								<Save className="size-3.5" />
								<span className="hidden sm:inline">Sauvegarder</span>
							</Button>

							<Button
								onClick={onPublish}
								disabled={loading || !title}
								className="rounded-full h-10 sm:h-12 px-4 sm:px-5 font-bold hover:opacity-90 transition-opacity text-xs gap-1.5 bg-green-600 text-white"
								size="sm"
							>
								{loading ? (
									<Loader2 className="animate-spin size-4" />
								) : (
									<>
										<FileText className="size-3.5" />
										Publier
									</>
								)}
							</Button>
						</>
					)}
				</div>
			</div>
		</header>
	);
}
