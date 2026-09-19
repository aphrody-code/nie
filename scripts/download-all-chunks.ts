import fs from "fs";

const BASE = "https://ievr-ultimate-team.fly.dev/assets";
const outDir = "var/mirror/ievr-ut/site/ievr-ultimate-team.fly.dev/assets";
fs.mkdirSync(outDir, { recursive: true });

const chunks = fs.readFileSync("var/mirror/ievr-ut/chunks.txt", "utf8").trim().split("\n");

console.log(`Downloading ${chunks.length} chunks...`);

let downloaded = 0;
let errors = 0;

async function downloadChunk(chunk: string) {
  const url = `${BASE}/${chunk}`;
  const target = `${outDir}/${chunk}`;
  if (fs.existsSync(target) && fs.statSync(target).size > 0) {
    downloaded++;
    return;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Failed ${chunk}: HTTP ${res.status}`);
      errors++;
      return;
    }
    const buf = await res.arrayBuffer();
    fs.writeFileSync(target, Buffer.from(buf));
    downloaded++;
  } catch (err: any) {
    console.error(`Error ${chunk}:`, err.message);
    errors++;
  }
}

async function main() {
  const batchSize = 10;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    await Promise.all(batch.map(downloadChunk));
    process.stdout.write(`\rProgress: ${downloaded}/${chunks.length} (errors: ${errors})`);
  }
  console.log(`\nFinished: ${downloaded} downloaded, ${errors} errors.`);
}

main().catch(console.error);
