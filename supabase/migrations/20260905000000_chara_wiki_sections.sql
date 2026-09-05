-- Fiche personnage : sections encyclopédiques et numéro de maillot.
--
-- `wiki_sections` était déjà LU par le service wiki
-- (`packages/azalee/src/wiki/service.ts` → `wikiSections: char.wiki_sections || []`)
-- et rendu par `app/chara/[id]/page.tsx`, mais la colonne n'existait pas : la section
-- « Histoire / Recrutement » était donc morte pour tous les personnages. On la crée.
--
-- `uniform_number` remplace le `jerseyNumber={10}` codé en dur de la fiche.
--
-- Additif et rejouable : aucune donnée existante n'est touchée, les deux colonnes
-- sont nullables et sans valeur par défaut.

ALTER TABLE public.inagle_characters
	ADD COLUMN IF NOT EXISTS wiki_sections jsonb;

ALTER TABLE public.inagle_characters
	ADD COLUMN IF NOT EXISTS uniform_number integer;

COMMENT ON COLUMN public.inagle_characters.wiki_sections IS
	'Sections encyclopédiques de la fiche : [{"title": "...", "content": "..."}]. Rendu par app/chara/[id].';
COMMENT ON COLUMN public.inagle_characters.uniform_number IS
	'Numéro de maillot affiché sur la fiche. NULL = inconnu (la fiche retombe sur 10).';

-- PostgREST met son cache de schéma à jour sur ce signal ; sans lui, les nouvelles
-- colonnes restent invisibles à l'API tant que le service n'a pas redémarré.
NOTIFY pgrst, 'reload schema';
