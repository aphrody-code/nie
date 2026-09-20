/** Capture the frozen French name ordering as migration data, not a second collator.
 * Input: complete ignored teams oracle captured from rg 93aea3ba against the mirror.
 * Unknown future names are rejected by the Rust consumer until this index is regenerated.
 */
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    fixture: { type: "string" },
    "source-checkout": { type: "string" },
    output: { type: "string", default: "crates/tools/nie-wiki/src/legacy_team_collation.json" },
  },
  strict: true,
});
if (!values.fixture || !values["source-checkout"]) throw new Error("--fixture and --source-checkout are required");
const baseline = "93aea3ba8b703d8ca66ca8d3b98988edea3c97df";
const source = "packages/azalee/src/wiki/teams.ts";
const result = Bun.spawnSync(["git", "-C", values["source-checkout"], "rev-parse", `${baseline}:${source}`]);
if (result.exitCode !== 0) throw new Error("Frozen source is unavailable");
const sourceBlob = result.stdout.toString().trim();
type Case = { kind: string; expected: null | { name: string; roster: { name: string }[] } | { name: string }[] };
const cases: Case[] = await Bun.file(values.fixture).json();
const list = cases.find((entry) => entry.kind === "teams")?.expected;
if (!Array.isArray(list) || list.length !== 208) throw new Error("Complete 208-team reference required");
const details = cases.filter((entry) => entry.kind === "team" && entry.expected !== null);
if (details.length !== list.length) throw new Error("Complete team details required");
const names = new Set(list.map((team) => team.name));
let rosterMembers = 0;
for (const entry of details) {
  const team = entry.expected as { roster: { name: string }[] };
  for (const member of team.roster) { names.add(member.name); rosterMembers++; }
}
const corpus = [...names].sort();
const corpusSha256 = new Bun.CryptoHasher("sha256").update(JSON.stringify(corpus)).digest("hex");
const collator = new Intl.Collator("fr");
const sorted = [...corpus].sort(collator.compare);
let rank = 0;
const ranks: Record<string, number> = Object.create(null);
for (let index = 0; index < sorted.length; index++) {
  if (index > 0 && collator.compare(sorted[index - 1]!, sorted[index]!) !== 0) rank++;
  ranks[sorted[index]!] = rank;
}
await Bun.write(values.output!, JSON.stringify({ baseline, source, sourceBlob, locale: "fr", comparator: "Intl.Collator(fr), default options", corpusSha256, teams: list.length, rosterMembers, ranks }, null, 2) + "\n");
console.log(JSON.stringify({ teams: list.length, rosterMembers, names: names.size, ranks: rank + 1, corpusSha256 }));
