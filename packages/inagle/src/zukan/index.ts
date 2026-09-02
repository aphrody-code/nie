export * from "./library.js";
export * from "./parser.js";
export * from "./types.js";
// NB : `./scraper.js` (live scraper, tire @aphrody-code/bxc) n'est volontairement
// PAS ré-exporté par ce barrel — le barrel inagle est value-importé en runtime par
// Azalée (app/chara/[id]/page.tsx). L'importer chargerait bxc côté Next et casserait
// le rendu (cf. mémoire azalee-wiki-500-inagle). Importer le leaf directement :
//   import { zukanScraper } from "@rosegriffon/inagle/zukan/scraper";
