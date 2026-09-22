import { existsSync, lstatSync, mkdirSync, readdirSync, symlinkSync, unlinkSync } from "fs";
import { dirname, join, relative, resolve } from "path";

const root = resolve(import.meta.dir, "..");
const src = resolve(root, "plugins/nie/skills");
const dest = resolve(root, ".agents/skills");
mkdirSync(dest, { recursive: true });

for (const name of readdirSync(src)) {
  const source = join(src, name);
  const target = join(dest, name);
  if (!lstatSync(source).isDirectory()) {
    continue;
  }

  if (existsSync(target)) continue;
  try {
    if (lstatSync(target).isSymbolicLink()) unlinkSync(target);
    else continue;
  } catch { /* target does not exist, create it below */ }

  symlinkSync(relative(dirname(target), source), target, "dir");
  console.log(`Linked skill: ${name}`);
}
