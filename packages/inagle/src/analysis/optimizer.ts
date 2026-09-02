/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

import { createCharactersAPI } from "../characters/api.js";
import { createBasaraAPI } from "../basara/api.js";
import { createSkillsAPI } from "../skills/api.js";
import type { CharacterStats } from "../core/types.js";
import type { EnrichedBasara } from "../basara/api.js";

// ============================================================================
// Types
// ============================================================================

export interface ActiveSynergy {
	name: string;
	description: string;
	bonusType: string;
	value: number;
}

export interface OptimizedBuildResult {
	buildType: number;
	name: string;
	stats: CharacterStats;
	totalPower: number;
}

export interface TeamPlayerInput {
	charaParamId: string;
	positionOnField: "GK" | "DF" | "MF" | "FW";
	buildType?: number; // Optional custom build type for BASARA characters (0-5)
}

export interface TeamSynergyReport {
	totalPower: number;
	synergyScore: number;
	activeSynergies: ActiveSynergy[];
	recommendations: string[];
}

// ============================================================================
// Basara Build Multipliers Configuration
// ============================================================================

export const BASARA_BUILD_PROJECTIONS: Record<
	number,
	{ name: string; description: string; multipliers: Partial<Record<keyof CharacterStats, number>> }
> = {
	0: {
		name: "Polyvalent (All-Rounder)",
		description: "Statistiques équilibrées, aucune pénalité.",
		multipliers: {},
	},
	1: {
		name: "Attaquant (Striker)",
		description: "Augmente la Frappe et la Vitesse, diminue le Contrôle et la Pression.",
		multipliers: {
			kick: 1.25,
			agility: 1.15,
			physical: 1.1,
			control: 0.9,
			pressure: 0.8,
		},
	},
	2: {
		name: "Muraille (Defender / Wall)",
		description: "Augmente la Pression et le Physique, diminue la Frappe et la Vitesse.",
		multipliers: {
			pressure: 1.25,
			physical: 1.2,
			intelligence: 1.1,
			kick: 0.7,
			agility: 0.9,
		},
	},
	3: {
		name: "Meneur (Playmaker)",
		description: "Augmente le Contrôle et la Technique, diminue la Frappe et la Pression.",
		multipliers: {
			control: 1.25,
			technique: 1.2,
			intelligence: 1.15,
			kick: 0.9,
			pressure: 0.9,
		},
	},
	4: {
		name: "Voltigeur (Speedster)",
		description: "Augmente drastiquement la Vitesse, diminue la Pression.",
		multipliers: {
			agility: 1.3,
			control: 1.1,
			technique: 1.1,
			kick: 0.9,
			pressure: 0.8,
		},
	},
	5: {
		name: "Gardien Infranchissable (GK Wall)",
		description: "Augmente la Technique et le Physique, diminue drastiquement la Frappe.",
		multipliers: {
			technique: 1.3,
			physical: 1.15,
			pressure: 1.15,
			kick: 0.5,
			control: 0.8,
		},
	},
};

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Projette les statistiques Lv99 d'un personnage BASARA sous un certain build.
 */
export function projectBasaraBuildStats(basara: EnrichedBasara, buildType: number): CharacterStats {
	const baseStats = basara.stats.lv99 || {
		kick: 0,
		control: 0,
		technique: 0,
		pressure: 0,
		physical: 0,
		agility: 0,
		intelligence: 0,
	};

	const config = BASARA_BUILD_PROJECTIONS[buildType] || BASARA_BUILD_PROJECTIONS[0];
	const projected: CharacterStats = { ...baseStats };

	for (const key of Object.keys(baseStats) as Array<keyof CharacterStats>) {
		const multiplier = config.multipliers[key];
		if (multiplier !== undefined) {
			projected[key] = Math.round(baseStats[key] * multiplier);
		}
	}

	return projected;
}

/**
 * Calcule tous les builds disponibles d'un personnage BASARA et retourne un classement.
 */
export function getOptimizedBasaraBuilds(basara: EnrichedBasara): OptimizedBuildResult[] {
	const results: OptimizedBuildResult[] = [];

	for (let type = 0; type < 6; type++) {
		const stats = projectBasaraBuildStats(basara, type);
		const totalPower =
			stats.kick +
			stats.control +
			stats.technique +
			stats.pressure +
			stats.physical +
			stats.agility +
			stats.intelligence;

		results.push({
			buildType: type,
			name: BASARA_BUILD_PROJECTIONS[type]?.name || "Inconnu",
			stats,
			totalPower,
		});
	}

	return results.sort((a, b) => b.totalPower - a.totalPower);
}

/**
 * Évalue la synergie d'une équipe de 11 joueurs et génère un rapport Big Data détaillé.
 */
