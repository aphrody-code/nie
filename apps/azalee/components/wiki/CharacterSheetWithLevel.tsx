"use client";

import { useLanguage } from "@/components/providers/language-provider";
import { formatDescription } from "@rosegriffon/azalee/text/format-description";
import { CharacterSheet } from "./CharacterSheet";
import type { CharacterSheetStats, SheetData } from "./CharacterSheet";
import type { MovesetSkill } from "./MovesetList";

interface CharacterSheetWithLevelProps {
	name: string;
	names?: { fr?: string; en?: string; ja?: string };
	nickname?: string;
	description?: string;
	descriptions?: { fr?: string; en?: string; ja?: string };
	position: "ATT" | "MIL" | "DEF" | "GAR" | "FW" | "MF" | "DF" | "GK";
	jerseyNumber?: number;
	rarity: string;
	element: string;
	series?: string;
	stats: CharacterSheetStats;
	skills?: MovesetSkill[];
	altSkills?: MovesetSkill[];
	avatarUrl?: string;
	zukanHash?: string;
	teamName?: string;
	teamId?: string;
	gender?: string;
	className?: string;
	prevCharacterId?: string;
	nextCharacterId?: string;
	sheetData?: SheetData;
	constellation?: { index: number; names: { fr?: string; en?: string; ja?: string } };
	heroConstellations?: Array<{ name: string; index: number }>;
	forms?: Array<{
		id: string;
		slug: string;
		position: string;
		element: string;
		rarity: string;
		zukanHash?: string;
		internalCode?: string;
		heroType?: string;
	}>;
	currentFormId?: string;
	slug?: string;
	basaraFormSlug?: string;
	normalFormSlug?: string;
	heroForms?: Array<{ type: string; slug: string }>;
	currentHeroType?: string;
	isControllable?: boolean;
	statsLv1?: CharacterSheetStats;
	statsLv30?: CharacterSheetStats;
	statsLv50?: CharacterSheetStats;
}

/**
 * Character sheet with navigation arrows
 */
export function CharacterSheetWithLevel({
	name,
	names,
	nickname,
	description,
	descriptions,
	position,
	jerseyNumber,
	rarity,
	element,
	series,
	stats,
	skills,
	altSkills,
	avatarUrl,
	zukanHash,
	teamName,
	teamId,
	gender,
	className,
	prevCharacterId,
	nextCharacterId,
	sheetData,
	constellation,
	heroConstellations,
	forms,
	currentFormId,
	slug,
	basaraFormSlug,
	normalFormSlug,
	heroForms,
	currentHeroType,
	isControllable,
	statsLv1,
	statsLv30,
	statsLv50,
}: CharacterSheetWithLevelProps) {
	const { getLocalized, language } = useLanguage();

	const displayName = names
		? getLocalized({ name_EN: names.en, name_FR: names.fr, name_JA: names.ja }, "name")
		: name;

	const rawDesc = descriptions
		? getLocalized(
				{ desc_EN: descriptions.en, desc_FR: descriptions.fr, desc_JA: descriptions.ja },
				"desc"
			)
		: description;

	const displayDesc = formatDescription(rawDesc, language);

	return (
		<div className={className}>
			<CharacterSheet
				name={displayName}
				nickname={nickname}
				description={displayDesc}
				position={position}
				jerseyNumber={jerseyNumber}
				rarity={rarity}
				element={element}
				series={series}
				stats={stats}
				skills={skills}
				altSkills={altSkills}
				avatarUrl={avatarUrl}
				zukanHash={zukanHash}
				teamName={teamName}
				teamId={teamId}
				gender={gender}
				prevCharacterHref={prevCharacterId ? `/chara/${prevCharacterId}` : undefined}
				nextCharacterHref={nextCharacterId ? `/chara/${nextCharacterId}` : undefined}
				sheetData={sheetData}
				constellation={constellation}
				heroConstellations={heroConstellations}
				forms={forms}
				currentFormId={currentFormId}
				slug={slug}
				basaraFormSlug={basaraFormSlug}
				normalFormSlug={normalFormSlug}
				heroForms={heroForms}
				currentHeroType={currentHeroType}
				isControllable={isControllable}
				statsLv1={statsLv1}
				statsLv30={statsLv30}
				statsLv50={statsLv50}
			/>
		</div>
	);
}
