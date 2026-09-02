import type { SerializedEditorState } from "lexical";
import type { ReactNode } from "react";

/**
 * SSR-safe renderer pour `SerializedEditorState` Lexical.
 *
 * Remplacement du renderer base sur `$generateHtmlFromNodes` (qui requiert
 * JSDom et crashait en Node SSR — voir log "To use $generateHtmlFromNodes
 * in headless mode please initialize a headless browser implementation").
 *
 * Genere directement le tree React :
 *   - paragraph / heading (h1-h6) / quote / list (ul/ol) / listitem
 *   - text avec format bitmask (bold/italic/underline/strikethrough/code/sub/sup/highlight)
 *   - link / linebreak / horizontalrule / code block / image
 *   - fallback span pour types inconnus avec children
 *
 * Injecte des `id` slugifies sur les H2/H3 pour le sommaire (memes regles
 * que `lib/lexical-utils.ts:extractTableOfContents`).
 *
 * Accepte aussi du content HTML legacy (string commencant par `<`) — rendu
 * via `dangerouslySetInnerHTML` apres injection d'IDs sur h2/h3.
 */

interface LexicalRendererProps {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	content: string | SerializedEditorState | Record<string, any>;
	className?: string;
}

// Lexical text format bitmask
const FMT_BOLD = 1;
const FMT_ITALIC = 1 << 1;
const FMT_STRIKETHROUGH = 1 << 2;
const FMT_UNDERLINE = 1 << 3;
const FMT_CODE = 1 << 4;
const FMT_SUBSCRIPT = 1 << 5;
const FMT_SUPERSCRIPT = 1 << 6;
const FMT_HIGHLIGHT = 1 << 7;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LexicalNode = any;

function slugify(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFD")
		.replaceAll(/[̀-ͯ]/g, "")
		.replaceAll(/[^a-z0-9]+/g, "-")
		.replaceAll(/^-+|-+$/g, "");
}

function extractText(node: LexicalNode): string {
	if (node?.text) {
		return node.text as string;
	}
	if (Array.isArray(node?.children)) {
		return node.children.map(extractText).join("");
	}
	return "";
}