export function calculateTeamSynergy(
	playersInput: TeamPlayerInput[],
	coachParamId?: string
): TeamSynergyReport {
	const charApi = createCharactersAPI();
	const basaraApi = createBasaraAPI();
	const skillsApi = createSkillsAPI();

	const activeSynergies: ActiveSynergy[] = [];
	const recommendations: string[] = [];

	let totalPower = 0;
	let positionMatchingCount = 0;

	// Éléments représentés dans l'équipe
	const elementCounts: Record<string, number> = {
		Wind: 0,
		Forest: 0,
		Fire: 0,
		Mountain: 0,
		Void: 0,
	};

	// Chargement des fiches de joueurs enrichies
	const loadedPlayers = playersInput
		.map((input) => {
			let char = charApi.getByParamId(input.charaParamId);
			let isBasara = false;
			let element = "Void";
			let naturalPosition = "FW";
			let name = "Joueur Inconnu";
			let stats: CharacterStats = {
				kick: 0,
				control: 0,
				technique: 0,
				pressure: 0,
				physical: 0,
				agility: 0,
				intelligence: 0,
			};
			let skillsList: Array<{ skillId: string; learnLevel: number }> = [];

			if (!char) {
				const basaraChar = basaraApi.get(input.charaParamId);
				if (basaraChar) {
					isBasara = true;
					char = basaraChar as any;
					name = basaraChar.displayName;
					element =
						basaraChar.elementRaw === 1
							? "Wind"
							: basaraChar.elementRaw === 2
								? "Forest"
								: basaraChar.elementRaw === 3
									? "Fire"
									: basaraChar.elementRaw === 4
										? "Mountain"
										: "Void";
					naturalPosition = basaraChar.position;

					const build = input.buildType !== undefined ? input.buildType : 0;
					stats = projectBasaraBuildStats(basaraChar, build);
					skillsList = basaraChar.skills || [];
				}
			} else {
				name = char.names.fr || char.names.en || "Joueur";
				element = char.element;
				naturalPosition = char.position;
				stats = char.stats.lv99 || {
					kick: 0,
					control: 0,
					technique: 0,
					pressure: 0,
					physical: 0,
					agility: 0,
					intelligence: 0,
				};
				skillsList = char.skills || [];
			}

			if (!char) return null;

			// Compter les éléments
			if (elementCounts[element] !== undefined) {
				elementCounts[element]++;
			}

			// Vérifier correspondance de position
			const isCorrectPosition = naturalPosition === input.positionOnField;
			if (isCorrectPosition) {
				positionMatchingCount++;
			} else {
				recommendations.push(
					`⚠️ ${name} (${naturalPosition}) joue en tant que ${input.positionOnField}. Pensez à le repositionner pour maximiser son efficacité.`
				);
			}

			// Force brute individuelle
			const power =
				stats.kick +
				stats.control +
				stats.technique +
				stats.pressure +
				stats.physical +
				stats.agility +
				stats.intelligence;
			totalPower += power;

			return {
				name,
				element,
				naturalPosition,
				positionOnField: input.positionOnField,
				isCorrectPosition,
				stats,
				skillsList,
				power,
			};
		})
		.filter(Boolean) as Array<{
		name: string;
		element: string;
		naturalPosition: string;
		positionOnField: string;
		isCorrectPosition: boolean;
		stats: CharacterStats;
		skillsList: Array<{ skillId: string; learnLevel: number }>;
		power: number;
	}>;

	// 1. Synergie de placement des joueurs (Position Bonus)
	const positionRatio = loadedPlayers.length > 0 ? positionMatchingCount / loadedPlayers.length : 0;
	if (positionRatio >= 0.9) {
		activeSynergies.push({
			name: "Discipline Tactique",
			description: "Plus de 90% des joueurs sont placés à leur position naturelle.",
			bonusType: "Statistiques de placement",
			value: 15,
		});
	} else if (positionRatio >= 0.7) {
		activeSynergies.push({
			name: "Coordination de Base",
			description: "Plus de 70% des joueurs sont à leur position naturelle.",
			bonusType: "Statistiques de placement",
			value: 8,
		});
	}

	// 2. Synergie de Cohésion Élémentaire
	let dominantElement = "Void";
	let dominantCount = 0;
	for (const [el, count] of Object.entries(elementCounts)) {
		if (count > dominantCount) {
			dominantCount = count;
			dominantElement = el;
		}
	}

	const elementRatio = loadedPlayers.length > 0 ? dominantCount / loadedPlayers.length : 0;
	if (elementRatio >= 0.55 && dominantElement !== "Void") {
		const localizedElement =
			dominantElement === "Fire"
				? "Feu"
				: dominantElement === "Wind"
					? "Vent"
					: dominantElement === "Forest"
						? "Forêt"
						: "Montagne";
		activeSynergies.push({
			name: `Cohésion Élémentaire (${localizedElement})`,
			description: `Dominance forte de l'élément ${localizedElement} (>= 55% de l'équipe).`,
			bonusType: "Multiplicateur de Hissatsu",
			value: 12,
		});
	}

	// 3. Synergie avec l'Entraîneur / Coach
	if (coachParamId) {
		const coach = charApi.getByParamId(coachParamId);
		if (coach) {
			const coachName = coach.names.fr || coach.names.en || "Coach";
			const isMatchingDominantElement = coach.element === dominantElement;
			if (isMatchingDominantElement && dominantElement !== "Void") {
				activeSynergies.push({
					name: "Harmonie Tactique",
					description: `L'élément de l'entraîneur ${coachName} (${coach.element}) correspond à la dominance de l'équipe.`,
					bonusType: "Boost Global de Puissance",
					value: 10,
				});
			} else {
				recommendations.push(
					`💡 L'entraîneur ${coachName} est d'élément ${coach.element}. Envisagez un coach d'élément ${dominantElement} pour activer l'Harmonie Tactique.`
				);
			}
		}
	}

	// 4. Analyse des Passifs d'Équipe (Interlinking Skills)
	const passiveCounters: Record<string, number> = {};
	for (const p of loadedPlayers) {
		for (const sk of p.skillsList) {
			const skillMeta = skillsApi.get(sk.skillId);
			if (skillMeta) {
				// Vérifier si c'est un passif
				const isPassive =
					skillMeta.categoryName?.en === "Passive" ||
					skillMeta.categoryName?.fr === "Passif" ||
					skillMeta.name_FR?.toLowerCase().includes("boost") ||
					skillMeta.name_EN?.toLowerCase().includes("boost");

				if (isPassive) {
					const skillName = skillMeta.name_FR || skillMeta.name_EN || "Passif";
					passiveCounters[skillName] = (passiveCounters[skillName] || 0) + 1;
				}
			}
		}
	}

	// Traduire les passifs trouvés en bonus synergiques
	for (const [name, count] of Object.entries(passiveCounters)) {
		const nameLower = name.toLowerCase();
		if (nameLower.includes("feu") || nameLower.includes("fire")) {
			const fireCount = elementCounts.Fire || 0;
			if (fireCount >= 3) {
				activeSynergies.push({
					name: `Fureur du Feu (x${count})`,
					description: `Boost de puissance de ${5 * count}% sur ${fireCount} joueurs Feu.`,
					bonusType: "Boost Élémentaire Feu",
					value: 5 * count,
				});
			}
		} else if (nameLower.includes("vent") || nameLower.includes("wind")) {
			const windCount = elementCounts.Wind || 0;
			if (windCount >= 3) {
				activeSynergies.push({
					name: `Souffle du Vent (x${count})`,
					description: `Boost de puissance de ${5 * count}% sur ${windCount} joueurs Vent.`,
					bonusType: "Boost Élémentaire Vent",
					value: 5 * count,
				});
			}
		} else if (nameLower.includes("forêt") || nameLower.includes("forest")) {
			const forestCount = elementCounts.Forest || 0;
			if (forestCount >= 3) {
				activeSynergies.push({
					name: `Emprise de la Forêt (x${count})`,
					description: `Boost de puissance de ${5 * count}% sur ${forestCount} joueurs Forêt.`,
					bonusType: "Boost Élémentaire Forêt",
					value: 5 * count,
				});
			}
		} else if (nameLower.includes("montagne") || nameLower.includes("mountain")) {
			const mountainCount = elementCounts.Mountain || 0;
			if (mountainCount >= 3) {
				activeSynergies.push({
					name: `Force de la Montagne (x${count})`,
					description: `Boost de puissance de ${5 * count}% sur ${mountainCount} joueurs Montagne.`,
					bonusType: "Boost Élémentaire Montagne",
					value: 5 * count,
				});
			}
		} else if (
			nameLower.includes("mur") ||
			nameLower.includes("wall") ||
			nameLower.includes("défense")
		) {
			const dfCount = loadedPlayers.filter((pl) => pl.positionOnField === "DF").length;
			if (dfCount >= 3) {
				activeSynergies.push({
					name: "Mur d'Acier Tactique",
					description: `Augmentation de la défense collective (+${6 * count}%) pour les ${dfCount} défenseurs.`,
					bonusType: "Boost Positionnel DF",
					value: 6 * count,
				});
			}
		}
	}

	// 5. Calcul du Score Final de Synergie (0-100)
	// Base : Correspondance de position (max 40 pts)
	// Cohésion élémentaire : (max 30 pts)
	// Coach : (max 10 pts)
	// Passifs activés : (max 20 pts)
	let synergyScore = 0;
	synergyScore += Math.round(positionRatio * 40);

	if (elementRatio >= 0.55) {
		synergyScore += 30;
	} else if (elementRatio >= 0.35) {
		synergyScore += 15;
	}

	const hasTacticalHarmony = activeSynergies.some((s) => s.name === "Harmonie Tactique");
	if (hasTacticalHarmony) {
		synergyScore += 10;
	}

	const passiveBonusSum = activeSynergies
		.filter(
			(s) =>
				s.bonusType.startsWith("Boost Élémentaire") || s.bonusType.startsWith("Boost Positionnel")
		)
		.reduce((sum, s) => sum + s.value, 0);

	synergyScore += Math.min(20, passiveBonusSum);

	// Générer des recommandations générales s'il y a peu de synergies
	if (synergyScore < 50) {
		recommendations.push(
			"💡 L'équipe manque de cohésion élémentaire. Essayez de regrouper au moins 5 joueurs du même élément pour débloquer des bonus."
		);
	}

	return {
		totalPower,
		synergyScore: Math.min(100, synergyScore),
		activeSynergies,
		recommendations,
	};
}
