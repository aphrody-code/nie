#!/usr/bin/env bun
/**
 * DIFF SÉMANTIQUE — anti-régression Phase 4 (Drizzle).
 *
 * Exécute ~12 requêtes représentatives via l'ANCIENNE façade (concaténation SQL
 * maison) ET la NOUVELLE (Drizzle sqlite-proxy) et compare les résultats.
 * DOIVENT être identiques. Sortie : `OK` (diff vide) ou liste des écarts.
 *
 *   bun apps/azalee/scripts/ops/diff-drizzle-facade.ts
 */
import { SqliteQueryBuilder as NewBuilder } from "@rosegriffon/azalee/db";
import { SqliteQueryBuilder as OldBuilder } from "./_sqlite-client-old";

const dbPath = "/home/ubuntu/rg/apps/azalee/data/backups/mirror.sqlite";
const { Database } = require("bun:sqlite");
// Une connexion par builder (les deux pointent le même fichier readonly).
const oldDb = new Database(dbPath, { readonly: true });
const newDb = new Database(dbPath, { readonly: true });

type Resp = {
	data: Record<string, unknown> | Array<Record<string, unknown>> | null;
	error: Error | null;
	count: number | null;
};

// `q(builder)` reçoit un constructeur de requête frais et renvoie la requête
// (thenable). On reconstruit la requête deux fois (ancienne / nouvelle façade).
type QFn = (b: unknown) => PromiseLike<Resp>;

const cases: Array<{ name: string; old: QFn; neo: QFn }> = [];

function addCase(
	name: string,
	build: (B: typeof OldBuilder | typeof NewBuilder, db: unknown) => PromiseLike<Resp>
) {
	cases.push({
		name,
		old: () => build(OldBuilder, oldDb),
		neo: () => build(NewBuilder, newDb),
	});
}

// helper: nouvelle instance liée à une table
function q(B: typeof OldBuilder, db: unknown, table: string) {
	return new B(db as never, table);
}

// 1. eq sur id (TEXT)
addCase("eq id (skill rhd10010)", (B, db) =>
	q(B, db, "inagle_skills").select("id, name_fr, name_en").eq("id", "rhd10010")
);

// 2. ilike sur name_fr
addCase("ilike name_fr %tornade%", (B, db) =>
	q(B, db, "inagle_skills").select("id, name_fr").ilike("name_fr", "%tornade%").order("name_fr")
);

// 3. or multi-mots (valeur avec espaces) — ne doit PAS être tronqué
addCase("or multi-mots (Tacle à l'épaule)", (B, db) =>
	q(B, db, "inagle_skills")
		.select("id, name_fr")
		.or("name_fr.eq.Tacle à l'épaule,name_fr.ilike.%feu%")
		.order("name_fr")
);

// 4. or avec json_extract ->> sur sheet_data
addCase("or ->> json_extract", (B, db) =>
	q(B, db, "inagle_auras")
		.select("id, name_fr, sheet_data")
		.or("name_fr.ilike.%feu%,sheet_data->>name_FR.ilike.%feu%")
		.order("name_fr", { nullsFirst: false })
		.limit(20)
);

// 5. order desc avec NULLS LAST (zukan_order a 191 NULL)
addCase("order zukan_order desc nulls last", (B, db) =>
	q(B, db, "inagle_characters")
		.select("id, name_fr, zukan_order")
		.order("zukan_order", { ascending: false, nullsFirst: false })
		.limit(50)
);

// 6. order asc avec NULLS FIRST
addCase("order zukan_order asc nulls first", (B, db) =>
	q(B, db, "inagle_characters")
		.select("id, name_fr, zukan_order")
		.order("zukan_order", { ascending: true, nullsFirst: true })
		.limit(50)
);

// 7. vue *_clean (GROUP BY name_fr) + count exact (119 distinct / 282 rows)
addCase("keshins_clean group by + count", (B, db) =>
	q(B, db, "inagle_keshins_clean")
		.select("*", { count: "exact" })
		.order("name_fr", { nullsFirst: false })
);

// 8. *_clean avec not ilike (filtre wa%/wkt%) — réplique wiki-service
addCase("keshins_clean not ilike wa%/wkt%", (B, db) =>
	q(B, db, "inagle_keshins_clean")
		.select("*", { count: "exact" })
		.not("asset_code", "ilike", "wa%")
		.not("asset_code", "ilike", "wkt%")
		.range(0, 49)
		.order("name_fr", { nullsFirst: false })
);

