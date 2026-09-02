"use client";

import type { Item } from "@rosegriffon/inagle";
import {
	ArrowRightLeft,
	Backpack,
	Coins,
	Layers,
	MapPin,
	ShoppingBag,
	Star,
	Store,
} from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { PLACEHOLDERS, resolveAssetUrl } from "@rosegriffon/azalee/images";
import { japaneseToRomaji } from "@rosegriffon/azalee/text/japanese-romaji";

const RARITY_LABELS: Record<string, string> = {
	"1": "Normal",
	"2": "Expérimenté",
	"3": "Normal",
	"4": "Normal",
	"5": "Normal",
};

/** Libellés FR des catégories d'objet (le brut `shoes`/`emblem` n'est pas affichable). */
const CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
	accessory: { icon: "diamond", label: "Accessoire" },
	animal: { icon: "pets", label: "Animal" },
	consume: { icon: "local_pharmacy", label: "Consommable" },
	costume: { icon: "apparel", label: "Costume" },
	craft_obj: { icon: "construction", label: "Matériau" },
	emblem: { icon: "shield", label: "Emblème" },
	fashion: { icon: "styler", label: "Mode" },
	formation: { icon: "sports", label: "Formation" },
	important: { icon: "priority_high", label: "Objet clé" },
	kizuna_link: { icon: "link", label: "Lien Kizuna" },
	misanga: { icon: "wrist_band", label: "Bracelet" },
	name_plate: { icon: "id_card", label: "Plaque" },
	performance: { icon: "music_note", label: "Performance" },
	shoes: { icon: "steps", label: "Chaussures" },
	special: { icon: "star", label: "Spécial" },
	special_skill: { icon: "auto_awesome", label: "Compétence sp." },
	title: { icon: "badge", label: "Titre" },
};

/** Clés de bonus de stats → libellé FR + icône Material. */
const BONUS_LABELS: Record<string, { label: string; icon: string }> = {
	agility: { icon: "directions_run", label: "Agilité" },
	control: { icon: "touch_app", label: "Contrôle" },
	intelligence: { icon: "psychology", label: "Intelligence" },
	kick: { icon: "sports_soccer", label: "Tir" },
	physical: { icon: "fitness_center", label: "Physique" },
	pressure: { icon: "compress", label: "Pression" },
	technique: { icon: "precision_manufacturing", label: "Technique" },
};

const LOCATION_FR: Record<string, string> = {
	Chronicle: "Galerie Chronique",
	"G-Mart (Arcade Branch)": "G-Mart (Succursale Arcade)",
	"G-Mart (Odaiba)": "G-Mart (Odaiba)",
	"Kool Kit (Odaiba Branch)": "Kool Kit (Succursale Odaiba)",
	"Special Training Booth": "Stand d'entraînement spécial",
	Spirit: "Marché des Esprits",
	VS: "Boutique VS",
};

const STAT_MAX = 15;

const STAT_LABELS: Record<string, { label: string; icon: string }> = {
	agility: { icon: "directions_run", label: "Agilité" },
	control: { icon: "touch_app", label: "Contrôle" },
	intelligence: { icon: "psychology", label: "Intelligence" },
	kick: { icon: "sports_soccer", label: "Tir" },
	physical: { icon: "fitness_center", label: "Physique" },
	pressure: { icon: "compress", label: "Pression" },
	technique: { icon: "precision_manufacturing", label: "Technique" },
};

interface CommunitySheetData {
	matchedName?: string;
	location?: string;
	stats?: Record<string, number>;
}

interface ItemDetailProps {
	item: Item;
	itemName: string;
	itemDesc: string;
}

