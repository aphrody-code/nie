import { useLanguage } from "@/components/providers/language-provider";
import { getSkillCategoryIconUrl } from "@rosegriffon/azalee/images";
import { FilterChips } from "../FilterChips";
import { RarityFilterChips } from "./RarityFilterChips";
import { TeamFilter } from "./TeamFilter";
import type { TeamOption } from "./TeamFilter";

interface CharacterFiltersProps {
	teams?: TeamOption[];
}

export function CharacterFilters({ teams = [] }: CharacterFiltersProps) {
	const { t } = useLanguage();

	return (
		<div className="flex flex-col gap-4 pb-6 px-1">
			{/* Element */}
			<section className="space-y-2">
				<h4 className="text-xs font-bold text-primary uppercase tracking-wider">
					{t("wiki.filters.element")}
				</h4>
				<FilterChips
					paramName="element"
					className="flex flex-wrap gap-1.5"
					hideLabel
					options={[
						{ commonSprite: "fire", label: t("wiki.elements.fire"), value: "Fire" },
						{ commonSprite: "wind", label: t("wiki.elements.wind"), value: "Wind" },
						{ commonSprite: "forest", label: t("wiki.elements.forest"), value: "Forest" },
						{ commonSprite: "mountain", label: t("wiki.elements.mountain"), value: "Mountain" },
					]}
				/>
			</section>

			<hr className="border-outline-variant/20" />

			{/* Position */}
			<section className="space-y-2">
				<h4 className="text-xs font-bold text-primary uppercase tracking-wider">
					{t("wiki.filters.position")}
				</h4>
				<FilterChips
					paramName="position"
					className="flex flex-wrap gap-1.5"
					hideLabel
					options={[
						{
							imageIcon: getSkillCategoryIconUrl("gardien"),
							label: t("wiki.positions.gk"),
							value: "GK",
						},
						{
							imageIcon: getSkillCategoryIconUrl("defense"),
							label: t("wiki.positions.df"),
							value: "DF",
						},
						{
							imageIcon: getSkillCategoryIconUrl("dribble"),
							label: t("wiki.positions.mf"),
							value: "MF",
						},
						{
							imageIcon: getSkillCategoryIconUrl("tir"),
							label: t("wiki.positions.fw"),
							value: "FW",
						},
					]}
				/>
			</section>

			<hr className="border-outline-variant/20" />

			{/* Gender */}
			<section className="space-y-2">
				<h4 className="text-xs font-bold text-primary uppercase tracking-wider">
					{t("wiki.filters.gender")}
				</h4>
				<FilterChips
					paramName="gender"
					className="flex flex-wrap gap-1.5"
					hideLabel
					options={[
						{ commonSprite: "boy", label: t("wiki.genders.male"), value: "1" },
						{ commonSprite: "girl", label: t("wiki.genders.female"), value: "2" },
					]}
				/>
			</section>

			<hr className="border-outline-variant/20" />

			{/* Playstyle */}
			<section className="space-y-2">
				<h4 className="text-xs font-bold text-primary uppercase tracking-wider">
					{t("wiki.filters.playstyle")}
				</h4>
				<FilterChips
					paramName="playstyle"
					className="flex flex-wrap gap-1.5"
					hideLabel
					options={[
						{ commonSprite: "justice", label: "Justice", value: "Justice" },
						{ commonSprite: "lien", label: t("wiki.playstyles.bond"), value: "Bond" },
						{ commonSprite: "contre", label: t("wiki.playstyles.counter"), value: "Counter" },
						{ commonSprite: "breche", label: t("wiki.playstyles.breach"), value: "Breach" },
						{
							commonSprite: "jeu_violent",
							label: t("wiki.playstyles.rough_play"),
							value: "Rough Play",
						},
						{ commonSprite: "tension", label: "Tension", value: "Tension" },
					]}
				/>
			</section>

			<hr className="border-outline-variant/20" />

			{/* Age Group — comme zukan.inazuma.jp/en/chara_list (colonne "Age Group").
			    8 valeurs réelles mesurées en base après crawl (le zukan-wide catalogue
			    en a d'autres, mais seules celles-ci apparaissent sur nos personnages). */}
			<section className="space-y-2">
				<h4 className="text-xs font-bold text-primary uppercase tracking-wider">
					{t("wiki.filters.age_group")}
				</h4>
				<FilterChips
					paramName="ageGroup"
					className="flex flex-wrap gap-1.5"
					options={[
						{ label: t("wiki.age_groups.child"), value: "Child" },
						{ label: t("wiki.age_groups.elementary"), value: "Elementary" },
						{ label: t("wiki.age_groups.middle_school"), value: "Middle School" },
						{ label: t("wiki.age_groups.high_school"), value: "High School" },
						{ label: t("wiki.age_groups.college"), value: "College" },
						{ label: t("wiki.age_groups.adult"), value: "Adult" },
						{ label: t("wiki.age_groups.elder"), value: "Elder" },
						{ label: t("wiki.age_groups.exobeing"), value: "Exobeing" },
					]}
				/>
			</section>

			<hr className="border-outline-variant/20" />

			{/* Rarity */}
			<section className="space-y-2">
				<h4 className="text-xs font-bold text-primary uppercase tracking-wider">
					{t("wiki.filters.rarity")}
				</h4>
				<RarityFilterChips />
			</section>

			<hr className="border-outline-variant/20" />

			{/* Role */}
			<section className="space-y-2">
				<h4 className="text-xs font-bold text-primary uppercase tracking-wider">Rôle</h4>
				<FilterChips
					paramName="role"
					className="flex flex-wrap gap-1.5"
					options={[
						{ label: "Coordinateur", value: "Coordinator" },
						{ label: "Entraîneur", value: "Coach" },
					]}
				/>
			</section>

			<hr className="border-outline-variant/20" />

			{/* Series */}
			<section className="space-y-2">
				<h4 className="text-xs font-bold text-primary uppercase tracking-wider">Série</h4>
				<FilterChips
					paramName="series"
					className="flex flex-wrap gap-1.5"
					options={[
						{ label: "Victory Road", value: "Victory Road" },
						{ label: "Ares", value: "Ares" },
						{ label: "Orion", value: "Orion" },
						{ label: "GO", value: "Inazuma Eleven GO" },
						{ label: "Chrono Stone", value: "Chrono Stone" },
						{ label: "Galaxy", value: "Galaxy" },
						{ label: "IE3", value: "Inazuma Eleven 3" },
						{ label: "IE2", value: "Inazuma Eleven 2" },
						{ label: "IE1", value: "Inazuma Eleven" },
					]}
				/>
			</section>

			{teams.length > 0 && (
				<>
					<hr className="border-outline-variant/20" />
					{/* Team Filter */}
					<section className="space-y-2">
						<h4 className="text-xs font-bold text-primary uppercase tracking-wider">
							{t("wiki.filters.team")}
						</h4>
						<TeamFilter teams={teams} />
					</section>
				</>
			)}
		</div>
	);
}
