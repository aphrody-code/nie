import { sql } from "./lib/db.js";

async function main() {
  try {
    const counts = await sql`
      SELECT team_id, COUNT(*)::int as count 
      FROM team_members 
      WHERE is_active = true 
      GROUP BY team_id
    `;
    console.log("Team members count by team_id:");
    for (const c of counts) {
      console.log(`- ${c.team_id}: ${c.count} active members`);
    }
  } catch (err) {
    console.error("Query failed:", err);
  } finally {
    process.exit(0);
  }
}

main();
