"use client";

import { ArrowRight, Plus, Zap } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Link } from "../../../compat/next";
import { CommonSpriteIcon } from "../../ui/CommonSpriteIcon";
import type { SpriteCommonKey } from "../../../config/sprites-common";

const ELEMENT_SPRITE: Record<number, SpriteCommonKey> = {
	1: "wind",
	2: "forest",
	3: "fire",
	4: "mountain",
};

const ELEMENT_FR: Record<number, string> = {
	0: "Néant",
	1: "Vent",
	2: "Forêt",
	3: "Feu",
	4: "Montagne",
	5: "Néant",
};

const ELEMENT_ACCENT: Record<number, string> = {
	0: "border-purple-500/30",
	1: "border-teal-500/30",
	2: "border-green-500/30",
	3: "border-red-500/30",
	4: "border-amber-500/30",
	5: "border-purple-500/30",
};

export interface OverrideSkillData {
	id: string;
	name_fr: string | null;
	name_en: string | null;
	name_ja: string | null;
	element_id: number | null;
	category_id: number | null;
	power_min: number | null;
	power_max: number | null;
	conditions: Array<{
		condition_type: number;
		required_skills: Array<{
			skill_id: string;
			name_fr: string | null;
			name_en: string | null;
			num: number;
		}>;
	}>;
}

export interface OverrideSkillImage {
	src: string;
	alt: string;
	className: string;
	onError: () => void;
}

export interface OverrideSkillSectionProps {
	overrides: OverrideSkillData[];
	currentSkillId: string;
	/** The host owns asset resolution (CDN, VFS, or an offline cache). */
	resolveSkillImage: (skillId: string) => string | null | undefined;
	/** The host selects its image primitive and decoding behavior. */
	renderSkillImage: (image: OverrideSkillImage) => ReactNode;
	/** The host may map a skill id to a route or an in-process screen state. */
	skillHref?: (skillId: string) => string;
}

function SkillThumb({
	skillId,
	name,
	resolveSkillImage,
	renderSkillImage,
}: {
	skillId: string;
	name: string;
	resolveSkillImage: OverrideSkillSectionProps["resolveSkillImage"];
	renderSkillImage: OverrideSkillSectionProps["renderSkillImage"];
}) {
	const [error, setError] = useState(false);
	const url = resolveSkillImage(skillId);

	if (error || !url) {
		return (
			<div className="w-full h-full flex items-center justify-center bg-surface-container-high">
				<Zap size={16} className="text-on-surface-variant/30" />
			</div>
		);
	}

	return renderSkillImage({
		src: url,
		alt: name,
		className: "object-contain p-1",
		onError: () => setError(true),
	});
}

