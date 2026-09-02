import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import { createMenuExplorer } from "./menu/index.js";

export function registerMenuCommand(program: Command) {
	const menu = program.command("menu").description("Explore game menu images");

	menu
		.command("list [path]")
		.alias("ls")
		.description("List files in a menu directory")
		.action((path = "") => {
			const explorer = createMenuExplorer();
			const entries = explorer.list(path);

			console.log(pc.bold(`\n📁 Contents of '${path || "/"}'`));
			console.log(pc.dim("--------------------------------"));

			if (entries.length === 0) {
				console.log(pc.yellow("Directory is empty or does not exist."));
				return;
			}

			entries.forEach((entry) => {
				if (entry.type === "directory") {
					console.log(`${pc.blue("DIR ")} ${entry.name}/`);
				} else {
					const sizeStr = entry.size ? ` ${(entry.size / 1024).toFixed(1)}KB` : "";
					console.log(`${pc.green("FILE")} ${entry.name}${pc.dim(sizeStr)}`);
				}
			});
			console.log(pc.dim(`\nTotal: ${entries.length} items`));
		});

	menu
		.command("find <pattern>")
		.description("Search for files matching a pattern")
		.option("-p, --path <path>", "Start path", "")
		.action((pattern, options) => {
			const explorer = createMenuExplorer();
			console.log(pc.cyan(`Searching for '${pattern}' in '${options.path || "/"}'...`));

			const start = performance.now();
			const results = explorer.find(pattern, options.path);
			const duration = (performance.now() - start).toFixed(0);

			if (results.length === 0) {
				console.log(pc.yellow("No matches found."));
				return;
			}

			// Limit output if too many results
			const MAX_DISPLAY = 20;
			results.slice(0, MAX_DISPLAY).forEach((entry) => {
				console.log(`${pc.dim(entry.path)}`);
			});

			if (results.length > MAX_DISPLAY) {
				console.log(pc.dim(`... and ${results.length - MAX_DISPLAY} more.`));
			}

			console.log(pc.bold(`\nFound ${results.length} matches in ${duration}ms`));
		});

	menu
		.command("scan [path]")
		.description("Recursively scan directory statistics")
		.option("-e, --ext <extensions>", "Filter by extensions (comma separated)", (val) =>
			val.split(",")
		)
		.option("-d, --depth <number>", "Max recursion depth", parseInt)
		.action((path = "", options) => {
			const explorer = createMenuExplorer();
			console.log(pc.cyan(`Scanning '${path || "/"}'...`));

			const start = performance.now();
			const results = explorer.scan(path, {
				recursive: true,
				extensions: options.ext,
				maxDepth: options.depth,
				includeDirectories: false,
			});
			const duration = (performance.now() - start).toFixed(0);

			// Group by extension for statistics
			const byExt: Record<string, number> = {};
			let totalSize = 0;

			results.forEach((entry) => {
				const ext = entry.extension || "unknown";
				byExt[ext] = (byExt[ext] || 0) + 1;
				totalSize += entry.size || 0;
			});

			console.log(pc.bold("\n📊 Scan Results"));
			console.log(pc.dim("--------------------------------"));
			console.log(`Total Files: ${pc.bold(results.length)}`);
			console.log(`Total Size:  ${pc.bold((totalSize / 1024 / 1024).toFixed(2))} MB`);
			console.log(`Time:        ${duration}ms`);

			console.log(pc.bold("\nBy Extension:"));
			Object.entries(byExt)
				.sort(([, a], [, b]) => b - a)
				.forEach(([ext, count]) => {
					console.log(`  .${ext.padEnd(8)} : ${count}`);
				});
		});

	menu
		.command("map")
		.description("Generate complete JSON maps for each top-level folder")
		.argument("[outputDir]", "Directory to save JSON maps", "./menu-maps")
		.action((outputDir) => {
			const explorer = createMenuExplorer();
			const resolvedOut = resolve(process.cwd(), outputDir);

			console.log(pc.cyan(`Generating menu maps in: ${resolvedOut}`));

			// Create output directory
			try {
				mkdirSync(resolvedOut, { recursive: true });
			} catch (e) {
				console.error(pc.red(`Failed to create output directory: ${e}`));
				return;
			}

			// Get top-level folders
			const topLevel = explorer.list("");
			const folders = topLevel.filter((e) => e.type === "directory");

			console.log(pc.dim(`Found ${folders.length} top-level folders to map.`));

			let totalFiles = 0;
			const startTotal = performance.now();

			for (const folder of folders) {
				const folderName = folder.name;
				// console.log(pc.blue(`Mapping ${folderName}...`));
				process.stdout.write(pc.blue(`Mapping ${folderName}... `));

				const start = performance.now();
				const files = explorer.scan(folderName, {
					recursive: true,
					includeDirectories: false,
				});

				// Construct the map object
				const mapData = {
					name: folderName,
					generatedAt: new Date().toISOString(),
					totalFiles: files.length,
					files: files.map((f) => ({
						path: f.path,
						name: f.name,
						size: f.size,
						extension: f.extension,
					})),
				};

				const outFile = join(resolvedOut, `${folderName}.json`);
				writeFileSync(outFile, JSON.stringify(mapData, null, 2));

				const time = (performance.now() - start).toFixed(0);
				console.log(pc.green(`Done (${files.length} files, ${time}ms)`));

				totalFiles += files.length;
			}

			const totalTime = ((performance.now() - startTotal) / 1000).toFixed(2);
			console.log(
				pc.bold(
					`\n✨ Completed! Mapped ${totalFiles} files across ${folders.length} folders in ${totalTime}s.`
				)
			);
			console.log(`Maps saved to: ${pc.underline(resolvedOut)}`);
		});
}
