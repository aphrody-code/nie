import fs from "fs";

const js = fs.readFileSync("var/mirror/ievr-ut/site/ievr-ultimate-team.fly.dev/assets/index-BJtdwxwy.js", "utf8");

const chunkRegex = /"assets\/([^"]+\.(?:js|css))"/g;
const chunks = new Set<string>();
let match;
while ((match = chunkRegex.exec(js)) !== null) {
  chunks.add(match[1]);
}

console.log(`Found ${chunks.size} code-split chunks in index.js:`);
for (const c of Array.from(chunks).sort()) {
  console.log(" -", c);
}

fs.writeFileSync("var/mirror/ievr-ut/chunks.txt", Array.from(chunks).sort().join("\n"));
