#!/usr/bin/env python3
"""Construit un index RAG (embeddings e5-small) depuis un .md → NDJSON {id,section,text,embedding}.
Usage: rag-build.py <source.md> <out.ndjson> [topic]"""
import sys, json, re, urllib.request

EMBED_URL = "http://127.0.0.1:8799/embed"

def embed(texts, query=False):
    req = urllib.request.Request(EMBED_URL, data=json.dumps({"texts": texts, "query": query}).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=120))["embeddings"]

def chunk_md(md, topic):
    # Découpe par sections H2/H3 ; chaque chunk = titre courant + paragraphe, borné à ~1200 car.
    chunks, cur_h, buf = [], topic, []
    def flush():
        txt = "\n".join(buf).strip()
        if txt:
            chunks.append((cur_h, f"{cur_h}\n{txt}" if cur_h else txt))
    for line in md.splitlines():
        m = re.match(r"^(#{1,3})\s+(.*)", line)
        if m:
            flush(); buf = []
            cur_h = m.group(2).strip()
        else:
            buf.append(line)
            if sum(len(x) for x in buf) > 1200:
                flush(); buf = []
    flush()
    return [(h, t) for h, t in chunks if len(t.strip()) > 20]

def main():
    src, out = sys.argv[1], sys.argv[2]
    topic = sys.argv[3] if len(sys.argv) > 3 else ""
    md = open(src, encoding="utf-8").read()
    chunks = chunk_md(md, topic)
    # e5 : préfixe "passage: " pour les documents.
    embs = embed([f"passage: {t}" for _, t in chunks], query=False)
    with open(out, "w", encoding="utf-8") as f:
        for i, ((h, t), e) in enumerate(zip(chunks, embs)):
            f.write(json.dumps({"id": f"{topic or 'doc'}-{i}", "topic": topic, "section": h,
                                "text": t, "embedding": e}, ensure_ascii=False) + "\n")
    print(f"RAG: {len(chunks)} chunks embedded (dim {len(embs[0])}) -> {out}")

if __name__ == "__main__":
    main()
