"use client";

import type { MultiLevelStats } from "@rosegriffon/inagle";
import { CircleDot } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { SafeImage } from "@/components/ui/SafeImage";
import { useLanguage } from "@/components/providers/language-provider";
import { CommonSpriteIcon } from "@/components/ui/CommonSpriteIcon";
import { RarityBadge } from "@/components/ui/rarity-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@rosegriffon/ui";
import type { SpriteCommonKey } from "@/config/sprites-common";
import { formatDescription } from "@rosegriffon/azalee/text/format-description";
import { isFemaleGender } from "@rosegriffon/azalee/game/gender";
import type { GenderValue } from "@rosegriffon/azalee/game/gender";
import {
	getCharacterImageUrl,
	getCharacterModelFullGlbUrl,
	getEmblemImageUrl,
	getSkillCategoryIconUrl,
} from "@rosegriffon/azalee/images";
import { TEAM_EMBLEM_MAP } from "@rosegriffon/azalee/game/team-emblem-map";
import { cn } from "@/lib/utils";
import CharacterModelViewer from "./CharacterModelViewer";
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

export interface CharacterTableData {
	index: number;
	charaParamId: string;
	internalCode?: string;
	names: {
		fr?: string;
		en?: string;
		ja?: string;
	};
	position: "Coach" | "GK" | "FW" | "MF" | "DF";
	subPosition?: "Coach" | "GK" | "FW" | "MF" | "DF";
	element: string;
	rarity: string;
	gender: GenderValue;
	descriptions?: {
		fr?: string;
		en?: string;
	};
	teams?: Array<{
		id: string;
		names: { fr?: string; en?: string; ja?: string };
		seasons: string[];
	}>;
	series?: string;
	stats?: MultiLevelStats;
	zukanHash?: string;
	slug?: string;
}

interface CharacterTableProps {
	characters: CharacterTableData[];
	startIndex?: number;
}