function OverrideCard({
	override,
	currentSkillId,
	resolveSkillImage,
	renderSkillImage,
	skillHref,
}: {
	override: OverrideSkillData;
	currentSkillId: string;
	resolveSkillImage: OverrideSkillSectionProps["resolveSkillImage"];
	renderSkillImage: OverrideSkillSectionProps["renderSkillImage"];
	skillHref: (skillId: string) => string;
}) {
	const isResult = override.id === currentSkillId;
	const elAccent = ELEMENT_ACCENT[override.element_id ?? 0] || "border-outline-variant/20";
	const elSprite = ELEMENT_SPRITE[override.element_id ?? 0];
	const elName = ELEMENT_FR[override.element_id ?? 0] || "Néant";
	const requiredSkills = override.conditions.flatMap((condition) => condition.required_skills);

	return (
		<div
			className={`rounded-xl border ${elAccent} bg-surface-container-high/50 hover:bg-surface-container-high transition-colors p-3`}
		>
			<Link href={skillHref(override.id)} className="flex items-center gap-3 group">
				<div className="w-14 h-10 rounded-lg bg-surface-container-highest border border-outline-variant/10 relative overflow-hidden shrink-0">
					<SkillThumb
						skillId={override.id}
						name={override.name_fr || ""}
						resolveSkillImage={resolveSkillImage}
						renderSkillImage={renderSkillImage}
					/>
				</div>
				<div className="flex-1 min-w-0">
					<h4
						className={`font-bold text-sm leading-tight truncate group-hover:text-primary transition-colors ${isResult ? "text-primary" : "text-on-surface"}`}
					>
						{override.name_fr || override.name_en || "Technique inconnue"}
					</h4>
					<div className="flex items-center gap-2 mt-0.5">
						{elSprite && <CommonSpriteIcon name={elSprite} scale={0.5} />}
						<span className="text-[11px] text-on-surface-variant">{elName}</span>
						{override.power_max != null && override.power_max > 0 && (
							<span className="text-[11px] text-on-surface-variant/70 font-medium">
								{override.power_min}-{override.power_max} Pui
							</span>
						)}
					</div>
				</div>
			</Link>

			<div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
				{requiredSkills.map((requiredSkill, index) => {
					const isCurrent = requiredSkill.skill_id === currentSkillId;
					return (
						<span key={`${requiredSkill.skill_id}-${index}`} className="contents">
							{index > 0 && <Plus size={12} className="text-on-surface-variant/40 shrink-0" />}
							<Link
								href={skillHref(requiredSkill.skill_id)}
								className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-colors ${isCurrent ? "bg-primary/15 text-primary border border-primary/30" : "bg-surface-container-highest/80 text-on-surface-variant hover:text-primary hover:bg-primary/10 border border-outline-variant/10"}`}
							>
								<div className="w-5 h-4 relative shrink-0">
									<SkillThumb
										skillId={requiredSkill.skill_id}
										name={requiredSkill.name_fr || ""}
										resolveSkillImage={resolveSkillImage}
										renderSkillImage={renderSkillImage}
									/>
								</div>
								<span className="truncate max-w-[120px]">
									{requiredSkill.name_fr || requiredSkill.name_en || requiredSkill.skill_id}
								</span>
								{requiredSkill.num > 1 && (
									<span className="text-[10px] opacity-60">x{requiredSkill.num}</span>
								)}
							</Link>
						</span>
					);
				})}
				<ArrowRight size={14} className="text-on-surface-variant/40 shrink-0 mx-0.5" />
				<span className="text-xs font-bold text-primary truncate max-w-[140px]">
					{override.name_fr || override.name_en}
				</span>
			</div>
		</div>
	);
}

/** Shared Overdrive formula presentation; hosts provide data, routes, and image handling. */
export function OverrideSkillSection({
	overrides,
	currentSkillId,
	resolveSkillImage,
	renderSkillImage,
	skillHref = (skillId) => `/skill/${skillId}`,
}: OverrideSkillSectionProps) {
	if (overrides.length === 0) return null;

	const asResult = overrides.filter((override) => override.id === currentSkillId);
	const asIngredient = overrides.filter((override) => override.id !== currentSkillId);

	return (
		<div className="space-y-3">
			<h3 className="text-lg font-bold text-on-surface px-1 flex items-center gap-2">
				<Zap size={20} className="text-primary" />
				Overdrive
			</h3>
			<p className="text-xs text-on-surface-variant px-1">
				Combinaisons de techniques spéciales activables en match.
			</p>
			<div className="space-y-2">
				{asIngredient.map((override) => (
					<OverrideCard
						key={override.id}
						override={override}
						currentSkillId={currentSkillId}
						resolveSkillImage={resolveSkillImage}
						renderSkillImage={renderSkillImage}
						skillHref={skillHref}
					/>
				))}
				{asResult.map((override) => (
					<OverrideCard
						key={`result-${override.id}`}
						override={override}
						currentSkillId={currentSkillId}
						resolveSkillImage={resolveSkillImage}
						renderSkillImage={renderSkillImage}
						skillHref={skillHref}
					/>
				))}
			</div>
		</div>
	);
}
