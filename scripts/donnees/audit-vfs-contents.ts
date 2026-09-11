/**
 * Audit complet du VFS : identification des fichiers skills, motions, models, events, et videos.
 */

import { Database } from "bun:sqlite";

// On inspecte mirror.sqlite pour les skills et relations
const db = new Database("var/mirror.sqlite");

console.log("=== 1. Inventaire des Skills dans mirror.sqlite ===");
const totalSkills = db.query("SELECT COUNT(*) as count FROM inagle_skills").get() as { count: number };
const categories = db.query("SELECT category, COUNT(*) as count FROM inagle_skills GROUP BY category").all();
const elements = db.query("SELECT element, COUNT(*) as count FROM inagle_skills GROUP BY element").all();
console.log(`Total skills enregistrés : ${totalSkills.count}`);
console.log("Par catégorie :", categories);
console.log("Par élément :", elements);

const sampleSkills = db.query(
  "SELECT id, internal_code, name_fr, name_ja, category, element, tp_cost, power_min, power_max, video_url FROM inagle_skills WHERE video_url IS NOT NULL LIMIT 5"
).all();
console.log("\nExemples de skills avec vidéo :", sampleSkills);