export function CharacterTable({ characters, startIndex = 0 }: CharacterTableProps) {
	const { t, language } = useLanguage();

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

	const getElementName = (el: string) => {
		// Map DB/API values to translation keys
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
			case "Void":
			case "Néant": {
				return "Néant";
			} // Optional
			default: {
				return el;
			}
		}
	};

	return (
		<div className="rounded-lg border border-outline-variant overflow-hidden bg-surface-container-low">
			<Table>
				<TableHeader>
					<TableRow className="bg-surface-container hover:bg-surface-container border-outline-variant">
						<TableHead className="w-12 text-center text-on-surface-variant">
							{t("wiki.table.headers.number")}
						</TableHead>
						<TableHead className="min-w-[200px] text-on-surface-variant">
							{t("wiki.table.headers.name")}
						</TableHead>
						<TableHead className="w-20 text-center text-on-surface-variant">
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
						<TableHead
							className="w-12 text-center text-on-surface-variant"
							title={t("wiki.table.headers.stats")}
						>
							{t("wiki.table.headers.stats")}
						</TableHead>
						<TableHead className="hidden lg:table-cell text-on-surface-variant">
							{t("wiki.table.headers.team")}
						</TableHead>
						<TableHead className="hidden xl:table-cell max-w-[300px] text-on-surface-variant">
							{t("wiki.table.headers.description")}
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{characters.map((character, idx) => {
						// Fallback to variants[0] for fields that may be nested in BaseCharacter
						const charAny = character as Record<string, any>;
						const activeData = charAny.variants?.[0] || character;
						const position = character.position || activeData.position || "MF";
						const element = character.element || activeData.element || "Void";
						const rarity = character.rarity || activeData.rarity || "N";
						const stats = character.stats || activeData.stats;
						// Modèle 3D GLB complet (corps+face+uniforme, nie-model-serve /model-full/).
						const modelGlbUrl = getCharacterModelFullGlbUrl(
							character.internalCode || (activeData as Record<string, any>).internalCode
						);

						// Localization logic for name/description
						const name =
							(language === "ja"
								? character.names.ja
								: language === "en"
									? character.names.en
									: character.names.fr) ||
							character.names.fr ||
							character.names.en ||
							character.names.ja ||
							"???";

						const nameSub = language === "ja" ? character.names.fr : character.names.ja;

						// Element
						const elementFr = getElementName(element);
						const elementSprite = ELEMENT_SPRITE_MAP[element];

						// Position
						const positionCategoryMap: Record<string, string> = {
							DF: "defense",
							FW: "tir",
							GK: "gardien",
							MF: "dribble",
						};
						const positionImage = positionCategoryMap[position]
							? getSkillCategoryIconUrl(positionCategoryMap[position])
							: null;
						const positionFr = getPositionName(position);

						const subPos = character.subPosition || activeData.subPosition;
						const subPositionImage =
							subPos && subPos !== "Coach" && positionCategoryMap[subPos]
								? getSkillCategoryIconUrl(positionCategoryMap[subPos])
								: null;

						// Rarity badge used in JSX below

						const isFemale = isFemaleGender(character.gender);
						const genderName = isFemale ? t("common.female") : t("common.male");

						const rawDescription =
							(language === "en" ? character.descriptions?.en : character.descriptions?.fr) ||
							character.descriptions?.fr ||
							"";
						const description = formatDescription(
							rawDescription,
							language === "ja" ? "fr" : (language as "fr" | "en")
						);

						const teams = character.teams || activeData.teams || [];
						const rawTeamName =
							(language === "ja"
								? teams[0]?.names?.ja
								: language === "en"
									? teams[0]?.names?.en
									: teams[0]?.names?.fr) ||
							teams[0]?.names?.fr ||
							"";
						const teamName = rawTeamName
							? formatDescription(rawTeamName, language === "ja" ? "fr" : (language as "fr" | "en"))
							: "—";

						return (
							<TableRow
								key={
									character.charaParamId ||
									(character as any).charaId ||
									(character as any).internalCode ||
									(character as any).slug ||
									idx
								}
								className="border-outline-variant/50 hover:bg-surface-container-high/50 transition-colors"
							>
								{/* N° */}
								<TableCell className="text-center font-mono text-on-surface-variant">
									{startIndex + idx + 1}
								</TableCell>

								{/* Nom avec image */}
								<TableCell>
									<Link
										href={`/chara/${(character as any).baseSlug || character.slug || character.charaParamId}`}
										className="flex items-center gap-3 group"
									>
										<div className="relative size-12 rounded-lg overflow-hidden bg-surface-container-highest shrink-0 ring-1 ring-outline-variant/30">
											<SafeImage
												src={character.zukanHash ? `https://dxi4wb638ujep.cloudfront.net/1/${character.zukanHash}.png` : getCharacterImageUrl(character.internalCode)}
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
											<span className="font-medium text-on-surface group-hover:text-primary transition-colors">
												{name}
											</span>
											{nameSub && nameSub !== name && (
												<span className="text-[10px] text-on-surface-variant/70 font-normal leading-tight">
													{nameSub}
												</span>
											)}
										</div>
									</Link>
								</TableCell>

								{/* Genre */}
								<TableCell className="text-center">
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
										<span className="text-xs text-on-surface-variant hidden sm:inline">
											{elementFr}
										</span>
									</div>
								</TableCell>

								<TableCell className="text-center">
									<div className="flex flex-col items-center gap-1">
										{positionImage ? (
											<div className="relative size-6" title={positionFr}>
												<Image
													src={positionImage}
													alt={positionFr}
													fill
													className="object-contain"
												/>
											</div>
										) : (
											<span
												className={cn(
													"inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
													position === "Coach"
														? "bg-amber-100 text-amber-700"
														: "bg-gray-100 text-gray-600"
												)}
											>
												{positionFr}
											</span>
										)}

										{subPositionImage && (
											<div className="relative size-4 opacity-70" title={subPos || ""}>
												<Image
													src={subPositionImage}
													alt={subPos || ""}
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

								{/* Stats */}
								<TableCell className="text-center p-0">
									{stats?.lv99 && <CharacterStatsPopover stats={stats.lv99} name={name} />}
									{modelGlbUrl && (
										<CharacterModelViewer glbUrl={modelGlbUrl} name={name} />
									)}
								</TableCell>

								{/* Équipe */}
								<TableCell className="hidden lg:table-cell text-on-surface-variant text-sm">
									{(() => {
										const teamId = teams[0]?.id;
										const emblemCode = teamId ? TEAM_EMBLEM_MAP[teamId] : undefined;
										const teamEmblemUrl = emblemCode ? getEmblemImageUrl(emblemCode) : null;
										return (
											<div className="flex items-center gap-2">
												{teamEmblemUrl && (
													<Image
														src={teamEmblemUrl}
														alt=""
														width={20}
														height={20}
														className="size-5 object-contain shrink-0"
														unoptimized
													/>
												)}
												<span>{teamName}</span>
											</div>
										);
									})()}
								</TableCell>

								{/* Description */}
								<TableCell className="hidden xl:table-cell max-w-[300px]">
									<p className="text-sm text-on-surface-variant line-clamp-2">
										{description || "—"}
									</p>
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</div>
	);
}
