export interface TocItem {
	id: string;
	text: string;
	level: 2 | 3;
}

function slugify(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFD")
		.replaceAll(/[\u0300-\u036F]/g, "")
		.replaceAll(/[^a-z0-9]+/g, "-")
		.replaceAll(/^-+|-+$/g, "");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTextFromNode(node: any): string {
	if (node.text) {
		return node.text;
	}
	if (node.children) {
		return node.children.map(extractTextFromNode).join("");
	}
	return "";
}

/**
 * Extrait les titres H2/H3 d'un contenu Lexical JSON pour générer un sommaire
 */
export function extractTableOfContents(content: string): TocItem[] {
	try {
		const parsed =
			typeof content === "string" && content.startsWith("{")
				? JSON.parse(content)
				: typeof content === "object"
					? content
					: null;

		if (!parsed?.root?.children) {
			return [];
		}

		const items: TocItem[] = [];
		const slugCounts = new Map<string, number>();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		for (const node of parsed.root.children as any[]) {
			if (node.type === "heading" && (node.tag === "h2" || node.tag === "h3")) {
				const text = extractTextFromNode(node).trim();
				if (!text) {
					continue;
				}

				let slug = slugify(text);

				// Ensure unique slugs
				const count = slugCounts.get(slug) || 0;
				slugCounts.set(slug, count + 1);
				if (count > 0) {
					slug = `${slug}-${count}`;
				}

				items.push({
					id: slug,
					level: node.tag === "h2" ? 2 : 3,
					text,
				});
			}
		}

		return items;
	} catch {
		return [];
	}
}
