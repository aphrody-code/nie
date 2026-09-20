/** Non-mutating payload checks for an isolated, content-backed Azalee migration candidate. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const base = new URL(process.argv[2] ?? "http://127.0.0.1:19323");
assert.equal(base.protocol, "http:");
assert.equal(base.hostname, "127.0.0.1", "Only isolated local candidates are accepted");
const evidence: Array<{ contract: string; passed: boolean; milliseconds: number; error?: string }> = [];
const request = (path: string, redirect: "follow" | "manual" | "error" = "follow") => fetch(new URL(path, base), {
	redirect, signal: AbortSignal.timeout(45_000),
});
async function json<T>(path: string): Promise<T> {
	const response = await request(path);
	assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
	assert.match(response.headers.get("content-type") ?? "", /application\/json/);
	return response.json() as Promise<T>;
}
async function check(contract: string, work: () => Promise<void>) {
	const start = performance.now();
	try {
		await work();
		evidence.push({ contract, passed: true, milliseconds: Math.round(performance.now() - start) });
	} catch (error) {
		evidence.push({ contract, passed: false, milliseconds: Math.round(performance.now() - start), error: String(error) });
	}
}

await check("canonical character count, combined filters and pagination", async () => {
	type Page = { total: number; page: number; elements: Array<{ id: string; gender: string }> };
	const all = await json<Page>("/api/v1/chara?per_page=2");
	assert.equal(all.total, 6166);
	assert.equal(all.elements.length, 2);
	const first = await json<Page>("/api/v1/chara?q=Byron&gender=M&per_page=2");
	const second = await json<Page>("/api/v1/chara?q=Byron&gender=M&per_page=2&page=2");
	assert.equal(first.total, 8);
	assert.equal(second.total, first.total);
	assert.equal(second.page, 2);
	assert.equal(new Set([...first.elements, ...second.elements].map(row => row.id)).size, 4);
	assert.ok([...first.elements, ...second.elements].every(row => row.gender === "M"));
});

await check("Byron BASARA screenshot statistics and exact variant", async () => {
	const card = await json<{ character: { id: string }; statsLv99: Record<string, number>; variants: unknown[]; learnedSkills: unknown[]; descriptionFr: string }>("/api/v1/wiki/characters/0x12B74634");
	assert.equal(card.character.id, "0x12B74634");
	assert.deepEqual(card.statsLv99, { kick: 238, control: 258, technique: 250, pressure: 211, physical: 210, agility: 195, intelligence: 230 });
	assert.equal(Object.values(card.statsLv99).reduce((total, value) => total + value, 0), 1592);
	assert.ok(card.variants.length > 1 && card.learnedSkills.length > 0 && card.descriptionFr.length > 0);
});

await check("tool roster, variant skill hashes and staff retain native DTO types", async () => {
	const roster = await json<Array<{ id: string; rarity_label: string; stat_frappe: number; stat_controle: number }>>("/api/v1/wiki/roster");
	assert.ok(roster.length > 6000);
	assert.equal(new Set(roster.map(row => row.id)).size, roster.length);
	const byron = roster.find(row => row.id === "0x12B74634");
	assert.ok(byron);
	assert.equal(byron.rarity_label, "BASARA");
	assert.equal(byron.stat_frappe, 238);
	assert.equal(byron.stat_controle, 258);
	const skills = await json<Array<{ id: string; name_fr: string }>>("/api/v1/wiki/characters/0x12B74634/skills");
	assert.equal(skills.length, 6);
	assert.ok(skills.every(skill => skill.id && skill.name_fr));
	const staff = await json<Array<{ id: number; role: string }>>("/api/v1/wiki/staff");
	assert.ok(staff.length > 100 && staff.every(row => typeof row.id === "number"));
});

await check("editorial gallery inventory, categories and source-backed records", async () => {
	const gallery = await json<{ total: number; records: Array<{ id: string }>; categories: Array<{ id: string; count: number }> }>("/api/v1/wiki/gallery?view=editorial&limit=20");
	assert.equal(gallery.total, 3939);
	assert.equal(gallery.records.length, 20);
	assert.equal(gallery.categories.length, 11);
	assert.equal(gallery.categories.reduce((total, category) => total + category.count, 0), 3939);
	assert.equal(new Set(gallery.records.map(row => row.id)).size, 20);
	const story = await json<{ total: number; records: Array<{ category: string }> }>("/api/v1/wiki/gallery?view=editorial&category=story&q=Story&limit=2");
	assert.ok(story.total > 0 && story.records.length > 0);
	assert.ok(story.records.every(record => record.category === "story"));
});

await check("legacy redirects preserve locale, exact selection and filters", async () => {
	for (const [path, destination, params] of [
		["/en/gallery?category=story&q=Story&page=2", "/en/gallery_menu", { categorie: "story", q: "Story", page: "2", view: "editorial" }],
		["/en/chara/0x12B74634", "/en/chara_bank_menu", { chara: "0x12B74634" }],
		["/ja/tools/compare?q=Byron&level=99", "/ja/inacord/tools", { tool: "compare", q: "Byron", level: "99" }],
	] as const) {
		const response = await request(path, "manual");
		assert.ok([301, 302, 307, 308].includes(response.status), `${path}: HTTP ${response.status}`);
		const location = new URL(response.headers.get("location")!, base);
		assert.equal(location.pathname, destination);
		for (const [key, value] of Object.entries(params)) assert.equal(location.searchParams.get(key), value);
	}
});

await check("split VFS manifest and secondary archive wire integrity", async () => {
	const manifest = await json<{ archives: Array<{ id: string; url: string; paths: string[]; bytes: number; sha256: string }> }>("/static/game/vfs/manifest.json");
	assert.deepEqual(manifest.archives.map(archive => archive.id).sort(), ["item_atlas", "menu", "native_tables", "profile"]);
	const paths = manifest.archives.flatMap(archive => archive.paths);
	assert.equal(paths.length, 85);
	assert.equal(new Set(paths).size, paths.length);
	const archive = manifest.archives.find(entry => entry.id === "native_tables")!;
	assert.match(archive.url, /^\/static\/game\/vfs\/native_tables_[a-f0-9]{64}\.nievfs$/);
	const response = await request(archive.url);
	assert.equal(response.status, 200);
	const bytes = Buffer.from(await response.arrayBuffer());
	assert.equal(bytes.length, archive.bytes);
	assert.equal(createHash("sha256").update(bytes).digest("hex"), archive.sha256);
});

const report = { measuredAt: new Date().toISOString(), scope: "local candidate HTTP payloads, not browser or native visual parity", passed: evidence.filter(check => check.passed).length, total: evidence.length, evidence };
console.log(JSON.stringify(report, null, 2));
if (process.argv[3]) await Bun.write(process.argv[3], JSON.stringify(report, null, 2) + "\n");
if (report.passed !== report.total) process.exitCode = 1;
