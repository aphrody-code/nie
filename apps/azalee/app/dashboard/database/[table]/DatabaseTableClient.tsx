"use client";

import Link from "next/link";
import { useState } from "react";
import {
	Button,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@rosegriffon/ui";
import { Icon } from "@/components/ui/Icon";

interface DatabaseTableClientProps {
	table: string;
	rows: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
	columns: string[];
	currentSort: string;
	currentDir: "asc" | "desc";
	pageNum: number;
	totalPages: number;
	count: number;
}

function formatCellValue(value: unknown): string {
	if (value === null || value === undefined) {
		return "—";
	}
	if (typeof value === "object") {
		return JSON.stringify(value);
	}
	return String(value);
}

function JsonPreview({ value }: { value: unknown }) {
	const [expanded, setExpanded] = useState(false);

	if (value === null || value === undefined) {
		return <span className="text-on-surface-variant/40 italic">null</span>;
	}

	if (typeof value !== "object") {
		const str = String(value);
		if (str.length > 80) {
			return (
				<span className="break-all">
					{expanded ? str : `${str.slice(0, 80)}…`}
					<button
						onClick={() => setExpanded(!expanded)}
						className="ml-1 text-primary text-[10px] hover:underline"
					>
						{expanded ? "réduire" : "voir plus"}
					</button>
				</span>
			);
		}
		return <span>{str}</span>;
	}

	const json = JSON.stringify(value, null, 2);
	const preview = JSON.stringify(value).slice(0, 60);

	if (!expanded) {
		return (
			<button
				onClick={() => setExpanded(true)}
				className="text-left font-mono text-[10px] text-on-surface-variant/70 bg-surface-container rounded-lg px-2 py-1 hover:bg-surface-container-high transition-colors max-w-[200px] truncate block"
				title="Cliquer pour développer"
			>
				{preview}
				{preview.length >= 60 ? "…" : ""}
			</button>
		);
	}

	return (
		<div className="relative">
			<pre className="font-mono text-[10px] text-on-surface-variant bg-surface-container rounded-lg px-3 py-2 max-h-48 overflow-auto max-w-xs whitespace-pre-wrap break-all">
				{json}
			</pre>
			<button
				onClick={() => setExpanded(false)}
				className="absolute top-1 right-1 text-[10px] text-primary hover:underline bg-surface-container rounded px-1"
			>
				réduire
			</button>
		</div>
	);
}

export function DatabaseTableClient({
	table,
	rows,
	columns,
	currentSort,
	currentDir,
	pageNum,
	totalPages,
}: DatabaseTableClientProps) {
	const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());

	const visibleColumns = columns.filter((c) => !hiddenCols.has(c));
	const hiddenCount = hiddenCols.size;

	function toggleColumn(col: string) {
		setHiddenCols((prev) => {
			const next = new Set(prev);
			if (next.has(col)) {
				next.delete(col);
			} else {
				next.add(col);
			}
			return next;
		});
	}

	function buildSortHref(col: string) {
		const newDir = col === currentSort && currentDir === "asc" ? "desc" : "asc";
		const params = new URLSearchParams();
		params.set("sort", col);
		params.set("dir", newDir);
		if (pageNum > 1) {
			params.set("page", String(pageNum));
		}
		return `?${params.toString()}`;
	}

	return (
		<>
			{/* Column visibility toggle */}
			{hiddenCount > 0 && (
				<div className="flex items-center gap-2 text-xs text-on-surface-variant">
					<Icon name="visibility_off" size={14} className="opacity-60" />
					<span>
						{hiddenCount} colonne{hiddenCount > 1 ? "s" : ""} masquée{hiddenCount > 1 ? "s" : ""}
					</span>
					<button onClick={() => setHiddenCols(new Set())} className="text-primary hover:underline">
						Tout afficher
					</button>
				</div>
			)}

			<div className="bg-surface-container rounded-3xl border border-outline-variant/20 overflow-hidden">
				<div className="overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow className="hover:bg-transparent">
								<TableHead className="w-[50px] sticky left-0 bg-surface-container z-10">
									Action
								</TableHead>
								{visibleColumns.map((col) => (
									<TableHead key={col} className="whitespace-nowrap group/th">
										<div className="flex items-center gap-1">
											<Link
												href={buildSortHref(col)}
												className="flex items-center gap-1 hover:text-on-surface transition-colors"
											>
												<span className="text-[10px] font-black uppercase tracking-widest">
													{col}
												</span>
												{currentSort === col && (
													<Icon
														name={currentDir === "asc" ? "arrow_upward" : "arrow_downward"}
														size={12}
														className="text-primary"
													/>
												)}
											</Link>
											<button
												onClick={() => toggleColumn(col)}
												className="opacity-0 group-hover/th:opacity-100 transition-opacity p-0.5 hover:bg-surface-container-highest rounded"
												title={`Masquer ${col}`}
											>
												<Icon
													name="visibility_off"
													size={12}
													className="text-on-surface-variant/40"
												/>
											</button>
										</div>
									</TableHead>
								))}
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map(
								(
									row: any // eslint-disable-line @typescript-eslint/no-explicit-any
								) => (
									<TableRow key={row.id}>
										<TableCell className="sticky left-0 bg-surface-container z-10">
											<Button asChild size="icon" variant="ghost" className="size-10">
												<Link href={`/dashboard/database/${table}/${row.id}`}>
													<Icon name="edit" size={16} />
												</Link>
											</Button>
										</TableCell>
										{visibleColumns.map((col) => (
											<TableCell key={col} className="max-w-[250px]">
												{typeof row[col] === "object" && row[col] !== null ? (
													<JsonPreview value={row[col]} />
												) : (
													<span
														className="whitespace-nowrap truncate block max-w-[250px]"
														title={formatCellValue(row[col])}
													>
														{formatCellValue(row[col])}
													</span>
												)}
											</TableCell>
										))}
									</TableRow>
								)
							)}
						</TableBody>
					</Table>
				</div>
			</div>

			{/* Pagination */}
			<div className="flex justify-center gap-2">
				{pageNum > 1 && (
					<Button asChild variant="outline" className="rounded-full">
						<Link
							href={`?page=${pageNum - 1}${currentSort !== "id" ? `&sort=${currentSort}&dir=${currentDir}` : ""}`}
						>
							<Icon name="arrow_back" size={16} className="mr-2" />
							Précédent
						</Link>
					</Button>
				)}
				<span className="flex items-center px-4 font-bold text-sm text-on-surface-variant">
					Page {pageNum} / {totalPages}
				</span>
				{pageNum < totalPages && (
					<Button asChild variant="outline" className="rounded-full">
						<Link
							href={`?page=${pageNum + 1}${currentSort !== "id" ? `&sort=${currentSort}&dir=${currentDir}` : ""}`}
						>
							Suivant
							<Icon name="arrow_forward" size={16} className="ml-2" />
						</Link>
					</Button>
				)}
			</div>
		</>
	);
}
