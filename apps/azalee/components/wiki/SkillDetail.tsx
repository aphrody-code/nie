"use client";

import type { Skill } from "@rosegriffon/inagle";
import {
	ArrowLeft,
	CircleDot,
	Play,
	Zap,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { OverrideSkillSection } from "@/components/wiki/OverrideSkillSection";
import type { OverrideSkillData } from "@/components/wiki/OverrideSkillSection";
import { SkillVideoActions } from "@/components/wiki/SkillVideoActions";
import { SkillVideoPlayer } from "@/components/wiki/SkillVideoPlayer";
import type { SkillVideoVariant } from "@/components/wiki/SkillVideoPlayer";
import { getSkillIconUrl, getSkillImageUrl } from "@rosegriffon/azalee/images";
import { japaneseToRomaji } from "@rosegriffon/azalee/text/japanese-romaji";
import { SHOP_FR } from "@rosegriffon/azalee/text/translations";
import { SkillDetailInfo } from "@niers/inacord-ui";

// Translation maps for community sheet data
const SKILL_TYPE_FR: Record<string, string> = {
	main: "Principal",
	sub: "Secondaire",
};

const SHEET_TYPE_FR: Record<string, string> = {
	Defense: "Défense",
	Dribble: "Dribble",
	Keep: "Arrêt",
	Offense: "Attaque",
	Shoot: "Tir",
};

const SHEET_SUBTYPE_FR: Record<string, string> = {
	"Counter Shoot": "Contre-tir",
	"Long Shoot": "Tir longue distance",
	"Shoot Block": "Contre-tir",
};

// SHOP_FR imported from @/lib/translations

// Community sheet data structure (from Google Sheets enrichment)
interface CommunitySheetData {
	matchedName?: string;
	shop?: string;
	type?: string;
	subType?: string;
	power?: number | string;
	tension?: number | string;
	duration?: number | string;
	effects?: string[];
}

interface SkillDetailProps {
	skill: Skill;
	name: string;
	desc: string;
	category: string;
	element: string;
	relatedSkills: Skill[];
	overrideSkills?: OverrideSkillData[];
	/** Variantes vidéo officielles (`inagle_skill_videos`), lues côté serveur. */
	videos?: SkillVideoVariant[];
}

function SkillImage({ src, alt }: { src: string; alt: string }) {
	const [error, setError] = useState(false);
	if (error) {
		return null;
	}
	return (
		<Image
			src={src}
			alt={alt}
			fill
			sizes="(max-width: 640px) 112px, 160px"
			className="object-contain p-2"
			onError={() => setError(true)}
		/>
	);
}

function getCategoryIcon(category: number | undefined): string {
	if (category === 1) {
		return "sports_soccer";
	}
	if (category === 4) {
		return "front_hand";
	}
	if (category === 2) {
		return "directions_run";
	}
	if (category === 3) {
		return "shield";
	}
	return "auto_awesome";
}

export function SkillDetail({
	skill,
	name,
	desc,
	category,
	element,
	relatedSkills,
	overrideSkills,
	videos,
}: SkillDetailProps) {
	const imageUrl = getSkillImageUrl(skill.skillIDStr, (skill as any).image);

	// La variante affichée est choisie dans le lecteur (colonne de gauche) mais
	// c'est la barre d'actions (plus bas) qui la télécharge : l'état vit donc ici,
	// leur premier parent commun. Auparavant le bouton téléchargeait toujours
	// `skill.videoUrl`, la vidéo de rang 0 — sur les 236 techniques à deux vidéos,
	// choisir « Échec » puis « Télécharger » rapportait la vidéo de réussite.
	const variants = buildVideoVariants(skill, videos);
	const [activeVideoIndex, setActiveVideoIndex] = useState(0);
	const activeVariant = variants[activeVideoIndex] ?? variants[0];

	const sheetData = (skill as any).sheetData as CommunitySheetData | undefined;
	const nameJA = (skill as any).name_JA || (skill as any).names?.ja;
	const nameEN = (skill as any).name_EN || (skill as any).names?.en;
	const descEN = (skill as any).desc_EN;
	const descJA = (skill as any).descriptions?.ja || (skill as any).desc_JA;

	return (
		<div className="w-full animate-in fade-in zoom-in-95 duration-300">
			{/* Back Button */}
			<div className="mb-4">
				<Link
					href="/skill"
					className="inline-flex items-center gap-2 text-sm font-medium text-on-surface-variant hover:text-primary transition-colors"
				>
					<ArrowLeft size={20} aria-hidden="true" />
					Retour à la liste
				</Link>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
				{/* Left Column: Main Content */}
				<div className="space-y-4">
					{/* Video Player Section */}
					<VideoSection
						skill={skill}
						name={name}
						imageUrl={imageUrl}
						variants={variants}
						activeIndex={activeVideoIndex}
						onActiveIndexChange={setActiveVideoIndex}
					/>

					{/* Title + Alt Names */}
					<div>
						<h1 className="text-2xl md:text-3xl font-bold font-heading text-on-surface leading-tight">
							{name}
						</h1>
						{(nameEN || nameJA) && (
							<div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
								{nameEN && nameEN !== name && (
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
					</div>

					{/* Meta Row & Actions */}
					<MetaRow
						skill={skill}
						name={name}
						category={category}
						element={element}
						sheetData={sheetData}
						activeVariant={activeVariant}
						variantCount={variants.length}
					/>

					{/* Description Box */}
					<SkillDetailInfo
						powerMin={skill.power_min}
						powerMax={skill.power_max}
						foulRate={skill.foulRate}
						duration={sheetData?.duration}
						evolution={
							(skill as any).evolutionType ??
							(skill.growthType !== undefined ? skill.growthSpeed : null)
						}
						partnerCount={skill.partnerCount}
						recastTime={skill.recastTime}
						internalId={(skill as any).internalCode || skill.skillIDStr}
						description={desc}
						descriptionEnglish={descEN}
						descriptionJapanese={descJA}
						effects={sheetData?.effects}
						recipes={(skill as any).exchangeRecipes ?? null}
						shops={skill.shops?.fr || []}
						additionalShop={sheetData?.shop ? SHOP_FR[sheetData.shop] || sheetData.shop : null}
						tags={skill.tags}
					/>
				</div>

				{/* Right Column: Overdrive + Related Skills */}
				<div className="space-y-6">
					{/* Overdrive Combinations */}
					{overrideSkills && overrideSkills.length > 0 && (
						<OverrideSkillSection
							overrides={overrideSkills}
							currentSkillId={(skill as any).skillId || (skill as any).skillID || skill.skillIDStr}
						/>
					)}

					<div className="space-y-4">
						<h3 className="text-lg font-bold text-on-surface px-1">À suivre</h3>
						<div className="space-y-3">
							{relatedSkills.map((relSkill) => (
								<RelatedSkillItem key={relSkill.skillID} skill={relSkill} />
							))}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

/**
 * Variantes vidéo de la technique, dans l'ordre d'affichage.
 *
 * Elles viennent de `inagle_skill_videos` ; à défaut (technique non peuplée, ou
 * lecture DB indisponible) on retombe sur la vidéo principale portée par la
 * colonne scalaire `video_url`.
 */
function buildVideoVariants(skill: Skill, videos?: SkillVideoVariant[]): SkillVideoVariant[] {
	if (videos && videos.length > 0) {
		return videos;
	}
	const posterUrl = (skill as any).posterUrl as string | null | undefined;
	return skill.videoUrl
		? [{ label: "Movie", position: 0, posterUrl: posterUrl ?? null, videoUrl: skill.videoUrl }]
		: [];
}

function VideoSection({
	skill,
	name,
	imageUrl,
	variants,
	activeIndex,
	onActiveIndexChange,
}: {
	skill: Skill;
	name: string;
	imageUrl: string;
	variants: SkillVideoVariant[];
	activeIndex: number;
	onActiveIndexChange: (index: number) => void;
}) {
	const [skillImgError, setSkillImgError] = useState(false);

	if (variants.length > 0) {
		return (
			<SkillVideoPlayer
				videos={variants}
				skillName={name}
				fallbackPoster={imageUrl}
				activeIndex={activeIndex}
				onActiveIndexChange={onActiveIndexChange}
			/>
		);
	}

	return (
		<div className="w-full rounded-2xl overflow-hidden shadow-lg border border-outline-variant/20 bg-surface-container-highest aspect-video relative group">
			<div className="w-full h-full flex flex-col items-center justify-center bg-surface-container-high/50 text-on-surface-variant/50">
				{imageUrl && !skillImgError ? (
					<div className="relative w-full h-full p-12">
						<Image
							src={imageUrl}
							alt={name}
							fill
							sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
							className="object-contain filter drop-shadow-md opacity-80"
							onError={() => setSkillImgError(true)}
						/>
					</div>
				) : (
					<>
						<Icon name={getCategoryIcon(skill.category)} size={96} className="sm:hidden" />
						<Icon name={getCategoryIcon(skill.category)} size={144} className="hidden sm:block" />
					</>
				)}
			</div>
		</div>
	);
}

function MetaRow({
	skill,
	name,
	category,
	element,
	sheetData,
	activeVariant,
	variantCount,
}: {
	skill: Skill;
	name: string;
	category: string;
	element: string;
	sheetData?: CommunitySheetData;
	/** Variante actuellement affichée par le lecteur — c'est elle qu'on télécharge. */
	activeVariant?: SkillVideoVariant;
	variantCount: number;
}) {
	const elementIconUrl = getSkillIconUrl(element);
	const { skillType } = skill as any;

	return (
		<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
			<div className="flex items-center gap-3 flex-wrap">
				<div className="size-10 rounded-full bg-surface-container-highest flex items-center justify-center border border-outline-variant/10 overflow-hidden shrink-0">
					{elementIconUrl ? (
						<Image
							src={elementIconUrl}
							alt={element}
							width={24}
							height={24}
							className="object-contain"
						/>
					) : (
						<CircleDot size={18} className="text-on-surface-variant" aria-hidden="true" />
					)}
				</div>
				<div className="flex flex-col">
					<span className="text-sm font-bold text-on-surface">{category}</span>
					<span className="text-xs text-on-surface-variant">{element || "Élément inconnu"}</span>
				</div>

				{/* Skill Type Badge (main/sub) */}
				{skillType && skillType !== "main" && (
					<span className="px-2.5 py-1 rounded-full bg-secondary-container/30 text-secondary text-xs font-bold uppercase tracking-wide">
						{SKILL_TYPE_FR[skillType] || skillType}
					</span>
				)}

				{/* Sheet type/subType badges — skip if type already matches the displayed category */}
				{sheetData?.type &&
					(() => {
						const translatedType = SHEET_TYPE_FR[sheetData.type] || sheetData.type;
						const isDuplicate = translatedType.toLowerCase() === category.toLowerCase();
						// Only show if it adds new information (different type or has a subType)
						if (isDuplicate && !sheetData.subType) {
							return null;
						}
						return (
							<span className="px-2.5 py-1 rounded-full bg-tertiary-container/30 text-tertiary text-xs font-bold uppercase tracking-wide">
								{isDuplicate ? "" : translatedType}
								{sheetData.subType
									? `${isDuplicate ? "" : " "}(${SHEET_SUBTYPE_FR[sheetData.subType] || sheetData.subType})`
									: ""}
							</span>
						);
					})()}
			</div>

			<div className="flex items-center gap-2">
				{/* Tension Cost Chip */}
				{skill.consumeTp != null && (
					<div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container-highest/50 border border-outline-variant/10 text-on-surface-variant text-sm font-medium">
						<Zap size={18} aria-hidden="true" />
						{skill.consumeTp} Tension
					</div>
				)}

				{/* Client Component for Actions */}
				<SkillVideoActions
					videoUrl={activeVariant?.videoUrl ?? skill.videoUrl}
					skillName={name}
					// Le nom du fichier porte la variante quand il y en a plusieurs :
					// deux téléchargements successifs d'une même technique écrasaient
					// sinon le premier fichier.
					variantLabel={variantCount > 1 ? activeVariant?.label : undefined}
				/>
			</div>
		</div>
	);
}

function RelatedSkillItem({ skill }: { skill: Skill }) {
	const imageUrl = getSkillImageUrl(skill.skillIDStr, (skill as any).image);

	return (
		<Link
			href={`/skill/${(skill as any).internalCode || skill.skillIDStr || skill.skillID}`}
			className="flex gap-2 group p-2 rounded-xl hover:bg-surface-container-highest transition-colors"
		>
			{/* Thumbnail */}
			<div className="w-28 h-[70px] sm:w-40 sm:h-[90px] rounded-lg bg-surface-container-high border border-outline-variant/20 relative overflow-hidden shrink-0 group-hover:bg-surface-container-highest">
				{imageUrl ? (
					<SkillImage src={imageUrl} alt="" />
				) : (
					<div className="w-full h-full flex items-center justify-center">
						<Icon
							name={skill.category === 1 ? "sports_soccer" : "auto_awesome"}
							size={30}
							className="text-on-surface-variant/20"
						/>
					</div>
				)}
				{skill.videoUrl && (
					<div className="absolute bottom-1 right-1 bg-black/80 px-1.5 py-0.5 rounded text-[10px] font-bold text-white flex items-center gap-0.5 shadow-sm">
						<Play size={10} aria-hidden="true" />
						<span>Vidéo</span>
					</div>
				)}
			</div>
			{/* Info */}
			<div className="flex-1 py-1 min-w-0">
				<h4 className="font-bold text-sm text-on-surface line-clamp-2 leading-tight group-hover:text-primary transition-colors">
					{skill.name_FR || skill.displayName}
				</h4>
				<div className="mt-1 text-xs text-on-surface-variant flex flex-col gap-0.5">
					<span>
						{skill.categoryName?.fr || "Spécial"} • {skill.elementName?.fr || "Néant"}
					</span>
					<div className="flex items-center gap-2">
						<span className="bg-surface-container-high px-1.5 rounded text-[10px]">
							{skill.power_min}-{skill.power_max} Pui
						</span>
					</div>
				</div>
			</div>
		</Link>
	);
}
