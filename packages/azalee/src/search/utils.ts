export function normalizeText(text: string | null | undefined): string {
	if (!text) {
		return "";
	}
	return text
		.normalize("NFD")
		.replaceAll(/[\u0300-\u036F]/g, "") // Remove accents
		.toLowerCase();
}
