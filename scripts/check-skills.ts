import { existsSync, readdirSync } from "fs";
import { join } from "path";

const dir = "plugins/niers-plugin/skills";
const skills = readdirSync(dir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const invalid = skills.filter((skill) => !existsSync(join(dir, skill, "SKILL.md")));
if (invalid.length > 0) {
  throw new Error(`Missing SKILL.md: ${invalid.join(", ")}`);
}

for (const s of skills) {
  const p = join(dir, s, "SKILL.md");
  await Bun.file(p).text();
}
console.log(`All ${skills.length} plugin skills have valid SKILL.md files`);
