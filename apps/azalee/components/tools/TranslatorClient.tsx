"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { searchTranslations } from "@/app/actions/translate";
import type { TranslationResult } from "@/app/actions/translate";
import { Icon } from "@/components/ui/Icon";
import { Skeleton } from "@rosegriffon/ui";
import { cn } from "@/lib/utils";

const ENTITY_TYPES = [
	{ label: "Tous", value: undefined },
	{ label: "Personnages", value: "character" },
	{ label: "Techniques", value: "skill" },
	{ label: "Objets", value: "item" },
	{ label: "Tactiques", value: "tactic" },
	{ label: "Équipes", value: "team" },
	{ label: "Esprits G.", value: "keshin" },
	{ label: "Totems", value: "soul" },
] as const;

const LANGS = ["FR", "EN", "JA", "ROMA"] as const;
type Lang = (typeof LANGS)[number];

const LANG_LABELS: Record<Lang, string> = {
	EN: "English",
	FR: "Français",
	JA: "日本語",
	ROMA: "Romaji",
};

const TYPE_COLORS: Record<string, string> = {
	character: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
	item: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
	keshin: "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20",
	skill: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
	soul: "bg-teal-500/10 text-teal-400 border border-teal-500/20",
	tactic: "bg-purple-500/10 text-purple-400 border border-purple-500/20",
	team: "bg-rose-500/10 text-rose-400 border border-rose-500/20",
};

