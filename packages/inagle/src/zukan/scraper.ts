/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

// Surface canonique unifiée pour l'accès Zukan live : on ré-expose la SDK
// `@aphrody-code/zukan` (extraite de bxc) afin que TOUS les clients du monorepo
// (cron, scripts, apps) importent le scraper Zukan depuis un seul point —
// `@rosegriffon/inagle` — plutôt que de réimplémenter des crawls ad hoc.
//
// La SDK fournit `ZukanScraper` (getCharacterList / getCharacterDetail) et les
// types `ZukanCharacterRef` / `ZukanCharacterDetail`. Les parsers locaux
// (`parser.ts`) et la `ZukanLibrary` restent disponibles pour les données déjà
// mirrorées ; ce module est la porte d'entrée pour le scraping en direct.

export { ZukanScraper } from "@aphrody-code/zukan";
export type { ZukanCharacterDetail, ZukanCharacterRef } from "@aphrody-code/zukan";

import { ZukanScraper } from "@aphrody-code/zukan";

/** Instance partagée du scraper Zukan (réutilisable entre les tâches). */
export const zukanScraper = new ZukanScraper();
