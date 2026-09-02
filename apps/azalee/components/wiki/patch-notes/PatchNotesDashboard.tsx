"use client";

import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { getPatchNoteDetail, getPatchNotes } from "@/app/actions/news";
import type { PatchNoteDetail, PatchNoteSummary } from "@/app/actions/news";
import { ScrollArea } from "@rosegriffon/ui";
import { cn } from "@/lib/utils";
import { PatchNoteViewer } from "./PatchNoteViewer";

interface PatchNotesDashboardProps {
	initialNotes?: PatchNoteSummary[];
}

/**
 * Extrait le numéro de version depuis l'ID composite.
 * Ex: "ps-steam_ver_3_1_1" → "3.1.1"
 *     "switch_ver_3_0_0" → "3.0.0"
 */
const NOW = Date.now();

function extractVersion(id: string): string | null {
	const match = id.match(/ver_(\d+(?:_\d+)*)/);
	if (!match) {
		return null;
	}
	return match[1].replaceAll("_", ".");
}

function PatchNoteListItem({
	note,
	isActive,
	onClick,
}: {
	note: PatchNoteSummary;
	isActive: boolean;
	onClick: () => void;
}) {
	const dateObj = note.date ? new Date(note.date) : null;
	const isNew = dateObj && NOW - dateObj.getTime() < 1000 * 60 * 60 * 24 * 7;
	const version = extractVersion(note.id);

	return (
		<button
			onClick={onClick}
			className={cn(
				"w-full text-left px-4 py-3.5 border-b border-outline-variant/5 transition-all duration-200",
				isActive
					? "bg-primary/8 border-l-3 border-l-primary"
					: "hover:bg-surface-container-lowest/50 border-l-3 border-l-transparent"
			)}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="flex-1 min-w-0 space-y-1">
					{/* Version + date + new badge */}
					<div className="flex items-center gap-2 flex-wrap">
						{version && (
							<span
								className={cn(
									"text-xs font-bold px-2 py-0.5 rounded-full",
									isActive ? "bg-primary text-on-primary" : "bg-primary/10 text-primary"
								)}
							>
								v{version}
							</span>
						)}
						<span className="text-[11px] font-medium text-on-surface-variant/60">
							{dateObj ? format(dateObj, "d MMM yyyy", { locale: fr }) : note.date}
						</span>
						{isNew && (
							<span className="text-[10px] font-bold uppercase text-error bg-error/10 px-1.5 py-0.5 rounded">
								New
							</span>
						)}
					</div>

					{/* Title */}
					<h3
						className={cn(
							"text-[13px] leading-tight line-clamp-2 transition-colors",
							isActive ? "text-primary font-semibold" : "text-on-surface-variant"
						)}
					>
						{note.title}
					</h3>
				</div>

				<ChevronRight
					className={cn(
						"size-4 shrink-0 mt-1 transition-all",
						isActive
							? "text-primary opacity-100"
							: "text-on-surface-variant/30 opacity-0 group-hover:opacity-100"
					)}
				/>
			</div>
		</button>
	);
}

