import { useLanguage } from "@/components/providers/language-provider";
import { CommonSpriteIcon } from "@/components/ui/CommonSpriteIcon";
import { Icon } from "@/components/ui/Icon";
import type { SpriteCommonKey } from "@/config/sprites-common";
import { useFilterNavigation } from "@/lib/hooks/use-filter-navigation";
import { getSkillCategoryIconUrl } from "@rosegriffon/azalee/images";
import Image from "next/image";
import {
	CharacterFilters as SharedCharacterFilters,
	type CharacterFilterSection,
} from "@niers/inacord-ui/components/wiki/wiki/filters/CharacterFilters";
import { TeamFilter } from "./TeamFilter";
import type { TeamOption } from "./TeamFilter";

interface CharacterFiltersProps {
	teams?: TeamOption[];
}

export function CharacterFilters({ teams = [] }: CharacterFiltersProps) {
	const { t } = useLanguage();
	const { isPending, navigate, searchParams } = useFilterNavigation();
	const sections: CharacterFilterSection[] = [
		{
			id: "element",
			title: t("wiki.filters.element"),
			hideLabel: true,
			options: [
				{ commonSprite: "fire", label: t("wiki.elements.fire"), value: "Fire" },
				{ commonSprite: "wind", label: t("wiki.elements.wind"), value: "Wind" },
				{ commonSprite: "forest", label: t("wiki.elements.forest"), value: "Forest" },
				{ commonSprite: "mountain", label: t("wiki.elements.mountain"), value: "Mountain" },
			],
		},
		{
			id: "position",
			title: t("wiki.filters.position"),
			hideLabel: true,
			options: [
				{ imageIcon: getSkillCategoryIconUrl("gardien"), label: t("wiki.positions.gk"), value: "GK" },
				{ imageIcon: getSkillCategoryIconUrl("defense"), label: t("wiki.positions.df"), value: "DF" },
				{ imageIcon: getSkillCategoryIconUrl("dribble"), label: t("wiki.positions.mf"), value: "MF" },
				{ imageIcon: getSkillCategoryIconUrl("tir"), label: t("wiki.positions.fw"), value: "FW" },
			],
		},
		{
			id: "gender",
			title: t("wiki.filters.gender"),
			hideLabel: true,
			options: [
				{ commonSprite: "boy", label: t("wiki.genders.male"), value: "1" },
				{ commonSprite: "girl", label: t("wiki.genders.female"), value: "2" },
			],
		},
		{
			id: "playstyle",
			title: t("wiki.filters.playstyle"),
			hideLabel: true,
			options: [
				{ commonSprite: "justice", label: "Justice", value: "Justice" },
				{ commonSprite: "lien", label: t("wiki.playstyles.bond"), value: "Bond" },
				{ commonSprite: "contre", label: t("wiki.playstyles.counter"), value: "Counter" },
				{ commonSprite: "breche", label: t("wiki.playstyles.breach"), value: "Breach" },
				{ commonSprite: "jeu_violent", label: t("wiki.playstyles.rough_play"), value: "Rough Play" },
				{ commonSprite: "tension", label: "Tension", value: "Tension" },
			],
		},
		{
			id: "ageGroup",
			title: t("wiki.filters.age_group"),
			options: [
				{ label: t("wiki.age_groups.child"), value: "Child" },
				{ label: t("wiki.age_groups.elementary"), value: "Elementary" },
				{ label: t("wiki.age_groups.middle_school"), value: "Middle School" },
				{ label: t("wiki.age_groups.high_school"), value: "High School" },
				{ label: t("wiki.age_groups.college"), value: "College" },
				{ label: t("wiki.age_groups.adult"), value: "Adult" },
				{ label: t("wiki.age_groups.elder"), value: "Elder" },
				{ label: t("wiki.age_groups.exobeing"), value: "Exobeing" },
			],
		},
		{ id: "rarity", kind: "rarity", title: t("wiki.filters.rarity") },
		{
			id: "role",
			title: "Rôle",
			options: [
				{ label: "Coordinateur", value: "Coordinator" },
				{ label: "Entraîneur", value: "Coach" },
			],
		},
		{
			id: "series",
			title: "Série",
			options: [
				{ label: "Victory Road", value: "Victory Road" },
				{ label: "Ares", value: "Ares" },
				{ label: "Orion", value: "Orion" },
				{ label: "GO", value: "Inazuma Eleven GO" },
				{ label: "Chrono Stone", value: "Chrono Stone" },
				{ label: "Galaxy", value: "Galaxy" },
				{ label: "IE3", value: "Inazuma Eleven 3" },
				{ label: "IE2", value: "Inazuma Eleven 2" },
				{ label: "IE1", value: "Inazuma Eleven" },
			],
		},
	].map((section) =>
		section.kind === "rarity"
			? section
			: {
				...section,
				renderIcon: (option, imageOnly) => {
					const icon = option as typeof option & {
						imageIcon?: string;
						commonSprite?: string;
						icon?: string;
					};
					return icon.imageIcon ? (
						<div className={imageOnly ? "relative size-10" : "relative size-6"}>
							<Image src={icon.imageIcon} fill alt={option.label} sizes={imageOnly ? "40px" : "24px"} className="object-contain" />
						</div>
					) : icon.commonSprite ? (
						<CommonSpriteIcon name={icon.commonSprite as SpriteCommonKey} scale={imageOnly ? 0.6 : 0.4} />
					) : icon.icon ? (
						<Icon name={icon.icon} size={imageOnly ? 28 : 20} />
					) : null;
				},
			},
	);
	const selectedValues = Object.fromEntries(sections.map((section) => [section.id, searchParams.get(section.id)]));

	return (
		<SharedCharacterFilters
			sections={sections}
			selectedValues={selectedValues}
			isPending={isPending}
			onToggle={(filter, value) => {
				navigate((params) => {
					if (params.get(filter) === value) params.delete(filter);
					else params.set(filter, value);
				});
			}}
			teamControl={teams.length > 0 ? <><h4 className="text-xs font-bold uppercase tracking-wider text-primary">{t("wiki.filters.team")}</h4><TeamFilter teams={teams} /></> : undefined}
		/>
	);
}
