export type ProductKind = "desktop" | "cli" | "mobile" | "mcp" | "plugin" | "web" | "other";

export interface DownloadItem {
	id: string;
	name: string;
	kind: ProductKind;
	version?: string;
	platform?: string;
	architecture?: string;
	description?: string;
	url?: string;
	signatureUrl?: string;
	sha256?: string;
	bytes?: number;
	status: "available" | "unavailable" | "planned";
}

type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;

function inferKind(raw: RecordValue): ProductKind {
	const value = `${text(raw.kind) ?? ""} ${text(raw.type) ?? ""} ${text(raw.category) ?? ""} ${text(raw.name) ?? ""}`.toLowerCase();
	if (/desktop|windows|macos|linux|installer/.test(value)) return "desktop";
	if (/\bcli\b|command/.test(value)) return "cli";
	if (/mobile|android|ios/.test(value)) return "mobile";
	if (/\bmcp\b/.test(value)) return "mcp";
	if (/plugin|blender|extension/.test(value)) return "plugin";
	if (/\bweb\b|browser|navigateur/.test(value)) return "web";
	return "other";
}

function itemFrom(raw: RecordValue, index: number, parent?: RecordValue): DownloadItem {
	const combined = { ...parent, ...raw };
	const url = text(combined.url) ?? text(combined.download_url) ?? text(combined.downloadUrl) ?? text(combined.href);
	const statusText = (text(combined.status) ?? "").toLowerCase();
	const explicitlyUnavailable = combined.available === false || statusText === "unavailable" || statusText === "indisponible";
	const explicitlyPlanned = statusText === "planned" || statusText === "coming-soon" || statusText === "bientot";
	const name = text(combined.name) ?? text(combined.label) ?? text(combined.title) ?? `Distribution ${index + 1}`;
	return {
		id: text(combined.id) ?? `${inferKind(combined)}-${index}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
		name,
		kind: inferKind(combined),
		version: text(combined.version) ?? text(combined.tag),
		platform: text(combined.platform) ?? text(combined.os),
		architecture: text(combined.architecture) ?? text(combined.arch) ?? text(combined.target),
		description: text(combined.description) ?? text(combined.notes),
		url,
		signatureUrl: text(combined.signature_url) ?? text(combined.signatureUrl),
		sha256: text(combined.sha256),
		bytes: typeof combined.bytes === "number" && combined.bytes >= 0 ? combined.bytes : typeof combined.size === "number" && combined.size >= 0 ? combined.size : undefined,
		status: explicitlyUnavailable ? "unavailable" : explicitlyPlanned ? "planned" : url ? "available" : "unavailable",
	};
}

export function normalizeCatalog(payload: unknown): DownloadItem[] {
	if (!isRecord(payload)) throw new Error("Le catalogue n’est pas un objet JSON.");
	const roots = [payload.artifacts, payload.downloads, payload.items, payload.products].find(Array.isArray);
	if (!roots) return [];
	const flattened: Array<{ raw: RecordValue; parent?: RecordValue }> = [];
	for (const entry of roots) {
		if (!isRecord(entry)) continue;
		const children = [entry.artifacts, entry.downloads, entry.items, entry.platforms].find(Array.isArray);
		if (children) {
			for (const child of children) if (isRecord(child)) flattened.push({ raw: child, parent: entry });
		} else flattened.push({ raw: entry });
	}
	return flattened.map(({ raw, parent }, index) => itemFrom(raw, index, parent));
}

export function formatBytes(bytes?: number): string | undefined {
	if (bytes === undefined) return undefined;
	if (bytes < 1024) return `${bytes} o`;
	const units = ["Kio", "Mio", "Gio"];
	let value = bytes / 1024;
	let unit = units[0];
	for (let i = 1; i < units.length && value >= 1024; i += 1) { value /= 1024; unit = units[i]; }
	return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}
