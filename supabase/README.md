# Migrations — le schéma des données du jeu

Les tables `inagle_*` portent les données d'Inazuma Eleven extraites des `.cfg.bin` du jeu par
`packages/inagle`. Elles existaient en base **sans jamais avoir été décrites par une migration** :
créées au fil des familles portées, par le pipeline de push. Une base neuve n'était donc pas
reconstructible, et rien ne disait quel schéma le code attendait.

| Migration | Ce qu'elle pose |
|---|---|
| `20260605000000_inagle_event_subtitles.sql` | les répliques sous-titrées des événements |
| `20260610000000_inagle_cross_core.sql` | le schéma `inagle_cross_*` — 153 tables, **jamais peuplées en production** |
| `20260902000000_inagle_schema_reference.sql` | **la référence** : 66 tables, 39 index, 68 contraintes, 5 vues |
| `20260902000100_inagle_policies.sql` | 66 tables en RLS, 81 politiques |

## Ce qui est vérifié

* **Rejouables à froid** : les quatre passent sur une base vide, dans l'ordre.
* **Idempotentes** : elles passent une deuxième fois sur la base qu'elles viennent de créer.
  `CREATE TABLE`/`SEQUENCE`/`INDEX … IF NOT EXISTS`, `CREATE OR REPLACE VIEW`, contraintes gardées
  par `pg_constraint`, politiques supprimées avant d'être recréées.
* **Fidèles** : le schéma reconstruit porte **les 811 colonnes de la production, sans exception**
  (comparaison `information_schema.columns` entre une base neuve migrée et `rg`).

```bash
sudo -u postgres createdb verif
for f in supabase/migrations/*.sql; do sudo -u postgres psql -v ON_ERROR_STOP=1 -d verif -f "$f"; done
```

## Deux choses à savoir

**Les politiques sont séparées du schéma.** Elles interrogent `public.profiles` et `auth.uid()`,
c'est-à-dire le socle Supabase. Une base qui ne porte que les tables du jeu doit pouvoir se
construire sans lui : la migration le détecte et passe son tour en le disant, au lieu d'échouer au
milieu.

**`inagle_cross_*` n'est pas `inagle_*`.** Ces 153 tables décrivent un autre jeu et ne portent
aucune ligne en production. Elles sont conservées parce que la migration existait ; ne pas les
confondre avec le schéma servi par le wiki.

## Ce que ces fichiers ne font pas

Ils créent la **forme**, jamais le contenu. Les lignes viennent de `packages/inagle` (push depuis
les fichiers du jeu), et le miroir SQLite lu par le site et par `@niers/catalog` est republié par
`scripts/donnees/miroir-inagle.sh`. Une migration qui insérerait des données du jeu ferait du SQL
une deuxième source de vérité — le jeu est la seule.
