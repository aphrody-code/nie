import { Database } from "bun:sqlite";

const DB_PATH = "/home/ubuntu/rg/apps/azalee/data/backups/supabase-2026-06-09T07-12-52.sqlite";

async function main() {
	const db = new Database(DB_PATH);

	// Let's find table names
	const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
	console.log("Tables found:", tables.map(t => t.name).join(", "));

	// Query teams
	if (tables.some(t => t.name === "inagle_teams" || t.name === "teams")) {
		const teamTable = tables.some(t => t.name === "inagle_teams") ? "inagle_teams" : "teams";
		const team = db.query(`SELECT * FROM ${teamTable} LIMIT 1`).get() as any;
		console.log(`Example team from ${teamTable}:`, team);
	}

	// Query capsules / gacha
	const gachaTable = tables.find(t => t.name.includes("gacha") || t.name.includes("capsule"));
	if (gachaTable) {
		const gacha = db.query(`SELECT * FROM ${gachaTable.name} LIMIT 1`).get() as any;
		console.log(`Example from ${gachaTable.name}:`, gacha);
	} else {
		// Let's search inside all tables for capsule-like table names
		console.log("No gacha/capsule table found directly.");
	}

	db.close();
}

main().catch(console.error);
