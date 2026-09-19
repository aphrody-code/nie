import fs from "fs";

const content = fs.readFileSync("var/mirror/ievr-ut/site/ievr-ultimate-team.fly.dev/assets/index-BJtdwxwy.js", "utf8");

console.log("File size:", content.length);

// Find all .from("...")
const fromMatches = new Set<string>();
const fromRegex = /\.from\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
let match;
while ((match = fromRegex.exec(content)) !== null) {
  fromMatches.add(match[1]);
}
console.log("Tables (.from):", Array.from(fromMatches));

// Find all .rpc("...")
const rpcMatches = new Set<string>();
const rpcRegex = /\.rpc\s*\(\s*["'`]([^"'`]+)["'`]/g;
while ((match = rpcRegex.exec(content)) !== null) {
  rpcMatches.add(match[1]);
}
console.log("RPC functions (.rpc):", Array.from(rpcMatches));

// Find storage buckets (.from("...") after storage or .getPublicUrl)
const storageRegex = /storage\s*\.\s*from\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
const bucketMatches = new Set<string>();
while ((match = storageRegex.exec(content)) !== null) {
  bucketMatches.add(match[1]);
}
console.log("Storage buckets:", Array.from(bucketMatches));

// Search for any supabase endpoints / table names mentioned in string literals
const stringRegex = /["'`]([a-zA-Z0-9_-]{3,30})["'`]/g;
const tableCandidates = new Set<string>();
while ((match = stringRegex.exec(content)) !== null) {
  const s = match[1];
  if (["jugadores", "equipos", "usuarios", "sobres", "recursos", "partidos", "mercado", "transacciones", "cartas", "alineaciones", "torneos"].some(k => s.includes(k))) {
    tableCandidates.add(s);
  }
}
console.log("Related keyword strings:", Array.from(tableCandidates));
