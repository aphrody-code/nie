/** Minimal compile-time surface for the external Bun browser package. */
export const Browser: {
	newPage(options?: Record<string, unknown>): Promise<Page>;
	[key: string]: unknown;
};
export type Page = any;
export type NavigationResponse = any;
export const googleWebSearch: any;
export const extractTitle: any;
export const htmlToMarkdown: any;
