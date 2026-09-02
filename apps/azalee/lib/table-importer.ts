import { parse } from "csv-parse/sync";
import { google } from "googleapis";

export async function fetchGoogleSheetData(sheetId: string): Promise<string[][]> {
	const auth = new google.auth.GoogleAuth({
		apiKey: process.env.GOOGLE_API_KEY,
		scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
	});

	const sheets = google.sheets({ auth, version: "v4" });

	try {
		const response = await sheets.spreadsheets.values.get({
			range: "A1:Z1000", // Default range, fetches first sheet up to 1000 rows
			spreadsheetId: sheetId,
		});

		return (response.data.values as string[][]) || [];
	} catch (error) {
		console.error("Error fetching Google Sheet:", error);
		throw new Error("Impossible de récupérer le Google Sheet. Vérifiez l'ID et qu'il est public.", {
			cause: error,
		});
	}
}

export function parseCsvData(csvString: string): string[][] {
	try {
		const records = parse(csvString, {
			relax_column_count: true,
			skip_empty_lines: true,
		});
		return records as string[][];
	} catch (error) {
		console.error("Error parsing CSV:", error);
		throw new Error("Format CSV invalide.", { cause: error });
	}
}

export function convertTableToHtml(data: string[][], title: string = "Tableau de données"): string {
	if (!data || data.length === 0) {
		return "";
	}

	// Helper to escape HTML to prevent XSS (basic)
	const escape = (str: string) =>
		str.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

	let html = `
    <div class="my-8 w-full overflow-hidden rounded-[24px] border border-outline-variant/50 shadow-sm bg-surface">
      <div class="px-6 py-4 bg-surface-container border-b border-outline-variant/20">
        <h3 class="type-title-large text-on-surface font-medium">${escape(title)}</h3>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full caption-bottom text-sm border-collapse">
  `;

	// Header (First row)
	const header = data[0];
	html += '<thead class="bg-surface-container-low text-on-surface-variant"><tr>';
	header.forEach((cell) => {
		html += `<th class="h-12 px-4 text-left align-middle font-medium border-b border-outline-variant/20 whitespace-nowrap">${escape(cell)}</th>`;
	});
	html += "</tr></thead>";

	// Body
	html += "<tbody>";
	for (let i = 1; i < data.length; i++) {
		const row = data[i];
		html +=
			'<tr class="border-b border-outline-variant/10 hover:bg-surface-container-high/50 transition-colors">';
		row.forEach((cell) => {
			html += `<td class="p-4 align-middle text-on-surface whitespace-nowrap">${escape(cell)}</td>`;
		});
		html += "</tr>";
	}
	html += "</tbody></table></div></div>";

	return html;
}
