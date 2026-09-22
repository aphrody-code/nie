import { existsSync, lstatSync, mkdirSync, readdirSync, symlinkSync } from "fs";
import { dirname, join, relative, resolve } from "path";

const root = resolve(import.meta.dir, "..");
const src = resolve(root, "plugins/niers-plugin/skills");
const dest = resolve(root, ".agents/skills");
mkdirSync(dest, { recursive: true });

for (const name of readdirSync(src)) {
  const source = join(src, name);
  const target = join(dest, name);
  if (!lstatSync(source).isDirectory() || existsSync(target)) {
    continue;
  }

  symlinkSync(relative(dirname(target), source), target, "dir");
  console.log(`Linked skill: ${name}`);
}
