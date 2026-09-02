#!/usr/bin/env bun
// Régénère `src/types.gen.ts` depuis la base PostgreSQL vivante.
//
// Pourquoi ce script et plus `supabase gen types typescript --project-id …` :
// le projet Supabase Cloud n'existe plus (bascule self-host du 11/8/2026), donc
// l'ancienne commande ne pouvait plus produire que des types périmés. Le
// générateur utilisé ici est EXACTEMENT celui qu'appelait la CLI Supabase :
// l'endpoint `/generators/typescript` de pg-meta, servi en local par le
// conteneur `rg-pg-meta` (cf. `infra/docker/supabase-studio.yml`).
//
// Le fichier produit est commité tel quel : relancer ce script sur un schéma
// inchangé doit redonner un fichier identique au bit près. C'est ce qui permet
// de détecter une dérive avec un simple `git diff`.

const PG_META = Bun.env.RG_PG_META_URL ?? "http://127.0.0.1:8813";
const SCHEMAS = (Bun.env.RG_SCHEMAS ?? "public").split(",");
const CIBLE = new URL("../src/types.gen.ts", import.meta.url).pathname;

const ENTETE = `// Types du schéma PostgreSQL — FICHIER GÉNÉRÉ, NE PAS ÉDITER À LA MAIN.
//
// Régénération : \`bun run --filter @rosegriffon/db types:gen\`
// (script \`packages/db/scripts/types-gen.ts\` → endpoint \`/generators/typescript\`
// de pg-meta en local, le générateur même de \`supabase gen types typescript\`).
//
// Toute correction se fait EN BASE puis par régénération : une retouche à la
// main est effacée au prochain passage et fait mentir le type sans prévenir.
//
// Pas de bloc \`__InternalSupabase.PostgrestVersion\` ici : \`@supabase/supabase-js\`
// retombe alors sur \`'12'\`, ce qui correspond au PostgREST réellement servi
// (12.2.12, cf. l'en-tête \`Server:\` de \`127.0.0.1:8809\`). L'ancienne valeur
// \`"14.5"\` héritée de Supabase Cloud autorisait \`.maxAffected()\` au typage
// alors que le serveur ne sait pas l'honorer.

`;

const url = `${PG_META}/generators/typescript?included_schemas=${SCHEMAS.join(",")}`;
const reponse = await fetch(url, { signal: AbortSignal.timeout(60_000) }).catch(
	(erreur: unknown) => {
		throw new Error(`[types:gen] pg-meta injoignable sur ${PG_META} : ${String(erreur)}`);
	}
);

if (!reponse.ok) {
	throw new Error(
		`[types:gen] pg-meta a répondu ${reponse.status} — le conteneur rg-pg-meta doit tourner.`
	);
}

const types = await reponse.text();
if (!types.includes("export type Database = {")) {
	throw new Error("[types:gen] réponse inattendue : aucun `export type Database` dans la sortie.");
}

await Bun.write(CIBLE, ENTETE + types);
console.log(`types:gen ok schemas=${SCHEMAS.join(",")} octets=${ENTETE.length + types.length}`);
