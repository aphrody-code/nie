/**
 * Assets de cut-in des hissatsu, générés par niers (`export_skills` → `data/skills-cutin.json`).
 *
 * Source : `nie-data/src/skill.rs::SkillInfo::cutin_assets()` — chemins VFS dérivés de
 * `event_id_name` + `skill_id_str`, vérifiés byte-exact sur whs00340. Permet à la page skill
 * d'afficher le modèle 3D du cut-in, le telop (nom rendu) par langue, et les assets son/effets,
 * tous déjà servis live par `nie-model-serve` (`/raw`, `/tex`, `/model-*`).
 */
import skillsCutinData from "../data/skills-cutin.json";
import skillsCutinServed from "../data/skills-cutin-served.json";

/** Chemins VFS des assets de cut-in d'un hissatsu. */
export interface SkillCutin {
	event_id_name: string;
	model_g4mg: string;
	model_g4md: string;
	texture_g4tx: string;
	sound_cfg: string;
	effects_dir: string;
	/** `[langue, chemin .g4tx du telop]` par langue disponible (8 avec la MAJ du 2026-08-15 :
	 * de/en/es/fr/it/pt/zh_hans/zh_hant). `string[][]`, pas un tuple : un import JSON brut
	 * n'inférerait jamais `[string,string]` (TS widen systématiquement en `string[]`), et le
	 * cast `as SkillsCutinFile` échouait le type-check de déploiement pour cette seule raison. */
	telop_by_lang: string[][];
}

/** Une entrée skill enrichie (identité + cut-in). */
export interface SkillCutinEntry {
	skill_id_str: string;
	skill_id: string;
	event_id_name: string;
	element: number;
	element_name: { fr: string; en: string; ja: string };
	category: number;
	category_name: { fr: string; en: string; ja: string };
	power_min: number;
	power_max: number;
	consume_tp: number;
	foul_rate: number;
	growth_type: number;
	recast_time: number;
	partner_type: number;
	cutin: SkillCutin | null;
}

interface SkillsCutinFile {
	meta: { skill_count: number; cutin_count: number };
	skills: SkillCutinEntry[];
}

const byCode = new Map<string, SkillCutinEntry>(
	(skillsCutinData as SkillsCutinFile).skills.map((s) => [s.skill_id_str, s])
);

/** Renvoie l'entrée cut-in d'un skill par son code interne (`skill_id_str`, ex. `whs00340`). */
export function getSkillCutin(codeOrId: string): SkillCutinEntry | null {
	return byCode.get(codeOrId) ?? null;
}

/** Ensemble des `event_id_name` dont le modèle 3D + texture `_waza` existent dans cette build. */
const servedEvents = new Set<string>((skillsCutinServed as { events: string[] }).events);

/**
 * `true` si le cut-in 3D (modèle `/model-chr/waza/<event>.glb` + texture) est réellement servi par
 * le CDN pour cet `event_id_name` (gate anti-404, ~142 events / ~890). Source : manifeste
 * `skills-cutin-served.json` (généré depuis l'index CPK, `scripts/build-skills-cutin-served.ts`).
 * Client-safe (import JSON pur). Permet à la fiche de n'afficher le viewer/texture que là où ils
 * existent — au lieu d'un viewer « indisponible » + image cassée sur les ~835 hissatsu sans cut-in.
 */
export function cutinHasAssets(eventIdName: string | null | undefined): boolean {
	return eventIdName ? servedEvents.has(eventIdName) : false;
}
