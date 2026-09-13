import {
	inspectModelGlb,
	type ModelGlbInspection,
	validateEditorPng,
} from "../../../game/model-render";

export const MAX_EDITOR_GLB_BYTES = 64 * 1024 * 1024;
export const MAX_EDITOR_PNG_BYTES = 32 * 1024 * 1024;

export interface ImportedGlb {
	name: string;
	bytes: Uint8Array;
	inspection: ModelGlbInspection;
}

export interface ImportedPng {
	name: string;
	bytes: Uint8Array;
	width: number;
	height: number;
	/** Original browser Blob; presentation creates and owns a revocable object URL. */
	blob: Blob;
}

function requireBoundedFile(file: File, extension: string, maximum: number): void {
	if (!file.name.toLowerCase().endsWith(extension)) {
		throw new Error(`Fichier ${extension} attendu`);
	}
	if (file.size === 0) throw new Error("Le fichier choisi est vide");
	if (file.size > maximum) {
		throw new Error(`Fichier trop volumineux (${file.size.toLocaleString("fr-FR")} octets, maximum ${maximum.toLocaleString("fr-FR")})`);
	}
}

/** Admit a local GLB only after the bounded Rust reader has parsed it. */
export async function importEditorGlb(file: File): Promise<ImportedGlb> {
	requireBoundedFile(file, ".glb", MAX_EDITOR_GLB_BYTES);
	const bytes = new Uint8Array(await file.arrayBuffer());
	const inspection = await inspectModelGlb(bytes);
	return { name: file.name, bytes, inspection };
}

/** Decode the PNG in bounded Rust before it becomes a texture or visual reference. */
export async function importEditorPng(file: File): Promise<ImportedPng> {
	requireBoundedFile(file, ".png", MAX_EDITOR_PNG_BYTES);
	const bytes = new Uint8Array(await file.arrayBuffer());
	const [width, height] = await validateEditorPng(bytes);
	return { name: file.name, bytes, width, height, blob: file };
}

/** Export names never inherit directories or a second extension from imported files. */
export function editorExportName(name: string, extension: "glb" | "png"): string {
	const leaf = name.split(/[\\/]/u).pop() || "scene";
	const stem = leaf.replace(/\.[^.]+$/u, "").replace(/[^a-zA-Z0-9_-]+/gu, "_") || "scene";
	return `${stem}.${extension}`;
}
