import { describe, it, expect } from "bun:test";
import { chunkText } from "./rag-utils";
import { chunkMarkdown, chunkBySource } from "./rag-chunkers";

describe("RAG chunkText Tests", () => {
	it("should split long text at word boundaries without cutting words in half during overlap", () => {
		const text = "Ce texte contient plusieurs mots longs. Il est destiné à tester le découpage en blocs sémantiques. Le but est d'éviter de couper un mot en plein milieu lorsqu'on applique le chevauchement (overlap).";
		const chunks = chunkText(text, 40, 15);
		console.log("Generated chunks:", chunks);

		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.length).toBeLessThanOrEqual(40);
		}
	});

	it("should return the entire text if it fits in chunkSize", () => {
		const text = "Short text.";
		const chunks = chunkText(text, 50, 10);
		expect(chunks).toEqual([text]);
	});
});

describe("RAG chunkMarkdown Tests", () => {
	it("should split markdown by headings and append section titles as metadata", () => {
		const markdown = `# Introduction\nCeci est l'intro.\n## Section A\nContenu de la section A avec plusieurs lignes.\n## Section B\nContenu B.`;
		const chunks = chunkMarkdown(markdown, 100);

		expect(chunks.length).toBe(3);
		expect(chunks[0]!.content).toContain("Contexte: Introduction");
		expect(chunks[0]!.content).toContain("Ceci est l'intro.");
		expect(chunks[1]!.content).toContain("Contexte: Introduction > Section A");
		expect(chunks[2]!.content).toContain("Contexte: Introduction > Section B");
	});
});

describe("RAG chunkBySource Dispatcher", () => {
	it("should route 'doc' source kind containing markdown to chunkMarkdown", () => {
		const markdown = `# Title\nSome documentation text here.`;
		const chunks = chunkBySource("doc", markdown);
		expect(chunks[0]!.content).toContain("Contexte: Title");
	});
});
