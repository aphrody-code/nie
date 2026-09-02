import type { docs_v1 } from "googleapis";

type Paragraph = docs_v1.Schema$Paragraph;
type Table = docs_v1.Schema$Table;
type TextRun = docs_v1.Schema$TextRun;

export function convertGoogleDocToHtml(doc: docs_v1.Schema$Document): string {
	if (!doc.body?.content) {
		return "";
	}

	let html = "";
	let listState: { listId: string; nestingLevel: number } | null = null;

	for (const element of doc.body.content) {
		if (element.paragraph) {
			// Handle Lists
			if (element.paragraph.bullet) {
				const listId = element.paragraph.bullet.listId || "unknown";
				const nestingLevel = element.paragraph.bullet.nestingLevel || 0;

				if (!listState || listState.listId !== listId) {
					if (listState) {
						html += "</ul>";
					} // Close previous list
					html += '<ul class="list-disc pl-6 mb-4 space-y-2">';
					listState = { listId, nestingLevel };
				}

				// Render list item
				const content = renderParagraphContent(element.paragraph, doc);
				html += `<li class="text-on-surface type-body-large">${content}</li>`;
			} else {
				// Close list if we were in one
				if (listState) {
					html += "</ul>";
					listState = null;
				}
				html += renderParagraph(element.paragraph, doc);
			}
		} else if (element.table) {
			if (listState) {
				html += "</ul>";
				listState = null;
			}
			html += renderTable(element.table, doc);
		} else if (element.sectionBreak) {
			// Ignore or handle section breaks
		}
	}

	if (listState) {
		html += "</ul>";
	}

	return html;
}

function renderParagraph(paragraph: Paragraph, doc: docs_v1.Schema$Document): string {
	const style = paragraph.paragraphStyle?.namedStyleType || "NORMAL_TEXT";
	const content = renderParagraphContent(paragraph, doc);

	if (!content.trim() && !hasImage(paragraph)) {
		return "";
	}

	switch (style) {
		case "TITLE": {
			return `<h1 class="type-display-medium text-on-surface font-normal mb-6 mt-8">${content}</h1>`;
		}
		case "SUBTITLE": {
			return `<p class="type-headline-small text-on-surface-variant mb-8">${content}</p>`;
		}
		case "HEADING_1": {
			return `<h2 class="type-headline-medium text-primary mt-10 mb-4 border-b border-outline-variant/50 pb-2">${content}</h2>`;
		}
		case "HEADING_2": {
			return `<h3 class="type-headline-small text-on-surface mt-8 mb-4 font-medium">${content}</h3>`;
		}
		case "HEADING_3": {
			return `<h4 class="type-title-large text-on-surface mt-6 mb-3 font-medium">${content}</h4>`;
		}
		case "HEADING_4": {
			return `<h5 class="type-title-medium text-on-surface mt-4 mb-2 font-bold">${content}</h5>`;
		}
		case "HEADING_5": {
			return `<h6 class="type-title-small text-on-surface mt-4 mb-2 font-bold uppercase tracking-wider opacity-80">${content}</h6>`;
		}
		default: {
			return `<p class="type-body-large text-on-surface-variant mb-4 leading-relaxed">${content}</p>`;
		}
	}
}

function renderParagraphContent(paragraph: Paragraph, doc: docs_v1.Schema$Document): string {
	if (!paragraph.elements) {
		return "";
	}

	return paragraph.elements
		.map((el) => {
			if (el.textRun) {
				return formatTextRun(el.textRun);
			} else if (el.inlineObjectElement) {
				return renderImage(el.inlineObjectElement, doc);
			}
			return "";
		})
		.join("");
}

function hasImage(paragraph: Paragraph): boolean {
	return paragraph.elements?.some((el) => Boolean(el.inlineObjectElement)) ?? false;
}

function renderImage(
	element: docs_v1.Schema$InlineObjectElement,
	doc: docs_v1.Schema$Document
): string {
	const objectId = element.inlineObjectId;
	if (!objectId || !doc.inlineObjects) {
		return "";
	}

	const inlineObject = doc.inlineObjects[objectId];
	const embeddedObject = inlineObject?.inlineObjectProperties?.embeddedObject;
	const src = embeddedObject?.imageProperties?.contentUri;

	if (src) {
		return `<div class="my-6 flex justify-center"><img src="${src}" class="rounded-[24px] max-w-full h-auto shadow-level-2 border border-outline-variant/20" alt="Image importée" /></div>`;
	}
	return "";
}

function formatTextRun(textRun: TextRun): string {
	let text = textRun.content || "";

	// Basic escaping
	text = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
	text = text.replaceAll("\n", "<br>"); // Preserve line breaks within runs if needed, or remove them

	const style = textRun.textStyle;
	if (!style) {
		return text;
	}

	if (style.link?.url) {
		text = `<a href="${style.link.url}" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline underline-offset-4 decoration-2 font-medium transition-colors">${text}</a>`;
	}
	if (style.bold) {
		text = `<strong class="font-bold text-on-surface">${text}</strong>`;
	}
	if (style.italic) {
		text = `<em class="italic text-on-surface-variant">${text}</em>`;
	}
	if (style.underline && !style.link) {
		text = `<u class="decoration-outline decoration-1 underline-offset-4">${text}</u>`;
	}
	if (style.strikethrough) {
		text = `<s class="opacity-70">${text}</s>`;
	}

	return text;
}

function renderTable(table: Table, doc: docs_v1.Schema$Document): string {
	if (!table.tableRows) {
		return "";
	}

	let html =
		'<div class="w-full overflow-auto my-6 rounded-[16px] border border-outline-variant/50"><table class="w-full caption-bottom text-sm border-collapse">';

	table.tableRows.forEach((row, rowIndex) => {
		html +=
			'<tr class="border-b border-outline-variant/20 hover:bg-surface-container-high/50 transition-colors">';
		row.tableCells?.forEach((cell) => {
			// Render cell content (can contain paragraphs)
			let cellContent = "";
			cell.content?.forEach((element) => {
				if (element.paragraph) {
					// Inside tables, simplify paragraphs to avoid huge margins
					const pContent = renderParagraphContent(element.paragraph, doc);
					if (pContent.trim()) {
						cellContent += `<div class="mb-1">${pContent}</div>`;
					}
				}
			});

			// Heuristic: First row is often header
			const isHeader = rowIndex === 0;
			const tag = isHeader ? "th" : "td";
			const classes = isHeader
				? "h-12 px-4 text-left align-middle font-medium text-on-surface bg-surface-container"
				: "p-4 align-middle text-on-surface-variant";

			html += `<${tag} class="${classes}">${cellContent}</${tag}>`;
		});
		html += "</tr>";
	});

	html += "</table></div>";
	return html;
}
