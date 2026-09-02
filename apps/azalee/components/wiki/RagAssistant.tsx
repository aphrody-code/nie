"use client";

import { useState, useEffect, useCallback } from "react";
import { searchRagOnly } from "@/app/actions/search";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

interface RagDocument {
	id: string;
	title: string;
	date: string;
	url: string;
	type: string;
	text: string;
	score: number;
}

interface RagAssistantProps {
	initialQuery?: string;
	suggestions?: string[];
	className?: string;
}

export function RagAssistant({
	initialQuery = "",
	suggestions = [],
	className,
}: RagAssistantProps) {
	const [query, setQuery] = useState(initialQuery);
	const [results, setResults] = useState<RagDocument[]>([]);
	const [loading, setLoading] = useState(false);
	const [expandedDoc, setExpandedDoc] = useState<string | null>(null);

	const handleSearch = useCallback(async (searchQuery: string) => {
		if (!searchQuery.trim() || searchQuery.length < 2) return;
		setLoading(true);
		try {
			const res = await searchRagOnly(searchQuery);
			setResults(res);
		} catch (e) {
			console.error("RAG assistant search failed:", e);
		} finally {
			setLoading(false);
		}
	}, []);

	// Auto-run initial query
	useEffect(() => {
		if (initialQuery) {
			setQuery(initialQuery);
			handleSearch(initialQuery);
		}
	}, [initialQuery, handleSearch]);

	const getTypeStyles = (type: string) => {
		switch (type) {
			case "tweet":
				return {
					icon: "forum",
					bg: "bg-sky-500/10 text-sky-400 border-sky-500/25",
					label: "Tweet X",
				};
			case "patchnote":
				return {
					icon: "update",
					bg: "bg-purple-500/10 text-purple-400 border-purple-500/25",
					label: "Patch Note",
				};
			case "re":
			case "cross":
			case "level5":
			case "topic":
				return {
					icon: "feed",
					bg: "bg-amber-500/10 text-amber-400 border-amber-500/25",
					label: "Info Officielle",
				};
			case "character":
			case "basara":
				return {
					icon: "person",
					bg: "bg-blue-500/10 text-blue-400 border-blue-500/25",
					label: "Personnage",
				};
			case "skill":
				return {
					icon: "sports_soccer",
					bg: "bg-amber-500/10 text-amber-400 border-amber-500/25",
					label: "Technique",
				};
			case "item":
				return {
					icon: "inventory_2",
					bg: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
					label: "Objet",
				};
			case "tactic":
				return {
					icon: "schema",
					bg: "bg-purple-500/10 text-purple-400 border-purple-500/25",
					label: "Tactique",
				};
			case "team":
				return {
					icon: "groups",
					bg: "bg-rose-500/10 text-rose-400 border-rose-500/25",
					label: "Équipe",
				};
			case "keshin":
			case "soul":
			case "miximax":
			case "awakening":
			case "modechange":
			case "aura":
				return {
					icon: "auto_awesome",
					bg: "bg-cyan-500/10 text-cyan-400 border-cyan-500/25",
					label: "Aura",
				};
			default:
				return {
					icon: "newspaper",
					bg: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
					label: "Actualité",
				};
		}
	};

	return (
		<div
			className={cn(
				"relative w-full rounded-2xl border border-outline-variant/30 bg-surface-container/60 backdrop-blur-md p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-hidden shadow-lg",
				className
			)}
		>
			{/* Decorative background glow */}
			<div className="absolute top-0 right-0 -mr-16 -mt-16 w-32 h-32 bg-primary/10 rounded-full blur-2xl pointer-events-none" />
			<div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-32 h-32 bg-secondary/10 rounded-full blur-2xl pointer-events-none" />

			{/* Header */}
			<div className="flex items-center gap-3 border-b border-outline-variant/20 pb-3">
				<div className="p-2 rounded-xl bg-primary-container text-on-primary-container">
					<Icon name="wand" size={22} />
				</div>
				<div>
					<h3 className="font-[BradBunR] text-base sm:text-lg text-on-surface tracking-wide">
						Assistant Tactique
					</h3>
					<p className="text-[10px] sm:text-xs text-on-surface-variant">
						Recherchez en direct dans la base de connaissances (actus, patch notes, tweets)
					</p>
				</div>
			</div>

			{/* Form */}
			<form
				onSubmit={(e) => {
					e.preventDefault();
					handleSearch(query);
				}}
				className="flex gap-2"
			>
				<div className="relative flex-1">
					<input
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Ex: Effets du style de jeu Percée, stats d'Axel Blaze..."
						className="w-full h-11 px-3 pl-10 rounded-xl bg-surface-container-high border border-outline-variant/30 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-hidden focus:ring-2 focus:ring-primary/50 transition-all"
					/>
					<Icon
						name="search"
						size={18}
						className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/70"
					/>
					{query && (
						<button
							type="button"
							onClick={() => setQuery("")}
							className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
						>
							<Icon name="close" size={16} />
						</button>
					)}
				</div>
				<button
					type="submit"
					disabled={loading || query.trim().length < 2}
					className="h-11 px-4 rounded-xl bg-primary text-on-primary font-bold text-sm shadow-md hover:shadow-lg active:scale-95 transition-all disabled:opacity-50"
				>
					Rechercher
				</button>
			</form>

			{/* Suggestions */}
			{suggestions.length > 0 && (
				<div className="space-y-1.5">
					<span className="text-[10px] sm:text-xs font-bold text-on-surface-variant/80">
						Suggestions de recherche :
					</span>
					<div className="flex flex-wrap gap-1.5">
						{suggestions.map((s, idx) => (
							<button
								key={`${s}-${idx}`}
								type="button"
								onClick={() => {
									setQuery(s);
									handleSearch(s);
								}}
								className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-outline-variant/30 bg-surface-container-high hover:bg-on-surface/[0.05] text-[10px] sm:text-xs text-on-surface-variant transition-all"
							>
								<Icon name="search" size={12} className="opacity-75" />
								{s}
							</button>
						))}
					</div>
				</div>
			)}

			{/* Loader */}
			{loading && (
				<div className="flex flex-col items-center justify-center py-8 space-y-2">
					<Icon name="change_circle" size={32} className="text-primary animate-spin" />
					<span className="text-xs text-on-surface-variant animate-pulse">
						Interrogation de la base de connaissances...
					</span>
				</div>
			)}

			{/* Results */}
			{!loading && results.length > 0 && (
				<div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
					<p className="text-[10px] sm:text-xs font-bold text-on-surface-variant/75 uppercase tracking-wider">
						{results.length} résultats trouvés
					</p>
					<div className="space-y-3">
						{results.map((doc) => {
							const typeInfo = getTypeStyles(doc.type);
							const isExpanded = expandedDoc === doc.id;
							const scorePercent = Math.min(100, Math.round((doc.score || 0) * 100));

							return (
								<div
									key={doc.id}
									className="p-3.5 rounded-xl border border-outline-variant/20 bg-surface-container-high/40 hover:bg-surface-container-high/60 transition-all space-y-2.5 relative group"
								>
									{/* Top Meta */}
									<div className="flex flex-wrap items-center justify-between gap-2">
										<div className="flex items-center gap-2">
											<span
												className={cn(
													"inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[9px] font-black uppercase tracking-wider",
													typeInfo.bg
												)}
											>
												<Icon name={typeInfo.icon} size={10} />
												{typeInfo.label}
											</span>
											{doc.date && (
												<span className="text-[9px] sm:text-[10px] text-on-surface-variant/60">
													{doc.date}
												</span>
											)}
										</div>

										{/* Match Score */}
										<span
											className={cn(
												"inline-flex items-center gap-0.5 text-[10px] font-bold",
												scorePercent >= 80
													? "text-green-400"
													: scorePercent >= 60
														? "text-yellow-400"
														: "text-neutral-400"
											)}
											title={`Score de similarité sémantique: ${doc.score}`}
										>
											<Icon name="check_circle" size={12} />
											{scorePercent}% match
										</span>
									</div>

									{/* Title */}
									<h4 className="text-xs sm:text-sm font-bold text-on-surface leading-snug">
										{doc.title}
									</h4>

									{/* Text excerpt or full content */}
									<div className="text-[11px] sm:text-xs text-on-surface-variant/90 leading-relaxed whitespace-pre-line">
										{isExpanded ? doc.text : `${doc.text.substring(0, 180)}...`}
									</div>

									{/* Actions */}
									<div className="flex items-center justify-between gap-2 pt-1">
										<button
											type="button"
											onClick={() => setExpandedDoc(isExpanded ? null : doc.id)}
											className="inline-flex items-center gap-1 text-[10px] sm:text-xs font-bold text-primary hover:text-primary/80 transition-colors"
										>
											<span>{isExpanded ? "Voir moins" : "Lire la suite"}</span>
											<Icon name={isExpanded ? "expand_less" : "expand_more"} size={14} />
										</button>

										{doc.url && doc.url !== "#" && (
											<a
												href={doc.url}
												target="_blank"
												rel="noopener noreferrer"
												className="inline-flex items-center gap-1 text-[10px] sm:text-xs text-on-surface-variant hover:text-primary transition-colors"
											>
												<span>Source</span>
												<Icon name="open_in_new" size={12} />
											</a>
										)}
									</div>
								</div>
							);
						})}
					</div>
				</div>
			)}

			{!loading && results.length === 0 && query.trim().length >= 2 && (
				<div className="flex flex-col items-center justify-center py-8 text-center space-y-1">
					<Icon name="search_off" size={24} className="text-on-surface-variant/40" />
					<span className="text-xs font-medium text-on-surface-variant/80">
						Aucun document trouvé pour cette question.
					</span>
					<span className="text-[10px] text-on-surface-variant/50 max-w-xs">
						Essayez avec des mots-clés plus généraux ou sélectionnez une suggestion.
					</span>
				</div>
			)}
		</div>
	);
}
