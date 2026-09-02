// Shim de types pour `@aphrody-code/bxc` — utilisé UNIQUEMENT à la compilation.
//
// `@aphrody-code/bxc` publie sa SOURCE `.ts` brute (`main`/`types` →
// `./src/api/browser.ts`) avec des imports en extension `.ts`. Sous tsc sans
// `allowImportingTsExtensions` (incompatible avec un build émetteur), ça produit
// des dizaines de `TS5097` et casse `inagle#build` / `type-check`. On mappe donc
// `@aphrody-code/bxc` vers ce shim via `paths` dans les tsconfig : tsc n'a plus
// besoin de lire la source du paquet. L'IMPORT ÉMIS reste `@aphrody-code/bxc`
// (les `paths` n'affectent que la résolution de types, pas l'emit) → au runtime,
// `src/zukan/order.ts` (consommé par le cron via `dist/zukan/order.js`) charge
// toujours le vrai paquet bxc.
//
// Seuls `Browser` (scraping headless) et `Page` sont importés par inagle
// (`src/zukan/order.ts`). On les expose en `any` : surface minimale, suffisante.

export const Browser: {
	newPage(opts?: Record<string, unknown>): Promise<Page>;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	[key: string]: any;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Page = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NavigationResponse = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const googleWebSearch: any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const extractTitle: any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const htmlToMarkdown: any;


