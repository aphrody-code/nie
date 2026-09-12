/**
 * Local-machine capabilities rebuilt on browser APIs.
 *
 * The desktop host touches the user's disk directly. A page cannot, but it is not powerless
 * either: the File System Access API grants explicit, user-picked handles, OPFS gives a private
 * writable store, and an `<a download>` always works. Each entry point feature-detects and says
 * precisely which API is missing rather than pretending the browser is a lesser machine.
 *
 * `overrides/` in OPFS stands in for the desktop "loose override" folder: writes are keyed by
 * their VFS path, so `list_packs_dir` can enumerate what the session staged.
 */

import { fromBase64, toBase64 } from "./http";

/* eslint-disable @typescript-eslint/no-explicit-any -- File System Access is not in the DOM lib shipped here. */
type FileHandle = { getFile: () => Promise<File>; createWritable: () => Promise<any>; name: string; kind: "file" };
type DirHandle = {
	name: string;
	kind: "directory";
	getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FileHandle>;
	getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<DirHandle>;
	removeEntry: (name: string, options?: { recursive?: boolean }) => Promise<void>;
	entries?: () => AsyncIterableIterator<[string, FileHandle | DirHandle]>;
};
const global = globalThis as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Reject with the name of the API the browser does not expose — never a vague "unavailable". */
function missing(api: string, feature: string): Promise<never> {
	return Promise.reject(`${feature} demande l’API « ${api} », absente de ce navigateur. L’application Desktop la fournit.`);
}

const hasDocument = () => typeof document !== "undefined";

// ---------------------------------------------------------------------------
// Picking files and folders
// ---------------------------------------------------------------------------

/** A user-picked file, through the picker when present, through `<input type=file>` otherwise. */
export async function pickFile(accept?: string): Promise<File> {
	if (typeof global.showOpenFilePicker === "function") {
		const [handle] = await global.showOpenFilePicker({ multiple: false });
		return handle.getFile();
	}
	if (!hasDocument()) return missing("showOpenFilePicker", "Ouvrir un fichier du disque");
	return new Promise<File>((resolve, reject) => {
		const input = document.createElement("input");
		input.type = "file";
		if (accept) input.accept = accept;
		input.addEventListener("change", () => {
			const file = input.files?.[0];
			if (file) resolve(file); else reject("Aucun fichier sélectionné.");
		});
		input.addEventListener("cancel", () => reject("Aucun fichier sélectionné."));
		input.click();
	});
}

/** A user-picked destination folder; `null` when the API is absent and downloads must be used. */
export async function pickDirectory(): Promise<DirHandle | null> {
	if (typeof global.showDirectoryPicker !== "function") return null;
	return global.showDirectoryPicker({ mode: "readwrite" }) as Promise<DirHandle>;
}

// ---------------------------------------------------------------------------
// Writing out
// ---------------------------------------------------------------------------

/** Trigger a plain browser download — the universal fallback for every "save to disk". */
export function download(name: string, bytes: Uint8Array | string, type = "application/octet-stream"): number {
	const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
	if (!hasDocument()) throw new Error("Aucun document pour déclencher un téléchargement.");
	const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = name.split("/").pop() ?? "export.bin";
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 30_000);
	return data.byteLength;
}

/** Write through `showSaveFilePicker` when available, else fall back to a download. */
export async function saveBytes(name: string, bytes: Uint8Array, type?: string): Promise<number> {
	if (typeof global.showSaveFilePicker === "function") {
		const handle: FileHandle = await global.showSaveFilePicker({ suggestedName: name.split("/").pop() });
		const writable = await handle.createWritable();
		await writable.write(bytes);
		await writable.close();
		return bytes.byteLength;
	}
	return download(name, bytes, type);
}

