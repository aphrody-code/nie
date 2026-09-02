/**
 * Utility to export entities to different formats (Markdown, JSX)
 * Useful for the Agent to generate rich content or code snippets.
 */

export interface ExportableEntity {
	id: string;
	name: string;
	description?: string;
	image?: string;
	attributes?: Record<string, string | number | undefined>;
}

export const EntityExporters = {
	/**
	 * Generates a clean Markdown card
	 */
	toMarkdown: (
		entity: {
			name?: string;
			names?: { fr?: string; en?: string; ja?: string };
			description?: string;
			descriptions?: { fr?: string; en?: string };
			attributes?: Record<string, string | number | undefined>;
			position?: string;
			element?: string | number;
			bestRarity?: string;
			teamName?: string;
			[key: string]: any;
		},
		type: string
	) => {
		// Handle name resolution from localized names if present
		let displayName = entity.name;
		if (!displayName && entity.names) {
			displayName = entity.names.fr || entity.names.en || entity.names.ja;
		}
		if (!displayName) displayName = "Unknown";

		let md = `### ${displayName} (${type})\n\n`;
		if (entity.description || entity.descriptions) {
			const desc = entity.description || entity.descriptions?.fr || entity.descriptions?.en;
			if (desc) md += `> ${desc}\n\n`;
		}

		const attributes = { ...(entity.attributes || {}) };

		// Character specific
		if (entity.position && !attributes.Position) attributes.Position = entity.position;
		if (entity.element && !attributes.Élément) attributes.Élément = entity.element;
		if (entity.bestRarity && !attributes.Rareté) attributes.Rareté = entity.bestRarity;
		if (entity.teamName && !attributes.Équipe) attributes.Équipe = entity.teamName;

		if (Object.keys(attributes).length > 0) {
			md += "| Attribut | Valeur |\n| --- | --- |\n";
			for (const [key, val] of Object.entries(attributes)) {
				if (val !== undefined && val !== null) {
					md += `| **${key}** | ${val} |\n`;
				}
			}
		}
		return md;
	},

	/**
	 * Generates a React/Next.js Component snippet (JSX String)
	 * Compatible with the project's UI components (Card, Badge, etc.)
	 */
	toReact: (entity: ExportableEntity) => {
		const props = Object.entries(entity.attributes || {})
			.filter(([_, v]) => v !== undefined)
			.map(
				([k, v]) =>
					`  <div className="flex justify-between"><span className="text-muted-foreground">${k}:</span> <span>${v}</span></div>`
			)
			.join("\n");

		return `
<Card className="w-full max-w-md">
  <CardHeader>
    <CardTitle>${entity.name}</CardTitle>
    ${entity.description ? `<CardDescription>${entity.description}</CardDescription>` : ""}
  </CardHeader>
  <CardContent className="grid gap-2 text-sm">
${props}
  </CardContent>
</Card>
`.trim();
	},
};