// 9. count exact head-style (juste count) sur table simple
addCase("count exact characters", (B, db) =>
	q(B, db, "inagle_characters").select("id", { count: "exact" }).eq("is_primary", 1)
);

// 10. maybeSingle qui trouve
addCase("maybeSingle hit (chara Fei)", (B, db) =>
	q(B, db, "inagle_characters").select("id, name_fr").eq("id", "0x28685D70").maybeSingle()
);

// 11. maybeSingle qui ne trouve PAS (doit renvoyer null, pas la 1re ligne)
addCase("maybeSingle miss (id inexistant)", (B, db) =>
	q(B, db, "inagle_characters").select("id, name_fr").eq("id", "__nope__").maybeSingle()
);

// 12. in() sur category items + neq + range
addCase("items in category + range", (B, db) =>
	q(B, db, "inagle_items")
		.select("id, name_fr, category")
		.in("category", ["shoes", "consume"])
		.neq("name_fr", null)
		.order("id")
		.range(0, 30)
);

// 13. or vide -> 1=0 -> maybeSingle null
addCase("or empty -> match nothing", (B, db) =>
	q(B, db, "inagle_characters").select("id").or("id.eq.").maybeSingle()
);

// 14. in() vide -> 1=0 -> [] avec count 0
addCase("in empty -> nothing + count", (B, db) =>
	q(B, db, "inagle_items").select("id", { count: "exact" }).in("id", [])
);

// 15. json_extract ->> POSITIF (8 auras avec name_FR LIKE %a%)
addCase("or ->> json_extract positif", (B, db) =>
	q(B, db, "inagle_auras")
		.select("id, name_fr, sheet_data")
		.or("sheet_data->>name_FR.ilike.%a%")
		.order("id")
);

// 16. gte/lte sur entier (price items — range réel 0..7141)
addCase("gte/lte price range", (B, db) =>
	q(B, db, "inagle_items")
		.select("id, name_fr, price")
		.gte("price", 100)
		.lte("price", 1000)
		.order("price", { ascending: false })
		.order("id")
		.limit(40)
);

// 17. single() qui trouve
addCase("single() hit", (B, db) =>
	q(B, db, "inagle_skills").select("id, name_fr").eq("id", "rhd10010").single()
);

function stable(value: unknown): string {
	// Sérialisation stable (clés triées) pour comparer data + count.
	return JSON.stringify(value, (_k, v) => {
		if (v && typeof v === "object" && !Array.isArray(v)) {
			const o = v as Record<string, unknown>;
			return Object.keys(o)
				.sort()
				.reduce<Record<string, unknown>>((acc, k) => {
					acc[k] = o[k];
					return acc;
				}, {});
		}
		return v;
	});
}

let failures = 0;
for (const c of cases) {
	const o = await c.old(null);
	const n = await c.neo(null);
	const oData = stable(o.data);
	const nData = stable(n.data);
	const oCount = o.count;
	const nCount = n.count;
	const oErr = o.error ? o.error.message : null;
	const nErr = n.error ? n.error.message : null;

	const same = oData === nData && oCount === nCount && oErr === nErr;
	if (same) {
		const rowN = Array.isArray(o.data) ? o.data.length : o.data === null ? 0 : 1;
		console.log(`OK   ${c.name}  rows=${rowN} count=${oCount ?? "-"}`);
	} else {
		failures++;
		console.log(`DIFF ${c.name}`);
		if (oCount !== nCount) console.log(`  count: old=${oCount} new=${nCount}`);
		if (oErr !== nErr) console.log(`  error: old=${oErr} new=${nErr}`);
		if (oData !== nData) {
			console.log(`  data old (${oData.length} chars): ${oData.slice(0, 240)}`);
			console.log(`  data new (${nData.length} chars): ${nData.slice(0, 240)}`);
		}
	}
}

console.log(`\n=== ${failures === 0 ? "ALL IDENTICAL (diff vide)" : `${failures} DIFF`} / ${cases.length} cases ===`);
process.exit(failures === 0 ? 0 : 1);