export function ItemDetail({ item, itemName, itemDesc }: ItemDetailProps) {
	const [imgError, setImgError] = useState(false);
	const resolvedSrc = resolveAssetUrl(item.imageUrl || item.image);
	// Pas de <img> cassé : une URL placeholder (`/ievr.webp`) ou une erreur runtime bascule
	// sur l'icône Backpack (les items « important » `gd120002..091` n'ont pas d'icône réelle
	// dans le CPK ; le `onError` couvre tout 404 résiduel).
	const hasRealImage = !!resolvedSrc && resolvedSrc !== PLACEHOLDERS.item && !imgError;

	const nameJA = item.names?.ja;
	const nameEN = item.names?.en;
	const descJA = item.descriptions?.ja || (item as any).description_JA;
	const { rarity } = item as any;
	const rarityLabel = rarity ? RARITY_LABELS[String(rarity)] || String(rarity) : null;
	const { price } = item as any;
	const sheetData = (item as any).sheetData as CommunitySheetData | null;
	const exchangeRecipes = (item as any).exchangeRecipes as Array<{
		shop: string;
		costs: Array<{ name: string; code: string; quantity: number }>;
	}> | null;
	// Catégorie : libellé FR + icône (le brut `shoes`/`emblem` ne s'affiche pas).
	const categoryKey = String(item.category);
	const categoryInfo = CATEGORY_LABELS[categoryKey] || { icon: "backpack", label: categoryKey };
	// Bonus de stats RÉELS décodés (kick +6, control +5, …). Source : parser + bonus-db.
	const bonuses = (item as any).bonuses as Record<string, number> | null;
	const bonusEntries = bonuses
		? Object.entries(bonuses).filter(([, v]) => typeof v === "number" && v !== 0)
		: [];
	const maxBonus = bonusEntries.length
		? Math.max(...bonusEntries.map(([, v]) => Math.abs(v)))
		: 0;
	const { maxStack } = item as any;
	// La description peut désormais être renseignée (lue depuis item_text via le descId).
	const hasDesc = itemDesc && itemDesc !== "Aucune description.";

	return (
		<div className="w-full space-y-8 animate-in fade-in zoom-in-95 duration-300">
			{/* Main Card */}
			<div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 lg:gap-8 p-4 sm:p-6 lg:p-8 rounded-2xl sm:rounded-[32px] bg-surface-container border border-outline-variant/30 shadow-sm relative overflow-hidden">
				{/* Decorative Background */}
				<div className="absolute top-0 right-0 size-96 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

				{/* Left: Image */}
				<div className="flex flex-col items-center gap-6">
					<div className="w-full aspect-square max-w-[200px] sm:max-w-[280px] rounded-2xl sm:rounded-3xl bg-surface-container-high flex items-center justify-center shrink-0 shadow-inner overflow-hidden relative border border-outline-variant/20">
						{hasRealImage ? (
							<Image
								src={resolvedSrc as string}
								alt={itemName}
								width={128}
								height={128}
								className="object-contain p-6 filter drop-shadow-lg"
								unoptimized
								onError={() => setImgError(true)}
							/>
						) : (
							<>
								<Backpack
									size={96}
									className="text-on-surface-variant/20 sm:hidden"
									aria-hidden="true"
								/>
								<Backpack
									size={128}
									className="text-on-surface-variant/20 hidden sm:block"
									aria-hidden="true"
								/>
							</>
						)}
					</div>

					{/* Badges */}
					<div className="flex flex-wrap justify-center gap-3">
						<div className="flex items-center gap-2 px-4 py-2 rounded-full bg-surface-container-highest border border-outline-variant/10">
							<Icon
								name={categoryInfo.icon}
								size={16}
								className="text-on-surface-variant shrink-0"
							/>
							<span className="text-sm font-bold text-on-surface uppercase tracking-wider">
								{categoryInfo.label}
							</span>
						</div>
						{rarityLabel && (
							<div className="flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20">
								<Star size={18} className="text-primary" aria-hidden="true" />
								<span className="text-sm font-bold text-primary uppercase tracking-wider">
									{rarityLabel}
								</span>
							</div>
						)}
					</div>
				</div>

				{/* Right: Info */}
				<div className="flex-1 space-y-6 relative z-10">
					<div>
						<h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold font-heading text-on-surface mb-2 leading-tight">
							{itemName}
						</h1>
						{/* Alt names */}
						{(nameEN || nameJA) && (
							<div className="flex flex-wrap gap-x-4 gap-y-1 mb-4">
								{nameEN && nameEN !== itemName && (
									<span className="text-sm text-on-surface-variant/70 italic">{nameEN}</span>
								)}
								{nameJA && (
									<span className="text-sm text-on-surface-variant/50 font-light">
										{nameJA}
										{(() => {
											const r = japaneseToRomaji(nameJA);
											return r ? ` (${r})` : "";
										})()}
									</span>
								)}
							</div>
						)}
						{hasDesc ? (
							<div className="max-w-2xl text-on-surface-variant text-base sm:text-lg leading-relaxed whitespace-pre-line">
								{itemDesc}
							</div>
						) : (
							<div className="max-w-2xl text-on-surface-variant/50 text-sm italic">
								Aucune description disponible pour cet objet.
							</div>
						)}
						{/* Description JA */}
						{descJA && (
							<div className="max-w-2xl text-on-surface-variant/50 text-sm leading-relaxed whitespace-pre-line mt-2 font-light">
								{descJA}
							</div>
						)}
					</div>

					{/* Bonus de stats réels (équipement) */}
					{bonusEntries.length > 0 && (
						<div>
							<span className="text-[10px] font-bold text-on-surface-variant uppercase block mb-3 opacity-60">
								Bonus de statistiques
							</span>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
								{bonusEntries
									.toSorted(([, a], [, b]) => Math.abs(b) - Math.abs(a))
									.map(([key, value]) => {
										const info = BONUS_LABELS[key] || { icon: "bar_chart", label: key };
										const pct = maxBonus > 0 ? (Math.abs(value) / maxBonus) * 100 : 0;
										const positive = value > 0;
										return (
											<div
												key={key}
												className="flex items-center gap-3 px-3 py-2 rounded-xl bg-surface-container-high border border-outline-variant/10"
											>
												<Icon name={info.icon} size={18} className="text-primary shrink-0" />
												<div className="flex-1 min-w-0">
													<div className="flex items-center justify-between mb-1">
														<span className="text-[10px] font-bold text-on-surface-variant uppercase opacity-60">
															{info.label}
														</span>
														<span
															className={`text-sm font-black ${positive ? "text-primary" : "text-error"}`}
														>
															{positive ? "+" : ""}
															{value}
														</span>
													</div>
													<div className="h-1.5 rounded-full bg-outline-variant/20 overflow-hidden">
														<div
															className={`h-full rounded-full transition-all ${positive ? "bg-primary" : "bg-error"}`}
															style={{ width: `${pct}%` }}
														/>
													</div>
												</div>
											</div>
										);
									})}
							</div>
						</div>
					)}

					{/* Price + max stack */}
					<div className="flex flex-wrap items-center gap-4">
						{price != null && price > 0 && (
							<div className="flex items-center gap-2">
								<Coins size={18} className="text-on-surface-variant" aria-hidden="true" />
								<span className="text-sm font-bold text-on-surface">
									{price.toLocaleString("fr-FR")}
								</span>
								<span className="text-xs text-on-surface-variant">Points</span>
							</div>
						)}
						{maxStack != null && maxStack > 1 && maxStack < 99999 && (
							<div className="flex items-center gap-2">
								<Layers size={18} className="text-on-surface-variant" aria-hidden="true" />
								<span className="text-sm font-bold text-on-surface">
									{maxStack.toLocaleString("fr-FR")}
								</span>
								<span className="text-xs text-on-surface-variant">max</span>
							</div>
						)}
					</div>

					{/* Location from community data — skip if already in shops.fr */}
					{sheetData?.location &&
						(() => {
							const translatedLocation = LOCATION_FR[sheetData.location] || sheetData.location;
							const existingShops = (item.shops?.fr || []).map((s: string) => s.toLowerCase());
							if (existingShops.includes(translatedLocation.toLowerCase())) {
								return null;
							}
							return (
								<div className="flex items-center gap-2">
									<MapPin size={18} className="text-on-surface-variant" aria-hidden="true" />
									<span className="text-sm font-medium text-on-surface">{translatedLocation}</span>
								</div>
							);
						})()}

					{/* Stats communautaires nommées — uniquement si pas de bonus réels décodés
					    ET si les clés sont des stats reconnues (sinon ce sont des codes bruts
					    `stat1/stat2` non interprétables qu'on ne doit pas afficher). */}
					{bonusEntries.length === 0 &&
						sheetData?.stats &&
						Object.keys(sheetData.stats).some((k) => k in STAT_LABELS) &&
						Object.entries(sheetData.stats).some(([k, v]) => k in STAT_LABELS && v > 0) && (
							<div>
								<span className="text-[10px] font-bold text-on-surface-variant uppercase block mb-3 opacity-60">
									Statistiques
								</span>
								<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
									{Object.entries(sheetData.stats).map(([key, value]) => {
										if (!value || value === 0 || !(key in STAT_LABELS)) {
											return null;
										}
										const info = STAT_LABELS[key] || { icon: "bar_chart", label: key };
										const pct = Math.min(100, (value / STAT_MAX) * 100);
									return (
										<div
											key={key}
											className="flex items-center gap-3 px-3 py-2 rounded-xl bg-surface-container-high border border-outline-variant/10"
										>
											<Icon name={info.icon} size={18} className="text-primary shrink-0" />
											<div className="flex-1 min-w-0">
												<div className="flex items-center justify-between mb-1">
													<span className="text-[10px] font-bold text-on-surface-variant uppercase opacity-60">
														{info.label}
													</span>
													<span className="text-sm font-black text-on-surface">{value}</span>
												</div>
												<div className="h-1.5 rounded-full bg-outline-variant/20 overflow-hidden">
													<div
														className="h-full rounded-full bg-primary transition-all"
														style={{ width: `${pct}%` }}
													/>
												</div>
											</div>
										</div>
									);
								})}
							</div>
						</div>
					)}
				</div>
			</div>

			{/* Shops & Exchange Costs */}
			{exchangeRecipes && exchangeRecipes.length > 0 ? (
				<section className="bg-surface-container rounded-2xl sm:rounded-[24px] p-4 sm:p-6 border border-border/50">
					<h2 className="text-xl font-bold mb-4 flex items-center gap-2">
						<ArrowRightLeft size={24} aria-hidden="true" />
						Obtention
					</h2>
					<div className="space-y-3">
						{exchangeRecipes.map((recipe, i) => (
							<div
								key={i}
								className="p-3 rounded-xl bg-surface-container-low border border-outline-variant/10"
							>
								<div className="flex items-center gap-2 mb-2">
									<ShoppingBag
										size={16}
										className="text-on-surface-variant shrink-0"
										aria-hidden="true"
									/>
									<span className="text-xs font-bold text-on-surface-variant uppercase tracking-wide">
										{recipe.shop}
									</span>
								</div>
								<div className="flex flex-wrap gap-2">
									{recipe.costs.map((cost, j) => (
										<span
											key={j}
											className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-bold border border-primary/20"
										>
											<span className="text-on-surface font-black">{cost.quantity}x</span>
											{cost.name}
										</span>
									))}
								</div>
							</div>
						))}
					</div>
				</section>
			) : item.shops?.fr && item.shops.fr.length > 0 ? (
				<section className="bg-surface-container rounded-2xl sm:rounded-[24px] p-4 sm:p-6 border border-border/50">
					<h2 className="text-xl font-bold mb-4 flex items-center gap-2">
						<Store size={24} aria-hidden="true" />
						Boutiques
					</h2>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						{item.shops.fr.map((shop: string, i: number) => (
							<div
								key={i}
								className="flex items-center gap-3 p-3 rounded-xl bg-surface-container-low hover:bg-surface-container-high transition-colors"
							>
								<ShoppingBag size={24} className="text-on-surface-variant" aria-hidden="true" />
								<span className="font-medium text-sm">{shop}</span>
							</div>
						))}
					</div>
				</section>
			) : null}
		</div>
	);
}
