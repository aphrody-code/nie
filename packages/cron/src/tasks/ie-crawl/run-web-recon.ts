/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

// Runner reproductible du recon web exhaustif (victory-road/fr).
// Usage : bun packages/cron/src/tasks/ie-crawl/run-web-recon.ts [outDir] [rootUrl]
//   outDir  défaut : <racine du dépôt>/var/ie-crawl/victory-road-fr
//   rootUrl défaut : https://www.inazuma.jp/victory-road/fr/

import { crawlWebRecon } from "./web-recon";
import { dansLeDepot } from "../../lib/racine";

const outDir = process.argv[2] || dansLeDepot("var", "ie-crawl", "victory-road-fr");
const rootUrl = process.argv[3] || "https://www.inazuma.jp/victory-road/fr/";

const t0 = Date.now();
console.log(`[run-web-recon] cible=${rootUrl} → ${outDir}`);

const res = await crawlWebRecon({ rootUrl, outDir });

console.log("\n================ RÉSUMÉ ================");
console.log(`pages          : ${res.pages.length}`);
console.log(`endpoints      : ${res.endpoints.length}`);
console.log(`sous-domaines  : ${res.subdomains.length}`);
console.log(`URLs CDN       : ${res.cdnUrls.length}`);
console.log(`images         : ${res.images.length}`);
console.log(`css            : ${res.css.length}`);
console.log(`js             : ${res.js.length}`);
console.log(`json payloads  : ${res.json.length}`);
console.log("\nArtefacts :");
for (const [name, info] of Object.entries(res.artifacts))
	console.log(`  ${name.padEnd(18)} ${info.bytes} octets`);
console.log(`\nDurée : ${((Date.now() - t0) / 1000).toFixed(1)}s`);
