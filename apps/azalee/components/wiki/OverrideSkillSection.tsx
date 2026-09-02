"use client";

import { ArrowRight, Plus, Zap } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { CommonSpriteIcon } from "@/components/ui/CommonSpriteIcon";
import type { SpriteCommonKey } from "@/config/sprites-common";
import { getSkillImageUrl } from "@rosegriffon/azalee/images";

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

interface OverrideSkillSectionProps {
	overrides: OverrideSkillData[];
	currentSkillId: string;
}

function SkillThumb({ skillId, name }: { skillId: string; name: string }) {
	const [error, setError] = useState(false);
	const url = getSkillImageUrl(skillId);

	if (error || !url) {
		return (
			<div className="w-full h-full flex items-center justify-center bg-surface-container-high">
				<Zap size={16} className="text-on-surface-variant/30" />
			</div>
		);
	}

	return (
		<Image
			src={url}
			alt={name}
			fill
			className="object-contain p-1"
			onError={() => setError(true)}
		/>
	);
}

function OverrideCard({
	override,
	currentSkillId,
}: {
	override: OverrideSkillData;
	currentSkillId: string;
}) {
	const isResult = override.id === currentSkillId;
	const elAccent = ELEMENT_ACCENT[override.element_id ?? 0] || "border-outline-variant/20";
	const elSprite = ELEMENT_SPRITE[override.element_id ?? 0];
	const elName = ELEMENT_FR[override.element_id ?? 0] || "Néant";

	// All required skills across all conditions
	const requiredSkills = override.conditions.flatMap((c) => c.required_skills);

	return (
		<div
			className={`rounded-xl border ${elAccent} bg-surface-container-high/50 hover:bg-surface-container-high transition-colors p-3`}
		>
			{/* Result skill header */}
			<Link href={`/skill/${override.id}`} className="flex items-center gap-3 group">
				<div className="w-14 h-10 rounded-lg bg-surface-container-highest border border-outline-variant/10 relative overflow-hidden shrink-0">
					<SkillThumb skillId={override.id} name={override.name_fr || ""} />
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

			{/* Combination formula */}
			<div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
				{requiredSkills.map((rs, i) => {
					const isCurrent = rs.skill_id === currentSkillId;
					return (
						<span key={`${rs.skill_id}-${i}`} className="contents">
							{i > 0 && <Plus size={12} className="text-on-surface-variant/40 shrink-0" />}
							<Link
								href={`/skill/${rs.skill_id}`}
								className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
									isCurrent
										? "bg-primary/15 text-primary border border-primary/30"
										: "bg-surface-container-highest/80 text-on-surface-variant hover:text-primary hover:bg-primary/10 border border-outline-variant/10"
								}`}
							>
								<div className="w-5 h-4 relative shrink-0">
									<SkillThumb skillId={rs.skill_id} name={rs.name_fr || ""} />
								</div>
								<span className="truncate max-w-[120px]">
									{rs.name_fr || rs.name_en || rs.skill_id}
								</span>
								{rs.num > 1 && <span className="text-[10px] opacity-60">x{rs.num}</span>}
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

export function OverrideSkillSection({ overrides, currentSkillId }: OverrideSkillSectionProps) {
	if (overrides.length === 0) {
		return null;
	}

	// Separate: overrides where this skill is the RESULT vs where it's an INGREDIENT
	const asResult = overrides.filter((o) => o.id === currentSkillId);
	const asIngredient = overrides.filter((o) => o.id !== currentSkillId);

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
				{asIngredient.map((o) => (
					<OverrideCard key={o.id} override={o} currentSkillId={currentSkillId} />
				))}
				{asResult.map((o) => (
					<OverrideCard key={`result-${o.id}`} override={o} currentSkillId={currentSkillId} />
				))}
			</div>
		</div>
	);
}