export function TranslatorClient() {
	const [query, setQuery] = useState("");
	const [entityType, setEntityType] = useState<string | undefined>();
	const [results, setResults] = useState<TranslationResult[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const [hasSearched, setHasSearched] = useState(false);
	const [selectedResult, setSelectedResult] = useState<TranslationResult | null>(null);
	const [copiedLang, setCopiedLang] = useState<string | null>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	const doSearch = useCallback(async (q: string, type?: string) => {
		if (q.length < 2) {
			setResults([]);
			setHasSearched(false);
			setSelectedResult(null);
			return;
		}
		setIsSearching(true);
		setHasSearched(true);
		try {
			const data = await searchTranslations(q, type);
			setResults(data);
			setSelectedResult(data.length > 0 ? data[0] : null);
		} catch {
			setResults([]);
			setSelectedResult(null);
		} finally {
			setIsSearching(false);
		}
	}, []);

	useEffect(() => {
		if (query.length < 2) {
			setResults([]);
			setHasSearched(false);
			setSelectedResult(null);
			return;
		}
		const timer = setTimeout(() => doSearch(query, entityType), 300);
		return () => clearTimeout(timer);
	}, [query, entityType, doSearch]);

	const clearQuery = () => {
		setQuery("");
		setResults([]);
		setHasSearched(false);
		setSelectedResult(null);
		inputRef.current?.focus();
	};

	const copyName = async (name: string, lang: string) => {
		try {
			await navigator.clipboard.writeText(name);
			setCopiedLang(lang);
			setTimeout(() => setCopiedLang(null), 1500);
		} catch {
			/* Silent */
		}
	};

	const active = selectedResult;

	// Recherche approximative : tous les résultats remontés sont marqués fuzzy
	// (aucun match exact/préfixe) → on l'indique discrètement à l'utilisateur.
	const isApproximate = results.length > 0 && results.every((r) => r.fuzzy === true);

	return (
		<div className="w-full space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
			{/* Header with gradient subtitle */}
			<div className="relative overflow-hidden rounded-2xl bg-linear-to-r from-surface-container-low to-surface-container p-6 border border-outline/5">
				<div className="relative z-10">
					<h1 className="font-[BradBunR] text-3xl sm:text-4xl md:text-5xl text-on-surface tracking-wide bg-linear-to-r from-primary to-secondary bg-clip-text text-transparent">
						Traducteur Azalée
					</h1>
					<p className="type-body-medium text-on-surface-variant/80 mt-2 max-w-xl">
						Dictionnaire de noms et termes de jeu Inazuma Eleven: Victory Road. Recherchez en{" "}
						<span className="text-primary font-semibold">Français</span>,{" "}
						<span className="text-secondary font-semibold">Anglais</span>,{" "}
						<span className="text-tertiary font-semibold">Japonais (Kanji/Kana)</span> ou{" "}
						<span className="text-on-surface font-semibold">Romaji</span>.
					</p>
				</div>
				<div className="absolute right-0 bottom-0 translate-x-12 translate-y-12 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />
			</div>

			{/* Entity type filter chips */}
			<div className="space-y-2">
				<label className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant/55 block">
					Filtrer par type d&apos;entité
				</label>
				<div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Filtrer par type">
					{ENTITY_TYPES.map((et) => {
						const isActive = entityType === et.value;
						return (
							<button
								key={et.value ?? "all"}
								onClick={() => setEntityType(et.value)}
								aria-pressed={isActive}
								className={cn(
									"inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-xs font-bold transition-all duration-200 cursor-pointer select-none",
									isActive
										? "bg-primary text-on-primary shadow-xs scale-102"
										: "border border-outline/20 bg-surface-container-low hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface"
								)}
							>
								{isActive && <Icon name="check" size={14} />}
								{et.label}
							</button>
						);
					})}
				</div>
			</div>

			{/* Main translator panel */}
			<div className="rounded-2xl overflow-hidden bg-surface-container-lowest border border-outline/10 shadow-lg">
				<div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-outline/10">
					{/* LEFT: Input panel */}
					<div className="relative flex flex-col min-h-[220px] sm:min-h-[280px] bg-surface-container-low/40">
						{/* Language header */}
						<div className="flex items-center justify-between h-14 px-5 border-b border-outline/5 bg-surface-container/20">
							<div className="flex items-center gap-2">
								<span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
								<span className="type-label-large font-bold text-on-surface/80">
									Recherche multilingue
								</span>
							</div>
							{query && (
								<button
									onClick={clearQuery}
									aria-label="Effacer la recherche"
									className="p-1.5 rounded-full hover:bg-surface-container-high text-on-surface-variant/60 hover:text-on-surface transition-colors cursor-pointer"
								>
									<Icon name="close" size={16} />
								</button>
							)}
						</div>

						{/* Textarea */}
						<div className="flex-1 relative">
							<textarea
								ref={inputRef}
								value={query}
								onChange={(e) => setQuery(e.target.value.replaceAll("\n", ""))}
								placeholder="Saisissez un nom (ex: Mark Evans, Fire Tornado, 円堂守, endou...)"
								aria-label="Rechercher un nom"
								rows={4}
								className="w-full h-full min-h-[140px] sm:min-h-[200px] p-5 bg-transparent text-on-surface text-lg sm:text-xl placeholder:text-on-surface-variant/40 focus:outline-hidden resize-none leading-relaxed transition-all"
							/>
						</div>

						{/* Footer */}
						<div className="px-5 py-3 border-t border-outline/5 bg-surface-container/10 text-xs text-on-surface-variant/50 flex items-center gap-2">
							<Icon name="info" size={14} className="text-primary/70" />
							<span>Optimisé pour la conversion Romaji ⇄ Kana et le glossaire officiel</span>
						</div>
					</div>

					{/* RIGHT: Translation output */}
					<div className="bg-surface-container-low/20 flex flex-col min-h-[220px] sm:min-h-[280px]">
						{/* Header */}
						<div className="flex items-center h-14 px-5 border-b border-outline/5 bg-surface-container/20">
							<span className="type-label-large font-bold text-on-surface/80">
								Fiche de Traduction
							</span>
						</div>

						{/* Translation content */}
						<div className="flex-1 p-5 flex flex-col justify-center">
							{/* Initial state */}
							{!hasSearched && !isSearching && (
								<div className="flex flex-col items-center justify-center gap-4 py-8 text-center animate-in fade-in duration-300">
									<div className="p-4 rounded-full bg-surface-container-high border border-outline/10 text-primary/40">
										<Icon name="translate" size={32} />
									</div>
									<div>
										<p className="type-title-small text-on-surface-variant">
											En attente de saisie...
										</p>
										<p className="text-xs text-on-surface-variant/65 mt-1 max-w-[280px]">
											Saisissez au moins 2 caractères dans le champ de gauche pour lancer la
											recherche.
										</p>
									</div>
								</div>
							)}

							{/* Loading */}
							{isSearching && (
								<div className="space-y-4 py-2">
									<div className="flex items-center justify-between">
										<Skeleton className="h-6 w-24 rounded-full" />
										<Skeleton className="h-4 w-16" />
									</div>
									<div className="space-y-3">
										{LANGS.map((lang) => (
											<div key={lang} className="flex items-center gap-4">
												<Skeleton className="h-6 w-9 rounded-md" />
												<Skeleton className="h-7 w-3/4 rounded-sm" />
											</div>
										))}
									</div>
								</div>
							)}

							{/* No results */}
							{hasSearched && !isSearching && !active && (
								<div className="flex flex-col items-center justify-center gap-3 py-8 text-center animate-in fade-in duration-300">
									<div className="p-3.5 rounded-full bg-error/10 border border-error/20 text-error">
										<Icon name="search_off" size={24} />
									</div>
									<div className="max-w-[300px]">
										<p className="type-title-small text-on-surface">Aucun résultat trouvé</p>
										<p className="text-xs text-on-surface-variant/60 mt-1">
											Rien pour « <span className="font-semibold text-primary">{query}</span> ». La
											recherche tolère les fautes et accents : vérifiez l&apos;orthographe, essayez
											une autre langue (EN/JA) ou retirez le filtre de type.
										</p>
										{entityType && (
											<button
												onClick={() => setEntityType(undefined)}
												className="mt-3 inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-bold bg-surface-container-high hover:bg-primary-container/40 text-on-surface-variant hover:text-on-surface border border-outline/15 transition-colors cursor-pointer"
											>
												<Icon name="filter_list" size={14} />
												Chercher dans tous les types
											</button>
										)}
									</div>
								</div>
							)}

							{/* Active translation */}
							{active && !isSearching && (
								<div className="space-y-4 animate-in fade-in slide-in-from-right-3 duration-300">
									{/* Type badge + link */}
									<div className="flex items-center justify-between border-b border-outline/5 pb-3">
										<span
											className={cn(
												"px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
												TYPE_COLORS[active.type] ||
													"bg-surface-container-highest text-on-surface-variant"
											)}
										>
											{active.typeLabel}
										</span>
										{active.url !== "#" && (
											<Link
												href={active.url}
												className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary-hover group/link transition-colors"
											>
												Voir la fiche complète
												<Icon
													name="chevron_right"
													size={14}
													className="group-hover/link:translate-x-0.5 transition-transform"
												/>
											</Link>
										)}
									</div>

									{/* Names list */}
									<div className="space-y-2.5">
										{LANGS.map((lang) => {
											const name =
												lang === "FR"
													? active.name_fr
													: lang === "EN"
														? active.name_en
														: lang === "JA"
															? active.name_ja
															: active.name_roma;
											return (
												<div
													key={lang}
													className="group/row flex items-center justify-between rounded-xl p-2.5 hover:bg-surface-container/60 border border-transparent hover:border-outline/5 transition-all duration-200"
												>
													<div className="flex items-center gap-3.5 min-w-0">
														<span
															className={cn(
																"shrink-0 w-9 h-6 flex items-center justify-center rounded text-xs sm:text-[9px] font-extrabold select-none",
																lang === "FR"
																	? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
																	: lang === "EN"
																		? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
																		: lang === "JA"
																			? "bg-red-500/10 text-red-400 border border-red-500/20"
																			: "bg-purple-500/10 text-purple-400 border border-purple-500/20"
															)}
														>
															{lang}
														</span>
														<div className="min-w-0">
															{name ? (
																<span
																	className={cn(
																		"text-on-surface block truncate select-all",
																		lang === "JA"
																			? "text-lg font-bold"
																			: lang === "ROMA"
																				? "text-sm italic text-on-surface-variant"
																				: "text-base font-semibold"
																	)}
																>
																	{name}
																</span>
															) : (
																<span className="text-on-surface-variant/30 text-sm italic">
																	non renseigné
																</span>
															)}
														</div>
													</div>
													{name && (
														<button
															onClick={() => copyName(name, lang)}
															aria-label={`Copier le nom ${LANG_LABELS[lang]}`}
															className="shrink-0 inline-flex items-center justify-center min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 p-2 rounded-full cursor-pointer opacity-100 sm:opacity-0 sm:group-hover/row:opacity-100 focus/row:opacity-100 hover:bg-surface-container-high text-on-surface-variant/60 hover:text-primary transition-all duration-200"
														>
															{copiedLang === lang ? (
																<Icon
																	name="check"
																	size={14}
																	className="text-emerald-400 animate-bounce"
																/>
															) : (
																<Icon name="content_copy" size={14} />
															)}
														</button>
													)}
												</div>
											);
										})}
									</div>
								</div>
							)}
						</div>
					</div>
				</div>
			</div>

			{/* Results list section */}
			{hasSearched && !isSearching && results.length > 0 && (
				<div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
					<div className="flex items-center justify-between gap-3 px-1">
						<h2 className="type-title-small font-bold text-on-surface-variant/80 flex items-center gap-2 min-w-0">
							<span className="truncate">Résultats de recherche ({results.length})</span>
							{isApproximate && (
								<span
									title="Aucune correspondance exacte — résultats les plus proches affichés"
									className="shrink-0 inline-flex items-center gap-1 h-5 px-2 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20"
								>
									<Icon name="auto_fix_high" size={11} />
									Résultats approchants
								</span>
							)}
						</h2>
						<span className="hidden sm:inline text-[10px] text-on-surface-variant/50 shrink-0">
							Sélectionnez pour afficher les détails
						</span>
					</div>
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
						{results.map((result) => {
							const isActive = active?.id === result.id && active?.type === result.type;
							return (
								<button
									key={`${result.type}-${result.id}`}
									onClick={() => setSelectedResult(result)}
									className={cn(
										"relative flex items-center justify-between rounded-2xl p-3.5 text-left border cursor-pointer select-none transition-all duration-200 hover:translate-y-[-1px] group/item",
										isActive
											? "bg-primary-container/30 border-primary/45 shadow-md shadow-primary/5"
											: "bg-surface-container-low border-outline/10 hover:border-outline/35 hover:bg-surface-container-high"
									)}
								>
									<div className="flex items-center gap-3 min-w-0">
										<span
											className={cn(
												"shrink-0 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider select-none",
												TYPE_COLORS[result.type] ||
													"bg-surface-container-highest text-on-surface-variant"
											)}
										>
											{result.typeLabel}
										</span>
										<div className="min-w-0">
											<span className="block font-bold text-on-surface text-sm truncate">
												{result.name_fr || result.name_en || result.name_ja || "—"}
											</span>
											{result.name_en && result.name_en !== result.name_fr && (
												<span className="block text-xs text-on-surface-variant/50 truncate">
													{result.name_en}
												</span>
											)}
										</div>
									</div>
									{result.url !== "#" && (
										<Link
											href={result.url}
											onClick={(e) => e.stopPropagation()}
											className="shrink-0 p-1.5 rounded-full hover:bg-surface-container-high/80 text-on-surface-variant/30 hover:text-primary group-hover/item:text-primary/70 transition-colors"
											aria-label={`Voir la fiche de ${result.name_fr || result.name_en}`}
										>
											<Icon name="chevron_right" size={16} />
										</Link>
									)}
								</button>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
