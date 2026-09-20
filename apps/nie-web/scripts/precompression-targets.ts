/**
 * Files for which the production build may emit adjacent `.br` and `.zst` variants.
 *
 * Images and GPU textures are already compressed. WebAssembly and the deterministic VFS archive
 * are deliberately included: both contain enough repeated structure for Brotli 11 to reduce the
 * bytes sent by `nie-site`, whose content negotiation is extension-independent.
 */
export const PRECOMPRESSION_EXTENSIONS = [
	".js",
	".css",
	".html",
	".json",
	".svg",
	".map",
	".txt",
	".wasm",
	".nievfs",
] as const;

export function isPrecompressionTarget(path: string): boolean {
	return PRECOMPRESSION_EXTENSIONS.some((extension) => path.endsWith(extension));
}
