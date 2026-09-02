"use client";

import { exportFile, importFile } from "@lexical/file";
import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import {
	$convertFromMarkdownString,
	$convertToMarkdownString,
	TRANSFORMERS,
} from "@lexical/markdown";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot } from "lexical";
import { Code, Download, FileCode, FileJson, FileText, Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { IMAGE } from "@/components/editor/transformers/markdown-image-transformer";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@rosegriffon/ui";

const ALL_TRANSFORMERS = [IMAGE, ...TRANSFORMERS];

export function ImportExportPlugin() {
	const [editor] = useLexicalComposerContext();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [importDialogOpen, setImportDialogOpen] = useState(false);
	const [importContent, setImportContent] = useState("");
	const [importType, setImportType] = useState<"html" | "markdown">("html");

	// ========================
	// EXPORT
	// ========================

	const handleExportLexical = () => {
		exportFile(editor, {
			fileName: `azalee-doc-${new Date().toISOString().split("T")[0]}`,
			source: "AzaleeEditor",
		});
	};

	const handleExportHtml = useCallback(() => {
		editor.read(() => {
			const htmlString = $generateHtmlFromNodes(editor, null);
			const blob = new Blob([htmlString], { type: "text/html;charset=utf-8" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `azalee-doc-${new Date().toISOString().split("T")[0]}.html`;
			a.click();
			URL.revokeObjectURL(url);
			toast.success("HTML exporté");
		});
	}, [editor]);

	const handleExportMarkdown = useCallback(() => {
		editor.read(() => {
			const markdown = $convertToMarkdownString(ALL_TRANSFORMERS);
			const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `azalee-doc-${new Date().toISOString().split("T")[0]}.md`;
			a.click();
			URL.revokeObjectURL(url);
			toast.success("Markdown exporté");
		});
	}, [editor]);

	// ========================
	// IMPORT — core insert functions first
	// ========================

	const insertHtml = useCallback(
		(htmlString: string) => {
			editor.update(() => {
				const parser = new DOMParser();
				const dom = parser.parseFromString(htmlString, "text/html");
				const nodes = $generateNodesFromDOM(editor, dom);
				const root = $getRoot();
				root.clear();
				root.append(...nodes);
			});
			toast.success("HTML importé");
		},
		[editor]
	);

	const insertMarkdown = useCallback(
		(mdString: string) => {
			editor.update(() => {
				const root = $getRoot();
				root.clear();
				$convertFromMarkdownString(mdString, ALL_TRANSFORMERS, root);
			});
			toast.success("Markdown importé");
		},
		[editor]
	);

	const handleImportLexical = () => {
		importFile(editor);
	};

	const handleImportHtmlFromFile = useCallback(() => {
		if (!fileInputRef.current) {
			return;
		}
		fileInputRef.current.accept = ".html,.htm";
		fileInputRef.current.onchange = (e) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (!file) {
				return;
			}
			const reader = new FileReader();
			reader.onload = () => {
				const htmlString = reader.result as string;
				insertHtml(htmlString);
				if (fileInputRef.current) {
					fileInputRef.current.value = "";
				}
			};
			reader.readAsText(file);
		};
		fileInputRef.current.click();
	}, [insertHtml]);

	const handleImportMarkdownFromFile = useCallback(() => {
		if (!fileInputRef.current) {
			return;
		}
		fileInputRef.current.accept = ".md,.markdown,.txt";
		fileInputRef.current.onchange = (e) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (!file) {
				return;
			}
			const reader = new FileReader();
			reader.onload = () => {
				const mdString = reader.result as string;
				insertMarkdown(mdString);
				if (fileInputRef.current) {
					fileInputRef.current.value = "";
				}
			};
			reader.readAsText(file);
		};
		fileInputRef.current.click();
	}, [insertMarkdown]);

	// Import from paste dialog
	const handlePasteImport = () => {
		if (!importContent.trim()) {
			toast.error("Le contenu est vide");
			return;
		}
		if (importType === "html") {
			insertHtml(importContent);
		} else {
			insertMarkdown(importContent);
		}
		setImportDialogOpen(false);
		setImportContent("");
	};

	return (
		<>
			<input ref={fileInputRef} type="file" className="hidden" tabIndex={-1} />

			<div className="flex items-center gap-1">
				{/* Import dropdown */}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							className="h-8 gap-1.5 text-xs font-medium rounded-full hover:bg-primary/10 text-primary"
						>
							<Upload className="size-3.5" />
							Importer
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="start"
						className="rounded-2xl border-none shadow-2xl p-2 min-w-[200px] bg-surface-container-high"
					>
						<DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant px-3 py-1.5">
							Depuis un fichier
						</DropdownMenuLabel>
						<DropdownMenuItem
							onClick={handleImportLexical}
							className="rounded-xl focus:bg-primary/10 focus:text-primary cursor-pointer font-bold"
						>
							<FileJson className="mr-3 size-4" />
							Fichier Lexical (.lexical)
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={handleImportHtmlFromFile}
							className="rounded-xl focus:bg-primary/10 focus:text-primary cursor-pointer font-bold"
						>
							<FileCode className="mr-3 size-4" />
							Fichier HTML (.html)
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={handleImportMarkdownFromFile}
							className="rounded-xl focus:bg-primary/10 focus:text-primary cursor-pointer font-bold"
						>
							<FileText className="mr-3 size-4" />
							Fichier Markdown (.md)
						</DropdownMenuItem>
						<DropdownMenuSeparator className="bg-outline-variant/10" />
						<DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant px-3 py-1.5">
							Coller du contenu
						</DropdownMenuLabel>
						<DropdownMenuItem
							onClick={() => {
								setImportType("html");
								setImportContent("");
								setImportDialogOpen(true);
							}}
							className="rounded-xl focus:bg-primary/10 focus:text-primary cursor-pointer font-bold"
						>
							<Code className="mr-3 size-4" />
							Coller du HTML
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={() => {
								setImportType("markdown");
								setImportContent("");
								setImportDialogOpen(true);
							}}
							className="rounded-xl focus:bg-primary/10 focus:text-primary cursor-pointer font-bold"
						>
							<FileText className="mr-3 size-4" />
							Coller du Markdown
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>

				{/* Export dropdown */}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							className="h-8 gap-1.5 text-xs font-medium rounded-full hover:bg-primary/10 text-primary"
						>
							<Download className="size-3.5" />
							Exporter
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="start"
						className="rounded-2xl border-none shadow-2xl p-2 min-w-[200px] bg-surface-container-high"
					>
						<DropdownMenuItem
							onClick={handleExportLexical}
							className="rounded-xl focus:bg-primary/10 focus:text-primary cursor-pointer font-bold"
						>
							<FileJson className="mr-3 size-4" />
							Lexical (.lexical)
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={handleExportHtml}
							className="rounded-xl focus:bg-primary/10 focus:text-primary cursor-pointer font-bold"
						>
							<FileCode className="mr-3 size-4" />
							HTML (.html)
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={handleExportMarkdown}
							className="rounded-xl focus:bg-primary/10 focus:text-primary cursor-pointer font-bold"
						>
							<FileText className="mr-3 size-4" />
							Markdown (.md)
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			{/* Paste import dialog */}
			<Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
				<DialogContent className="rounded-[28px] bg-surface border-outline-variant/20 max-w-2xl">
					<DialogHeader>
						<DialogTitle className="text-on-surface">
							Importer du {importType === "html" ? "HTML" : "Markdown"}
						</DialogTitle>
						<DialogDescription className="text-on-surface-variant">
							Collez votre contenu {importType === "html" ? "HTML" : "Markdown"} ci-dessous. Le
							contenu actuel de l&apos;éditeur sera remplacé.
						</DialogDescription>
					</DialogHeader>
					<textarea
						value={importContent}
						onChange={(e) => setImportContent(e.target.value)}
						className="w-full h-64 p-4 rounded-2xl bg-surface-container-low border border-outline-variant/30 text-sm font-mono text-on-surface placeholder:text-on-surface-variant/40 focus:outline-hidden focus:ring-2 focus:ring-primary/30 resize-none"
						placeholder={
							importType === "html"
								? "<h1>Mon titre</h1>\n<p>Mon contenu...</p>"
								: "# Mon titre\n\nMon contenu..."
						}
						autoFocus
					/>
					<DialogFooter className="gap-2">
						<Button
							variant="outline"
							onClick={() => setImportDialogOpen(false)}
							className="rounded-full"
						>
							Annuler
						</Button>
						<Button
							onClick={handlePasteImport}
							disabled={!importContent.trim()}
							className="rounded-full bg-primary text-on-primary hover:bg-primary/90"
						>
							<Upload className="size-4 mr-2" />
							Importer
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
