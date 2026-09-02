/**
 * Types du schéma masterdata d'Inazuma Eleven Cross (extrait du dump IL2CPP).
 * Source de vérité : `data/masterdata-schema.json` (153 tables, 1215 colonnes typées,
 * références FK + héritage résolus) et `data/enums.json` (214 enums).
 *
 * Le jeu sert ses VALEURS via un serveur protégé par anti-triche (récupération
 * Phase 1) ; ce package fige le MODÈLE et la plomberie d'ingestion.
 */

/** Famille de type d'une colonne. */
export type CrossColumnKind =
	| "int"
	| "float"
	| "bool"
	| "string"
	| "enum"
	| "ref"
	| "array"
	| "list"
	| "dict"
	| "struct"
	| "localizationKey";

export interface CrossColumn {
	name: string;
	type: string;
	kind: CrossColumnKind;
	enumValues?: { name: string; value: number }[];
	/** Table masterdata cible (`kind === "ref"`). */
	ref?: string;
	element?: string;
	key?: string;
	value?: string;
	nullable?: boolean;
	inherited?: boolean;
	from?: string;
}

export interface CrossTable {
	/** Fichier TSV source côté jeu. */
	file: string;
	fullName: string;
	extends: string | null;
	relatedFiles?: string[];
	columns: CrossColumn[];
}

/** Schéma complet : clé = nom C# complet de la classe `*Master`. */
export type CrossSchema = Record<string, CrossTable>;

export interface CrossEnumMember {
	name: string;
	value: number;
}
export type CrossEnums = Record<string, CrossEnumMember[]>;

/** Nom de table Postgres/SQLite à partir du nom court de la classe `*Master`. */
export function crossTableName(shortClassName: string): string {
	const snake = shortClassName.replace(/(?<!^)(?=[A-Z])/g, "_").toLowerCase().replace(/__+/g, "_");
	return `inagle_cross_${snake}`;
}
