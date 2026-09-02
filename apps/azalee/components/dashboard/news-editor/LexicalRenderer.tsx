"use client";

import type { SerializedEditorState } from "lexical";
import type { ReactNode } from "react";

/**
 * Renderer leger pour SerializedEditorState Lexical.
 * Couvre les nodes les plus courants (paragraph, heading, text avec format
 * bold/italic/underline/strikethrough/code, link, list/listitem, quote,
 * linebreak). Fait pour la preview admin — pas un rendu complet runtime.
 */

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
	const style = node.style as string | undefined;
	if (style) {
		const styleObj: Record<string, string> = {};
		for (const decl of style.split(";")) {
			const [k, v] = decl.split(":").map((s) => s.trim());
			if (k && v) {
				styleObj[toCamel(k)] = v;
			}
		}
		return (
			<span key={key} style={styleObj}>
				{el}
			</span>
		);
	}
	return <span key={key}>{el}</span>;
}

function toCamel(prop: string): string {
	return prop.replaceAll(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function renderChildren(children: LexicalNode[] | undefined): ReactNode[] {
	if (!Array.isArray(children)) {
		return [];
	}
	return children.map((c, i) => renderNode(c, i));
}

function renderNode(node: LexicalNode, key: string | number): ReactNode {
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
			return <p key={key}>{renderChildren(node.children)}</p>;
		}
		case "heading": {
			const tag = (node.tag as string) || "h2";
			const Tag = tag as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
			return <Tag key={key}>{renderChildren(node.children)}</Tag>;
		}
		case "quote": {
			return <blockquote key={key}>{renderChildren(node.children)}</blockquote>;
		}
		case "list": {
			const Tag = node.listType === "number" ? "ol" : "ul";
			return <Tag key={key}>{renderChildren(node.children)}</Tag>;
		}
		case "listitem": {
			return <li key={key}>{renderChildren(node.children)}</li>;
		}
		case "link": {
			return (
				<a
					key={key}
					href={node.url ?? "#"}
					target={node.target ?? undefined}
					rel={node.rel ?? "noopener noreferrer"}
				>
					{renderChildren(node.children)}
				</a>
			);
		}
		case "horizontalrule": {
			return <hr key={key} />;
		}
		case "code": {
			return (
				<pre key={key}>
					<code>{renderChildren(node.children)}</code>
				</pre>
			);
		}
		case "image": {
			const src = node.src as string | undefined;
			const alt = (node.altText as string) || "";
			if (!src) {
				return null;
			}
			// eslint-disable-next-line @next/next/no-img-element
			return <img key={key} src={src} alt={alt} loading="lazy" decoding="async" />;
		}
		default: {
			// fallback : si le node a des children, on les rend dans un fragment
			if (Array.isArray(node.children)) {
				return <span key={key}>{renderChildren(node.children)}</span>;
			}
			return null;
		}
	}
}

export function LexicalRenderer({
	content,
}: {
	content: SerializedEditorState | null | undefined;
}) {
	if (!content?.root) {
		return null;
	}
	return <>{renderChildren(content.root.children as LexicalNode[])}</>;
}
