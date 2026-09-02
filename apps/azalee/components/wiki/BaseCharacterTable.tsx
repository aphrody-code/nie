"use client";

import type { BaseCharacter } from "@rosegriffon/inagle";
import { CircleDot, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useLanguage } from "@/components/providers/language-provider";
import { CommonSpriteIcon } from "@/components/ui/CommonSpriteIcon";
import { RarityBadge } from "@/components/ui/rarity-badge";
import { SafeImage } from "@/components/ui/SafeImage";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@rosegriffon/ui";
import type { SpriteCommonKey } from "@/config/sprites-common";
import { isFemaleGender } from "@rosegriffon/azalee/game/gender";
import { getCharacterImageUrl, getSkillCategoryIconUrl } from "@rosegriffon/azalee/images";
import { cn } from "@/lib/utils";
import { CharacterStatsPopover } from "./CharacterStatsPopover";

const ELEMENT_SPRITE_MAP: Record<string, SpriteCommonKey> = {
	Feu: "fire",
	Fire: "fire",
	Forest: "forest",
	Forêt: "forest",
	Montagne: "mountain",
	Mountain: "mountain",
	Vent: "wind",
	Wind: "wind",
};

const PLAYSTYLE_SPRITE: Record<string, SpriteCommonKey> = {
	Bond: "lien",
	Breach: "breche",
	Counter: "contre",
	Freedom: "breche",
	Justice: "justice",
	"Rough Play": "jeu_violent",
	Tension: "tension",
};

const PLAYSTYLE_LABEL: Record<string, string> = {
	Bond: "Lien",
	Breach: "Brèche",
	Counter: "Contre",
	Freedom: "Brèche",
	Justice: "Justice",
	"Rough Play": "Jeu violent",
	Tension: "Tension",
};

interface BaseCharacterTableProps {
	characters: BaseCharacter[];
	startIndex?: number;
}

/**
 * Row component for a single base character with variant switching
 */
