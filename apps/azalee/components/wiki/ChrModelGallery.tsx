"use client";

import { Download, PawPrint, Sparkles, Swords } from "lucide-react";
import { useState } from "react";
import InlineModelViewer from "@/components/wiki/InlineModelViewer";
import { downloadName } from "@rosegriffon/azalee/text/download-filename";
import { cn } from "@/lib/utils";

interface ModelEntry {
	code: string;
	name: string;
	glbUrl: string;
	/** Texture g4tx→png (le maillage `/model-chr` n'embarque pas la texture). `null` si absente. */
	textureUrl?: string | null;
}

type Tab = "waza" | "item" | "animal";

interface ChrModelGalleryProps {
	waza: ModelEntry[];
	item: ModelEntry[];
	animal: ModelEntry[];
}

function ModelCard({ entry }: { entry: ModelEntry }) {
	const [texError, setTexError] = useState(false);
	const showTexture = Boolean(entry.textureUrl) && !texError;
	const fileName = downloadName(entry.name, "modele");
	return (
		<div className="group rounded-2xl overflow-hidden bg-surface-container border border-outline-variant/20 hover:border-primary/40 transition-all duration-200">
			{/* Vrai modèle 3D rendu INLINE (monté quand visible, démonté hors-champ). */}
			<div className="relative aspect-[3/4] bg-surface-container-high">
				<InlineModelViewer glbUrl={entry.glbUrl} name={entry.name} />
				{/* Vignette de la texture (le maillage model-chr est sans texture embarquée). */}
				{showTexture && (
					// eslint-disable-next-line @next/next/no-img-element
					<img
						src={`${entry.textureUrl}?w=160&format=webp`}
						alt={`Texture ${entry.name}`}
						loading="lazy"
						onError={() => setTexError(true)}
						className="absolute bottom-2 right-2 size-12 rounded-lg border border-outline-variant/30 bg-surface-container object-cover [image-rendering:pixelated] shadow"
					/>
				)}
			</div>
			<div className="p-3 border-t border-outline-variant/10 space-y-2">
				<div>
					<p className="type-title-small text-on-surface truncate">{entry.name}</p>
				</div>
				{/* Téléchargements : modèle (GLB) + texture (PNG). */}
				<div className="flex flex-wrap items-center gap-1.5">
					<a
						href={entry.glbUrl}
						download={`${fileName}.glb`}
						className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition-colors"
						title="Télécharger le modèle 3D (GLB)"
					>
						<Download size={12} /> GLB
					</a>
					{showTexture && (
						<a
							href={entry.textureUrl ?? "#"}
							download={`${fileName}.png`}
							className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition-colors"
							title="Télécharger la texture (PNG)"
						>
							<Download size={12} /> PNG
						</a>
					)}
				</div>
			</div>
		</div>
	);
}

export function ChrModelGallery({ waza, item, animal }: ChrModelGalleryProps) {
	const TABS: Array<{ id: Tab; label: string; count: number; icon: typeof Swords; entries: ModelEntry[] }> = [
		{ count: waza.length, entries: waza, icon: Sparkles, id: "waza", label: "Techniques" },
		{ count: item.length, entries: item, icon: Swords, id: "item", label: "Objets" },
		{ count: animal.length, entries: animal, icon: PawPrint, id: "animal", label: "Animaux" },
	];

	// Premier onglet non vide par défaut.
	const firstNonEmpty = TABS.find((t) => t.count > 0)?.id ?? "waza";
	const [tab, setTab] = useState<Tab>(firstNonEmpty);
	const entries = TABS.find((t) => t.id === tab)?.entries ?? [];

	return (
		<div className="space-y-6">
			{/* Onglets */}
			<div className="flex flex-wrap gap-2">
				{TABS.map((t) => {
					const TabIcon = t.icon;
					return (
						<button
							key={t.id}
							type="button"
							onClick={() => setTab(t.id)}
							disabled={t.count === 0}
							className={cn(
								"flex items-center gap-2 px-4 py-2 rounded-full border transition-all",
								tab === t.id
									? "bg-primary text-on-primary border-primary"
									: "bg-surface-container border-outline-variant/20 text-on-surface-variant hover:bg-surface-container-high",
								t.count === 0 && "opacity-40 cursor-not-allowed"
							)}
						>
							<TabIcon size={16} aria-hidden="true" />
							<span className="type-label-large font-bold">{t.label}</span>
							<span className="type-label-small opacity-70">{t.count}</span>
						</button>
					);
				})}
			</div>

			{entries.length === 0 ? (
				<p className="type-body-medium text-on-surface-variant py-8 text-center">
					Aucun modèle 3D disponible pour le moment.
				</p>
			) : (
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
					{entries.map((entry) => (
						<ModelCard key={entry.code} entry={entry} />
					))}
				</div>
			)}
		</div>
	);
}