function toCamel(prop: string): string {
	return prop.replaceAll(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function parseStyle(style: string | undefined): Record<string, string> | undefined {
	if (!style) {
		return undefined;
	}
	const out: Record<string, string> = {};
	for (const decl of style.split(";")) {
		const [k, v] = decl.split(":").map((s) => s.trim());
		if (k && v) {
			out[toCamel(k)] = v;
		}
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function renderText(node: LexicalNode, key: string | number): ReactNode {
	let el: ReactNode = node.text ?? "";
	const format = (node.format as number) || 0;
	if (format & FMT_CODE) {
		el = <code>{el}</code>;
	}
	if (format & FMT_HIGHLIGHT) {
		el = <mark>{el}</mark>;
	}
	if (format & FMT_SUBSCRIPT) {
		el = <sub>{el}</sub>;
	}
	if (format & FMT_SUPERSCRIPT) {
		el = <sup>{el}</sup>;
	}
	if (format & FMT_STRIKETHROUGH) {
		el = <s>{el}</s>;
	}
	if (format & FMT_UNDERLINE) {
		el = <u>{el}</u>;
	}
	if (format & FMT_ITALIC) {
		el = <em>{el}</em>;
	}
	if (format & FMT_BOLD) {
		el = <strong>{el}</strong>;
	}
	const styleObj = parseStyle(node.style as string | undefined);
	if (styleObj) {
		return (
			<span key={key} style={styleObj}>
				{el}
			</span>
		);
	}
	return <span key={key}>{el}</span>;
}

function renderChildren(children: LexicalNode[] | undefined, ctx: SlugContext): ReactNode[] {
	if (!Array.isArray(children)) {
		return [];
	}
	return children.map((c, i) => renderNode(c, i, ctx));
}

interface SlugContext {
	counts: Map<string, number>;
}

function uniqueSlug(ctx: SlugContext, base: string): string {
	const n = ctx.counts.get(base) ?? 0;
	ctx.counts.set(base, n + 1);
	return n === 0 ? base : `${base}-${n}`;
}

function renderNode(node: LexicalNode, key: string | number, ctx: SlugContext): ReactNode {
	if (!node || typeof node !== "object") {
		return null;
	}
	switch (node.type) {
		case "text": {
			return renderText(node, key);
		}
		case "linebreak": {
			return <br key={key} />;
		}
		case "paragraph": {
			return <p key={key}>{renderChildren(node.children, ctx)}</p>;
		}
		case "heading": {
			const tag = (node.tag as string) || "h2";
			const Tag = tag as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
			const text = extractText(node).trim();
			const id =
				(tag === "h2" || tag === "h3") && text ? uniqueSlug(ctx, slugify(text)) : undefined;
			return (
				<Tag key={key} id={id}>
					{renderChildren(node.children, ctx)}
				</Tag>
			);
		}
		case "quote": {
			return <blockquote key={key}>{renderChildren(node.children, ctx)}</blockquote>;
		}
		case "list": {
			const Tag = node.listType === "number" ? "ol" : "ul";
			return <Tag key={key}>{renderChildren(node.children, ctx)}</Tag>;
		}
		case "listitem": {
			return <li key={key}>{renderChildren(node.children, ctx)}</li>;
		}
		case "link": {
			return (
				<a
					key={key}
					href={node.url ?? "#"}
					target={node.target ?? undefined}
					rel={node.rel ?? "noopener noreferrer"}
				>
					{renderChildren(node.children, ctx)}
				</a>
			);
		}
		case "horizontalrule": {
			return <hr key={key} />;
		}
		case "code": {
			return (
				<pre key={key}>
					<code>{renderChildren(node.children, ctx)}</code>
				</pre>
			);
		}
		case "image":
		case "inline-image": {
			const src = node.src as string | undefined;
			const alt = (node.altText as string) || "";
			if (!src) {
				return null;
			}
			// eslint-disable-next-line @next/next/no-img-element
			return <img key={key} src={src} alt={alt} loading="lazy" decoding="async" />;
		}
		default: {
			if (Array.isArray(node.children)) {
				return <span key={key}>{renderChildren(node.children, ctx)}</span>;
			}
			return null;
		}
	}
}

/**
 * Inject id attributes sur h2/h3 pour le sommaire — chemin HTML legacy.
 */
function injectHeadingIds(html: string): string {
	const slugCounts = new Map<string, number>();
	return html.replaceAll(/<(h[23])([^>]*)>(.*?)<\/h[23]>/gi, (match, tag, attrs, inner) => {
		const text = inner.replaceAll(/<[^>]+>/g, "").trim();
		if (!text) {
			return match;
		}
		let slug = slugify(text);
		const count = slugCounts.get(slug) || 0;
		slugCounts.set(slug, count + 1);
		if (count > 0) {
			slug = `${slug}-${count}`;
		}
		if (/id\s*=\s*["']/i.test(attrs)) {
			return match;
		}
		return `<${tag}${attrs} id="${slug}">${inner}</${tag}>`;
	});
}

function isLexicalShape(content: unknown): content is SerializedEditorState {
	if (!content || typeof content !== "object") {
		return false;
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return Array.isArray((content as any)?.root?.children);
}

export function LexicalRenderer({ content, className }: LexicalRendererProps) {
	if (!content) {
		return null;
	}

	let parsed: SerializedEditorState | null = null;
	let legacyHtml: string | null = null;

	if (typeof content === "string") {
		const trimmed = content.trim();
		if (trimmed.startsWith("{")) {
			try {
				const obj = JSON.parse(trimmed);
				if (isLexicalShape(obj)) {
					parsed = obj;
				} else {
					legacyHtml = content;
				}
			} catch {
				legacyHtml = content;
			}
		} else {
			legacyHtml = content;
		}
	} else if (isLexicalShape(content)) {
		parsed = content as SerializedEditorState;
	}

	if (parsed) {
		const ctx: SlugContext = { counts: new Map() };
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const children = renderChildren(parsed.root.children as any[], ctx);
		return <div className={className}>{children}</div>;
	}

	if (legacyHtml) {
		return (
			<div
				className={className}
				dangerouslySetInnerHTML={{ __html: injectHeadingIds(legacyHtml) }}
			/>
		);
	}

	return null;
}
