import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "../..");
const localData = resolve(PACKAGE_ROOT, "data");

console.log("import.meta.url:", import.meta.url);
console.log("__dirname:", __dirname);
console.log("PACKAGE_ROOT:", PACKAGE_ROOT);
console.log("localData:", localData);
console.log("localData exists:", existsSync(localData));
console.log("localData/common exists:", existsSync(join(localData, "common")));
