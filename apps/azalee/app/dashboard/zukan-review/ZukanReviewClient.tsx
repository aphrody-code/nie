"use client";

import Image from "next/image";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { updateZukanHash } from "@/app/actions/zukan-admin";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Issue {
	code: string;
	hash: string;
	severity: string;
	category: string;
	problems: string[];
	imageUrl: string;
	dbNameEn?: string;
	dbNameFr?: string;
	dbNameJa?: string;
	dbPosition?: string;
	dbElement?: string;
	dbGender?: string;
	dbSeries?: string;
	dbRarity?: string;
	dbStats?: number[];
	zukanNameEn?: string;
	zukanNameJa?: string;
	zukanPosition?: string;
	zukanElement?: string;
	zukanGender?: string;
	zukanGame?: string;
	zukanStats?: number[];
	statsCorrelation?: number | null;
	characters?: Array<{
		code: string;
		name: string;
		nameJa: string;
		pos: string;
		elem: string;
		series: string;
		rarity: string;
	}>;
}

export interface ZukanCandidate {
	name: string;
	nickname: string;
	zukanHash: string;
	position: string;
	element: string;
	stats: {
		kick: number;
		control: number;
		technique: number;
		pressure: number;
		physical: number;
		agility: number;
		intelligence: number;
	};
	game: string;
	gender: string;
}

export interface MissingCharacter {
	id: string;
	name_en: string | null;
	name_fr: string | null;
	name_ja: string | null;
	series: string | null;
	rarity_label: string | null;
	element: string | null;
	position: string | null;
	internal_code: string | null;
}

