/**
 * Déclarations pour `kuroshiro` et `kuroshiro-analyzer-kuromoji`.
 *
 * Les deux paquets sont publiés en JavaScript nu, sans `.d.ts` et sans `@types/*` amont :
 * `import Kuroshiro from "kuroshiro"` est donc implicitement `any`, ce que `noImplicitAny`
 * refuse (TS7016). L'erreur ne se voyait pas tant que les consommateurs lisaient les types
 * CONSTRUITS d'`inagle` (`dist/*.d.ts`) ; depuis que le paquet expose ses sources
 * (`main: ./src/index.ts`, exigé par Bun qui lit le TypeScript sans build), c'est
 * `apps/azalee` et `packages/mcp` qui compilent `romaji.ts` et butent dessus.
 *
 * On ne déclare que la surface RÉELLEMENT utilisée par `src/utils/romaji.ts` — un shim
 * qui invente des méthodes serait pire que pas de types du tout.
 */

declare module "kuroshiro" {
	/** Modes de rendu acceptés par `convert`. */
	export type KuroshiroMode = "normal" | "spaced" | "okurigana" | "furigana";
	/** Systèmes de romanisation acceptés par `convert`. */
	export type KuroshiroSystem = "nippon" | "passport" | "hepburn";

	export interface KuroshiroConvertOptions {
		to?: "hiragana" | "katakana" | "romaji";
		mode?: KuroshiroMode;
		romajiSystem?: KuroshiroSystem;
	}

	/** L'analyseur passé à `init` — sa forme est celle du paquet kuromoji. */
	export interface KuroshiroAnalyzer {
		init(): Promise<void>;
	}

	export default class Kuroshiro {
		init(analyzer: unknown): Promise<void>;
		convert(text: string, options?: KuroshiroConvertOptions): Promise<string>;
	}
}

declare module "kuroshiro-analyzer-kuromoji" {
	export interface KuromojiAnalyzerOptions {
		/** Dossier du dictionnaire kuromoji, résolu à l'exécution depuis le paquet installé. */
		dictPath?: string;
	}

	export default class KuromojiAnalyzer {
		constructor(options?: KuromojiAnalyzerOptions);
		init(): Promise<void>;
	}
}
