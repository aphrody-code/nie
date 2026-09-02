"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { resolveRoster, type ResolvedChara } from "@rosegriffon/azalee/game/roster-resolver";
import { parseSave, type SaveSummary } from "@/lib/save-reader";
import { cn } from "@/lib/utils";

// Garde-fou de taille : une USERDATALIVE réelle fait ~12 Mo. On rejette au-delà
// de 30 Mo (fichier manifestement non-IEVR ou corrompu) avant tout traitement wasm.
const MAX_SIZE_BYTES = 30 * 1024 * 1024;

type Status =
	| { kind: "idle" }
	| { kind: "parsing"; filename: string }
	| { kind: "resolving"; filename: string; summary: SaveSummary }
	| {
			kind: "done";
			summary: SaveSummary;
			filename: string;
			roster: ResolvedChara[];
			matched: number;
	  }
	| { kind: "error"; message: string };

/** Formate des secondes en `XXh YYm` (temps de jeu). */
function formatPlaytime(secs: number): string {
	const h = Math.floor(secs / 3600);
	const m = Math.floor((secs % 3600) / 60);
	return `${h}h ${m.toString().padStart(2, "0")}m`;
}

/** Formate un octet-count humainement. */
function formatBytes(n: number): string {
	if (n >= 1024 * 1024) {
		return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
	}
	if (n >= 1024) {
		return `${(n / 1024).toFixed(0)} Ko`;
	}
	return `${n} o`;
}

/** Formate un horodatage natif IEVR en `YYYY-MM-DD HH:MM`. */
function formatDateTime(dt: {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second?: number;
}): string {
	const p = (v: number) => v.toString().padStart(2, "0");
	return `${dt.year}-${p(dt.month)}-${p(dt.day)} ${p(dt.hour)}:${p(dt.minute)}`;
}

/** Formate un compteur lisible en français. */
function fmt(n: number): string {
	return n.toLocaleString("fr-FR");
}

