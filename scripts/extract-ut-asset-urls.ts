import fs from "fs";

const dbDir = "var/mirror/ievr-ut/db";
const files = fs.readdirSync(dbDir).filter(f => f.endsWith(".json"));

const urls = new Set<string>();
const urlRegex = /https?:\/\/[^\s"',]+\.(?:png|jpg|jpeg|webp|gif|svg|mp3|ogg|wav)/gi;

for (const file of files) {
  const content = fs.readFileSync(`${dbDir}/${file}`, "utf8");
  let match;
  while ((match = urlRegex.exec(content)) !== null) {
    urls.add(match[0]);
  }
}

console.log(`Found ${urls.size} unique asset URLs across all tables`);

const byDomain: Record<string, number> = {};
for (const url of urls) {
  try {
    const domain = new URL(url).hostname;
    byDomain[domain] = (byDomain[domain] || 0) + 1;
  } catch {}
}

console.log("Assets by domain:", byDomain);

fs.writeFileSync("var/mirror/ievr-ut/asset_urls.txt", Array.from(urls).sort().join("\n"));
