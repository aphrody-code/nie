"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { bulkDeleteArticles, bulkUpdateArticles } from "@/app/actions/articles";
import type { NewsItem } from "@/types/news";
import { BulkActionsBar } from "./BulkActionsBar";
import { SelectableNewsCard } from "./SelectableNewsCard";
import { SelectableNewsRow } from "./SelectableNewsRow";

interface NewsListClientProps {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	items: any[];
	isListView: boolean;
}

export function NewsListClient({ items, isListView }: NewsListClientProps) {
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const router = useRouter();

	const toggleSelect = useCallback((id: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	}, []);

	const toggleSelectAll = useCallback(() => {
		if (selectedIds.size === items.length) {
			setSelectedIds(new Set());
		} else {
			setSelectedIds(new Set(items.map((i) => i.id)));
		}
	}, [items, selectedIds.size]);

	const clearSelection = useCallback(() => {
		setSelectedIds(new Set());
	}, []);

	const handleBulkAction = useCallback(
		async (action: string, value?: string) => {
			const ids = [...selectedIds];
			if (ids.length === 0) {
				return;
			}

			if (action === "status" && value) {
				const result = await bulkUpdateArticles(ids, { status: value });
				if (result.success) {
					toast.success(`${result.count} article${result.count > 1 ? "s" : ""} mis à jour`);
					clearSelection();
					router.refresh();
				} else {
					toast.error(result.error || "Erreur");
				}
			} else if (action === "category" && value) {
				const result = await bulkUpdateArticles(ids, { category: value });
				if (result.success) {
					toast.success(
						`Catégorie mise à jour pour ${result.count} article${result.count > 1 ? "s" : ""}`
					);
					clearSelection();
					router.refresh();
				} else {
					toast.error(result.error || "Erreur");
				}
			} else if (action === "pin" && value !== undefined) {
				const result = await bulkUpdateArticles(ids, { pinned: value === "true" });
				if (result.success) {
					toast.success(
						value === "true"
							? `${result.count} article${result.count > 1 ? "s" : ""} épinglé${result.count > 1 ? "s" : ""}`
							: `${result.count} article${result.count > 1 ? "s" : ""} désépinglé${result.count > 1 ? "s" : ""}`
					);
					clearSelection();
					router.refresh();
				} else {
					toast.error(result.error || "Erreur");
				}
			} else if (action === "delete") {
				const result = await bulkDeleteArticles(ids);
				if (result.success) {
					toast.success(
						`${result.count} article${result.count > 1 ? "s" : ""} supprimé${result.count > 1 ? "s" : ""}`
					);
					clearSelection();
					router.refresh();
				} else {
					toast.error(result.error || "Erreur");
				}
			}
		},
		[selectedIds, clearSelection, router]
	);

	const allSelected = items.length > 0 && selectedIds.size === items.length;

	return (
		<>
			{/* Select all toggle */}
			{items.length > 0 && (
				<div className="flex items-center gap-3 px-1">
					<button
						type="button"
						onClick={toggleSelectAll}
						className="flex items-center gap-2 text-xs text-on-surface-variant hover:text-on-surface transition-colors"
					>
						<div
							className={`size-4 rounded border transition-all flex items-center justify-center ${
								allSelected
									? "bg-primary border-primary"
									: selectedIds.size > 0
										? "bg-primary/30 border-primary"
										: "border-outline-variant"
							}`}
						>
							{(allSelected || selectedIds.size > 0) && (
								<svg className="size-3 text-on-primary" viewBox="0 0 12 12" fill="none">
									{allSelected ? (
										<path
											d="M2 6L5 9L10 3"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
									) : (
										<path d="M3 6H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
									)}
								</svg>
							)}
						</div>
						{selectedIds.size > 0
							? `${selectedIds.size} sélectionné${selectedIds.size > 1 ? "s" : ""}`
							: "Tout sélectionner"}
					</button>
				</div>
			)}

			{isListView ? (
				<div className="rounded-[24px] sm:rounded-[32px] border border-outline-variant/30 overflow-hidden bg-surface-container-lowest shadow-sm divide-y divide-outline-variant/10">
					{items.map((item) => (
						<SelectableNewsRow
							key={item.id}
							item={item}
							selected={selectedIds.has(item.id)}
							onToggle={() => toggleSelect(item.id)}
						/>
					))}
				</div>
			) : (
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 sm:gap-6">
					{items.map((item) => (
						<SelectableNewsCard
							key={item.id}
							item={item as unknown as NewsItem}
							selected={selectedIds.has(item.id)}
							onToggle={() => toggleSelect(item.id)}
						/>
					))}
				</div>
			)}

			<BulkActionsBar
				selectedCount={selectedIds.size}
				onClearSelection={clearSelection}
				onBulkAction={handleBulkAction}
			/>
		</>
	);
}