export default function PatchNotesPageClient({ initialNotes }: PatchNotesDashboardProps) {
	const [isPending, startTransition] = useTransition();
	const [loading, setLoading] = useState(!initialNotes);
	const [platform, setPlatform] = useState("ps-steam");
	const [list, setList] = useState<PatchNoteSummary[]>(initialNotes || []);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [detailData, setDetailData] = useState<PatchNoteDetail | null>(null);
	const [loadingDetail, setLoadingDetail] = useState(false);

	const fetchList = useCallback(async (pf: string) => {
		setLoading(true);
		startTransition(async () => {
			try {
				const notes = await getPatchNotes(pf);
				setList(notes);
				// Auto-select le premier item
				setSelectedId(notes.length > 0 ? notes[0].id : null);
			} catch (error) {
				console.error(error);
				setList([]);
				setSelectedId(null);
			} finally {
				setLoading(false);
			}
		});
	}, []);

	const fetchDetail = useCallback(async (noteId: string) => {
		setLoadingDetail(true);
		try {
			const detail = await getPatchNoteDetail(noteId);
			if (detail) {
				setDetailData(detail);
			}
		} catch (error) {
			console.error(error);
			setDetailData(null);
		} finally {
			setLoadingDetail(false);
		}
	}, []);

	useEffect(() => {
		fetchList(platform);
	}, [platform, fetchList]);

	useEffect(() => {
		if (selectedId && list.length > 0) {
			fetchDetail(selectedId);
		}
	}, [selectedId, list, fetchDetail]);

	const detailRef = useRef<HTMLDivElement>(null);

	// On mobile: show list OR detail, not both
	const showMobileDetail = selectedId && detailData;

	return (
		<div className="grid grid-cols-1 lg:grid-cols-12 gap-0 lg:gap-8">
			{/* Sidebar — hidden on mobile when detail is shown */}
			<div
				className={cn(
					"lg:col-span-4 xl:col-span-3 flex flex-col lg:sticky lg:top-24 lg:h-[calc(100vh-120px)]",
					showMobileDetail ? "hidden lg:flex" : "flex"
				)}
			>
				{/* Platform tabs */}
				<div className="flex border-b border-outline-variant/10 bg-surface-container-lowest/50">
					{[
						["ps-steam", "PC / PS"],
						["switch", "Switch"],
						["xbox", "Xbox"],
					].map(([key, label]) => (
						<button
							key={key}
							onClick={() => {
								setPlatform(key);
								setSelectedId(null);
								setDetailData(null);
							}}
							className={cn(
								"flex-1 py-4 sm:py-3 text-sm font-bold transition-all relative",
								platform === key
									? "text-on-surface"
									: "text-on-surface-variant/50 hover:text-on-surface-variant"
							)}
						>
							{label}
							{platform === key && (
								<span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-0.5 rounded-full bg-primary" />
							)}
						</button>
					))}
				</div>

				{/* List */}
				<ScrollArea className="flex-1 min-h-[200px] lg:min-h-0">
					<div className="flex flex-col">
						{loading || isPending ? (
							<div className="flex justify-center py-12">
								<Loader2 className="animate-spin text-primary size-6" />
							</div>
						) : list.length > 0 ? (
							list.map((note) => (
								<PatchNoteListItem
									key={note.id}
									note={note}
									isActive={selectedId === note.id}
									onClick={() => setSelectedId(note.id)}
								/>
							))
						) : (
							<div className="py-12 text-center text-sm text-on-surface-variant/50">
								Aucun patch note pour cette plateforme.
							</div>
						)}
					</div>
				</ScrollArea>
			</div>

			{/* Detail — hidden on mobile when no detail selected */}
			<div
				className={cn(
					"lg:col-span-8 xl:col-span-9",
					showMobileDetail ? "block" : "hidden lg:block"
				)}
				ref={detailRef}
			>
				{/* Mobile back button */}
				{showMobileDetail && (
					<button
						onClick={() => {
							setSelectedId(null);
							setDetailData(null);
						}}
						className="lg:hidden flex items-center gap-2 text-sm font-medium text-primary mb-4 py-3 active:opacity-70 transition-opacity"
					>
						<ChevronRight className="size-4 rotate-180" />
						Retour à la liste
					</button>
				)}

				{loadingDetail ? (
					<div className="h-96 flex flex-col items-center justify-center text-on-surface-variant gap-3">
						<Loader2 className="size-8 animate-spin text-primary" />
						<p className="text-sm animate-pulse">Chargement...</p>
					</div>
				) : detailData ? (
					<PatchNoteViewer data={detailData} />
				) : (
					<div className="h-96 flex flex-col items-center justify-center text-on-surface-variant/50 gap-2">
						<RefreshCw size={36} aria-hidden="true" />
						<p className="text-sm">Selectionnez un patch note pour voir les details.</p>
					</div>
				)}
			</div>
		</div>
	);
}