interface Props {
	issues: Issue[];
	bySeverity: Record<string, number>;
	zukanCatalog: ZukanCandidate[];
	missingCharacters?: MissingCharacter[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
	critical: { bg: "bg-red-500/20", color: "text-red-400", label: "Critique" },
	high: { bg: "bg-orange-500/20", color: "text-orange-400", label: "Élevé" },
	low: { bg: "bg-blue-500/20", color: "text-blue-400", label: "Faible" },
	medium: { bg: "bg-yellow-500/20", color: "text-yellow-400", label: "Moyen" },
};

const STAT_LABELS = ["Tir", "Ctrl", "Tech", "Pres", "Phys", "Agi", "Intel"];

const ELEMENT_ICONS: Record<string, string> = {
	Fire: "local_fire_department",
	Forest: "forest",
	Mountain: "landscape",
	Wind: "air",
};

const CLOUDFRONT_BASE = "https://dxi4wb638ujep.cloudfront.net/1/";

const GAMES = [
	"Inazuma Eleven",
	"Inazuma Eleven 2",
	"Inazuma Eleven 3",
	"Inazuma Eleven GO",
	"Inazuma Eleven GO 2: Chrono Stone",
	"Inazuma Eleven GO 3: Galaxy",
	"Inazuma Eleven Ares",
	"Inazuma Eleven Orion",
	"Inazuma Eleven: Victory Road",
];

// ─── Main Component ─────────────────────────────────────────────────────────

export function ZukanReviewClient({ issues, bySeverity, zukanCatalog, missingCharacters }: Props) {
	const [filter, setFilter] = useState<string>("all");
	const [dismissed, setDismissed] = useState<Set<string>>(new Set());
	const [resolvedIssues, setResolvedIssues] = useState<Set<string>>(new Set());

	const filtered = issues.filter((i) => {
		if (dismissed.has(i.code + i.hash)) {
			return false;
		}
		if (resolvedIssues.has(i.code)) {
			return false;
		}
		if (filter === "all") {
			return true;
		}
		return i.severity === filter;
	});

	const dismiss = (issue: Issue) => {
		setDismissed((prev) => new Set(prev).add(issue.code + issue.hash));
	};

	const markResolved = (code: string) => {
		setResolvedIssues((prev) => new Set(prev).add(code));
	};

	return (
		<div className="space-y-6">
			{/* Severity tabs */}
			<div className="flex flex-wrap gap-2">
				<button
					onClick={() => setFilter("all")}
					className={cn(
						"px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
						filter === "all"
							? "bg-primary text-on-primary"
							: "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
					)}
				>
					Tous ({issues.length - dismissed.size - resolvedIssues.size})
				</button>
				{Object.entries(SEVERITY_CONFIG).map(([key, cfg]) => {
					const count = bySeverity[key] || 0;
					if (count === 0) {
						return null;
					}
					return (
						<button
							key={key}
							onClick={() => setFilter(key)}
							className={cn(
								"px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
								filter === key
									? `${cfg.bg} ${cfg.color}`
									: "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
							)}
						>
							{cfg.label} ({count})
						</button>
					);
				})}
			</div>

			{/* Legend */}
			<div className="flex flex-wrap gap-4 text-xs text-on-surface-variant px-1">
				<span className="flex items-center gap-1">
					<span className="size-2 rounded-full bg-orange-500" /> Stats inversées = probable mauvais
					variant
				</span>
				<span className="flex items-center gap-1">
					<span className="size-2 rounded-full bg-yellow-500" /> Ère différente = image d&apos;une
					autre série
				</span>
				<span className="flex items-center gap-1">
					<span className="size-2 rounded-full bg-yellow-500" /> Hash dupliqué = personnages
					différents, même image
				</span>
			</div>

			{/* Issues list */}
			<div className="space-y-4">
				{filtered.map((issue, idx) => (
					<IssueCard
						key={`${issue.code}-${issue.hash}-${idx}`}
						issue={issue}
						onDismiss={dismiss}
						onResolved={markResolved}
						zukanCatalog={zukanCatalog}
					/>
				))}
			</div>

			{filtered.length === 0 && (
				<div className="py-16 text-center text-on-surface-variant">
					<Icon name="check_circle" size={48} className="mx-auto mb-3 text-primary/50" />
					<p className="text-lg font-medium">Aucun problème restant</p>
					<p className="text-sm mt-1">
						{dismissed.size + resolvedIssues.size > 0
							? `${dismissed.size + resolvedIssues.size} problème(s) vérifiés / résolus.`
							: "Tout est conforme."}
					</p>
				</div>
			)}

			{/* Missing characters with assign button */}
			{missingCharacters && missingCharacters.length > 0 && (
				<MissingCharactersTable characters={missingCharacters} zukanCatalog={zukanCatalog} />
			)}
		</div>
	);
}

// ─── Issue Card ──────────────────────────────────────────────────────────────

function IssueCard({
	issue,
	onDismiss,
	onResolved,
	zukanCatalog,
}: {
	issue: Issue;
	onDismiss: (i: Issue) => void;
	onResolved: (code: string) => void;
	zukanCatalog: ZukanCandidate[];
}) {
	const [expanded, setExpanded] = useState(false);
	const [showCandidates, setShowCandidates] = useState(false);
	const [isPending, startTransition] = useTransition();
	const cfg = SEVERITY_CONFIG[issue.severity] || SEVERITY_CONFIG.low;
	const isDuplicate = issue.category === "duplicate_hash";

	const handleRemoveImage = () => {
		startTransition(async () => {
			const result = await updateZukanHash(issue.code, null);
			if (result.success) {
				toast.success("Image retirée");
				onResolved(issue.code);
			} else {
				toast.error(result.error || "Erreur");
			}
		});
	};

	const handleChooseCandidate = (hash: string) => {
		startTransition(async () => {
			const result = await updateZukanHash(issue.code, hash);
			if (result.success) {
				toast.success("Image mise à jour");
				onResolved(issue.code);
			} else {
				toast.error(result.error || "Erreur");
			}
		});
	};

	return (
		<div
			className={cn(
				"rounded-2xl border border-outline-variant bg-surface-container-low overflow-hidden",
				isPending && "opacity-50 pointer-events-none"
			)}
		>
			{/* Header */}
			<div className="flex items-start gap-3 p-4">
				<div className="shrink-0 size-16 sm:size-20 rounded-xl overflow-hidden bg-surface-container-high relative">
					<Image
						src={issue.imageUrl}
						alt={issue.dbNameEn || issue.dbNameFr || ""}
						fill
						className="object-cover"
						unoptimized
					/>
				</div>

				<div className="flex-1 min-w-0 space-y-1">
					<div className="flex items-center gap-2 flex-wrap">
						<span
							className={cn(
								"px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
								cfg.bg,
								cfg.color
							)}
						>
							{cfg.label}
						</span>
						<span className="text-xs text-on-surface-variant font-mono">{issue.code}</span>
						{issue.dbRarity && issue.dbRarity !== "Normal" && (
							<span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-tertiary-container text-on-tertiary-container">
								{issue.dbRarity}
							</span>
						)}
					</div>

					<div className="flex items-baseline gap-2">
						<span className="font-medium text-on-surface truncate">
							{issue.dbNameFr || issue.dbNameEn || issue.dbNameJa}
						</span>
						{issue.dbNameJa && (
							<span className="text-xs text-on-surface-variant">{issue.dbNameJa}</span>
						)}
					</div>

					<div className="space-y-0.5">
						{issue.problems.map((p, i) => (
							<p key={i} className="text-xs text-on-surface-variant leading-snug">
								{p}
							</p>
						))}
					</div>
				</div>

				{/* Actions */}
				<div className="flex flex-col gap-1 shrink-0">
					<button
						onClick={() => setExpanded(!expanded)}
						className="p-2 rounded-full hover:bg-surface-container-highest transition-colors"
						title="Détails"
					>
						<Icon name={expanded ? "expand_less" : "expand_more"} size={20} />
					</button>
					<button
						onClick={() => setShowCandidates(!showCandidates)}
						className={cn(
							"p-2 rounded-full transition-colors",
							showCandidates
								? "bg-primary-container text-primary"
								: "hover:bg-surface-container-highest text-on-surface-variant hover:text-primary"
						)}
						title="Chercher alternatives"
					>
						<Icon name="image_search" size={20} />
					</button>
					<button
						onClick={handleRemoveImage}
						className="p-2 rounded-full hover:bg-error-container transition-colors text-on-surface-variant hover:text-error"
						title="Retirer l'image"
					>
						<Icon name="image_not_supported" size={20} />
					</button>
					<button
						onClick={() => onDismiss(issue)}
						className="p-2 rounded-full hover:bg-primary-container transition-colors text-on-surface-variant hover:text-primary"
						title="Marquer comme vérifié"
					>
						<Icon name="check" size={20} />
					</button>
				</div>
			</div>

			{/* Expanded details */}
			{expanded && (
				<div className="border-t border-outline-variant px-4 py-3 bg-surface-container space-y-3">
					{isDuplicate && issue.characters ? (
						<div>
							<h4 className="text-xs font-bold text-on-surface-variant uppercase mb-2">
								Personnages partageant cette image
							</h4>
							<div className="grid gap-1.5">
								{issue.characters.map((c, i) => (
									<div key={i} className="flex items-center gap-2 text-xs">
										<span className="font-mono text-on-surface-variant">{c.code}</span>
										<span className="font-medium text-on-surface">{c.name}</span>
										<span className="text-on-surface-variant">{c.nameJa}</span>
										<div className="flex gap-1 ml-auto">
											<span className="px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant">
												{c.pos}
											</span>
											<span className="px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant">
												{c.elem}
											</span>
											<span className="px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant">
												{c.series}
											</span>
										</div>
									</div>
								))}
							</div>
						</div>
					) : (
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
							{/* DB side */}
							<div>
								<h4 className="text-xs font-bold text-on-surface-variant uppercase mb-2">
									Base de données
								</h4>
								<div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
									<span className="text-on-surface-variant">Nom EN</span>
									<span className="font-medium">{issue.dbNameEn || "—"}</span>
									<span className="text-on-surface-variant">Nom FR</span>
									<span className="font-medium">{issue.dbNameFr || "—"}</span>
									<span className="text-on-surface-variant">Nom JA</span>
									<span className="font-medium">{issue.dbNameJa || "—"}</span>
									<span className="text-on-surface-variant">Position</span>
									<span>{issue.dbPosition || "—"}</span>
									<span className="text-on-surface-variant">Élément</span>
									<span className="flex items-center gap-1">
										{issue.dbElement && ELEMENT_ICONS[issue.dbElement] && (
											<Icon name={ELEMENT_ICONS[issue.dbElement]} size={14} />
										)}
										{issue.dbElement || "—"}
									</span>
									<span className="text-on-surface-variant">Série</span>
									<span>{issue.dbSeries || "—"}</span>
									{issue.dbStats && (
										<>
											<span className="text-on-surface-variant">Stats</span>
											<span className="font-mono text-[10px]">
												{STAT_LABELS.map((l, i) => `${l}:${issue.dbStats![i]}`).join(" ")}
											</span>
										</>
									)}
								</div>
							</div>

							{/* Zukan side */}
							<div>
								<h4 className="text-xs font-bold text-on-surface-variant uppercase mb-2">
									Zukan (image source)
								</h4>
								<div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
									<span className="text-on-surface-variant">Nom EN</span>
									<span className="font-medium">{issue.zukanNameEn || "—"}</span>
									<span className="text-on-surface-variant">Nom JA</span>
									<span className="font-medium">{issue.zukanNameJa || "—"}</span>
									<span className="text-on-surface-variant">Position</span>
									<span>{issue.zukanPosition || "—"}</span>
									<span className="text-on-surface-variant">Élément</span>
									<span className="flex items-center gap-1">
										{issue.zukanElement && ELEMENT_ICONS[issue.zukanElement] && (
											<Icon name={ELEMENT_ICONS[issue.zukanElement]} size={14} />
										)}
										{issue.zukanElement || "—"}
									</span>
									<span className="text-on-surface-variant">Jeu</span>
									<span>{issue.zukanGame || "—"}</span>
									{issue.zukanStats && (
										<>
											<span className="text-on-surface-variant">Stats</span>
											<span className="font-mono text-[10px]">
												{STAT_LABELS.map((l, i) => `${l}:${issue.zukanStats![i]}`).join(" ")}
											</span>
										</>
									)}
									{issue.statsCorrelation != null && (
										<>
											<span className="text-on-surface-variant">Corrélation</span>
											<span
												className={cn(
													"font-mono",
													issue.statsCorrelation < 0
														? "text-red-400"
														: issue.statsCorrelation < 0.5
															? "text-yellow-400"
															: "text-green-400"
												)}
											>
												{issue.statsCorrelation.toFixed(2)}
											</span>
										</>
									)}
								</div>
							</div>
						</div>
					)}

					<div className="pt-2 flex items-center gap-2 text-[10px] text-on-surface-variant font-mono">
						<span>hash: {issue.hash}</span>
					</div>
				</div>
			)}

			{/* Candidate panel */}
			{showCandidates && (
				<CandidatePanel
					catalog={zukanCatalog}
					initialSearch={issue.dbNameEn || ""}
					currentHash={issue.hash}
					dbPosition={issue.dbPosition}
					dbElement={issue.dbElement}
					onChoose={handleChooseCandidate}
				/>
			)}
		</div>
	);
}

// ─── Candidate Panel ─────────────────────────────────────────────────────────

function CandidatePanel({
	catalog,
	initialSearch,
	currentHash,
	dbPosition,
	dbElement,
	onChoose,
}: {
	catalog: ZukanCandidate[];
	initialSearch: string;
	currentHash: string;
	dbPosition?: string;
	dbElement?: string;
	onChoose: (hash: string) => void;
}) {
	const [search, setSearch] = useState(initialSearch);
	const [posFilter, setPosFilter] = useState("");
	const [elemFilter, setElemFilter] = useState("");
	const [gameFilter, setGameFilter] = useState("");

	const results = useMemo(() => {
		if (!search.trim() && !posFilter && !elemFilter && !gameFilter) {
			return [];
		}
		const q = search.toLowerCase().trim();
		return catalog
			.filter((c) => {
				if (q && !c.name.toLowerCase().includes(q) && !c.nickname.toLowerCase().includes(q)) {
					return false;
				}
				if (posFilter && c.position !== posFilter) {
					return false;
				}
				if (elemFilter && c.element !== elemFilter) {
					return false;
				}
				if (gameFilter && c.game !== gameFilter) {
					return false;
				}
				return true;
			})
			.slice(0, 50);
	}, [catalog, search, posFilter, elemFilter, gameFilter]);

	return (
		<div className="border-t border-outline-variant px-4 py-4 bg-surface-container-lowest space-y-4">
			<h4 className="text-xs font-bold text-on-surface-variant uppercase">
				Chercher dans le catalogue Zukan ({catalog.length} entrées)
			</h4>

			{/* Search + filters */}
			<div className="flex flex-wrap gap-2">
				<input
					type="text"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					placeholder="Rechercher par nom..."
					className="flex-1 min-w-[200px] px-3 py-1.5 rounded-xl bg-surface-container-high border border-outline-variant/30 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-hidden focus:border-primary"
				/>
				<select
					value={posFilter}
					onChange={(e) => setPosFilter(e.target.value)}
					className="px-2 py-1.5 rounded-xl bg-surface-container-high border border-outline-variant/30 text-xs text-on-surface"
				>
					<option value="">Position</option>
					<option value="GK">GK</option>
					<option value="DF">DF</option>
					<option value="MF">MF</option>
					<option value="FW">FW</option>
				</select>
				<select
					value={elemFilter}
					onChange={(e) => setElemFilter(e.target.value)}
					className="px-2 py-1.5 rounded-xl bg-surface-container-high border border-outline-variant/30 text-xs text-on-surface"
				>
					<option value="">Élément</option>
					<option value="Fire">Feu</option>
					<option value="Wind">Vent</option>
					<option value="Forest">Forêt</option>
					<option value="Mountain">Montagne</option>
				</select>
				<select
					value={gameFilter}
					onChange={(e) => setGameFilter(e.target.value)}
					className="px-2 py-1.5 rounded-xl bg-surface-container-high border border-outline-variant/30 text-xs text-on-surface"
				>
					<option value="">Jeu</option>
					{GAMES.map((g) => (
						<option key={g} value={g}>
							{g}
						</option>
					))}
				</select>
			</div>

			{/* Results grid */}
			{results.length > 0 ? (
				<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
					{results.map((c, i) => {
						const isCurrent = c.zukanHash === currentHash;
						const posMatch = dbPosition && c.position === dbPosition;
						const elemMatch = dbElement && c.element === dbElement;

						return (
							<button
								key={`${c.zukanHash}-${i}`}
								onClick={() => !isCurrent && onChoose(c.zukanHash)}
								disabled={isCurrent}
								className={cn(
									"relative group rounded-xl overflow-hidden border transition-all text-left",
									isCurrent
										? "border-green-500/50 bg-green-500/5 ring-1 ring-green-500/30"
										: "border-outline-variant/20 bg-surface-container-low hover:border-primary/50 hover:ring-1 hover:ring-primary/30"
								)}
							>
								<div className="aspect-square relative bg-surface-container-high">
									<Image
										src={`${CLOUDFRONT_BASE}${c.zukanHash}.png`}
										alt={c.name}
										fill
										className="object-cover"
										unoptimized
									/>
									{isCurrent && (
										<div className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-green-500 text-white text-[9px] font-bold">
											Actuelle
										</div>
									)}
								</div>
								<div className="p-2 space-y-1">
									<p className="text-xs font-medium text-on-surface truncate">{c.name}</p>
									<div className="flex items-center gap-1 flex-wrap">
										<span
											className={cn(
												"px-1 py-0.5 rounded text-[9px] font-bold",
												posMatch
													? "bg-green-500/20 text-green-600"
													: "bg-surface-container-high text-on-surface-variant"
											)}
										>
											{c.position}
										</span>
										<span
											className={cn(
												"px-1 py-0.5 rounded text-[9px] font-bold flex items-center gap-0.5",
												elemMatch
													? "bg-green-500/20 text-green-600"
													: "bg-surface-container-high text-on-surface-variant"
											)}
										>
											{ELEMENT_ICONS[c.element] && (
												<Icon name={ELEMENT_ICONS[c.element]} size={10} />
											)}
											{c.element}
										</span>
									</div>
									<p className="text-[9px] text-on-surface-variant truncate">{c.game}</p>
								</div>
							</button>
						);
					})}
				</div>
			) : search.trim() || posFilter || elemFilter || gameFilter ? (
				<p className="text-xs text-on-surface-variant py-4 text-center">Aucun résultat</p>
			) : (
				<p className="text-xs text-on-surface-variant py-4 text-center">
					Tapez un nom pour chercher dans le catalogue
				</p>
			)}

			{results.length >= 50 && (
				<p className="text-[10px] text-on-surface-variant/60 text-center">
					Limité à 50 résultats — affinez votre recherche
				</p>
			)}
		</div>
	);
}

// ─── Missing Characters Table ────────────────────────────────────────────────

function MissingCharactersTable({
	characters,
	zukanCatalog,
}: {
	characters: MissingCharacter[];
	zukanCatalog: ZukanCandidate[];
}) {
	const [assigningId, setAssigningId] = useState<string | null>(null);
	const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
	const [isPending, startTransition] = useTransition();

	const assigningChar = assigningId ? characters.find((c) => c.id === assigningId) : null;

	const handleChoose = (characterId: string, hash: string) => {
		startTransition(async () => {
			const result = await updateZukanHash(characterId, hash);
			if (result.success) {
				toast.success("Image assignée");
				setAssignedIds((prev) => new Set(prev).add(characterId));
				setAssigningId(null);
			} else {
				toast.error(result.error || "Erreur");
			}
		});
	};

	const visibleChars = characters.filter((c) => !assignedIds.has(c.id));

	return (
		<div className="rounded-[24px] bg-surface-container-lowest border border-outline-variant/20 p-6">
			<h2 className="text-sm font-bold uppercase tracking-wider text-on-surface-variant mb-1">
				Personnages sans image Zukan
			</h2>
			<p className="text-xs text-on-surface-variant/60 mb-4">
				Hors Coach (_5000) et MixiMax (×). {visibleChars.length} affichés (max 200).
				{assignedIds.size > 0 && ` — ${assignedIds.size} assigné(s) cette session.`}
			</p>

			{/* Assign panel */}
			{assigningChar && (
				<div
					className={cn(
						"mb-4 rounded-2xl border border-primary/30 bg-primary-container/10 p-4",
						isPending && "opacity-50 pointer-events-none"
					)}
				>
					<div className="flex items-center justify-between mb-3">
						<h3 className="text-sm font-medium text-on-surface">
							Assigner une image à :{" "}
							<strong>{assigningChar.name_fr || assigningChar.name_en || assigningChar.id}</strong>
						</h3>
						<button
							onClick={() => setAssigningId(null)}
							className="p-1 rounded-full hover:bg-surface-container-highest"
						>
							<Icon name="close" size={18} />
						</button>
					</div>
					<CandidatePanel
						catalog={zukanCatalog}
						initialSearch={assigningChar.name_en || ""}
						currentHash=""
						dbPosition={assigningChar.position || undefined}
						dbElement={assigningChar.element || undefined}
						onChoose={(hash) => handleChoose(assigningChar.id, hash)}
					/>
				</div>
			)}

			<div className="overflow-x-auto">
				<table className="w-full text-xs">
					<thead>
						<tr className="border-b border-outline-variant/20 text-left">
							<th className="py-2 px-2 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
								Code
							</th>
							<th className="py-2 px-2 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
								Nom FR
							</th>
							<th className="py-2 px-2 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
								Nom EN
							</th>
							<th className="py-2 px-2 text-[10px] font-black uppercase tracking-widest text-on-surface-variant hidden sm:table-cell">
								Série
							</th>
							<th className="py-2 px-2 text-[10px] font-black uppercase tracking-widest text-on-surface-variant hidden md:table-cell">
								Rareté
							</th>
							<th className="py-2 px-2 text-[10px] font-black uppercase tracking-widest text-on-surface-variant hidden md:table-cell">
								Pos
							</th>
							<th className="py-2 px-2 text-[10px] font-black uppercase tracking-widest text-on-surface-variant hidden md:table-cell">
								Elem
							</th>
							<th className="py-2 px-2 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
								Action
							</th>
						</tr>
					</thead>
					<tbody>
						{visibleChars.map((char) => (
							<tr
								key={char.id}
								className="border-b border-outline-variant/5 hover:bg-surface-container-low transition-colors"
							>
								<td className="py-1.5 px-2 font-mono text-on-surface-variant">
									{char.internal_code}
								</td>
								<td className="py-1.5 px-2 font-medium text-on-surface">{char.name_fr || "—"}</td>
								<td className="py-1.5 px-2 text-on-surface-variant">{char.name_en || "—"}</td>
								<td className="py-1.5 px-2 text-on-surface-variant hidden sm:table-cell">
									{char.series || "—"}
								</td>
								<td className="py-1.5 px-2 text-on-surface-variant hidden md:table-cell">
									{char.rarity_label || "—"}
								</td>
								<td className="py-1.5 px-2 text-on-surface-variant hidden md:table-cell">
									{char.position || "—"}
								</td>
								<td className="py-1.5 px-2 text-on-surface-variant hidden md:table-cell">
									{char.element || "—"}
								</td>
								<td className="py-1.5 px-2">
									<button
										onClick={() => setAssigningId(char.id)}
										className={cn(
											"px-2 py-1 rounded-lg text-[10px] font-bold transition-colors",
											assigningId === char.id
												? "bg-primary text-on-primary"
												: "bg-primary-container text-primary hover:bg-primary hover:text-on-primary"
										)}
									>
										Assigner
									</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
