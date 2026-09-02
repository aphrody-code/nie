"use client";

import {
	ArrowLeft,
	ArrowRight,
	CircleDot,
	LayoutGrid,
	Sparkles,
	Store,
	TrendingUp,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import CharacterModelViewer from "@/components/wiki/CharacterModelViewer";
import { ElementIcon } from "@/components/wiki/ElementIcon";
import {
	BUFF_EFFECT_FR,
	HISSATSU_ELEMENT_FR,
	HISSATSU_TYPE_FR,
	translatePassiveEffect,
} from "@rosegriffon/azalee/text/aura-translations";
import { resolveAssetUrl } from "@rosegriffon/azalee/images";
import { japaneseToRomaji } from "@rosegriffon/azalee/text/japanese-romaji";

interface SheetData {
	matchedName?: string;
	passiveEffect?: string;
	hissatsu?: {
		name: string;
		type: string;
		element: string;
		// La puissance peut être un scalaire OU une plage {min,max} (ex hissatsu de soul/keshin).
		power?: string | number | { min: number; max: number };
	};
	buff?: {
		name: string;
		effect: string;
	};
}

interface SubTypeInfo {
	label: string;
	icon: string;
	color: string;
}

/**
 * Rend la puissance d'une hissatsu : scalaire tel quel, ou plage `{min,max}` en
 * `min–max` (un seul nombre si min===max). Évite l'erreur React « Objects are not
 * valid as a React child » quand la donnée est une plage.
 */
function formatHissatsuPower(
	power: string | number | { min: number; max: number } | null | undefined
): string {
	if (power == null) return "";
	if (typeof power === "object") {
		return power.min === power.max ? `${power.max}` : `${power.min}–${power.max}`;
	}
	return String(power);
}

interface AuraData {
	auraId: string;
	auraIdStr?: string;
	displayName: string;
	name_FR?: string;
	name_EN?: string;
	name_JA?: string;
	desc_FR?: string;
	desc_JA?: string;
	element?: number;
	elementName?: { en?: string; fr?: string; ja?: string };
	image?: string;
	telopUrl?: string | null;
	assetCode?: string;
	subType?: string;
	sheetData?: SheetData;
	skillId?: string;
	skillVideoUrl?: string | null;
	skillInternalCode?: string | null;
	skillNameFR?: string | null;
	ownerCharaParamId?: string;
	ownerName?: string;
	ownerSlug?: string;
	/** URL du modèle 3D COMPLET keshin (corps+armure+textures), null si non servi. */
	modelGlbUrl?: string | null;
}

interface AuraDetailProps {
	aura: AuraData;
	category: string;
	subTypeInfo: SubTypeInfo;
	prevAura: AuraData | null;
	nextAura: AuraData | null;
}

export function AuraDetail({ aura, category, subTypeInfo, prevAura, nextAura }: AuraDetailProps) {
	const [imgError, setImgError] = useState(false);
	const [telopError, setTelopError] = useState(false);
	const imageUrl = resolveAssetUrl(aura.image);
	const nameEN = (aura as any).name_EN;
	const nameJA = (aura as any).name_JA || (aura as any).name_ja;
	const descJA = (aura as any).desc_JA || (aura as any).desc_ja;

	return (
		<div className="w-full space-y-8 animate-in fade-in zoom-in-95 duration-300">
			{/* Main Card */}
			<div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 lg:gap-8 p-4 sm:p-6 lg:p-8 rounded-2xl sm:rounded-[32px] bg-surface-container border border-outline-variant/30 shadow-sm relative overflow-hidden">
				{/* Decorative Background */}
				<div className="absolute top-0 right-0 size-[500px] bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

				{/* Left: Image */}
				<div className="flex flex-col items-center gap-6">
					<div className="w-full aspect-square max-w-[256px] rounded-2xl sm:rounded-3xl bg-surface-container-high flex items-center justify-center shrink-0 shadow-inner overflow-hidden relative border border-outline-variant/20 mx-auto">
						{imageUrl && !imgError ? (
							<Image
								src={imageUrl}
								alt={aura.displayName}
								fill
								className="object-contain p-2 filter drop-shadow-lg"
								sizes="256px"
								unoptimized
								onError={() => setImgError(true)}
							/>
						) : (
							<>
								<Icon
									name={subTypeInfo.icon}
									size={96}
									className={`sm:hidden ${subTypeInfo.color} opacity-30`}
								/>
								<Icon
									name={subTypeInfo.icon}
									size={144}
									className={`hidden sm:block ${subTypeInfo.color} opacity-30`}
								/>
							</>
						)}
						{/* Modèle 3D COMPLET keshin (corps+armure+textures) — monté seulement
						    si un modèle assemblé est servi (gate manifeste, anti-404). Le GLB est
						    téléchargeable depuis le viewer (bouton dans le dialog). */}
						{aura.modelGlbUrl && (
							<div className="absolute bottom-1 right-1 rounded-full bg-black/40 backdrop-blur-sm border border-white/20">
								<CharacterModelViewer glbUrl={aura.modelGlbUrl} name={aura.displayName} />
							</div>
						)}
						{/* Téléchargement de l'image (icône/telop décodée PNG). */}
						{imageUrl && !imgError && (
							<a
								href={imageUrl}
								download
								target="_blank"
								rel="noreferrer"
								onClick={(e) => e.stopPropagation()}
								className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-surface/70 backdrop-blur px-2.5 py-1 text-xs font-medium text-on-surface hover:bg-surface border border-outline-variant/30 transition-colors"
								title="Télécharger l'image"
							>
								<Icon name="download" size={12} /> PNG
							</a>
						)}
					</div>

					{/* Type Badge */}
					<div className="flex flex-wrap justify-center gap-3 w-full">
						<div className="flex items-center gap-2 px-4 py-2 rounded-full bg-surface-container-highest border border-outline-variant/10 w-full justify-center">
							<Icon name={subTypeInfo.icon} size={20} className={subTypeInfo.color} />
							<span className="text-sm font-bold text-on-surface uppercase tracking-wider">
								{subTypeInfo.label}
							</span>
						</div>

						{aura.elementName?.en && (
							<div className="flex items-center gap-2 px-4 py-2 rounded-full bg-surface-container-highest border border-outline-variant/10 w-full justify-center">
								<ElementIcon element={aura.elementName.en} size="md" />
								<span className="text-sm font-bold text-on-surface uppercase tracking-wider">
									{aura.elementName.fr}
								</span>
							</div>
						)}

						{/* Owner character */}
						{aura.ownerName && (
							<Link
								href={aura.ownerSlug ? `/chara/${aura.ownerSlug}` : "#"}
								className="flex items-center gap-2 px-4 py-2 rounded-full bg-surface-container-highest border border-outline-variant/10 w-full justify-center hover:bg-surface-container-high transition-colors"
							>
								<CircleDot size={16} className="text-primary" />
								<span className="text-sm font-bold text-on-surface">{aura.ownerName}</span>
							</Link>
						)}
					</div>
				</div>

				{/* Right: Info */}
				<div className="flex-1 space-y-8 relative z-10">
					<div>
						<h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black font-heading text-on-surface mb-2 leading-tight">
							{aura.displayName}
						</h1>
						{/* Alt names */}
						{(nameEN || nameJA) && (
							<div className="flex flex-wrap gap-x-4 gap-y-1 mb-4">
								{nameEN && nameEN !== aura.displayName && (
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
						<div className="p-4 sm:p-6 rounded-2xl bg-surface-container-low border border-outline-variant/20">
							<p className="text-base sm:text-lg text-on-surface-variant leading-relaxed whitespace-pre-line italic">
								&quot;{aura.desc_FR || "Aucune description disponible."}&quot;
							</p>
							{/* Description JA */}
							{descJA && (
								<p className="text-sm text-on-surface-variant/50 leading-relaxed whitespace-pre-line mt-3 font-light">
									{descJA}
								</p>
							)}
						</div>
					</div>

					{/* Passive Effect */}
					{aura.sheetData?.passiveEffect && (
						<div className="bg-tertiary/5 border border-tertiary/10 rounded-2xl p-4">
							<div className="flex items-center gap-2 mb-2">
								<Sparkles size={18} className="text-tertiary" aria-hidden="true" />
								<span className="text-[10px] font-bold text-tertiary uppercase tracking-wider">
									Effet Passif
								</span>
							</div>
							<p className="text-on-surface font-medium whitespace-pre-line">
								{translatePassiveEffect(aura.sheetData.passiveEffect)}
							</p>
						</div>
					)}

					{/* Hissatsu + Buff */}
					{(aura.sheetData?.hissatsu || aura.skillNameFR || aura.sheetData?.buff) && (
						<div className="space-y-4">
							{(aura.sheetData?.hissatsu || aura.skillNameFR) && (
								<div className="bg-primary/5 border border-primary/10 rounded-2xl p-4">
									<div className="flex items-center justify-between mb-3">
										<div className="flex items-center gap-2">
											<CircleDot size={18} className="text-primary" aria-hidden="true" />
											<span className="text-[10px] font-bold text-primary uppercase tracking-wider">
												Technique Spéciale
											</span>
										</div>
										{(aura as any).skillInternalCode && (
											<Link
												href={`/skill/${(aura as any).skillInternalCode}`}
												className="flex items-center gap-1 text-xs font-bold text-primary hover:text-primary/80 transition-colors"
											>
												Voir la fiche
												<ArrowRight size={14} aria-hidden="true" />
											</Link>
										)}
									</div>
									<span className="text-lg font-bold text-on-surface block mb-2">
										{aura.skillNameFR || aura.sheetData?.hissatsu?.name}
									</span>
									{(aura.sheetData?.hissatsu?.type ||
										aura.sheetData?.hissatsu?.element ||
										aura.sheetData?.hissatsu?.power) && (
										<div className="flex flex-wrap items-center gap-3 text-sm mb-3">
											{aura.sheetData?.hissatsu?.type && (
												<span className="font-medium">
													{HISSATSU_TYPE_FR[aura.sheetData.hissatsu.type] ||
														aura.sheetData.hissatsu.type}
												</span>
											)}
											{aura.sheetData?.hissatsu?.type && aura.sheetData?.hissatsu?.element && (
												<span className="text-on-surface-variant/40">|</span>
											)}
											{aura.sheetData?.hissatsu?.element && (
												<span className="font-medium">
													{HISSATSU_ELEMENT_FR[aura.sheetData.hissatsu.element] ||
														aura.sheetData.hissatsu.element}
												</span>
											)}
											{aura.sheetData?.hissatsu?.power != null && (
												<>
													<span className="text-on-surface-variant/40">|</span>
													<span className="text-xl font-black text-primary">
														{formatHissatsuPower(aura.sheetData.hissatsu.power)}
													</span>
												</>
											)}
										</div>
									)}
									{(aura as any).skillVideoUrl && (
										<div className="rounded-xl overflow-hidden border border-primary/10 aspect-video bg-black">
											<video
												src={(aura as any).skillVideoUrl}
												controls
												muted
												className="w-full h-full object-contain"
											>
												Votre navigateur ne supporte pas la lecture de vidéos.
											</video>
										</div>
									)}
								</div>
							)}

							{aura.sheetData?.buff && (
								<div className="bg-secondary/5 border border-secondary/10 rounded-2xl p-4">
									<div className="flex items-center gap-2 mb-3">
										<TrendingUp size={18} className="text-secondary" aria-hidden="true" />
										<span className="text-[10px] font-bold text-secondary uppercase tracking-wider">
											Bonus d&apos;Activation
										</span>
									</div>
									{aura.sheetData?.buff.name && (
										<span className="text-sm font-bold text-on-surface block mb-1">
											{aura.sheetData.buff.name}
										</span>
									)}
									<p className="text-sm font-medium whitespace-pre-line">
										{BUFF_EFFECT_FR[aura.sheetData?.buff.effect] || aura.sheetData?.buff.effect}
									</p>
								</div>
							)}
						</div>
					)}

					{/* Shop Availability */}
					{(aura.sheetData as any)?.shopAvailability &&
						(aura.sheetData as any).shopAvailability.length > 0 && (
							<div className="flex items-center gap-2 p-3 rounded-xl bg-surface-container-low border border-outline-variant/10">
								<Store size={18} className="text-on-surface-variant shrink-0" aria-hidden="true" />
								<span className="text-sm font-medium text-on-surface">
									{(aura.sheetData as any).shopAvailability.join(", ")}
								</span>
							</div>
						)}

				</div>
			</div>

			{/* Telop banner — bandeau d'annonce de technique 1728x352 (4.9:1) */}
			{aura.telopUrl && !telopError && (
				<div className="relative w-full aspect-[1728/352] rounded-2xl overflow-hidden bg-surface-container border border-outline-variant/20 shadow-sm">
					<Image
						src={aura.telopUrl}
						alt={`Bandeau ${aura.displayName}`}
						fill
						className="object-cover"
						sizes="(max-width: 768px) 100vw, 1024px"
						unoptimized
						onError={() => setTelopError(true)}
					/>
				</div>
			)}

			{/* Navigation */}
			<div className="flex justify-between items-center gap-2 sm:gap-4">
				{prevAura ? (
					<Link
						href={`/aura/${category}/${prevAura.auraIdStr || prevAura.auraId}`}
						className="flex items-center gap-1.5 sm:gap-3 px-3 py-2 sm:px-6 sm:py-3 rounded-full bg-surface-container hover:bg-surface-container-high transition-all border border-outline-variant/20 hover:scale-105 active:scale-95 group min-w-0"
					>
						<ArrowLeft
							size={20}
							className="shrink-0 group-hover:-translate-x-1 transition-transform"
							aria-hidden="true"
						/>
						<div className="flex flex-col items-start min-w-0">
							<span className="text-[10px] uppercase font-bold text-on-surface-variant opacity-70 hidden sm:block">
								Précédent
							</span>
							<span className="text-xs sm:text-sm font-bold truncate max-w-[80px] sm:max-w-[150px]">
								{prevAura.displayName}
							</span>
						</div>
					</Link>
				) : (
					<div />
				)}

				<Link
					href={`/aura/${category}`}
					className="flex items-center gap-2 px-3 py-2 sm:px-6 sm:py-3 rounded-full bg-surface-container-high hover:bg-surface-container-highest transition-all border border-outline-variant/20 hover:shadow-md shrink-0"
				>
					<LayoutGrid size={20} aria-hidden="true" />
					<span className="text-xs sm:text-sm font-bold hidden sm:inline">Retour à la liste</span>
				</Link>

				{nextAura ? (
					<Link
						href={`/aura/${category}/${nextAura.auraIdStr || nextAura.auraId}`}
						className="flex items-center gap-1.5 sm:gap-3 px-3 py-2 sm:px-6 sm:py-3 rounded-full bg-surface-container hover:bg-surface-container-high transition-all border border-outline-variant/20 hover:scale-105 active:scale-95 group min-w-0"
					>
						<div className="flex flex-col items-end min-w-0">
							<span className="text-[10px] uppercase font-bold text-on-surface-variant opacity-70 hidden sm:block">
								Suivant
							</span>
							<span className="text-xs sm:text-sm font-bold truncate max-w-[80px] sm:max-w-[150px]">
								{nextAura.displayName}
							</span>
						</div>
						<ArrowRight
							size={20}
							className="shrink-0 group-hover:translate-x-1 transition-transform"
							aria-hidden="true"
						/>
					</Link>
				) : (
					<div />
				)}
			</div>
		</div>
	);
}
