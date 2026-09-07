import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type Manifest = {
  canonicalPlan: string;
  instructionFiles: string[];
  planAppendices: string[];
  stalePatterns: string[];
  externalSitePrefixes: string[];
  allowedBrokenLinks: Record<string, string[]>;
};

const root = process.cwd();
const manifestPath = resolve(root, "docs/docs-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
const failures: string[] = [];
const tracked = Bun.spawnSync(["git", "ls-files", "*.md"]).stdout.toString().trim().split(/\r?\n/).filter(Boolean);

function requireFile(path: string, reason: string) {
  if (!existsSync(resolve(root, path))) failures.push(`${path}: ${reason}`);
}

function linkCandidates(sourcePath: string, rawTarget: string): string[] {
  const source = resolve(root, sourcePath);
  const candidates = [resolve(dirname(source), rawTarget)];
  if (sourcePath.startsWith(".agents/plugins/")) {
    const mirror = sourcePath.replace(/^\.agents\//, "");
    candidates.push(resolve(dirname(resolve(root, mirror)), rawTarget));
  }
  if (sourcePath.startsWith(".agents/skills/")) {
    const mirror = `plugins/niers-plugin/skills/${sourcePath.slice(".agents/skills/".length)}`;
    candidates.push(resolve(dirname(resolve(root, mirror)), rawTarget));
  }
  return candidates;
}

requireFile(manifest.canonicalPlan, "canonical plan is missing");
for (const path of [...manifest.instructionFiles, ...manifest.planAppendices]) requireFile(path, "manifest entry is missing");

for (const path of manifest.instructionFiles) {
  const bytes = readFileSync(resolve(root, path)).byteLength;
  if (bytes > 32 * 1024) failures.push(`${path}: ${bytes} bytes exceeds the 32 KiB instruction budget`);
}

const linkPattern = /!?(?:\[[^\]]*\])\(([^)]+)\)/g;
let linkCount = 0;
for (const path of tracked) {
  const source = readFileSync(resolve(root, path), "utf8");
  for (const match of source.matchAll(linkPattern)) {
    const raw = match[1].trim().split(/\s+/)[0].replace(/^<|>$/g, "");
    if (!raw || raw.startsWith("#") || raw.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    if (manifest.externalSitePrefixes.some((prefix) => raw.startsWith(prefix))) continue;
    linkCount++;
    const target = raw.split("#", 1)[0].split("?", 1)[0];
    if (!target) continue;
    const candidates = linkCandidates(path, target);
    if (!candidates.some((candidate) => existsSync(candidate)) && !manifest.allowedBrokenLinks[path]?.includes(raw)) {
      failures.push(`${path}: broken internal link ${raw}`);
    }
  }
  for (const stale of manifest.stalePatterns) {
    if (source.includes(stale)) failures.push(`${path}: stale fact or policy pattern ${JSON.stringify(stale)}`);
  }
}

const rootPlan = readFileSync(resolve(root, manifest.canonicalPlan), "utf8");
if (!rootPlan.includes("Référentiel canonique") && !rootPlan.includes("canonical")) {
  failures.push(`${manifest.canonicalPlan}: canonical-plan marker is missing`);
}
const generatedWriters = Bun.spawnSync(["rg", "-l", "writeFileSync\\(.*(PLAN|README|AGENTS)", "scripts", "-g", "*.ts"]).stdout.toString().trim().split(/\r?\n/).filter(Boolean);
if (generatedWriters.length) console.log(`notice: generated document writers require source review: ${generatedWriters.join(", ")}`);

const allowedBrokenLinkCount = Object.values(manifest.allowedBrokenLinks).reduce((count, links) => count + links.length, 0);
console.log(JSON.stringify({ markdownFiles: tracked.length, internalLinks: linkCount, allowedBrokenLinks: allowedBrokenLinkCount, instructionFiles: manifest.instructionFiles.length, failures: failures.length }, null, 2));
if (failures.length) {
  console.error(failures.map((failure) => `ERROR ${failure}`).join("\n"));
  process.exit(1);
}
console.log("docs:check passed");
