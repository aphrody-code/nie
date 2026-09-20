import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Loading, needsStartupRecovery } from "./Loading";

describe("loading screen evidence boundary", () => {
	test("keeps unknown and in-progress health on the readiness screen", () => {
		expect(needsStartupRecovery(null, false)).toBeFalse();
		expect(
			needsStartupRecovery({ capacites: { vfs: "en_cours" } } as never, false),
		).toBeFalse();
	});

	test("uses the recovery state when VFS pixels cannot be served", () => {
		expect(needsStartupRecovery(null, true)).toBeTrue();
		expect(needsStartupRecovery({ capacites: { vfs: "absent" } } as never, false)).toBeTrue();
	});

	test("does not render the game layout in the failed fallback", () => {
		const html = renderToStaticMarkup(<Loading health={null} failed onRetry={() => {}} />);
		expect(html).toContain('role="alert"');
		expect(html).toContain('aria-label="Réessayer"');
		expect(html).not.toContain("loading01_01_fade_loading");
		expect(html).not.toContain("/pet/");
	});

	test("renders a zero-asset readiness surface", () => {
		const html = renderToStaticMarkup(<Loading health={null} />);
		expect(html).toContain('role="status"');
		expect(html).toContain('class="screen-status"');
		expect(html).not.toContain("img");
		expect(html).not.toContain("video");
		expect(html).not.toContain("audio");
		expect(html).not.toContain("canvas");
		expect(html).not.toContain("Passer");
		expect(html).not.toContain("Accéder au menu principal");
	});
});
