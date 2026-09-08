import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SecondaryScreen } from "./SecondaryScreen";

describe("secondary screen public identity", () => {
	test("names the site nie rather than the Aphrody character", () => {
		const html = renderToStaticMarkup(
			<SecondaryScreen currentView="textures" onSelect={() => {}} health={null}>
				content
			</SecondaryScreen>,
		);

		expect(html).toContain(">nie</button>");
		expect(html).not.toContain(">APHRODY</button>");
	});
});
