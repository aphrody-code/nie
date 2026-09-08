/** Browser view of the shared nie-data avatar contract and the existing resolved catalogue. */
export interface AvatarState {
	selections: Record<number, string>;
	gender: number;
	morphology: number;
	height: number | null;
	paletteSelections: Record<number, number>;
	customColors: Record<number, string>;
}
export interface AvatarPart {
	id: string; itemNo: number; viewNo?: number; gender?: number; resource: string;
	modeles: string[]; modeles2: string[]; icone?: string | null;
}
export interface AvatarCategory {
	faceSettingType: number; prefixe?: string; parts: AvatarPart[]; couleurs?: string[];
}
export interface AvatarCatalog {
	categories: AvatarCategory[];
	couleursRgb?: Record<string, { rgb: string; alpha: number }>;
	modelesDeBase: { morphologies: string[]; visages: { noseType: string; resources: string[] }[] };
	rubriques?: { hash: string; libelle: string }[];
	panneaux?: { nom: string; libelles: { hash: string; libelle: string; gaiji: string[] }[] }[];
	statsRadar?: { hash: string; libelle: string }[];
	presets?: { presetID: string; nom: string | null; morphologies: string[]; recette: { emplacement: number; valeur: number; couleur: number; part: string | null; partId?: string | null }[] }[];
}
export interface AvatarComposition {
	pieces: { directory: string; name: string }[];
	faceLayers: string[];
	morphology: string; morphologyIndex: number; skeleton: string; height: number | null;
	skinColor: string | null; irisColor: string | null; hairColor: string | null;
	warnings: { code: string; category: number | null }[];
}
export const INITIAL_AVATAR_STATE: AvatarState = {
	selections: {}, gender: 0, morphology: 0, height: null, paletteSelections: {}, customColors: {},
};