/** Write one file into a picked directory, creating intermediate folders. */
export async function writeInto(dir: DirHandle, relative: string, bytes: Uint8Array): Promise<number> {
	const parts = relative.split("/").filter(Boolean);
	const name = parts.pop() ?? "fichier.bin";
	let current = dir;
	for (const part of parts) current = await current.getDirectoryHandle(part, { create: true });
	const handle = await current.getFileHandle(name, { create: true });
	const writable = await handle.createWritable();
	await writable.write(bytes);
	await writable.close();
	return bytes.byteLength;
}

// ---------------------------------------------------------------------------
// OPFS — the browser stand-in for the desktop override folder
// ---------------------------------------------------------------------------

async function overridesRoot(create: boolean): Promise<DirHandle | null> {
	const storage = global.navigator?.storage;
	if (!storage || typeof storage.getDirectory !== "function") return null;
	const root: DirHandle = await storage.getDirectory();
	try {
		return await root.getDirectoryHandle("overrides", { create });
	} catch {
		return null;
	}
}

/** Flatten a VFS path into one OPFS file name so the store stays a single readable folder. */
const flatten = (path: string) => path.replace(/^\/+/u, "").replace(/\//gu, "%2F");
const unflatten = (name: string) => name.replace(/%2F/gu, "/");

/** Stage an override for a VFS path. Returns the byte count written. */
export async function writeOverride(path: string, base64: string): Promise<number> {
	const root = await overridesRoot(true);
	if (!root) return missing("navigator.storage.getDirectory (OPFS)", "Enregistrer une modification");
	const bytes = fromBase64(base64);
	const handle = await root.getFileHandle(flatten(path), { create: true });
	const writable = await handle.createWritable();
	await writable.write(bytes);
	await writable.close();
	return bytes.byteLength;
}

/** Read back a staged override, or `null` when nothing was staged for that path. */
export async function readOverride(path: string): Promise<string | null> {
	const root = await overridesRoot(false);
	if (!root) return null;
	try {
		const file = await (await root.getFileHandle(flatten(path))).getFile();
		return toBase64(await file.arrayBuffer());
	} catch {
		return null;
	}
}

/** Every override staged in this browser profile, shaped like the desktop `PackFileDto`. */
export async function listOverrides(): Promise<Array<{ name: string; path: string; size: number; modified: number | null }>> {
	const root = await overridesRoot(false);
	if (!root?.entries) return [];
	const out: Array<{ name: string; path: string; size: number; modified: number | null }> = [];
	for await (const [name, handle] of root.entries()) {
		if (handle.kind !== "file") continue;
		const file = await (handle as FileHandle).getFile();
		const path = unflatten(name);
		out.push({ name: path.split("/").pop() ?? path, path, size: file.size, modified: file.lastModified ?? null });
	}
	return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Drop staged overrides by VFS path; returns how many were removed. */
export async function removeOverrides(paths: string[]): Promise<number> {
	const root = await overridesRoot(false);
	if (!root) return 0;
	let removed = 0;
	for (const path of paths) {
		try { await root.removeEntry(flatten(path)); removed += 1; } catch { /* already gone */ }
	}
	return removed;
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

/** A browser cannot put file *references* on the clipboard; it can put their paths as text. */
export async function copyPathList(paths: string[]): Promise<null> {
	const clipboard = global.navigator?.clipboard;
	if (!clipboard || typeof clipboard.writeText !== "function") {
		return missing("navigator.clipboard.writeText", "Copier la liste de fichiers");
	}
	await clipboard.writeText(paths.join("\n"));
	return null;
}

// ---------------------------------------------------------------------------
// Describing a picked file the way the desktop describes a disk file
// ---------------------------------------------------------------------------

/** The `string[]` description shape `describe_disk_file` returns. */
export function describeFile(file: File): string[] {
	const lines = [
		`Nom : ${file.name}`,
		`Taille : ${file.size} octets`,
		`Type MIME : ${file.type || "inconnu"}`,
	];
	if (file.lastModified) lines.push(`Modifié : ${new Date(file.lastModified).toISOString()}`);
	return lines;
}
