/**
 * Data layer SERVEUR du hub « Inazuma Eleven Cross » (`/cross/*`).
 *
 * Source = artefacts d'extraction statique trackés sous `data/cross/*` (dump
 * IL2CPP + catalogue Addressables). Petits JSON → import direct (tracé par le
 * build standalone, bundle serveur uniquement). Le gros catalogue (25 328
 * objets) vit en `catalog-index.ndjson.gz` et est matérialisé à part par
 * `lib/cross/catalog.ts` (pattern singleton, comme `lib/cpk`).
 *
 * ⚠ module **serveur** — ne pas importer depuis un composant `"use client"`.
 * Les types + helpers purs sont dans `lib/cross/data-shared.ts`.
 */

import schemaJson from "../data/cross/masterdata-schema.json";
import enumsJson from "../data/cross/enums.json";
import statusJson from "../data/cross/extraction-status.json";
import audioJson from "../data/cross/audio-manifest.json";
import statsJson from "../data/cross/catalog-stats.json";
import typeSchemaJson from "../data/cross/type-schema.json";
import type {
	CrossAudioManifest,
	CrossEnums,
	CrossExtractionStatus,
	CrossSchema,
	CrossTable,
} from "./data-shared";
import { tableSlug } from "./data-shared";

const SCHEMA = schemaJson as unknown as CrossSchema;
const ENUMS = enumsJson as unknown as CrossEnums;

export function getCrossStatus(): CrossExtractionStatus {
	return statusJson as unknown as CrossExtractionStatus;
}

export function getCrossAudio(): CrossAudioManifest {
	return audioJson as unknown as CrossAudioManifest;
}

/** Stats agrégées du catalogue Addressables (totaux/types/localisation/audio). */
export function getCrossCatalogStats(): Record<string, unknown> {
	return statsJson as Record<string, unknown>;
}

/** Une table masterdata enrichie de son nom court. */
export interface CrossTableSummary {
	slug: string;
	short: string;
	fullName: string;
	file: string;
	columnCount: number;
	refCount: number;
	enumCount: number;
	extends: string | null;
}

/** Toutes les tables masterdata (153), triées, en résumé. Filtre `q` optionnel. */
export function getCrossTables(q?: string): CrossTableSummary[] {
	const needle = (q ?? "").trim().toLowerCase();
	const out: CrossTableSummary[] = [];
	for (const [fullName, t] of Object.entries(SCHEMA)) {
		const short = fullName.split(".").pop() ?? fullName;
		if (needle && !short.toLowerCase().includes(needle) && !t.file.toLowerCase().includes(needle))
			continue;
		out.push({
			slug: tableSlug(fullName),
			short,
			fullName,
			file: t.file,
			columnCount: t.columns.length,
			refCount: t.columns.filter((c) => c.kind === "ref").length,
			enumCount: t.columns.filter((c) => c.kind === "enum").length,
			extends: t.extends,
		});
	}
	out.sort((a, b) => a.short.localeCompare(b.short));
	return out;
}

/** Détail d'une table par slug (nom court). `null` si inconnue. */
export function getCrossTable(slug: string): (CrossTable & { short: string }) | null {
	for (const [fullName, t] of Object.entries(SCHEMA)) {
		const short = fullName.split(".").pop() ?? fullName;
		if (short === slug) return { ...t, short };
	}
	return null;
}

/** Les enums (214), triés par nom court. Filtre `q` optionnel. */
export function getCrossEnums(q?: string): { name: string; short: string; members: { name: string; value: number }[] }[] {
	const needle = (q ?? "").trim().toLowerCase();
	const out = Object.entries(ENUMS).map(([name, members]) => ({
		name,
		short: name.split(".").pop() ?? name,
		members,
	}));
	const filtered = needle
		? out.filter((e) => e.short.toLowerCase().includes(needle))
		: out;
	filtered.sort((a, b) => a.short.localeCompare(b.short));
	return filtered;
}

/** Compteurs globaux du modèle de données (pour les en-têtes). */
export function getCrossDataCounts(): {
	tables: number;
	columns: number;
	enums: number;
	refs: number;
} {
	let columns = 0;
	let refs = 0;
	for (const t of Object.values(SCHEMA)) {
		columns += t.columns.length;
		refs += t.columns.filter((c) => c.kind === "ref").length;
	}
	return { tables: Object.keys(SCHEMA).length, columns, enums: Object.keys(ENUMS).length, refs };
}

/** Récupère la liste des champs d'une classe C# d'après le type-schema.json. */
export function getCrossTypeFields(fullName: string): string[] | null {
	return (typeSchemaJson as Record<string, string[]>)[fullName] ?? null;
}