export function SaveUploader() {
	const [status, setStatus] = useState<Status>({ kind: "idle" });
	const [dragging, setDragging] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const handleFile = useCallback(async (file: File) => {
		if (file.size > MAX_SIZE_BYTES) {
			setStatus({
				kind: "error",
				message: `Fichier trop volumineux (${formatBytes(file.size)}). Limite : 30 Mo. Vérifiez qu'il s'agit bien d'une sauvegarde IEVR.`,
			});
			return;
		}

		setStatus({ kind: "parsing", filename: file.name });
		let summary: SaveSummary;
		try {
			const bytes = new Uint8Array(await file.arrayBuffer());
			// La clé de déchiffrement dérive EXACTEMENT du nom de fichier. Le parsing
			// (déchiffrement XOR + lecture des blobs) est 100% client-side (wasm).
			summary = await parseSave(bytes, file.name);
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Impossible de lire ce fichier de sauvegarde.";
			// Message d'aide : la cause la plus fréquente est un nom de fichier renommé
			// (la clé CRC32 ne correspond plus) ou un fichier qui n'est pas une save IEVR.
			setStatus({
				kind: "error",
				message: `${message}. Astuce : ne renommez pas le fichier — son nom d'origine sert à dériver la clé de déchiffrement.`,
			});
			return;
		}

		// Résolution des IDs du roster → noms réels. La SAVE ne quitte PAS le navigateur :
		// seule la liste d'identifiants `0x........` (aucun octet de save) transite vers
		// `/api/save/resolve-roster` pour matcher contre le miroir `inagle_characters`.
		setStatus({ kind: "resolving", filename: file.name, summary });
		const ids = summary.autosave?.owned_ids ?? [];
		try {
			const res = await resolveRoster(ids);
			setStatus({
				kind: "done",
				summary,
				filename: file.name,
				roster: res.resolved,
				matched: res.matched,
			});
		} catch {
			// La résolution est un bonus : si elle échoue, on affiche quand même le résumé.
			setStatus({ kind: "done", summary, filename: file.name, roster: [], matched: 0 });
		}
	}, []);

	const onDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			setDragging(false);
			const file = e.dataTransfer.files?.[0];
			if (file) {
				void handleFile(file);
			}
		},
		[handleFile]
	);

	const onPick = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (file) {
				void handleFile(file);
			}
		},
		[handleFile]
	);

	const reset = useCallback(() => {
		setStatus({ kind: "idle" });
		if (inputRef.current) {
			inputRef.current.value = "";
		}
	}, []);

	return (
		<div className="flex flex-col gap-6">
			{/* Zone de dépôt */}
			{status.kind !== "done" && (
				<div
					onDragOver={(e) => {
						e.preventDefault();
						setDragging(true);
					}}
					onDragLeave={() => setDragging(false)}
					onDrop={onDrop}
					onClick={() => inputRef.current?.click()}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							inputRef.current?.click();
						}
					}}
					role="button"
					tabIndex={0}
					aria-label="Déposer ou choisir un fichier de sauvegarde"
					className={cn(
						`
        relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12
        text-center transition-all duration-200 cursor-pointer outline-hidden
      `,
						"focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
						dragging
							? "border-primary bg-primary-container/40"
							: `
         border-outline-variant bg-surface-container
         hover:bg-surface-container-high
       `
					)}
				>
					<div
						className={cn(
							"flex size-16 items-center justify-center rounded-full transition-colors",
							dragging ? "bg-primary text-on-primary" : "bg-primary-container text-on-primary-container"
						)}
					>
						<Icon
							name={
								status.kind === "parsing" || status.kind === "resolving"
									? "hourglass_top"
									: "add"
							}
							size={32}
						/>
					</div>
					{status.kind === "parsing" ? (
						<>
							<p className="type-title-medium text-on-surface">Déchiffrement de la sauvegarde…</p>
							<p className="type-body-small text-on-surface-variant">{status.filename}</p>
						</>
					) : status.kind === "resolving" ? (
						<>
							<p className="type-title-medium text-on-surface">Résolution des personnages…</p>
							<p className="type-body-small text-on-surface-variant">
								{fmt(status.summary.autosave?.owned_ids.length ?? 0)} identifiants
							</p>
						</>
					) : (
						<>
							<p className="type-title-medium text-on-surface">
								Déposez votre sauvegarde ici
							</p>
							<p className="type-body-small text-on-surface-variant">
								ou cliquez pour parcourir — max 30 Mo, traité localement
							</p>
						</>
					)}
					<input
						ref={inputRef}
						type="file"
						className="sr-only"
						onChange={onPick}
						aria-hidden="true"
					/>
				</div>
			)}

			{/* Erreur */}
			{status.kind === "error" && (
				<div className="flex items-start gap-3 rounded-xl bg-error-container px-4 py-3 text-on-error-container">
					<Icon name="error" size={20} className="mt-0.5 shrink-0" />
					<div className="flex-1">
						<p className="type-body-medium">{status.message}</p>
						<button
							type="button"
							onClick={reset}
							className="mt-2 inline-flex min-h-11 items-center type-label-large text-on-error-container underline underline-offset-2 sm:min-h-0"
						>
							Réessayer
						</button>
					</div>
				</div>
			)}

			{/* Résumé */}
			{status.kind === "done" && (
				<SaveResume
					summary={status.summary}
					filename={status.filename}
					roster={status.roster}
					matched={status.matched}
					onReset={reset}
				/>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Résumé
// ---------------------------------------------------------------------------

function StatCard({
	icon,
	label,
	value,
	hint,
	soon = false,
}: {
	icon: string;
	label: string;
	value: string;
	hint?: string;
	soon?: boolean;
}) {
	return (
		<div className="flex flex-col gap-1 rounded-xl bg-surface-container p-4 elevation-1">
			<div className="flex items-center gap-2 text-on-surface-variant">
				<Icon name={icon} size={18} />
				<span className="type-label-medium uppercase tracking-wide">{label}</span>
			</div>
			{soon ? (
				<span className="type-title-medium text-on-surface-variant/60 italic">Bientôt</span>
			) : (
				<span className="type-title-large text-on-surface">{value}</span>
			)}
			{hint && !soon && <span className="type-body-small text-on-surface-variant">{hint}</span>}
		</div>
	);
}

function SaveResume({
	summary,
	filename,
	roster,
	matched,
	onReset,
}: {
	summary: SaveSummary;
	filename: string;
	roster: ResolvedChara[];
	matched: number;
	onReset: () => void;
}) {
	const { headersave: hs, autosave: as } = summary;

	// Temps de jeu : priorité aux scalaires AUTOSAVE (validés au réel), sinon
	// le premier slot HEADERSAVE horodaté.
	const playtimeSecs =
		as?.scalars?.playtime_secs ??
		hs?.slots.find((s) => s.playtime_secs != null)?.playtime_secs ??
		null;

	// Dernière sauvegarde : l'AUTOSAVE porte un horodatage scalaire plus récent que
	// le timestamp HEADERSAVE (souvent figé à la création du profil). On affiche les
	// deux quand ils diffèrent.
	const sc = as?.scalars;
	const autosaveDt = sc
		? {
				year: sc.save_year,
				month: sc.save_month,
				day: sc.save_day,
				hour: sc.save_hour,
				minute: sc.save_minute,
				second: sc.save_second,
			}
		: null;
	const lastSave = autosaveDt ?? hs?.save_timestamp ?? null;

	const named = roster.filter((r) => r.name !== null);

	return (
		<div className="flex flex-col gap-5">
			{/* En-tête du résumé */}
			<div className="
     flex flex-wrap items-center justify-between gap-3 rounded-xl bg-primary-container px-5 py-4
     text-on-primary-container
   ">
				<div className="flex items-center gap-3">
					<Icon name="check_circle" size={28} />
					<div>
						<p className="type-title-medium">Sauvegarde lue</p>
						<p className="type-body-small opacity-80">{filename}</p>
					</div>
				</div>
				<button
					type="button"
					onClick={onReset}
					className="
       flex min-h-11 items-center gap-1.5 rounded-full bg-on-primary-container/10 px-4 py-2 type-label-large transition-colors
       hover:bg-on-primary-container/20 sm:min-h-0
     "
				>
					<Icon name="replay" size={18} />
					Autre fichier
				</button>
			</div>

			{/* --- Profil --- */}
			<Section icon="badge" title="Profil">
				<div className="
       grid grid-cols-1 gap-3
       sm:grid-cols-2 md:grid-cols-3
     ">
					<StatCard
						icon="person"
						label="Joueur"
						value={hs?.player_name || "—"}
						soon={!hs?.player_name}
					/>
					<StatCard
						icon="stars"
						label="Niveau"
						value={hs?.level_str || "—"}
						soon={!hs?.level_str}
					/>
					<StatCard
						icon="schedule"
						label="Temps de jeu"
						value={playtimeSecs != null ? formatPlaytime(playtimeSecs) : "—"}
						hint={playtimeSecs != null ? `${fmt(playtimeSecs)} s` : undefined}
						soon={playtimeSecs == null}
					/>
					<StatCard
						icon="groups"
						label="Personnages possédés"
						value={as ? fmt(as.owned_count) : "—"}
						hint={
							as ? `${fmt(matched)} résolus · sur ${fmt(as.roster_slots)} emplacements` : undefined
						}
						soon={!as}
					/>
					<StatCard
						icon="save"
						label="Dernière sauvegarde"
						value={lastSave ? formatDateTime(lastSave) : "—"}
						hint={
							hs?.save_timestamp && autosaveDt
								? `Profil créé le ${formatDateTime(hs.save_timestamp)}`
								: undefined
						}
						soon={!lastSave}
					/>
					<StatCard
						icon="push_pin"
						label="Slots de sauvegarde"
						value={hs ? `${hs.used_slots} / ${hs.max_slots}` : "—"}
						soon={!hs}
					/>
				</div>

				{/* Identité + version du format */}
				{hs && (
					<div className="mt-3 grid gap-3 sm:grid-cols-2">
						{hs.unique_id && (
							<KeyVal icon="tag" label="Identifiant unique" mono value={hs.unique_id} />
						)}
						<KeyVal
							icon="memory"
							label="Version du format"
							value={`HEADERSAVE v${hs.format_version}${as ? ` · AUTOSAVE v${as.version}` : ""}`}
						/>
					</div>
				)}
			</Section>

			{/* --- Roster --- */}
			{named.length > 0 && (
				<Section
					icon="groups"
					title={`Roster — ${fmt(named.length)} personnages identifiés`}
					subtitle={
						as && named.length < as.owned_count
							? `${fmt(as.owned_count - named.length)} identifiants non encore présents dans la base Azalée`
							: undefined
					}
				>
					<RosterBreakdown roster={named} />
					<RosterGrid roster={named} />
				</Section>
			)}

			{/* --- Slots de sauvegarde (HEADERSAVE) --- */}
			{hs && hs.slots.some((s) => s.is_active || s.slot_datetime || s.playtime_secs != null) && (
				<Section
					icon="inventory_2"
					title="Emplacements de sauvegarde"
					subtitle="Métadonnées par slot extraites du HEADERSAVE"
				>
					<div className="overflow-x-auto">
						<table className="w-full type-body-small">
							<thead>
								<tr className="text-left text-on-surface-variant">
									<th className="pb-2 pr-4 font-medium">Slot</th>
									<th className="pb-2 pr-4 font-medium">État</th>
									<th className="pb-2 pr-4 font-medium">Horodatage</th>
									<th className="pb-2 font-medium">Temps de jeu</th>
								</tr>
							</thead>
							<tbody className="text-on-surface">
								{hs.slots
									.filter((s) => s.is_active || s.slot_datetime || s.playtime_secs != null)
									.map((s) => (
										<tr key={s.index} className="border-t border-outline-variant/20">
											<td className="py-1.5 pr-4">#{s.index}</td>
											<td className="py-1.5 pr-4">
												{s.is_active ? (
													<span className="inline-flex items-center gap-1 text-primary">
														<Icon name="check_circle" size={14} />
														Actif
													</span>
												) : (
													<span className="text-on-surface-variant">Inactif</span>
												)}
											</td>
											<td className="py-1.5 pr-4">
												{s.slot_datetime ? formatDateTime(s.slot_datetime) : "—"}
											</td>
											<td className="py-1.5">
												{s.playtime_secs != null ? formatPlaytime(s.playtime_secs) : "—"}
											</td>
										</tr>
									))}
							</tbody>
						</table>
					</div>
				</Section>
			)}

			{/* --- Régions non décodées : transparence honnête --- */}
			<div className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-4">
				<div className="mb-3 flex items-center gap-2 text-on-surface">
					<Icon name="build" size={18} />
					<span className="type-title-small">Non encore décodé</span>
				</div>
				<p className="mb-3 type-body-small text-on-surface-variant/80">
					Ces données existent dans la section principale de l&apos;AUTOSAVE (TLV
					entrelacé), mais leur format n&apos;est pas encore reversé. Rien n&apos;est inventé :
					seuls les champs validés sur octets réels sont affichés ci-dessus.
				</p>
				<ul className="grid gap-1.5 type-body-small text-on-surface-variant sm:grid-cols-2">
					<li className="flex items-center gap-2">
						<Icon name="payments" size={16} className="opacity-60" />
						Argent / pièces
					</li>
					<li className="flex items-center gap-2">
						<Icon name="sports_soccer" size={16} className="opacity-60" />
						Équipe titulaire &amp; formation
					</li>
					<li className="flex items-center gap-2">
						<Icon name="backpack" size={16} className="opacity-60" />
						Inventaire &amp; objets
					</li>
					<li className="flex items-center gap-2">
						<Icon name="auto_stories" size={16} className="opacity-60" />
						Progression histoire
					</li>
					<li className="flex items-center gap-2">
						<Icon name="bar_chart" size={16} className="opacity-60" />
						Niveaux &amp; stats par personnage
					</li>
					<li className="flex items-center gap-2">
						<Icon name="emoji_events" size={16} className="opacity-60" />
						Succès / trophées
					</li>
				</ul>
				{as && (
					<p className="mt-3 type-body-small text-on-surface-variant/70">
						Section principale brute :{" "}
						{formatBytes(as.main_data_range[1] - as.main_data_range[0])} ·{" "}
						{fmt(as.scalar_record_count)} enregistrements scalaires · {as.chara_slot_count} slots
						CharaParam.
					</p>
				)}
			</div>

			{/* Détail des blobs (diagnostic) */}
			<details className="rounded-xl bg-surface-container-low p-4">
				<summary className="cursor-pointer type-label-large text-on-surface-variant">
					Détail technique du conteneur
				</summary>
				<div className="mt-3 overflow-x-auto">
					<table className="w-full type-body-small">
						<thead>
							<tr className="text-left text-on-surface-variant">
								<th className="pb-2 pr-4 font-medium">Bloc</th>
								<th className="pb-2 pr-4 font-medium">Type</th>
								<th className="pb-2 pr-4 font-medium">Taille</th>
								<th className="pb-2 pr-4 font-medium">CRC32</th>
								<th className="pb-2 font-medium">field8</th>
							</tr>
						</thead>
						<tbody className="text-on-surface">
							{summary.blobs.map((b) => (
								<tr key={b.filename} className="border-t border-outline-variant/20">
									<td className="py-1.5 pr-4">{b.filename}</td>
									<td className="py-1.5 pr-4">{b.subtype}</td>
									<td className="py-1.5 pr-4">{formatBytes(b.size)}</td>
									<td className="py-1.5 pr-4 font-mono">
										0x{(b.crc32 >>> 0).toString(16).toUpperCase().padStart(8, "0")}
									</td>
									<td className="py-1.5 font-mono">{b.field8}</td>
								</tr>
							))}
						</tbody>
					</table>
					{summary.key != null && (
						<p className="mt-3 type-body-small text-on-surface-variant/70">
							Clé XOR dérivée du nom :{" "}
							<code className="font-mono">
								0x{(summary.key >>> 0).toString(16).toUpperCase().padStart(8, "0")}
							</code>{" "}
							· conteneur {summary.slot_name}
						</p>
					)}
				</div>
			</details>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Présentations réutilisables
// ---------------------------------------------------------------------------

/** Section titrée avec sous-titre optionnel. */
function Section({
	icon,
	title,
	subtitle,
	children,
}: {
	icon: string;
	title: string;
	subtitle?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="rounded-xl bg-surface-container-low p-4">
			<div className="mb-3 flex items-start gap-2 text-on-surface">
				<Icon name={icon} size={18} className="mt-0.5 shrink-0" />
				<div>
					<p className="type-title-small">{title}</p>
					{subtitle && <p className="type-body-small text-on-surface-variant">{subtitle}</p>}
				</div>
			</div>
			{children}
		</div>
	);
}

/** Couple clé/valeur inline (identité de la save). */
function KeyVal({
	icon,
	label,
	value,
	mono = false,
}: {
	icon: string;
	label: string;
	value: string;
	mono?: boolean;
}) {
	return (
		<div className="rounded-xl bg-surface-container p-3">
			<div className="flex items-center gap-2 text-on-surface-variant">
				<Icon name={icon} size={16} />
				<span className="type-label-medium uppercase tracking-wide">{label}</span>
			</div>
			<span
				className={cn(
					"mt-1 block break-all type-body-small text-on-surface",
					mono && "font-mono"
				)}
			>
				{value}
			</span>
		</div>
	);
}

/** Couleur d'accent par élément (cohérente avec le wiki). */
const ELEMENT_TINT: Record<string, string> = {
	Feu: "text-red-400",
	Vent: "text-emerald-400",
	Forêt: "text-green-500",
	Montagne: "text-amber-500",
	Foudre: "text-yellow-400",
	Vide: "text-purple-400",
};

/** Répartition du roster par élément, position et rareté (calculée client-side). */
function RosterBreakdown({ roster }: { roster: ResolvedChara[] }) {
	const { byElement, byPosition, byRarity } = useMemo(() => {
		const count = (key: keyof ResolvedChara) => {
			const m = new Map<string, number>();
			for (const c of roster) {
				const v = c[key];
				if (typeof v === "string" && v) {
					m.set(v, (m.get(v) ?? 0) + 1);
				}
			}
			return [...m.entries()].sort((a, b) => b[1] - a[1]);
		};
		return {
			byElement: count("element"),
			byPosition: count("position"),
			byRarity: count("rarity"),
		};
	}, [roster]);

	const Group = ({ label, entries }: { label: string; entries: [string, number][] }) =>
		entries.length === 0 ? null : (
			<div>
				<p className="mb-1.5 type-label-medium uppercase tracking-wide text-on-surface-variant">
					{label}
				</p>
				<div className="flex flex-wrap gap-1.5">
					{entries.map(([k, n]) => (
						<span
							key={k}
							className="
             inline-flex items-center gap-1 rounded-full bg-surface-container px-2.5 py-1 type-body-small
             text-on-surface
           "
						>
							<span className={cn(ELEMENT_TINT[k] ?? "text-on-surface-variant")}>{k}</span>
							<span className="text-on-surface-variant">{fmt(n)}</span>
						</span>
					))}
				</div>
			</div>
		);

	return (
		<div className="mb-4 grid gap-3 sm:grid-cols-3">
			<Group label="Élément" entries={byElement} />
			<Group label="Position" entries={byPosition} />
			<Group label="Rareté" entries={byRarity} />
		</div>
	);
}

/** Grille du roster résolu, avec recherche et expansion progressive. */
function RosterGrid({ roster }: { roster: ResolvedChara[] }) {
	const [expanded, setExpanded] = useState(false);
	const [query, setQuery] = useState("");
	const LIMIT = 60;

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) {
			return roster;
		}
		return roster.filter((c) => (c.name ?? "").toLowerCase().includes(q));
	}, [roster, query]);

	const shown = expanded || query ? filtered : filtered.slice(0, LIMIT);

	return (
		<>
			<div className="mb-3 flex items-center gap-2 rounded-full bg-surface-container px-3 py-1.5">
				<Icon name="search" size={16} className="text-on-surface-variant" />
				<input
					type="search"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Filtrer un personnage…"
					className="w-full bg-transparent type-body-small text-on-surface outline-hidden placeholder:text-on-surface-variant"
				/>
			</div>
			<ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
				{shown.map((c) => {
					const tint = (c.element && ELEMENT_TINT[c.element]) || "text-on-surface";
					const inner = (
						<span className="flex min-w-0 items-center gap-1.5">
							<Icon name="blur_on" size={12} className={cn("shrink-0", tint)} />
							<span className="truncate type-body-small text-on-surface">{c.name}</span>
						</span>
					);
					return (
						<li
							key={c.id}
							className="
             rounded-md bg-surface-container px-2.5 py-2 transition-colors
             hover:bg-surface-container-high md:py-1.5
           "
							title={[c.element, c.position, c.rarity].filter(Boolean).join(" · ")}
						>
							{c.baseSlug ? (
								<Link href={`/chara/${c.baseSlug}`} className="block">
									{inner}
								</Link>
							) : (
								inner
							)}
						</li>
					);
				})}
			</ul>
			{!query && filtered.length > LIMIT && (
				<button
					type="button"
					onClick={() => setExpanded((v) => !v)}
					className="mt-3 inline-flex min-h-11 items-center type-label-large text-primary underline underline-offset-2 sm:min-h-0"
				>
					{expanded ? "Réduire" : `Afficher les ${fmt(filtered.length)} personnages`}
				</button>
			)}
			{query && (
				<p className="mt-3 type-body-small text-on-surface-variant">
					{fmt(filtered.length)} résultat{filtered.length > 1 ? "s" : ""} pour « {query} »
				</p>
			)}
		</>
	);
}
