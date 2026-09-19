import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";

const ROOT = join(import.meta.dir, "..");
const ASSET_URLS_FILE = join(ROOT, "var/mirror/ievr-ut/asset_urls.txt");
const ASSETS_DIR = join(ROOT, "var/mirror/ievr-ut/assets");
const MANIFEST_FILE = join(ROOT, "var/mirror/ievr-ut/assets_manifest.json");

if (!existsSync(ASSETS_DIR)) {
  mkdirSync(ASSETS_DIR, { recursive: true });
}

const urls = readFileSync(ASSET_URLS_FILE, "utf-8")
  .split("\n")
  .map(u => u.trim())
  .filter(Boolean);

console.log(`Found ${urls.length} unique asset URLs to mirror`);

interface ManifestEntry {
  url: string;
  localPath: string;
  size: number;
  contentType: string;
  sha256: string;
}

const manifest: Record<string, ManifestEntry> = existsSync(MANIFEST_FILE)
  ? JSON.parse(readFileSync(MANIFEST_FILE, "utf-8"))
  : {};

function getLocalRelativePath(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    let pathname = decodeURIComponent(parsed.pathname);
    if (pathname.startsWith("/")) pathname = pathname.slice(1);
    
    // Prefix by host domain to prevent collisions
    const hostDir = parsed.hostname.replace(/[^a-zA-Z0-9.-]/g, "_");
    return join(hostDir, pathname);
  } catch {
    const hash = createHash("sha256").update(urlStr).digest("hex").slice(0, 16);
    return join("misc", `${hash}.bin`);
  }
}

async function downloadAsset(url: string, index: number, total: number): Promise<void> {
  const relPath = getLocalRelativePath(url);
  const absPath = join(ASSETS_DIR, relPath);

  if (manifest[url] && existsSync(absPath)) {
    return;
  }

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        "Referer": "https://ievr-ultimate-team.fly.dev/",
      }
    });

    if (!res.ok) {
      console.warn(`[${index + 1}/${total}] HTTP ${res.status} for ${url}`);
      return;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const hash = createHash("sha256").update(buffer).digest("hex");
    const contentType = res.headers.get("content-type") || "application/octet-stream";

    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, buffer);

    manifest[url] = {
      url,
      localPath: relPath,
      size: buffer.length,
      contentType,
      sha256: hash
    };

    if ((index + 1) % 25 === 0 || index === total - 1) {
      console.log(`[${index + 1}/${total}] Downloaded (${buffer.length} bytes): ${relPath}`);
      writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
    }
  } catch (err: any) {
    console.error(`Error downloading ${url}:`, err.message);
  }
}

async function main() {
  const CONCURRENCY = 10;
  let running = 0;
  let index = 0;

  const queue: Promise<void>[] = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const p = downloadAsset(url, i, urls.length);
    queue.push(p);

    if (queue.length >= CONCURRENCY) {
      await Promise.race(queue);
      // Remove settled promises
      for (let j = queue.length - 1; j >= 0; j--) {
        // Bun handles promise inspections or we can just do chunking
      }
    }
  }

  // Proper concurrent worker pool
  const pool = Array.from({ length: CONCURRENCY }, async () => {
    while (index < urls.length) {
      const curIndex = index++;
      await downloadAsset(urls[curIndex], curIndex, urls.length);
    }
  });

  await Promise.all(pool);
  writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
  console.log(`Mirror complete! ${Object.keys(manifest).length}/${urls.length} assets saved.`);
}

main().catch(console.error);
