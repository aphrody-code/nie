import { z } from "zod";

export const CrossAssetSchema = z.object({
	guid: z.string(),
	key: z.string(),
	type: z.string(),
	bundle: z.string(),
	size: z.number(),
	n_deps: z.number(),
	deps: z.array(z.string()).optional(),
});

export type CrossAsset = z.infer<typeof CrossAssetSchema>;

export const AssetPatternSchema = z.object({
	name: z.string(),
	source_field: z.string(),
	address_template: z.string(),
	asset_kind: z.string(),
	verify_regex: z.string(),
	distinct_codes_in_catalog: z.number().optional(),
	example_codes: z.array(z.string()).optional(),
});

export type AssetPattern = z.infer<typeof AssetPatternSchema>;

export const ExtractionStatusSchema = z.object({
	game: z.string(),
	package: z.string(),
	version: z.string(),
	engine: z.string(),
	released: z.string(),
	masterdata_tables: z.number(),
	masterdata_columns: z.number(),
	enums: z.number(),
	catalog_objects: z.number(),
	remote_bundles: z.number(),
	audio_wav: z.number(),
	local_assets: z.number(),
	classes: z.number(),
	game_classes: z.number(),
	localization_langs: z.array(z.string()),
	blocked: z.string(),
	extracted_static: z.array(z.string()),
});

export type ExtractionStatus = z.infer<typeof ExtractionStatusSchema>;

/** Schémas de liens pour les assets d'un personnage */
export const CharacterAssetLinksSchema = z.object({
	code: z.string(), // ex: "c00001001"
	icon: z.string().nullable(),
	iconAsset: CrossAssetSchema.nullable().optional(),
	voiceAcb: z.string().nullable(),
	voiceAcbAsset: CrossAssetSchema.nullable().optional(),
	voiceAwb: z.string().nullable(),
	voiceAwbAsset: CrossAssetSchema.nullable().optional(),
	voiceWavs: z.array(
		z.object({
			cueName: z.string(),
			fileName: z.string(),
			url: z.string(),
		})
	),
	faceInGame: z.string().nullable(),
	faceInGameAsset: CrossAssetSchema.nullable().optional(),
	faceDirector: z.string().nullable(),
	faceDirectorAsset: CrossAssetSchema.nullable().optional(),
	bodyMesh: z.string().nullable(),
	bodyMeshAsset: CrossAssetSchema.nullable().optional(),
	motions: z.array(
		z.object({
			key: z.string(),
			asset: CrossAssetSchema,
		})
	),
	uniforms: z.array(
		z.object({
			variant: z.string(),
			isHome: z.boolean(),
			mesh: z.string().nullable(),
			meshAsset: CrossAssetSchema.nullable().optional(),
			material: z.string().nullable(),
			materialAsset: CrossAssetSchema.nullable().optional(),
		})
	),
	skin: z.string().nullable(),
	skinAsset: CrossAssetSchema.nullable().optional(),
	glove: z.string().nullable(),
	gloveAsset: CrossAssetSchema.nullable().optional(),
	shoes: z.string().nullable(),
	shoesAsset: CrossAssetSchema.nullable().optional(),
	captainMark: z.string().nullable(),
	captainMarkAsset: CrossAssetSchema.nullable().optional(),
	uniformNumber: z.string().nullable(),
	uniformNumberAsset: CrossAssetSchema.nullable().optional(),
	shapeCorrection: z.string().nullable(),
	shapeCorrectionAsset: CrossAssetSchema.nullable().optional(),
});

export type CharacterAssetLinks = z.infer<typeof CharacterAssetLinksSchema>;
