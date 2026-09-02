import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import { ParagraphNode, TextNode } from "lexical";
import type { Klass, LexicalNode, LexicalNodeReplacement } from "lexical";

import { ImageNode } from "@/components/editor/nodes/image-node";

export const nodes: ReadonlyArray<Klass<LexicalNode> | LexicalNodeReplacement> = [
	HeadingNode,
	ParagraphNode,
	TextNode,
	QuoteNode,
	ListNode,
	ListItemNode,
	CodeNode,
	CodeHighlightNode,
	TableNode,
	TableCellNode,
	TableRowNode,
	AutoLinkNode,
	LinkNode,
	ImageNode,
	HorizontalRuleNode,
];
