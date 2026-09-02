import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { PATHS } from "../core/paths.js";

// Use PATHS.images + "menu" to ensure we follow the configured data root
const MENU_IMAGES_BASE = join(PATHS.images, "menu");

export interface MenuEntry {
	name: string;
	path: string; // Relative path (e.g., "00_soccer/soccer00")
	type: "directory" | "file";
	size?: number; // Optional file size
	extension?: string;
}

export interface ScanOptions {
	/** Whether to scan recursively (default: true) */
	recursive?: boolean;
	/** Filter by file extensions (e.g. ['webp', 'png']) */
	extensions?: string[];
	/** Include directories in the result (default: false for scan, true for list) */
	includeDirectories?: boolean;
	/** Max depth for recursion (default: Infinity) */
	maxDepth?: number;
}

/**
 * Explorer for the menu images directory.
 * Allows traversing the directory structure of game assets.
 */
export class MenuExplorer {
	private basePath: string;

	constructor(basePath: string = MENU_IMAGES_BASE) {
		this.basePath = resolve(basePath);
	}

	/**
	 * List content of a directory relative to menu images root
	 * @param relativePath - Path relative to menu root (e.g. "" or "00_soccer")
	 */
	list(relativePath: string = ""): MenuEntry[] {
		// Resolve target path and ensure it's within basePath to prevent traversal attacks
		const targetPath = resolve(this.basePath, relativePath);

		if (!targetPath.startsWith(this.basePath)) {
			console.warn(`[MenuExplorer] Access denied: ${relativePath}`);
			return [];
		}

		if (!existsSync(targetPath)) {
			return [];
		}

		try {
			const files = readdirSync(targetPath);
			const entries = files.map((file): MenuEntry | null => {
				const fullPath = join(targetPath, file);

				// Handle potential errors with statSync (e.g. broken links)
				let isDir = false;
				let size = 0;
				try {
					const stats = statSync(fullPath);
					isDir = stats.isDirectory();
					size = stats.size;
				} catch {
					return null;
				}

				// Construct relative path
				const childPath = join(relativePath, file).split(sep).join("/");
				const extension = !isDir && file.includes(".") ? file.split(".").pop() : undefined;

				const entry: MenuEntry = {
					name: file,
					path: childPath,
					type: isDir ? "directory" : "file",
					extension,
				};

				if (!isDir) {
					entry.size = size;
				}

				return entry;
			});

			// Filter out nulls and sort
			return entries
				.filter((entry): entry is MenuEntry => entry !== null)
				.sort((a, b) => {
					// Directories first, then files
					if (a.type === b.type) return a.name.localeCompare(b.name);
					return a.type === "directory" ? -1 : 1;
				});
		} catch (error) {
			console.error(`[MenuExplorer] Error listing directory ${relativePath}:`, error);
			return [];
		}
	}

	/**
	 * Recursively scan for files and folders
	 * @param relativePath - Start path
	 * @param options - Scan options
	 */
	scan(relativePath: string = "", options: ScanOptions = {}): MenuEntry[] {
		const results: MenuEntry[] = [];
		const {
			recursive = true,
			extensions,
			includeDirectories = false,
			maxDepth = Infinity,
		} = options;

		const processDir = (currentPath: string, currentDepth: number) => {
			if (currentDepth > maxDepth) return;

			const entries = this.list(currentPath);

			for (const entry of entries) {
				const isDir = entry.type === "directory";

				// Add to results if it matches criteria
				if (isDir) {
					if (includeDirectories) {
						results.push(entry);
					}
					if (recursive) {
						processDir(entry.path, currentDepth + 1);
					}
				} else {
					// It's a file
					if (extensions && entry.extension) {
						if (extensions.includes(entry.extension)) {
							results.push(entry);
						}
					} else if (!extensions) {
						// No extension filter, add all files
						results.push(entry);
					}
				}
			}
		};

		processDir(relativePath, 0);
		return results;
	}

	/**
	 * Find files matching a pattern (name or regex)
	 */
	find(pattern: string | RegExp, relativePath: string = ""): MenuEntry[] {
		const allFiles = this.scan(relativePath, {
			recursive: true,
			includeDirectories: false,
		});

		if (typeof pattern === "string") {
			const lowerPattern = pattern.toLowerCase();
			return allFiles.filter((f) => f.name.toLowerCase().includes(lowerPattern));
		} else {
			return allFiles.filter((f) => pattern.test(f.name));
		}
	}

	/**
	 * Check if a path exists
	 */
	exists(relativePath: string): boolean {
		const targetPath = resolve(this.basePath, relativePath);
		return targetPath.startsWith(this.basePath) && existsSync(targetPath);
	}

	/**
	 * Get the absolute path for a relative path (if valid)
	 */
	getAbsolutePath(relativePath: string): string | null {
		const targetPath = resolve(this.basePath, relativePath);
		if (!targetPath.startsWith(this.basePath) || !existsSync(targetPath)) {
			return null;
		}
		return targetPath;
	}
}

/**
 * Factory to create a MenuExplorer
 */
export function createMenuExplorer(customPath?: string) {
	return new MenuExplorer(customPath);
}
