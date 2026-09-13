/** Browser view of the shared nie-data avatar contract and the existing resolved catalogue. */
export interface AvatarState {
	selections: Record<number, string>;
	gender: number;
	morphology: number;
	height: number | null;
	paletteSelections: Record<number, number>;
	customColors: Record<number, string>;
	profile: AvatarProfile;
}
export interface AvatarProfile {
	name: string;
	nickname: string;
	uniformName: string;
	shirtNumber: number | null;
	element: number | null;
	mainPosition: number | null;
	subPosition: number | null;
	buildType: number | null;
	personality: number | null;
	voice: number | null;
	/** Optional only for persisted v1 draft migration; Rust normalizes absent values to null. */
	kick?: number | null;
	control?: number | null;
	technique?: number | null;
	pressure?: number | null;
	physical?: number | null;
	agility?: number | null;
	intelligence?: number | null;
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
	voix?: { banque: string; genre: number; personnalite: number; ton: number; itemNo: number }[];
	personnalites?: { type: number; presentation: number; texte: string; libelle: string | null }[];
	codePartage?: {
		bits: number;
		alphabet: string[];
		emplacements: { bits: number; emplacement: number; valeurs: number; categorie: number; param: number; paramSub: number }[];
	};
}
export interface AvatarComposition {
	pieces: { directory: string; name: string }[];
	faceLayers: string[];
	morphology: string; morphologyIndex: number; skeleton: string; height: number | null;
	skinColor: string | null; irisColor: string | null; hairColor: string | null;
	profile: AvatarProfile;
	warnings: { code: string; category: number | null }[];
}
export type OcReferenceKind = "zukan" | "azalee" | "nie_character" | "png" | "glb" | "share_code";
export interface OcReference {
	kind: OcReferenceKind;
	value: string;
	provenance?: string | null;
	bytes?: number | null;
	sha256?: string | null;
	rawSlots?: number[] | null;
}
export interface OcAvatarDocument {
	schema: "niers.oc.avatar-document/v1";
	slug: string;
	internalCode: string | null;
	avatarState: AvatarState;
	generationRecipe?: unknown | null;
	references: OcReference[];
	provenance: string[];
}
export type AvatarReferenceImport =
	| { kind: "editable"; state: AvatarState; document?: OcAvatarDocument }
	| { kind: "zukan_player"; internalCode: string; referenceOnly: true }
	| { kind: "azalee_player"; identifier: string; referenceOnly: true }
	| { kind: "nie_player"; internalCode: string; referenceOnly: true }
	| { kind: "share_code"; rawSlots: number[]; referenceOnly: true };
export const INITIAL_AVATAR_STATE: AvatarState = {
	selections: {}, gender: 0, morphology: 0, height: null, paletteSelections: {}, customColors: {},
	profile: {
		name: "", nickname: "", uniformName: "", shirtNumber: null, element: null,
		mainPosition: null, subPosition: null, buildType: null, personality: null, voice: null,
		kick: null, control: null, technique: null, pressure: null, physical: null, agility: null, intelligence: null,
	},
};
