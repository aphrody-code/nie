-- Lecture publique des donnees de jeu `inagle_*`.
--
-- POURQUOI CETTE MIGRATION EXISTE
-- Sur un projet Supabase neuf, RLS est active a la creation des tables. Postgres refuse
-- alors TOUTES les lignes tant qu'aucune policy permissive n'existe — independamment des
-- GRANT. Mesure sur le projet cible apres chargement des donnees :
--
--   64 tables `inagle_*` avec RLS et ZERO policy  -> invisibles
--   155 policies existantes, toutes sur `inagle_cross_*` -> des tables vides
--   has_table_privilege('anon','inagle_skills','SELECT') = true
--
-- Autrement dit le GRANT etait bon et la donnee etait la (165 277 lignes chargees), mais
-- `GET /rest/v1/inagle_skills` rendait `HTTP 200` avec un tableau VIDE. C'est le mode
-- d'echec le plus couteux : pas d'erreur, pas de 403, juste un site sans contenu. Ni un
-- build ni un type-check ne l'auraient signale.
--
-- CE QUE CETTE MIGRATION FAIT, ET CE QU'ELLE NE FAIT PAS
-- Elle donne la LECTURE SEULE a `anon` et `authenticated` sur les tables de donnees de jeu.
-- Ces donnees sont publiques par nature — c'est un wiki, et elles sont deja servies
-- publiquement depuis le VPS aujourd'hui. Elle n'accorde AUCUNE ecriture, et ne touche a
-- aucune table portant des donnees personnelles ou applicatives (`profiles`, `account`,
-- `two_factor`, `audit_logs`, le schema `auth`) : celles-la gardent leur RLS fermee.
--
-- IDEMPOTENTE : `CREATE POLICY` n'accepte pas `IF NOT EXISTS`, on interroge donc
-- `pg_policies` avant creation — meme technique que pour les contraintes ailleurs dans ce
-- dossier, Postgres n'ayant pas `ADD CONSTRAINT IF NOT EXISTS`.

do $$
declare
	t record;
	cree integer := 0;
	deja integer := 0;
begin
	for t in
		select c.relname as nom
		from pg_class c
		join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = 'public'
		where c.relkind = 'r'
		  and c.relname like 'inagle\_%'
		order by c.relname
	loop
		-- RLS doit rester activee : on ouvre par une policy explicite, on ne desactive pas
		-- la protection. Une table sans RLS serait ouverte en ecriture aussi.
		execute format('alter table public.%I enable row level security', t.nom);

		if exists (
			select 1 from pg_policies
			where schemaname = 'public' and tablename = t.nom and policyname = 'lecture_publique'
		) then
			deja := deja + 1;
		else
			execute format(
				'create policy lecture_publique on public.%I for select to anon, authenticated using (true)',
				t.nom
			);
			cree := cree + 1;
		end if;
	end loop;

	raise notice 'lecture publique : % policies creees, % deja presentes', cree, deja;
end
$$;
