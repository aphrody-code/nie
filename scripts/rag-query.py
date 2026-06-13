#!/usr/bin/env python3
"""Interroge un index RAG NDJSON par similarité cosinus (e5-small).
Usage: rag-query.py <index.ndjson> "<question>" [topk]"""
import sys, json, math, urllib.request
EMBED_URL = "http://127.0.0.1:8799/embed"
def embed(text):
    req = urllib.request.Request(EMBED_URL, data=json.dumps({"texts":[text],"query":True}).encode(),
                                 headers={"Content-Type":"application/json"})
    return json.load(urllib.request.urlopen(req, timeout=60))["embeddings"][0]
def cos(a,b):
    d=sum(x*y for x,y in zip(a,b)); na=math.sqrt(sum(x*x for x in a)); nb=math.sqrt(sum(y*y for y in b))
    return d/(na*nb+1e-9)
def main():
    idx, q = sys.argv[1], sys.argv[2]; k=int(sys.argv[3]) if len(sys.argv)>3 else 3
    rows=[json.loads(l) for l in open(idx,encoding="utf-8") if l.strip()]
    qe=embed(f"query: {q}")
    scored=sorted(((cos(qe,r["embedding"]),r) for r in rows), key=lambda x:-x[0])[:k]
    for s,r in scored:
        print(f"[{s:.3f}] {r['section']}")
        print(f"  {r['text'][:180].replace(chr(10),' ')}…\n")
if __name__=="__main__": main()
