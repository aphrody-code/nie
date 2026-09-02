-- Migration : indexation des scripts/sous-titres d'event IEVR (gap non couvert).
-- Source réelle : common/gamedata/event/subtitle/<lang>/Subtitle_ev*.cfg.bin.json
--                 + common/text/<lang>/event/ev*.cfg.bin.json (texte localisé)
--                 + common/text/event/ev*_map.cfg.bin.json    (table washa label/lip)
-- Parser : packages/inagle/src/parsers/event-subtitles.ts
-- Push    : packages/inagle/scripts/push-event_subtitles.ts
--
-- Deux grains :
--   inagle_events            : agrégat de couverture par event (listing).
--   inagle_event_subtitles   : 1 ligne atomique par (event_id, line_index),
--                              timing réel + texte ja/en/fr résolu par hash.
-- RLS activé + policy lecture publique (mirroir inagle_video_waza).

-- ============================================================================
-- A) Agrégat : 1 ligne par event
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.inagle_events (
  event_id        text PRIMARY KEY,                 -- 'ev09_05000'
  episode         text NOT NULL,                    -- 'ev09'
  has_subtitle    boolean NOT NULL DEFAULT false,   -- a un fichier Subtitle
  subtitle_langs  text[] NOT NULL DEFAULT '{}',     -- langues du fichier Subtitle
  dialogue_langs  text[] NOT NULL DEFAULT '{}',     -- langues du texte par-event (en/fr/ja)
  subtitle_rows   integer NOT NULL DEFAULT 0,       -- nb EV_SUBTITLE_DATA (canonique)
  line_count      integer NOT NULL DEFAULT 0,       -- nb TEXT_INFO (master ja)
  has_map         boolean NOT NULL DEFAULT false,   -- table washa présente
  data            jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inagle_events_episode_idx ON public.inagle_events (episode);
CREATE INDEX IF NOT EXISTS inagle_events_has_subtitle_idx ON public.inagle_events (has_subtitle);

ALTER TABLE public.inagle_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_events;
CREATE POLICY "Public Read" ON public.inagle_events FOR SELECT TO public USING (true);

-- ============================================================================
-- B) Atomique : 1 ligne par réplique de sous-titre (jointe par text_hash)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.inagle_event_subtitles (
  event_id       text NOT NULL,                     -- 'ev09_05000'
  episode        text NOT NULL,                     -- 'ev09'
  line_index     integer NOT NULL,                  -- ordre dans le fichier (0..N-1)
  text_hash      bigint NOT NULL,                   -- Int signé brut (clé de jointure réelle)
  text_hash_u    text NOT NULL,                     -- '0xC39AFCCB' (uint32 hex)
  show_start     double precision NOT NULL,         -- timing var[1] (secondes)
  show_end       double precision NOT NULL,         -- timing var[2]
  t3             double precision NOT NULL,          -- timing var[3]
  t4             double precision NOT NULL,          -- timing var[4]
  subtitle_langs text[] NOT NULL DEFAULT '{}',      -- langues avec timing valide
  line_label     text,                              -- washa var[15] 'ev09_05000_010_010'
  lip_sync       text,                              -- washa var[5] 'no_lip' / NULL
  text_ja        text,                              -- texte brut par-event (NULL si absent)
  text_en        text,
  text_fr        text,
  data           jsonb,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, line_index)
);

CREATE INDEX IF NOT EXISTS inagle_event_subtitles_hash_idx ON public.inagle_event_subtitles (text_hash);
CREATE INDEX IF NOT EXISTS inagle_event_subtitles_hash_u_idx ON public.inagle_event_subtitles (text_hash_u);
CREATE INDEX IF NOT EXISTS inagle_event_subtitles_episode_idx ON public.inagle_event_subtitles (episode);
CREATE INDEX IF NOT EXISTS inagle_event_subtitles_event_idx ON public.inagle_event_subtitles (event_id);

ALTER TABLE public.inagle_event_subtitles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_event_subtitles;
CREATE POLICY "Public Read" ON public.inagle_event_subtitles FOR SELECT TO public USING (true);