function BaseCharacterRow({ character, rowIndex }: { character: BaseCharacter; rowIndex: number }) {
	const { t, language } = useLanguage();
	const variants = character.variants || [];
	const activeVariant = variants[0];

	if (!activeVariant) {
		return null;
	}

	const name =
		(language === "ja"
			? character.names.ja
			: language === "en"
				? character.names.en
				: character.names.fr) ||
		character.names.fr ||
		character.names.en ||
		character.names.ja ||
		"";
	const nameSub = language === "ja" ? character.names.fr : character.names.ja;

	// Element Helper
	const getElementName = (el: string) => {
		switch (el) {
			case "Fire":
			case "Feu": {
				return t("wiki.elements.fire");
			}
			case "Wind":
			case "Vent": {
				return t("wiki.elements.wind");
			}
			case "Forest":
			case "Forêt": {
				return t("wiki.elements.forest");
			}
			case "Mountain":
			case "Montagne": {
				return t("wiki.elements.mountain");
			}
			default: {
				return el;
			}
		}
	};

	const elementFr = getElementName(activeVariant.element);
	const elementSprite = ELEMENT_SPRITE_MAP[activeVariant.element];

	// Position Helper
	const getPositionName = (pos: string) => {
		switch (pos) {
			case "Coach": {
				return t("wiki.positions.coach");
			}
			case "GK": {
				return t("wiki.positions.gk_long");
			}
			case "DF": {
				return t("wiki.positions.df_long");
			}
			case "MF": {
				return t("wiki.positions.mf_long");
			}
			case "FW": {
				return t("wiki.positions.fw_long");
			}
			default: {
				return pos;
			}
		}
	};

	const positionCategoryMap: Record<string, string> = {
		DF: "defense",
		FW: "tir",
		GK: "gardien",
		MF: "dribble",
	};
	const positionImage = positionCategoryMap[activeVariant.position]
		? getSkillCategoryIconUrl(positionCategoryMap[activeVariant.position])
		: null;
	const positionFr = getPositionName(activeVariant.position);

	const subPositionImage =
		activeVariant.subPosition &&
		activeVariant.subPosition !== "Coach" &&
		positionCategoryMap[activeVariant.subPosition]
			? getSkillCategoryIconUrl(positionCategoryMap[activeVariant.subPosition])
			: null;

	// Rarity
	const getRarityName = (r: string) => {
		switch (r) {
			case "N": {
				return t("wiki.rarities.normal");
			}
			case "R": {
				return t("wiki.rarities.rare");
			}
			case "SR": {
				return t("wiki.rarities.super_rare");
			}
			case "SSR": {
				return t("wiki.rarities.super_super_rare");
			}
			case "UR": {
				return t("wiki.rarities.ultra_rare");
			}
			case "Légendaire": {
				return t("wiki.rarities.normal");
			}
			case "BASARA": {
				return "BASARA";
			}
			default: {
				return r;
			}
		}
	};

	const rarity = activeVariant.rarity || character.bestRarity || "N";
	const _rarityLabel = getRarityName(rarity);

	const charAny = character as any;
	const variantAny = activeVariant as any;
	const playstyle = (variantAny.sheetData?.playstyle || charAny.sheetData?.playstyle) as
		| string
		| undefined;
	const playstyleSprite = playstyle ? PLAYSTYLE_SPRITE[playstyle] : undefined;
	const playstyleLabel = playstyle ? PLAYSTYLE_LABEL[playstyle] || playstyle : null;

	const isFemale = isFemaleGender(character.gender);
	const genderName = isFemale ? t("common.female") : t("common.male");

	// Robust image selection: Zukan Mirror > Local Asset
	const imageUrl = character.zukanHash
		? `https://dxi4wb638ujep.cloudfront.net/1/${character.zukanHash}.png`
		: getCharacterImageUrl(character.internalCode);

	return (
		<TableRow className="border-outline-variant/50 hover:bg-surface-container-high/50 transition-colors">
			{/* N° */}
			<TableCell className="text-center font-mono text-on-surface-variant hidden sm:table-cell">
				{rowIndex + 1}
			</TableCell>

			{/* Nom avec image */}
			<TableCell>
				<Link
					href={`/chara/${(character as any).baseSlug || character.slug || activeVariant.charaParamId}`}
					className="flex items-center gap-3 group"
				>
					<div className="relative size-12 rounded-lg overflow-hidden bg-surface-container-highest shrink-0 ring-1 ring-outline-variant/30">
						<SafeImage
							src={imageUrl}
							zukanHash={character.zukanHash}
							fallbackSrc={getCharacterImageUrl(character.internalCode)}
							alt={name}
							fill
							className="object-cover object-top group-hover:scale-110 transition-transform"
							sizes="48px"
							unoptimized
						/>
					</div>
					<div className="flex flex-col">
						<div className="flex items-center gap-1.5">
							<span className="font-bold text-on-surface group-hover:text-primary transition-colors text-dynamic font-grade-high">
								{name}
							</span>
							{character.isBasara && (
								<div
									className="flex items-center justify-center size-4 rounded-full bg-linear-to-br from-[#4facfe] via-[#7367f0] to-[#9733ee] shadow-sm animate-pulse"
									title="Personnage BASARA"
								>
									<Sparkles size={10} aria-hidden="true" className="text-white scale-90" />
								</div>
							)}
							{!character.isBasara && character.bestRarityCode >= 10 && (
								<span
									className="px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-linear-to-r from-amber-500 to-orange-500 text-white leading-none"
									title="Héros"
								>
									H
								</span>
							)}
							{variants.length > 1 && (
								<span
									className="bg-surface-container-highest text-on-surface text-[10px] font-bold rounded-full size-5 flex items-center justify-center shrink-0"
									title={`${variants.length} versions`}
								>
									{variants.length}
								</span>
							)}
						</div>
						{nameSub && nameSub !== name && (
							<span className="text-[10px] text-on-surface-variant/70 font-normal leading-tight font-grade-low">
								{nameSub}
							</span>
						)}
					</div>
				</Link>
			</TableCell>

			{/* Constellation */}
			<TableCell className="text-center hidden md:table-cell">
				{charAny.constellation ? (
					<span
						className="text-xs text-on-surface-variant"
						title={charAny.constellation.names?.fr || charAny.constellation}
					>
						{typeof charAny.constellation === "string"
							? charAny.constellation
							: charAny.constellation.names?.fr || "—"}
					</span>
				) : (
					<span className="text-on-surface-variant/40 text-xs">—</span>
				)}
			</TableCell>

			{/* Genre */}
			<TableCell className="text-center hidden lg:table-cell">
				<div className="flex justify-center" title={genderName}>
					<CommonSpriteIcon name={isFemale ? "girl" : "boy"} scale={0.35} />
				</div>
			</TableCell>

			{/* Élément avec icône */}
			<TableCell className="text-center">
				<div className="inline-flex items-center gap-1.5" title={elementFr}>
					{elementSprite ? (
						<CommonSpriteIcon name={elementSprite} scale={0.35} />
					) : (
						<CircleDot size={20} aria-hidden="true" className="text-on-surface-variant" />
					)}
					<span className="text-xs text-on-surface-variant hidden sm:inline">{elementFr}</span>
				</div>
			</TableCell>

			{/* Poste avec image */}
			<TableCell className="text-center">
				<div className="flex flex-col items-center gap-1">
					{positionImage ? (
						<div className="relative size-6" title={positionFr}>
							<Image
								src={positionImage}
								alt={positionFr}
								fill
								sizes="24px"
								className="object-contain"
							/>
						</div>
					) : (
						<span
							className={cn(
								"inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
								activeVariant.position === "Coach"
									? "bg-amber-100 text-amber-700"
									: "bg-gray-100 text-gray-600"
							)}
						>
							{positionFr}
						</span>
					)}

					{subPositionImage && (
						<div className="relative size-4 opacity-70" title={activeVariant.subPosition || ""}>
							<Image
								src={subPositionImage}
								alt={activeVariant.subPosition || ""}
								fill
								className="object-contain"
							/>
						</div>
					)}
				</div>
			</TableCell>

			{/* Rareté */}
			<TableCell className="text-center">
				<div className="flex justify-center">
					<RarityBadge rarity={rarity} size="xs" />
				</div>
			</TableCell>

			{/* Style de jeu */}
			<TableCell className="text-center hidden md:table-cell">
				{playstyleSprite ? (
					<div className="inline-flex items-center gap-1.5" title={playstyleLabel || ""}>
						<CommonSpriteIcon name={playstyleSprite} scale={0.3} />
						<span className="text-xs text-on-surface-variant">{playstyleLabel}</span>
					</div>
				) : (
					<span className="text-on-surface-variant/40 text-xs">—</span>
				)}
			</TableCell>

			{/* Stats */}
			<TableCell className="text-center p-0 hidden sm:table-cell">
				<div className="flex items-center justify-center gap-2 pr-2">
					{activeVariant.stats?.lv99 && (
						<CharacterStatsPopover stats={activeVariant.stats.lv99} name={name} />
					)}
				</div>
			</TableCell>
		</TableRow>
	);
}

