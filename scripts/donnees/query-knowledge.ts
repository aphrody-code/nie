import { Database } from "bun:sqlite";

const dbPath = "C:/Users/aphro/.aphrody/workspace/knowledge.db";
const dbFile = Bun.file(dbPath);

if (!(await dbFile.exists())) {
  console.log("knowledge.db non trouvé à", dbPath);
  process.exit(0);
}

const db = new Database(dbPath);
const results = db.query(
  "SELECT title, content FROM documents_fts WHERE documents_fts MATCH 'G4MT OR G4MA OR USM OR skill_base' LIMIT 5"
).all();

console.log("Résultats FTS5 approfondis :");
for (const r of results as Array<{ title: string; content: string }>) {
  console.log(`\n=== ${r.title} ===`);
  console.log(r.content.substring(0, 500) + "...\n");
}


