import type { SerializedEditorState } from "lexical";

export function generateSlug(title: string): string {
	return title
		.toLowerCase()
		.normalize("NFD")
		.replaceAll(/[\u0300-\u036F]/g, "")
		.replaceAll(/[^\w\s-]/g, "")
		.replaceAll(/\s+/g, "-")
		.replaceAll(/-+/g, "-")
		.replaceAll(/^-|-$/g, "");
}

export function countWords(content: SerializedEditorState): number {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function extractText(node: any): string {
		if (node.text) {
			return node.text;
		}
		if (node.children) {
			return node.children.map(extractText).join(" ");
		}
		return "";
	}
	const text = extractText(content.root);
	return text
		.trim()
		.split(/\s+/)
		.filter((w: string) => w.length > 0).length;
}

export function estimateReadTime(wordCount: number): number {
	// 300 wpm = lecture rapide adulte (presse/web). Aligne avec le rendu public.
	return Math.max(1, Math.ceil(wordCount / 300));
}

export function parseInitialContent(
	content: string | SerializedEditorState | null | undefined,
	emptyContent: SerializedEditorState
): SerializedEditorState {
	if (!content) {
		return emptyContent;
	}
	if (typeof content === "object") {
		return content;
	}
	try {
		return JSON.parse(content);
	} catch {
		return emptyContent;
	}
}

/**
 * Convertit une ISO string UTC en `value` consommable par `<input type="datetime-local">`,
 * qui attend le format `YYYY-MM-DDTHH:mm` exprimé en HEURE LOCALE.
 *
 * `new Date(iso).toISOString().slice(0, 16)` donne du UTC et décale donc l'heure
 * affichée — ce qui se répercute à la sauvegarde puisque l'input est ré-interprété
 * en local. On rebase ici sur l'offset du fuseau du navigateur.
 */
export function isoToDatetimeLocal(iso: string | null | undefined): string {
	if (!iso) {
		return "";
	}
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) {
		return "";
	}
	const offsetMs = d.getTimezoneOffset() * 60_000;
	return new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);
}

/**
 * Inverse de `isoToDatetimeLocal` : prend la valeur du `<input type="datetime-local">`
 * (heure locale), produit l'ISO UTC à stocker en DB.
 */
export function datetimeLocalToIso(value: string | null | undefined): string | null {
	if (!value) {
		return null;
	}
	const d = new Date(value);
	if (Number.isNaN(d.getTime())) {
		return null;
	}
	return d.toISOString();
}