/**
 * Card component for displaying character info on mobile viewports
 */
function BaseCharacterCard({ character, rowIndex }: { character: BaseCharacter; rowIndex: number }) {
	const { t, language } = useLanguage();
	const variants = character.variants || [];
	const activeVariant = variants[0];

	if (!activeVariant) {
		return null;
	}

	const name =
		(language === "ja"
			? character.names.ja
			: language === "en"
				? character.names.en
				: character.names.fr) ||
		character.names.fr ||
		character.names.en ||
		character.names.ja ||
		"";
	const nameSub = language === "ja" ? character.names.fr : character.names.ja;

	const getElementName = (el: string) => {
		switch (el) {
			case "Fire":
			case "Feu": {
				return t("wiki.elements.fire");
			}
			case "Wind":
			case "Vent": {
				return t("wiki.elements.wind");
			}
			case "Forest":
			case "Forêt": {
				return t("wiki.elements.forest");
			}
			case "Mountain":
			case "Montagne": {
				return t("wiki.elements.mountain");
			}
			default: {
				return el;
			}
		}
	};

	const elementFr = getElementName(activeVariant.element);
	const elementSprite = ELEMENT_SPRITE_MAP[activeVariant.element];

	const getPositionName = (pos: string) => {
		switch (pos) {
			case "Coach": {
				return t("wiki.positions.coach");
			}
			case "GK": {
				return t("wiki.positions.gk_long");
			}
			case "DF": {
				return t("wiki.positions.df_long");
			}
			case "MF": {
				return t("wiki.positions.mf_long");
			}
			case "FW": {
				return t("wiki.positions.fw_long");
			}
			default: {
				return pos;
			}
		}
	};

	const positionCategoryMap: Record<string, string> = {
		DF: "defense",
		FW: "tir",
		GK: "gardien",
		MF: "dribble",
	};
	const positionImage = positionCategoryMap[activeVariant.position]
		? getSkillCategoryIconUrl(positionCategoryMap[activeVariant.position])
		: null;
	const positionFr = getPositionName(activeVariant.position);


	const rarity = activeVariant.rarity || character.bestRarity || "N";

	const charAny = character as any;
	const variantAny = activeVariant as any;
	const playstyle = (variantAny.sheetData?.playstyle || charAny.sheetData?.playstyle) as
		| string
		| undefined;
	const playstyleSprite = playstyle ? PLAYSTYLE_SPRITE[playstyle] : undefined;
	const playstyleLabel = playstyle ? PLAYSTYLE_LABEL[playstyle] || playstyle : null;

	const isFemale = isFemaleGender(character.gender);
	const genderName = isFemale ? t("common.female") : t("common.male");

	const imageUrl = character.zukanHash
		? `https://dxi4wb638ujep.cloudfront.net/1/${character.zukanHash}.png`
		: getCharacterImageUrl(character.internalCode);

	return (
		<div className="relative rounded-2xl border border-outline-variant/40 bg-surface-container-low p-4 flex flex-col gap-3 hover:bg-surface-container-high/60 transition-all duration-300 shadow-sm group">
			{/* Top Bar: Number + Rarity + Stats */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-1.5">
					<span className="font-mono text-xs text-on-surface-variant/60">
						N°{rowIndex + 1}
					</span>
					<RarityBadge rarity={rarity} size="xs" />
				</div>
				<div className="flex items-center gap-2">
					<div title={genderName} className="opacity-80">
						<CommonSpriteIcon name={isFemale ? "girl" : "boy"} scale={0.3} />
					</div>
					{activeVariant.stats?.lv99 && (
						<CharacterStatsPopover stats={activeVariant.stats.lv99} name={name} />
					)}
				</div>
			</div>

			{/* Main character info (Portrait + Name/Element/Position) */}
			<div className="flex gap-3 items-start">
				<Link
					href={`/chara/${(character as any).baseSlug || character.slug || activeVariant.charaParamId}`}
					className="relative size-16 rounded-xl overflow-hidden bg-surface-container-highest shrink-0 ring-1 ring-outline-variant/30"
				>
					<SafeImage
						src={imageUrl}
						zukanHash={character.zukanHash}
						fallbackSrc={getCharacterImageUrl(character.internalCode)}
						alt={name}
						fill
						className="object-cover object-top group-hover:scale-110 transition-transform duration-300"
						sizes="64px"
						unoptimized
					/>
				</Link>

				<div className="flex flex-col min-w-0 flex-1">
					<Link
						href={`/chara/${(character as any).baseSlug || character.slug || activeVariant.charaParamId}`}
						className="flex flex-wrap items-center gap-1.5"
					>
						<span className="font-black text-on-surface group-hover:text-primary transition-colors text-sm sm:text-base leading-tight font-grade-high truncate">
							{name}
						</span>
						{character.isBasara && (
							<div className="flex items-center justify-center size-3.5 rounded-full bg-linear-to-br from-[#4facfe] via-[#7367f0] to-[#9733ee] animate-pulse">
								<Sparkles size={8} className="text-white" />
							</div>
						)}
						{!character.isBasara && character.bestRarityCode >= 10 && (
							<span className="px-1 py-0.5 text-[8px] font-black rounded bg-linear-to-r from-amber-500 to-orange-500 text-white leading-none">
								H
							</span>
						)}
						{variants.length > 1 && (
							<span className="bg-surface-container-highest text-on-surface text-[9px] font-black rounded-full size-4 flex items-center justify-center shrink-0">
								{variants.length}
							</span>
						)}
					</Link>
					{nameSub && nameSub !== name && (
						<span className="text-[10px] text-on-surface-variant/60 leading-normal truncate">
							{nameSub}
						</span>
					)}

					{/* Badges Row (Element + Position) */}
					<div className="flex items-center gap-2 mt-2">
						{/* Element */}
						<div className="inline-flex items-center gap-1 bg-surface-container/60 px-2 py-0.5 rounded-md text-[10px] font-medium text-on-surface-variant">
							{elementSprite && (
								<CommonSpriteIcon name={elementSprite} scale={0.25} />
							)}
							<span>{elementFr}</span>
						</div>

						{/* Position */}
						<div className="inline-flex items-center gap-1 bg-surface-container/60 px-2 py-0.5 rounded-md text-[10px] font-medium text-on-surface-variant">
							{positionImage ? (
								<div className="relative size-3.5">
									<Image
										src={positionImage}
										alt={positionFr}
										fill
										sizes="14px"
										className="object-contain"
									/>
								</div>
							) : (
								<span className="text-[9px]">{positionFr}</span>
							)}
							<span>{positionFr}</span>
						</div>
					</div>
				</div>
			</div>

			{/* Bottom Row: Constellation & Playstyle */}
			<div className="flex items-center justify-between border-t border-outline-variant/35 pt-2 mt-1 text-[11px] text-on-surface-variant">
				{/* Constellation */}
				<div className="flex items-center gap-1">
					<span className="opacity-60 text-[10px] uppercase font-bold">Const :</span>
					<span className="font-medium">
						{charAny.constellation ? (
							typeof charAny.constellation === "string"
								? charAny.constellation
								: charAny.constellation.names?.fr || "—"
						) : (
							"—"
						)}
					</span>
				</div>

				{/* Playstyle */}
				{playstyleSprite ? (
					<div className="inline-flex items-center gap-1 bg-surface-container-high/40 px-2.5 py-0.5 rounded-md">
						<CommonSpriteIcon name={playstyleSprite} scale={0.25} />
						<span className="font-bold text-[10px]">{playstyleLabel}</span>
					</div>
				) : (
					<span className="text-on-surface-variant/40">—</span>
				)}
			</div>
		</div>
	);
}

/**
 * Table component that displays base characters with variant switching
 * Each row represents one unique character with all their variants accessible
 */
export function BaseCharacterTable({ characters, startIndex = 0 }: BaseCharacterTableProps) {
	const { t } = useLanguage();

	return (
		<div className="space-y-4">
			{/* Mobile/Tablet Card Grid */}
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:hidden">
				{characters.map((character, idx) => (
					<BaseCharacterCard
						key={character.charaId}
						character={character}
						rowIndex={startIndex + idx}
					/>
				))}
			</div>

			{/* Desktop Table View */}
			<div className="hidden md:block rounded-lg border border-outline-variant overflow-hidden bg-surface-container-low">
				<Table>
					<TableHeader>
						<TableRow className="bg-surface-container hover:bg-surface-container border-outline-variant">
							<TableHead className="w-12 text-center text-on-surface-variant hidden sm:table-cell">
								{t("wiki.table.headers.number")}
							</TableHead>
							<TableHead className="min-w-[160px] sm:min-w-[200px] text-on-surface-variant">
								{t("wiki.table.headers.name")}
							</TableHead>
							<TableHead className="w-28 text-center text-on-surface-variant hidden md:table-cell">
								Constellation
							</TableHead>
							<TableHead className="w-16 text-center text-on-surface-variant hidden lg:table-cell">
								{t("wiki.table.headers.gender")}
							</TableHead>
							<TableHead className="w-24 text-center text-on-surface-variant">
								{t("wiki.table.headers.element")}
							</TableHead>
							<TableHead className="w-16 text-center text-on-surface-variant">
								{t("wiki.table.headers.position")}
							</TableHead>
							<TableHead className="w-20 text-center text-on-surface-variant">
								{t("wiki.table.headers.rarity")}
							</TableHead>
							<TableHead className="w-32 text-center text-on-surface-variant hidden md:table-cell">
								{t("wiki.filters.playstyle")}
							</TableHead>
							<TableHead
								className="w-12 text-center text-on-surface-variant hidden sm:table-cell"
								title={t("wiki.table.headers.stats")}
							>
								{t("wiki.table.headers.stats")}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{characters.map((character, idx) => (
							<BaseCharacterRow
								key={character.charaId}
								character={character}
								rowIndex={startIndex + idx}
							/>
						))}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}