/** Génère dynamiquement le code C# correspondant à la table et aux informations IL2CPP. */
export function generateCSharpClass(t: CrossTable, typeFields: string[] | null): string {
	const parts = t.fullName.split(".");
	const className = parts.pop() ?? t.fullName;
	const namespace = parts.join(".");

	const baseClassStr = t.extends ? ` : ${t.extends}` : "";

	const columnMap = new Map<string, typeof t.columns[0]>();
	for (const col of t.columns) {
		columnMap.set(col.name.toLowerCase(), col);
	}

	const lines: string[] = [];
	lines.push(`using System;`);
	lines.push(`using System.Collections.Generic;`);
	lines.push(``);
	lines.push(`namespace ${namespace}`);
	lines.push(`{`);
	lines.push(`    [Serializable]`);
	lines.push(`    public class ${className}${baseClassStr}`);
	lines.push(`    {`);

	const emitted = new Set<string>();

	const getCSharpType = (col: typeof t.columns[0]): string => {
		switch (col.kind) {
			case "int":
				if (col.type === "long") return "long";
				if (col.type === "uint") return "uint";
				if (col.type === "short") return "short";
				if (col.type === "byte") return "byte";
				return "int";
			case "float":
				if (col.type === "double") return "double";
				if (col.type === "decimal") return "decimal";
				return "float";
			case "bool":
				return "bool";
			case "string":
				return "string";
			case "localizationKey":
				return "LocalizationKey";
			case "enum":
				return col.type.split(".").pop() ?? col.type;
			case "ref":
				return col.ref?.split(".").pop() ?? col.type.split(".").pop() ?? col.type;
			case "array": {
				const arrElem = col.element ?? col.type;
				const cleanArrElem = arrElem.split(".").pop() ?? arrElem;
				return `${cleanArrElem}[]`;
			}
			case "list": {
				const listElem = col.element ?? col.type;
				const cleanListElem = listElem.split(".").pop() ?? listElem;
				return `List<${cleanListElem}>`;
			}
			case "dict": {
				const dictKey = col.key?.split(".").pop() ?? "string";
				const dictValue = col.value?.split(".").pop() ?? "object";
				return `Dictionary<${dictKey}, ${dictValue}>`;
			}
			default:
				return col.type.split(".").pop() ?? col.type;
		}
	};

	if (typeFields && typeFields.length > 0) {
		const properties: string[] = [];
		const fields: string[] = [];

		for (const field of typeFields) {
			const backingMatch = field.match(/^<(.+)>k__BackingField$/);
			if (backingMatch) {
				const propName = backingMatch[1];
				const col = columnMap.get(propName.toLowerCase());
				if (col) {
					const csType = getCSharpType(col);
					const isNullable = col.nullable ? "?" : "";
					const inheritComment = col.inherited ? ` // Hérité de ${col.from ?? "la classe de base"}` : "";
					properties.push(`        public ${csType}${isNullable} ${propName} { get; set; }${inheritComment}`);
					emitted.add(propName.toLowerCase());
				} else {
					properties.push(`        public object ${propName} { get; set; } // Propriété interne`);
				}
			} else {
				const col = columnMap.get(field.toLowerCase());
				if (col) {
					const csType = getCSharpType(col);
					const isNullable = col.nullable ? "?" : "";
					const inheritComment = col.inherited ? ` // Hérité de ${col.from ?? "la classe de base"}` : "";
					fields.push(`        public ${csType}${isNullable} ${field};${inheritComment}`);
					emitted.add(field.toLowerCase());
				} else {
					if (field === "MasterFileName") {
						fields.push(`        // public string MasterFileName; // Géré par MasterBase`);
					} else {
						fields.push(`        public object ${field}; // Champ interne`);
					}
				}
			}
		}

		const missingProperties: string[] = [];
		for (const col of t.columns) {
			if (!emitted.has(col.name.toLowerCase())) {
				const csType = getCSharpType(col);
				const isNullable = col.nullable ? "?" : "";
				const inheritComment = col.inherited ? ` // Hérité de ${col.from ?? "la classe de base"}` : "";
				missingProperties.push(`        public ${csType}${isNullable} ${col.name} { get; set; }${inheritComment}`);
			}
		}

		if (properties.length > 0) {
			lines.push(`        // Propriétés`);
			lines.push(...properties);
			lines.push(``);
		}

		if (missingProperties.length > 0) {
			lines.push(`        // Propriétés additionnelles`);
			lines.push(...missingProperties);
			lines.push(``);
		}

		if (fields.length > 0) {
			lines.push(`        // Champs internes (dump IL2CPP)`);
			lines.push(...fields);
		}
	} else {
		lines.push(`        // Propriétés (générées à partir du schéma)`);
		for (const col of t.columns) {
			const csType = getCSharpType(col);
			const isNullable = col.nullable ? "?" : "";
			const inheritComment = col.inherited ? ` // Hérité de ${col.from ?? "la classe de base"}` : "";
			lines.push(`        public ${csType}${isNullable} ${col.name} { get; set; }${inheritComment}`);
		}
	}

	lines.push(`    }`);
	lines.push(`}`);

	return lines.join("\n");
}
