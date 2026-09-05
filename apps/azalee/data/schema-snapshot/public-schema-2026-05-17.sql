--
-- PostgreSQL database dump
--

\restrict dAsXrhs4t0nEB25UDkeAmUolar53hdCb5VFjNUeP12mFEoBVqFapMhUdoJJs3Rj

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.3 (Ubuntu 18.3-1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: check_rate_limit(uuid, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_rate_limit(p_user_id uuid, p_action text, p_max_count integer DEFAULT 10, p_window_minutes integer DEFAULT 1) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_record RECORD;
BEGIN
  SELECT * INTO v_record
  FROM public.rate_limits
  WHERE user_id = p_user_id AND action = p_action;

  IF NOT FOUND THEN
    INSERT INTO public.rate_limits (user_id, action, count, window_start)
    VALUES (p_user_id, p_action, 1, NOW());
    RETURN TRUE;
  END IF;

  IF v_record.window_start < NOW() - (p_window_minutes || ' minutes')::INTERVAL THEN
    UPDATE public.rate_limits
    SET count = 1, window_start = NOW()
    WHERE user_id = p_user_id AND action = p_action;
    RETURN TRUE;
  END IF;

  IF v_record.count >= p_max_count THEN
    RETURN FALSE;
  END IF;

  UPDATE public.rate_limits
  SET count = count + 1
  WHERE user_id = p_user_id AND action = p_action;
  RETURN TRUE;
END;
$$;


--
-- Name: generate_article_slug(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_article_slug(title text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  base_slug TEXT;
  final_slug TEXT;
  counter INTEGER := 0;
BEGIN
  -- Générer slug de base (minuscules, remplacer espaces par tirets, supprimer caractères spéciaux)
  base_slug := lower(regexp_replace(
    regexp_replace(title, '[^a-zA-Z0-9\s-]', '', 'g'),
    '\s+', '-', 'g'
  ));
  
  final_slug := base_slug;
  
  -- Vérifier unicité et incrémenter si nécessaire
  WHILE EXISTS (SELECT 1 FROM public.articles WHERE slug = final_slug) LOOP
    counter := counter + 1;
    final_slug := base_slug || '-' || counter;
  END LOOP;
  
  RETURN final_slug;
END;
$$;


--
-- Name: get_comment_counts(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_comment_counts(article_ids uuid[]) RETURNS TABLE(article_id uuid, count bigint)
    LANGUAGE sql STABLE
    AS $$
  SELECT article_id, COUNT(*)::BIGINT
  FROM public.article_comments
  WHERE article_id = ANY(article_ids)
  GROUP BY article_id;
$$;


--
-- Name: get_my_patreon_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_patreon_status() RETURNS TABLE(is_active boolean, status text, tier_titles text[], currently_entitled_cents bigint, next_charge_date timestamp with time zone, is_free_trial boolean, is_gifted boolean, discount_percent integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    (m.patron_status = 'active_patron') AS is_active,
    m.patron_status                      AS status,
    m.tier_titles,
    m.currently_entitled_cents,
    m.next_charge_date,
    m.is_free_trial,
    m.is_gifted,
    CASE WHEN m.patron_status = 'active_patron' THEN 20 ELSE 0 END AS discount_percent
  FROM public.patreon_memberships m
  WHERE m.user_id = auth.uid()
  ORDER BY m.currently_entitled_cents DESC NULLS LAST
  LIMIT 1;
$$;


--
-- Name: FUNCTION get_my_patreon_status(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_my_patreon_status() IS 'Renvoie l etat Patreon condense pour l user courant (auth.uid). Utilise par le front pour afficher prix barre, badge tier, prochaine charge.';


--
-- Name: get_share_counts(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_share_counts(p_article_ids uuid[]) RETURNS TABLE(article_id uuid, total bigint, by_platform jsonb)
    LANGUAGE sql STABLE
    AS $$
  SELECT
    article_id,
    COUNT(*)::BIGINT                   AS total,
    jsonb_object_agg(platform, cnt)    AS by_platform
  FROM (
    SELECT article_id, platform, COUNT(*)::BIGINT AS cnt
    FROM public.share_tracking
    WHERE article_id = ANY(p_article_ids)
    GROUP BY article_id, platform
  ) sub
  GROUP BY article_id;
$$;


--
-- Name: get_trending_articles(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_trending_articles(days_window integer DEFAULT 7, result_limit integer DEFAULT 10) RETURNS TABLE(id uuid, title text, slug text, excerpt text, featured_image_url text, category character varying, view_count integer, published_at timestamp with time zone, trending_score double precision)
    LANGUAGE sql STABLE
    AS $$
  SELECT
    a.id,
    a.title,
    a.slug,
    a.excerpt,
    a.featured_image_url,
    a.category,
    a.view_count,
    a.published_at,
    (
      a.view_count::FLOAT
      / GREATEST(1, EXTRACT(EPOCH FROM (NOW() - a.published_at)) / 86400)
    )::FLOAT AS trending_score
  FROM public.articles a
  WHERE a.status      = 'published'
    AND a.app         = 'azalee'
    AND a.published_at >= NOW() - (days_window || ' days')::INTERVAL
  ORDER BY trending_score DESC
  LIMIT result_limit;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, email, username)
  VALUES (
    new.id, 
    new.email,
    -- Extract username from email if available, otherwise use a default
    COALESCE(new.raw_user_meta_data->>'username', SPLIT_PART(new.email, '@', 1))
  );
  RETURN new;
END;
$$;


--
-- Name: increment_article_views(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_article_views(article_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.articles
  SET views_count = COALESCE(views_count, 0) + 1
  WHERE id = article_id;
END;
$$;


--
-- Name: FUNCTION increment_article_views(article_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.increment_article_views(article_id uuid) IS 'Increments the view count for a specific article';


--
-- Name: increment_share_count(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_share_count(p_article_id uuid, p_platform text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.articles
  SET share_count = COALESCE(share_count, 0) + 1
  WHERE id = p_article_id;
END;
$$;


--
-- Name: is_active_patron(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_active_patron(uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.patreon_memberships
    WHERE user_id = uid
      AND patron_status = 'active_patron'
  );
$$;


--
-- Name: FUNCTION is_active_patron(uid uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.is_active_patron(uid uuid) IS 'true si user_id a un membership Patreon actif. Source de verite pour la reduction 20% boutique Stripe.';


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;


--
-- Name: notify_article_comment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_article_comment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_article        RECORD;
  v_commenter_name TEXT;
  v_parent_author  UUID;
BEGIN
  -- Récupérer les infos de l'article
  SELECT id, title, slug, author_id INTO v_article
  FROM public.articles WHERE id = NEW.article_id;

  -- Récupérer le nom de l'auteur du commentaire
  SELECT COALESCE(full_name, username, 'Quelqu''un') INTO v_commenter_name
  FROM public.profiles WHERE id = NEW.user_id;

  -- Notifier l'auteur de l'article (sauf s'il commente lui-même)
  IF v_article.author_id IS NOT NULL AND v_article.author_id != NEW.user_id THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_article.author_id,
      'comment',
      v_commenter_name || ' a commenté votre article',
      LEFT(NEW.content, 100),
      jsonb_build_object(
        'url',        '/news/' || v_article.slug,
        'article_id', v_article.id,
        'comment_id', NEW.id
      )
    );
  END IF;

  -- Si c'est une réponse, notifier l'auteur du commentaire parent
  IF NEW.parent_id IS NOT NULL THEN
    SELECT user_id INTO v_parent_author
    FROM public.article_comments WHERE id = NEW.parent_id;

    IF v_parent_author IS NOT NULL AND v_parent_author != NEW.user_id THEN
      INSERT INTO public.notifications (user_id, type, title, body, data)
      VALUES (
        v_parent_author,
        'reply',
        v_commenter_name || ' a répondu à votre commentaire',
        LEFT(NEW.content, 100),
        jsonb_build_object(
          'url',        '/news/' || v_article.slug,
          'article_id', v_article.id,
          'comment_id', NEW.id
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: promote_rg_creator_to_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.promote_rg_creator_to_admin() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  is_owner       boolean := false;
  is_whitelisted boolean := false;
  is_creator_tok boolean := false;
BEGIN
  -- Voie 1 : URL Patreon canonique RG. Match :
  --   - patreon.com/c/RoseGriffon (URL actuelle officielle, nouveau format avec /c/)
  --   - patreon.com/rosegriffon  (vanity historique sans suffixe)
  --   - patreon.com/rosegriffonfr (vanity historique avec suffixe fr)
  -- Tous case-insensitive, avec ou sans trailing slash.
  is_owner := lower(coalesce(NEW.patreon_url, '')) ~* 'patreon\.com/(c/)?rosegriffon(fr)?(/?|$)';

  IF NOT is_owner THEN
    SELECT EXISTS(
      SELECT 1 FROM public.patreon_admin_owners
      WHERE patreon_user_id = NEW.patreon_user_id
    ) INTO is_whitelisted;
  END IF;

  IF NOT is_owner AND NOT is_whitelisted THEN
    SELECT EXISTS(
      SELECT 1 FROM public.patreon_oauth_tokens
      WHERE patreon_user_id = NEW.patreon_user_id
        AND is_creator = true
    ) INTO is_creator_tok;
  END IF;

  IF NOT (is_owner OR is_whitelisted OR is_creator_tok) THEN
    RETURN NEW;
  END IF;

  UPDATE public.profiles
  SET role = 'admin',
      updated_at = now()
  WHERE id = NEW.user_id
    AND coalesce(role, '') <> 'admin';

  RETURN NEW;
END;
$_$;


--
-- Name: FUNCTION promote_rg_creator_to_admin(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.promote_rg_creator_to_admin() IS 'Trigger AFTER INSERT/UPDATE patreon_memberships : promeut profiles.role=admin pour le createur RG. Detection 3 voies (URL canonique, whitelist patreon_admin_owners, is_creator=true).';


--
-- Name: tg_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tg_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: update_articles_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_articles_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_chronicles_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_chronicles_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_comment_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_comment_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_exports_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_exports_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_stream_schedules_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_stream_schedules_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_team_members_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_team_members_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: upsert_reading_progress(uuid, uuid, smallint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_reading_progress(p_user_id uuid, p_article_id uuid, p_progress smallint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO public.reading_history (user_id, article_id, progress, last_read_at)
  VALUES (p_user_id, p_article_id, p_progress, NOW())
  ON CONFLICT (user_id, article_id)
  DO UPDATE SET
    progress     = GREATEST(reading_history.progress, p_progress),
    read_count   = reading_history.read_count + 1,
    last_read_at = NOW();
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account (
    id text NOT NULL,
    user_id text NOT NULL,
    account_id text NOT NULL,
    provider_id text NOT NULL,
    access_token text,
    refresh_token text,
    access_token_expires_at timestamp with time zone,
    refresh_token_expires_at timestamp with time zone,
    scope text,
    id_token text,
    password text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    details jsonb DEFAULT '{}'::jsonb,
    ip_address text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: article_bookmarks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.article_bookmarks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    article_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: article_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.article_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    slug character varying(100) NOT NULL,
    description text,
    color character varying(7),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: article_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.article_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    article_id uuid NOT NULL,
    user_id uuid NOT NULL,
    parent_id uuid,
    content text NOT NULL,
    is_edited boolean DEFAULT false NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT article_comments_content_check CHECK (((char_length(content) >= 1) AND (char_length(content) <= 2000)))
);


--
-- Name: article_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.article_reactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    article_id uuid NOT NULL,
    user_id uuid NOT NULL,
    reaction_type text DEFAULT 'like'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: article_series; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.article_series (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    slug text NOT NULL,
    description text,
    cover_image_url text,
    author_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: articles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.articles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(255) NOT NULL,
    slug character varying(255) NOT NULL,
    excerpt text,
    content text NOT NULL,
    featured_image_url text,
    featured_image_alt character varying(255),
    category character varying(100),
    tags text[],
    meta_title character varying(255),
    meta_description text,
    status character varying(20) DEFAULT 'draft'::character varying,
    published_at timestamp with time zone,
    author_id uuid,
    view_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    app text DEFAULT 'azalee'::text NOT NULL,
    scheduled_at timestamp with time zone,
    search_vector tsvector,
    series_id uuid,
    series_order integer DEFAULT 0 NOT NULL,
    share_count integer DEFAULT 0 NOT NULL,
    pinned boolean DEFAULT false,
    co_authors jsonb,
    CONSTRAINT articles_status_check CHECK (((status)::text = ANY (ARRAY[('draft'::character varying)::text, ('published'::character varying)::text, ('archived'::character varying)::text])))
);


--
-- Name: COLUMN articles.co_authors; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.articles.co_authors IS 'Array of co-authors: [{name, avatar_url, discord_id?, profile_id?}]. Author principal reste author_id.';


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    action text NOT NULL,
    details jsonb,
    ip_address text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: chronicles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chronicles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    slug text NOT NULL,
    excerpt text,
    content text NOT NULL,
    category text DEFAULT 'actualites'::text NOT NULL,
    published boolean DEFAULT false,
    views_count integer DEFAULT 0,
    featured_image text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    author_id uuid NOT NULL
);


--
-- Name: comment_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comment_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    comment_id uuid NOT NULL,
    reporter_id uuid NOT NULL,
    reason text NOT NULL,
    details text,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT comment_reports_reason_check CHECK ((reason = ANY (ARRAY['spam'::text, 'harassment'::text, 'inappropriate'::text, 'misinformation'::text, 'other'::text]))),
    CONSTRAINT comment_reports_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'reviewed'::text, 'resolved'::text, 'dismissed'::text])))
);


--
-- Name: patch_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patch_notes (
    id text NOT NULL,
    title text NOT NULL,
    date text NOT NULL,
    platform jsonb DEFAULT '[]'::jsonb NOT NULL,
    url text NOT NULL,
    featured_image text,
    content_html text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    title_fr text,
    content_html_fr text
);


--
-- Name: topics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.topics (
    id text NOT NULL,
    title text NOT NULL,
    date text NOT NULL,
    url text NOT NULL,
    category text,
    thumbnail text,
    content_html text,
    images jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: content_feed; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.content_feed AS
 SELECT topics.id,
    'article'::text AS type,
    topics.title,
    topics.id AS slug,
    'Voir le détail...'::text AS excerpt,
    to_date(topics.date, 'YYYY.MM.DD'::text) AS date,
    topics.thumbnail AS image,
    topics.category,
    NULL::uuid AS author_id,
    topics.created_at
   FROM public.topics
UNION ALL
 SELECT patch_notes.id,
    'article'::text AS type,
    patch_notes.title,
    patch_notes.id AS slug,
    'Notes de mise à jour'::text AS excerpt,
    to_date(patch_notes.date, 'YYYY.MM.DD'::text) AS date,
    patch_notes.featured_image AS image,
    'Patch Note'::text AS category,
    NULL::uuid AS author_id,
    patch_notes.created_at
   FROM public.patch_notes;


--
-- Name: discord_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discord_members (
    discord_id text NOT NULL,
    username text NOT NULL,
    display_name text,
    nickname text,
    avatar_url text,
    joined_at timestamp with time zone,
    premium_since timestamp with time zone,
    roles text[] DEFAULT '{}'::text[],
    is_bot boolean DEFAULT false,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: discord_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discord_roles (
    role_id text NOT NULL,
    guild_id text NOT NULL,
    name text NOT NULL,
    color integer DEFAULT 0,
    "position" integer DEFAULT 0,
    permissions text,
    is_mentionable boolean DEFAULT false,
    is_hoisted boolean DEFAULT false,
    icon_url text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: discord_sync_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discord_sync_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    status text NOT NULL,
    total_members integer DEFAULT 0,
    updated_count integer DEFAULT 0,
    error_count integer DEFAULT 0,
    message text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: email_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    subject text NOT NULL,
    body_html text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL,
    location text,
    image_url text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: inagle_activity_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_activity_photos (
    id text NOT NULL,
    trophy_id_hex text,
    reward integer,
    image_path text,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_auras; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_auras (
    id text NOT NULL,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_ja text,
    element_id integer,
    sub_type text,
    image_url text,
    asset_code text,
    sheet_data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_awakenings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_awakenings (
    id text NOT NULL,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_en text,
    description_ja text,
    type text,
    image_url text,
    data jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    sheet_data jsonb,
    asset_code text,
    sub_type text,
    element_id integer
);


--
-- Name: inagle_awakenings_clean; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.inagle_awakenings_clean AS
 SELECT DISTINCT ON (name_fr) id,
    name_fr,
    name_en,
    name_ja,
    description_fr,
    description_en,
    description_ja,
    type,
    image_url,
    data,
    updated_at,
    sheet_data
   FROM public.inagle_awakenings
  ORDER BY name_fr, id;


--
-- Name: inagle_basara; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_basara (
    character_id character varying(50) NOT NULL,
    name_romaji character varying(255),
    name_localised character varying(255),
    gender character varying(50),
    "position" character varying(50),
    alt_position character varying(50),
    element character varying(50),
    moveset text,
    alt_moveset text,
    passive text,
    kick integer,
    control integer,
    technique integer,
    pressure integer,
    physical integer,
    agility integer,
    intelligence integer
);


--
-- Name: inagle_capsules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_capsules (
    id text NOT NULL,
    prize_data jsonb,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_chara_menu_resource; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_chara_menu_resource (
    id text NOT NULL,
    is_template boolean DEFAULT false,
    paths jsonb,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_characters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_characters (
    id text NOT NULL,
    chara_id text,
    internal_code text,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_ja text,
    rarity text,
    rarity_code integer,
    rarity_label text,
    element_id integer,
    element text,
    position_id integer,
    "position" text,
    gender text,
    image_url text,
    sheet_data jsonb,
    stats jsonb,
    skills jsonb,
    teams jsonb,
    series text,
    slug text,
    team_id text,
    stat_frappe integer DEFAULT 0,
    stat_controle integer DEFAULT 0,
    stat_technique integer DEFAULT 0,
    stat_pression integer DEFAULT 0,
    stat_physique integer DEFAULT 0,
    stat_agilite integer DEFAULT 0,
    stat_intelligence integer DEFAULT 0,
    stat_total integer DEFAULT 0,
    constellation text,
    constellation_index integer,
    zukan_hash text,
    created_at timestamp with time zone DEFAULT now(),
    zukan_order integer,
    base_slug text,
    control_type text,
    data jsonb,
    is_controllable boolean DEFAULT false,
    description_en text,
    game_appearances text[],
    model_id text,
    stat_lv1_frappe integer DEFAULT 0,
    stat_lv1_controle integer DEFAULT 0,
    stat_lv1_technique integer DEFAULT 0,
    stat_lv1_pression integer DEFAULT 0,
    stat_lv1_physique integer DEFAULT 0,
    stat_lv1_agilite integer DEFAULT 0,
    stat_lv1_intelligence integer DEFAULT 0,
    updated_at timestamp with time zone DEFAULT now(),
    hero_type text
);


--
-- Name: inagle_chat_emotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_chat_emotes (
    id text NOT NULL,
    emote_id text,
    flag_idx integer,
    sort_id integer,
    type integer,
    text_id text,
    stamp_idx integer,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_coordinators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_coordinators (
    id integer NOT NULL,
    image text,
    name_kanji character varying(255),
    name_hiragana character varying(255),
    name_romaji character varying(255),
    name_localised character varying(255),
    gender text,
    role character varying(100),
    game character varying(255),
    element text,
    playstyle character varying(255),
    passive_slot integer,
    passive_no integer,
    requirements text,
    stat character varying(100),
    buff character varying(100)
);


--
-- Name: inagle_coordinators_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inagle_coordinators_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inagle_coordinators_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inagle_coordinators_id_seq OWNED BY public.inagle_coordinators.id;


--
-- Name: inagle_costumes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_costumes (
    id text NOT NULL,
    costume_index integer,
    type integer,
    model_ref text,
    flag1 integer,
    flag2 integer,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_custom_passives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_custom_passives (
    id integer NOT NULL,
    requirements text,
    stat text,
    buff text
);


--
-- Name: inagle_drops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_drops (
    id integer NOT NULL,
    team text,
    game text,
    fixed_beans text,
    passive_type text,
    no integer,
    requirement text,
    stat text,
    value text
);


--
-- Name: inagle_drops_battles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_drops_battles (
    battle_group_id bigint NOT NULL,
    item_table_id bigint,
    data jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_drops_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inagle_drops_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inagle_drops_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inagle_drops_id_seq OWNED BY public.inagle_drops.id;


--
-- Name: inagle_drops_tables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_drops_tables (
    table_id text NOT NULL,
    entries jsonb DEFAULT '[]'::jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_drops_treasures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_drops_treasures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    map_id text,
    pos jsonb,
    items jsonb DEFAULT '[]'::jsonb,
    data jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_exp_table; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_exp_table (
    level integer NOT NULL,
    need_exp integer NOT NULL
);


--
-- Name: inagle_formations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_formations (
    id text NOT NULL,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_en text,
    description_ja text,
    type text,
    image_url text,
    data jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    emblem_url text
);


--
-- Name: inagle_gallery; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_gallery (
    id text NOT NULL,
    img_path text,
    thumb_path text,
    need_token_num integer,
    flg_no integer,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_growth_tables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_growth_tables (
    id integer NOT NULL,
    section text NOT NULL,
    main_position integer,
    sub_position integer,
    play_style integer,
    growth_pattern integer,
    chara_rank integer,
    data jsonb NOT NULL
);


--
-- Name: inagle_growth_tables_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inagle_growth_tables_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inagle_growth_tables_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inagle_growth_tables_id_seq OWNED BY public.inagle_growth_tables.id;


--
-- Name: inagle_heroes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_heroes (
    character_id character varying(50) NOT NULL,
    name_romaji character varying(255),
    name_localised character varying(255),
    gender character varying(50),
    "position" character varying(50),
    element character varying(50),
    playstyle character varying(255) NOT NULL,
    moveset text,
    kick integer,
    control integer,
    technique integer,
    pressure integer,
    physical integer,
    agility integer,
    intelligence integer
);


--
-- Name: inagle_icon_inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_icon_inventory (
    id text NOT NULL,
    folder text NOT NULL,
    subfolder text DEFAULT ''::text,
    filename text NOT NULL,
    path text NOT NULL,
    size integer DEFAULT 0,
    mime text DEFAULT 'image/webp'::text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_img_inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_img_inventory (
    id text NOT NULL,
    folder text NOT NULL,
    subfolder text DEFAULT ''::text,
    filename text NOT NULL,
    path text NOT NULL,
    size integer DEFAULT 0,
    mime text DEFAULT 'image/webp'::text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_items (
    id text NOT NULL,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_ja text,
    category text,
    rarity integer,
    image_url text,
    sheet_data jsonb,
    price integer,
    internal_code text,
    shops jsonb,
    created_at timestamp with time zone DEFAULT now(),
    data jsonb,
    description_en text,
    sell_price integer,
    buy_price integer,
    shop_names text[],
    stat_boost_1 text,
    stat_boost_2 text,
    updated_at timestamp with time zone DEFAULT now(),
    boost_type text,
    effect_value integer DEFAULT 0
);


--
-- Name: inagle_keshins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_keshins (
    id text NOT NULL,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_en text,
    description_ja text,
    type text,
    image_url text,
    data jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    sheet_data jsonb,
    asset_code text,
    element_id integer,
    sub_type text
);


--
-- Name: inagle_keshins_clean; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.inagle_keshins_clean AS
 SELECT DISTINCT ON (name_fr) id,
    name_fr,
    name_en,
    name_ja,
    description_fr,
    description_en,
    description_ja,
    type,
    image_url,
    data,
    updated_at,
    sheet_data,
    asset_code,
    element_id,
    sub_type
   FROM public.inagle_keshins
  ORDER BY name_fr, id;


--
-- Name: inagle_kizuna_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_kizuna_items (
    name text NOT NULL,
    size text,
    power integer,
    shop text,
    notes text
);


--
-- Name: inagle_manager_passives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_manager_passives (
    id integer NOT NULL,
    playstyle character varying(100),
    requirements text,
    stat text,
    coord_common character varying(20),
    coord_legendary character varying(20),
    manager_common character varying(20),
    manager_legendary character varying(20)
);


--
-- Name: inagle_media_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_media_assets (
    id text NOT NULL,
    folder text NOT NULL,
    category text NOT NULL,
    path text NOT NULL,
    is_template boolean DEFAULT false,
    sources jsonb,
    context jsonb,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_miximax; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_miximax (
    id text NOT NULL,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_en text,
    description_ja text,
    type text,
    image_url text,
    data jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    icon_code text,
    asset_code text,
    element_id integer,
    sub_type text,
    sheet_data jsonb
);


--
-- Name: inagle_miximax_clean; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.inagle_miximax_clean AS
 SELECT DISTINCT ON (name_fr) id,
    name_fr,
    name_en,
    name_ja,
    description_fr,
    description_en,
    description_ja,
    type,
    image_url,
    data,
    updated_at,
    icon_code,
    asset_code,
    element_id,
    sub_type,
    sheet_data
   FROM public.inagle_miximax
  ORDER BY name_fr, id;


--
-- Name: inagle_mode_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_mode_changes (
    id text NOT NULL,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_en text,
    description_ja text,
    type text,
    image_url text,
    data jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    asset_code text,
    sub_type text,
    element_id integer,
    sheet_data jsonb
);


--
-- Name: inagle_mode_changes_clean; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.inagle_mode_changes_clean AS
 SELECT DISTINCT ON (name_fr) id,
    name_fr,
    name_en,
    name_ja,
    description_fr,
    description_en,
    description_ja,
    type,
    image_url,
    data,
    updated_at
   FROM public.inagle_mode_changes
  ORDER BY name_fr, id;


--
-- Name: inagle_nameplates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_nameplates (
    id text NOT NULL,
    name_text_id text,
    sort_no integer,
    image_path text,
    font_style text,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_opponent_teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_opponent_teams (
    id text NOT NULL,
    team_id text,
    type integer,
    game_id text,
    difficulty_type integer,
    bg_texture text,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_override_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_override_skills (
    id text NOT NULL,
    name_fr text,
    name_en text,
    name_ja text,
    element_id integer DEFAULT 0,
    category_id integer DEFAULT 0,
    power_min integer DEFAULT 0,
    power_max integer DEFAULT 0,
    conditions jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_passive_generation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_passive_generation (
    passive_id character varying(50) NOT NULL,
    no integer NOT NULL,
    requirement text,
    stat text
);


--
-- Name: inagle_passive_scaling; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_passive_scaling (
    id integer NOT NULL,
    requirement text,
    stat_affected text,
    legendary_low character varying(20),
    legendary_high character varying(20),
    top_low character varying(20),
    top_high character varying(20),
    advanced_low character varying(20),
    advanced_high character varying(20),
    growing_low character varying(20),
    growing_high character varying(20),
    common_low character varying(20),
    common_high character varying(20)
);


--
-- Name: inagle_passives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_passives (
    id text NOT NULL,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_en text,
    description_ja text,
    type text,
    image_url text,
    data jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    category text,
    boost_type text,
    stat_boost text,
    effect_value text
);


--
-- Name: inagle_performances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_performances (
    id text NOT NULL,
    event_id text,
    event_name_text_id text,
    image_path text,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_phase_titles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_phase_titles (
    id text NOT NULL,
    texture_id text,
    image_path text,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_quests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_quests (
    id text NOT NULL,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_en text,
    description_ja text,
    type text,
    image_url text,
    data jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    display_text text,
    phase text
);


--
-- Name: inagle_scene_archives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_scene_archives (
    id text NOT NULL,
    event_id text,
    category integer,
    title_text_id text,
    chapter_no integer,
    image_path text,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_skills (
    id text NOT NULL,
    internal_code text,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_ja text,
    category_id integer,
    element_id integer,
    power_min integer,
    power_max integer,
    tension_cost integer,
    image_url text,
    video_url text,
    poster_url text,
    is_hyper boolean DEFAULT false,
    sheet_data jsonb,
    created_at timestamp with time zone DEFAULT now(),
    category text,
    data jsonb,
    description_en text,
    element text,
    evolution_type text,
    foul_rate integer DEFAULT 0,
    growth_type text,
    hash_id text,
    is_eldorado boolean DEFAULT false,
    partner_count integer DEFAULT 0,
    recast_time integer DEFAULT 0,
    tp_cost integer DEFAULT 0,
    skill_effect_bit_flag integer DEFAULT 0,
    tags text[],
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_souls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_souls (
    id text NOT NULL,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_en text,
    description_ja text,
    type text,
    image_url text,
    data jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    sheet_data jsonb,
    asset_code text,
    sub_type text,
    element_id integer
);


--
-- Name: inagle_souls_clean; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.inagle_souls_clean AS
 SELECT DISTINCT ON (name_fr) id,
    name_fr,
    name_en,
    name_ja,
    description_fr,
    description_en,
    description_ja,
    type,
    image_url,
    data,
    updated_at,
    sheet_data
   FROM public.inagle_souls
  ORDER BY name_fr, id;


--
-- Name: inagle_stadiums; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_stadiums (
    id text NOT NULL,
    field_index integer,
    image_path text,
    condition text,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_tactics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_tactics (
    name text NOT NULL,
    effect1 text,
    effect2 text,
    effect3 text,
    duration integer,
    cooldown integer,
    shop text,
    id text,
    internal_code text,
    name_fr text,
    name_ja text,
    description_fr text,
    description_en text,
    description_ja text,
    element_id integer DEFAULT 0,
    element text DEFAULT 'Néant'::text,
    power integer DEFAULT 0,
    recast_time integer DEFAULT 0,
    partner_count integer DEFAULT 0,
    partner_ids jsonb,
    image_url text
);


--
-- Name: inagle_teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inagle_teams (
    id text NOT NULL,
    internal_code text,
    name_fr text,
    name_en text,
    name_ja text,
    emblems jsonb,
    kits jsonb,
    members jsonb,
    sheet_data jsonb,
    created_at timestamp with time zone DEFAULT now(),
    country_code text,
    data jsonb,
    description_en text,
    description_ja text,
    description_fr text,
    emblem_url text,
    series text,
    region text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: merch_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merch_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    price numeric NOT NULL,
    image_url text,
    stock integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: newsletter_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.newsletter_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    email text NOT NULL,
    categories text[] DEFAULT '{}'::text[],
    frequency text DEFAULT 'weekly'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    unsubscribe_token uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT newsletter_subscriptions_frequency_check CHECK ((frequency = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text, 'instant'::text])))
);


--
-- Name: patreon_admin_owners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patreon_admin_owners (
    patreon_user_id text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE patreon_admin_owners; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.patreon_admin_owners IS 'Whitelist explicite des patreon_user_id qui doivent recevoir le role admin a la connexion. Le compte rosegriffonfr est aussi detecte automatiquement via patreon_url et is_creator=true.';


--
-- Name: patreon_legacy_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patreon_legacy_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patreon_member_id text NOT NULL,
    patreon_user_id text NOT NULL,
    email text,
    full_name text,
    patron_status text NOT NULL,
    last_charge_date timestamp with time zone,
    last_charge_status text,
    currently_entitled_cents bigint,
    lifetime_support_cents bigint,
    pledge_start timestamp with time zone,
    pledge_cadence integer,
    tier_titles text[],
    tier_ids text[],
    discord_user_id text,
    shipping_address jsonb,
    raw_payload jsonb NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_user_id uuid,
    resolved_at timestamp with time zone,
    resolution_method text,
    rg_subscription_status text DEFAULT 'pending'::text NOT NULL,
    rg_subscription_ref text,
    reactivated_at timestamp with time zone,
    notified_at timestamp with time zone,
    notification_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT patreon_legacy_resolution_chk CHECK (((resolution_method IS NULL) OR (resolution_method = ANY (ARRAY['email'::text, 'discord_id'::text, 'manual'::text])))),
    CONSTRAINT patreon_legacy_status_chk CHECK ((rg_subscription_status = ANY (ARRAY['pending'::text, 'reactivated'::text, 'churned'::text, 'grandfathered'::text])))
);


--
-- Name: TABLE patreon_legacy_members; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.patreon_legacy_members IS 'Snapshot des supporters Patreon historiques. resolved_user_id rempli après match email/discord/manual.';


--
-- Name: patreon_legacy_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patreon_legacy_tiers (
    patreon_tier_id text NOT NULL,
    title text NOT NULL,
    amount_cents bigint NOT NULL,
    description text,
    discord_role_ids text[],
    patron_count integer,
    published boolean,
    rg_plan_name text,
    rg_price_id text,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE patreon_legacy_tiers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.patreon_legacy_tiers IS 'Tiers Patreon snapshot + mapping vers les Stripe price IDs RG.';


--
-- Name: patreon_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patreon_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    patreon_user_id text NOT NULL,
    patreon_member_id text,
    campaign_id text,
    patreon_email text,
    patreon_full_name text,
    patreon_thumb_url text,
    patreon_url text,
    discord_user_id text,
    patron_status text,
    last_charge_date timestamp with time zone,
    last_charge_status text,
    currently_entitled_cents bigint,
    lifetime_support_cents bigint,
    pledge_start timestamp with time zone,
    pledge_cadence integer,
    will_pay_amount_cents bigint,
    tier_ids text[] DEFAULT '{}'::text[] NOT NULL,
    tier_titles text[] DEFAULT '{}'::text[] NOT NULL,
    tier_amounts_cents bigint[] DEFAULT '{}'::bigint[] NOT NULL,
    discord_role_ids text[] DEFAULT '{}'::text[] NOT NULL,
    raw_identity jsonb,
    scope text,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_free_trial boolean,
    is_gifted boolean,
    next_charge_date timestamp with time zone,
    member_email text,
    note text,
    address jsonb,
    tier_requires_shipping boolean[] DEFAULT '{}'::boolean[] NOT NULL,
    CONSTRAINT patreon_membership_status_chk CHECK (((patron_status IS NULL) OR (patron_status = ANY (ARRAY['active_patron'::text, 'declined_patron'::text, 'former_patron'::text]))))
);


--
-- Name: TABLE patreon_memberships; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.patreon_memberships IS 'Etat Patreon live par user_id. Mis a jour a chaque OAuth callback + webhooks members:*. Distinct de patreon_legacy_members (snapshot J-0).';


--
-- Name: COLUMN patreon_memberships.last_charge_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.patreon_memberships.last_charge_status IS 'Patreon last_charge_status: Paid|Declined|Deleted|Pending|Refunded|Fraud|Refunded by Patreon|Other|Partially Refunded|Free Trial|Refund Pending|Refund Declined|null';


--
-- Name: COLUMN patreon_memberships.member_email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.patreon_memberships.member_email IS 'Email du member (peut differer de patreon_email = user.email). Requires campaigns.members[email] scope.';


--
-- Name: COLUMN patreon_memberships.note; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.patreon_memberships.note IS 'Notes du creator sur ce membre (visible admin uniquement).';


--
-- Name: COLUMN patreon_memberships.address; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.patreon_memberships.address IS 'Adresse de livraison (jsonb) issue de l include=address sur /identity. Champs: line_1, line_2, city, state, country, postal_code, addressee, phone_number.';


--
-- Name: patreon_oauth_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patreon_oauth_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    patreon_user_id text NOT NULL,
    is_creator boolean DEFAULT false NOT NULL,
    access_token_enc text NOT NULL,
    refresh_token_enc text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    scope text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE patreon_oauth_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.patreon_oauth_tokens IS 'OAuth tokens Patreon chiffrés AES-256-GCM. is_creator=true pour le compte RG creator.';


--
-- Name: patreon_post_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patreon_post_events (
    patreon_post_id text NOT NULL,
    campaign_id text,
    trigger text NOT NULL,
    title text,
    content_excerpt text,
    url text,
    published_at timestamp with time zone,
    is_paid boolean,
    is_public boolean,
    embed_url text,
    embed_data jsonb,
    raw_payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE patreon_post_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.patreon_post_events IS 'Audit trail des posts Patreon (triggers posts:publish/update/delete). Sert au digest hebdo + monitoring activite createur.';


--
-- Name: patreon_post_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patreon_post_images (
    id bigint NOT NULL,
    patreon_post_id text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    original_url text NOT NULL,
    storage_path text NOT NULL,
    content_type text,
    size_bytes bigint,
    sha256 text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE patreon_post_images; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.patreon_post_images IS 'Images extraites du content HTML des posts Patreon, archivees dans le bucket Storage patreon.';


--
-- Name: patreon_post_images_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.patreon_post_images ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.patreon_post_images_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: patreon_webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patreon_webhook_events (
    id text NOT NULL,
    trigger text NOT NULL,
    payload jsonb NOT NULL,
    signature_valid boolean NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    status text DEFAULT 'pending'::text NOT NULL,
    error text,
    CONSTRAINT patreon_webhook_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'done'::text, 'failed'::text])))
);


--
-- Name: TABLE patreon_webhook_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.patreon_webhook_events IS 'Webhooks Patreon HMAC-MD5. id = X-Patreon-Event-Id pour idempotence.';


--
-- Name: patreon_webhook_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patreon_webhook_state (
    id integer DEFAULT 1 NOT NULL,
    patreon_webhook_id text,
    uri text DEFAULT 'https://rosegriffon.fr/api/auth/patreon/webhook'::text NOT NULL,
    triggers text[] DEFAULT '{}'::text[] NOT NULL,
    paused boolean DEFAULT false,
    num_consecutive_times_failed integer DEFAULT 0,
    last_attempted_at timestamp with time zone,
    last_received_at timestamp with time zone,
    last_event_id text,
    last_trigger text,
    total_received bigint DEFAULT 0 NOT NULL,
    total_failed bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT patreon_webhook_state_id_check CHECK ((id = 1))
);


--
-- Name: TABLE patreon_webhook_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.patreon_webhook_state IS 'Heartbeat + statistiques du webhook Patreon. Single-row (id=1). last_received_at update a chaque POST signe valide pour monitoring.';


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    updated_at timestamp with time zone,
    username text,
    email text,
    avatar_url text,
    role text DEFAULT 'user'::text,
    full_name text,
    website text,
    address_line1 text,
    address_line2 text,
    city text,
    postal_code text,
    country text,
    discord_id text,
    bio text,
    banner_url text,
    twitter_handle text,
    patreon_id text,
    CONSTRAINT username_length CHECK ((char_length(username) >= 3))
);


--
-- Name: TABLE profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.profiles IS 'Table to store user profile information.';


--
-- Name: COLUMN profiles.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.id IS 'Links to auth.users.id';


--
-- Name: COLUMN profiles.username; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.username IS 'Public user name';


--
-- Name: COLUMN profiles.email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.email IS 'User email for contact and notifications';


--
-- Name: COLUMN profiles.avatar_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.avatar_url IS 'URL to user avatar image in Supabase Storage';


--
-- Name: COLUMN profiles.role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.role IS 'User role: user, admin, moderator, etc.';


--
-- Name: COLUMN profiles.full_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.full_name IS 'User full name for display';


--
-- Name: rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limits (
    key text NOT NULL,
    count integer DEFAULT 1,
    last_request timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: reading_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reading_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    article_id uuid NOT NULL,
    progress smallint DEFAULT 0 NOT NULL,
    read_count integer DEFAULT 1 NOT NULL,
    last_read_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reading_history_progress_check CHECK (((progress >= 0) AND (progress <= 100)))
);


--
-- Name: session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session (
    id text NOT NULL,
    user_id text NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    ip_address text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    key text NOT NULL,
    value jsonb NOT NULL,
    description text,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: share_tracking; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.share_tracking (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    article_id uuid NOT NULL,
    user_id uuid,
    platform text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT share_tracking_platform_check CHECK ((platform = ANY (ARRAY['twitter'::text, 'facebook'::text, 'whatsapp'::text, 'linkedin'::text, 'telegram'::text, 'copy'::text, 'native'::text])))
);


--
-- Name: stream_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stream_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    day_of_week smallint NOT NULL,
    streamer_name text NOT NULL,
    start_time time without time zone,
    end_time time without time zone,
    category text,
    status text DEFAULT 'active'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id text NOT NULL,
    name text NOT NULL,
    role text NOT NULL,
    image_url text,
    display_index smallint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    member_link text,
    team_name text,
    is_active boolean DEFAULT true,
    source text,
    order_index integer DEFAULT 0,
    discord_user_id text
);


--
-- Name: tweets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tweets (
    id text NOT NULL,
    text text,
    created_at timestamp with time zone,
    author_id text,
    author_username text,
    author_name text,
    media jsonb DEFAULT '[]'::jsonb,
    quoted_tweets jsonb DEFAULT '[]'::jsonb,
    metrics jsonb DEFAULT '{}'::jsonb,
    is_thread boolean DEFAULT false,
    tweet_count integer DEFAULT 1,
    raw_tweets jsonb DEFAULT '[]'::jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."user" (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    image text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_preferences (
    user_id uuid NOT NULL,
    font_size text DEFAULT 'medium'::text NOT NULL,
    reduced_motion boolean DEFAULT false NOT NULL,
    reading_mode boolean DEFAULT false NOT NULL,
    preferred_categories text[] DEFAULT '{}'::text[],
    email_notifications boolean DEFAULT true NOT NULL,
    push_notifications boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_preferences_font_size_check CHECK ((font_size = ANY (ARRAY['small'::text, 'medium'::text, 'large'::text, 'x-large'::text])))
);


--
-- Name: user_teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    formation_id text NOT NULL,
    formation_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_public boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: verification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: wiki_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wiki_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    field_path text NOT NULL,
    value jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_coordinators id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_coordinators ALTER COLUMN id SET DEFAULT nextval('public.inagle_coordinators_id_seq'::regclass);


--
-- Name: inagle_drops id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_drops ALTER COLUMN id SET DEFAULT nextval('public.inagle_drops_id_seq'::regclass);


--
-- Name: inagle_growth_tables id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_growth_tables ALTER COLUMN id SET DEFAULT nextval('public.inagle_growth_tables_id_seq'::regclass);


--
-- Name: account account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);


--
-- Name: admin_audit_log admin_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id);


--
-- Name: article_bookmarks article_bookmarks_article_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_bookmarks
    ADD CONSTRAINT article_bookmarks_article_id_user_id_key UNIQUE (article_id, user_id);


--
-- Name: article_bookmarks article_bookmarks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_bookmarks
    ADD CONSTRAINT article_bookmarks_pkey PRIMARY KEY (id);


--
-- Name: article_categories article_categories_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_categories
    ADD CONSTRAINT article_categories_name_key UNIQUE (name);


--
-- Name: article_categories article_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_categories
    ADD CONSTRAINT article_categories_pkey PRIMARY KEY (id);


--
-- Name: article_categories article_categories_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_categories
    ADD CONSTRAINT article_categories_slug_key UNIQUE (slug);


--
-- Name: article_comments article_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_comments
    ADD CONSTRAINT article_comments_pkey PRIMARY KEY (id);


--
-- Name: article_reactions article_reactions_article_id_user_id_reaction_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_reactions
    ADD CONSTRAINT article_reactions_article_id_user_id_reaction_type_key UNIQUE (article_id, user_id, reaction_type);


--
-- Name: article_reactions article_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_reactions
    ADD CONSTRAINT article_reactions_pkey PRIMARY KEY (id);


--
-- Name: article_series article_series_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_series
    ADD CONSTRAINT article_series_pkey PRIMARY KEY (id);


--
-- Name: article_series article_series_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_series
    ADD CONSTRAINT article_series_slug_key UNIQUE (slug);


--
-- Name: articles articles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_pkey PRIMARY KEY (id);


--
-- Name: articles articles_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_slug_key UNIQUE (slug);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: chronicles chronicles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chronicles
    ADD CONSTRAINT chronicles_pkey PRIMARY KEY (id);


--
-- Name: chronicles chronicles_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chronicles
    ADD CONSTRAINT chronicles_slug_key UNIQUE (slug);


--
-- Name: comment_reports comment_reports_comment_id_reporter_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_reports
    ADD CONSTRAINT comment_reports_comment_id_reporter_id_key UNIQUE (comment_id, reporter_id);


--
-- Name: comment_reports comment_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_reports
    ADD CONSTRAINT comment_reports_pkey PRIMARY KEY (id);


--
-- Name: discord_members discord_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discord_members
    ADD CONSTRAINT discord_members_pkey PRIMARY KEY (discord_id);


--
-- Name: discord_roles discord_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discord_roles
    ADD CONSTRAINT discord_roles_pkey PRIMARY KEY (role_id);


--
-- Name: discord_sync_logs discord_sync_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discord_sync_logs
    ADD CONSTRAINT discord_sync_logs_pkey PRIMARY KEY (id);


--
-- Name: email_templates email_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_pkey PRIMARY KEY (id);


--
-- Name: email_templates email_templates_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_slug_key UNIQUE (slug);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: inagle_activity_photos inagle_activity_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_activity_photos
    ADD CONSTRAINT inagle_activity_photos_pkey PRIMARY KEY (id);


--
-- Name: inagle_auras inagle_auras_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_auras
    ADD CONSTRAINT inagle_auras_pkey PRIMARY KEY (id);


--
-- Name: inagle_awakenings inagle_awakenings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_awakenings
    ADD CONSTRAINT inagle_awakenings_pkey PRIMARY KEY (id);


--
-- Name: inagle_basara inagle_basara_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_basara
    ADD CONSTRAINT inagle_basara_pkey PRIMARY KEY (character_id);


--
-- Name: inagle_capsules inagle_capsules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_capsules
    ADD CONSTRAINT inagle_capsules_pkey PRIMARY KEY (id);


--
-- Name: inagle_chara_menu_resource inagle_chara_menu_resource_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_chara_menu_resource
    ADD CONSTRAINT inagle_chara_menu_resource_pkey PRIMARY KEY (id);


--
-- Name: inagle_characters inagle_characters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_characters
    ADD CONSTRAINT inagle_characters_pkey PRIMARY KEY (id);


--
-- Name: inagle_chat_emotes inagle_chat_emotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_chat_emotes
    ADD CONSTRAINT inagle_chat_emotes_pkey PRIMARY KEY (id);


--
-- Name: inagle_coordinators inagle_coordinators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_coordinators
    ADD CONSTRAINT inagle_coordinators_pkey PRIMARY KEY (id);


--
-- Name: inagle_costumes inagle_costumes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_costumes
    ADD CONSTRAINT inagle_costumes_pkey PRIMARY KEY (id);


--
-- Name: inagle_custom_passives inagle_custom_passives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_custom_passives
    ADD CONSTRAINT inagle_custom_passives_pkey PRIMARY KEY (id);


--
-- Name: inagle_drops_battles inagle_drops_battles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_drops_battles
    ADD CONSTRAINT inagle_drops_battles_pkey PRIMARY KEY (battle_group_id);


--
-- Name: inagle_drops inagle_drops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_drops
    ADD CONSTRAINT inagle_drops_pkey PRIMARY KEY (id);


--
-- Name: inagle_drops_tables inagle_drops_tables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_drops_tables
    ADD CONSTRAINT inagle_drops_tables_pkey PRIMARY KEY (table_id);


--
-- Name: inagle_drops_treasures inagle_drops_treasures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_drops_treasures
    ADD CONSTRAINT inagle_drops_treasures_pkey PRIMARY KEY (id);


--
-- Name: inagle_exp_table inagle_exp_table_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_exp_table
    ADD CONSTRAINT inagle_exp_table_pkey PRIMARY KEY (level);


--
-- Name: inagle_formations inagle_formations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_formations
    ADD CONSTRAINT inagle_formations_pkey PRIMARY KEY (id);


--
-- Name: inagle_gallery inagle_gallery_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_gallery
    ADD CONSTRAINT inagle_gallery_pkey PRIMARY KEY (id);


--
-- Name: inagle_growth_tables inagle_growth_tables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_growth_tables
    ADD CONSTRAINT inagle_growth_tables_pkey PRIMARY KEY (id);


--
-- Name: inagle_heroes inagle_heroes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_heroes
    ADD CONSTRAINT inagle_heroes_pkey PRIMARY KEY (character_id, playstyle);


--
-- Name: inagle_icon_inventory inagle_icon_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_icon_inventory
    ADD CONSTRAINT inagle_icon_inventory_pkey PRIMARY KEY (id);


--
-- Name: inagle_img_inventory inagle_img_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_img_inventory
    ADD CONSTRAINT inagle_img_inventory_pkey PRIMARY KEY (id);


--
-- Name: inagle_items inagle_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_items
    ADD CONSTRAINT inagle_items_pkey PRIMARY KEY (id);


--
-- Name: inagle_keshins inagle_keshins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_keshins
    ADD CONSTRAINT inagle_keshins_pkey PRIMARY KEY (id);


--
-- Name: inagle_kizuna_items inagle_kizuna_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_kizuna_items
    ADD CONSTRAINT inagle_kizuna_items_pkey PRIMARY KEY (name);


--
-- Name: inagle_manager_passives inagle_manager_passives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_manager_passives
    ADD CONSTRAINT inagle_manager_passives_pkey PRIMARY KEY (id);


--
-- Name: inagle_media_assets inagle_media_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_media_assets
    ADD CONSTRAINT inagle_media_assets_pkey PRIMARY KEY (id);


--
-- Name: inagle_miximax inagle_miximax_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_miximax
    ADD CONSTRAINT inagle_miximax_pkey PRIMARY KEY (id);


--
-- Name: inagle_mode_changes inagle_mode_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_mode_changes
    ADD CONSTRAINT inagle_mode_changes_pkey PRIMARY KEY (id);


--
-- Name: inagle_nameplates inagle_nameplates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_nameplates
    ADD CONSTRAINT inagle_nameplates_pkey PRIMARY KEY (id);


--
-- Name: inagle_opponent_teams inagle_opponent_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_opponent_teams
    ADD CONSTRAINT inagle_opponent_teams_pkey PRIMARY KEY (id);


--
-- Name: inagle_override_skills inagle_override_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_override_skills
    ADD CONSTRAINT inagle_override_skills_pkey PRIMARY KEY (id);


--
-- Name: inagle_passive_generation inagle_passive_generation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_passive_generation
    ADD CONSTRAINT inagle_passive_generation_pkey PRIMARY KEY (passive_id, no);


--
-- Name: inagle_passive_scaling inagle_passive_scaling_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_passive_scaling
    ADD CONSTRAINT inagle_passive_scaling_pkey PRIMARY KEY (id);


--
-- Name: inagle_passives inagle_passives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_passives
    ADD CONSTRAINT inagle_passives_pkey PRIMARY KEY (id);


--
-- Name: inagle_performances inagle_performances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_performances
    ADD CONSTRAINT inagle_performances_pkey PRIMARY KEY (id);


--
-- Name: inagle_phase_titles inagle_phase_titles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_phase_titles
    ADD CONSTRAINT inagle_phase_titles_pkey PRIMARY KEY (id);


--
-- Name: inagle_quests inagle_quests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_quests
    ADD CONSTRAINT inagle_quests_pkey PRIMARY KEY (id);


--
-- Name: inagle_scene_archives inagle_scene_archives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_scene_archives
    ADD CONSTRAINT inagle_scene_archives_pkey PRIMARY KEY (id);


--
-- Name: inagle_skills inagle_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_skills
    ADD CONSTRAINT inagle_skills_pkey PRIMARY KEY (id);


--
-- Name: inagle_souls inagle_souls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_souls
    ADD CONSTRAINT inagle_souls_pkey PRIMARY KEY (id);


--
-- Name: inagle_stadiums inagle_stadiums_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_stadiums
    ADD CONSTRAINT inagle_stadiums_pkey PRIMARY KEY (id);


--
-- Name: inagle_tactics inagle_tactics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_tactics
    ADD CONSTRAINT inagle_tactics_pkey PRIMARY KEY (name);


--
-- Name: inagle_teams inagle_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_teams
    ADD CONSTRAINT inagle_teams_pkey PRIMARY KEY (id);


--
-- Name: merch_products merch_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merch_products
    ADD CONSTRAINT merch_products_pkey PRIMARY KEY (id);


--
-- Name: newsletter_subscriptions newsletter_subscriptions_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_subscriptions
    ADD CONSTRAINT newsletter_subscriptions_email_key UNIQUE (email);


--
-- Name: newsletter_subscriptions newsletter_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_subscriptions
    ADD CONSTRAINT newsletter_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: patch_notes patch_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patch_notes
    ADD CONSTRAINT patch_notes_pkey PRIMARY KEY (id);


--
-- Name: patreon_admin_owners patreon_admin_owners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patreon_admin_owners
    ADD CONSTRAINT patreon_admin_owners_pkey PRIMARY KEY (patreon_user_id);


--
-- Name: patreon_legacy_members patreon_legacy_members_patreon_member_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patreon_legacy_members
    ADD CONSTRAINT patreon_legacy_members_patreon_member_id_key UNIQUE (patreon_member_id);


--
-- Name: patreon_legacy_members patreon_legacy_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patreon_legacy_members
    ADD CONSTRAINT patreon_legacy_members_pkey PRIMARY KEY (id);


--
-- Name: patreon_legacy_tiers patreon_legacy_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patreon_legacy_tiers
    ADD CONSTRAINT patreon_legacy_tiers_pkey PRIMARY KEY (patreon_tier_id);


--
-- Name: patreon_memberships patreon_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patreon_memberships
    ADD CONSTRAINT patreon_memberships_pkey PRIMARY KEY (id);


--
-- Name: patreon_memberships patreon_memberships_user_id_patreon_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patreon_memberships
    ADD CONSTRAINT patreon_memberships_user_id_patreon_user_id_key UNIQUE (user_id, patreon_user_id);


--
-- Name: patreon_oauth_tokens patreon_oauth_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patreon_oauth_tokens
    ADD CONSTRAINT patreon_oauth_tokens_pkey PRIMARY KEY (id);


--
-- Name: patreon_oauth_tokens patreon_oauth_tokens_user_id_patreon_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patreon_oauth_tokens
    ADD CONSTRAINT patreon_oauth_tokens_user_id_patreon_user_id_key UNIQUE (user_id, patreon_user_id);


--
-- Name: patreon_post_events patreon_post_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patreon_post_events
    ADD CONSTRAINT patreon_post_events_pkey PRIMARY KEY (patreon_post_id);


--
-- Name: patreon_post_images patreon_post_images_patreon_post_id_sha256_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patreon_post_images
    ADD CONSTRAINT patreon_post_images_patreon_post_id_sha256_key UNIQUE (patreon_post_id, sha256);


--
-- Name: patreon_post_images patreon_post_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patreon_post_images
    ADD CONSTRAINT patreon_post_images_pkey PRIMARY KEY (id);


--
-- Name: patreon_webhook_events patreon_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patreon_webhook_events
    ADD CONSTRAINT patreon_webhook_events_pkey PRIMARY KEY (id);


--
-- Name: patreon_webhook_state patreon_webhook_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patreon_webhook_state
    ADD CONSTRAINT patreon_webhook_state_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_discord_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_discord_id_key UNIQUE (discord_id);


--
-- Name: profiles profiles_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_email_key UNIQUE (email);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_username_key UNIQUE (username);


--
-- Name: rate_limits rate_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limits
    ADD CONSTRAINT rate_limits_pkey PRIMARY KEY (key);


--
-- Name: reading_history reading_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reading_history
    ADD CONSTRAINT reading_history_pkey PRIMARY KEY (id);


--
-- Name: reading_history reading_history_user_id_article_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reading_history
    ADD CONSTRAINT reading_history_user_id_article_id_key UNIQUE (user_id, article_id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);


--
-- Name: session session_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_token_key UNIQUE (token);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);


--
-- Name: share_tracking share_tracking_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.share_tracking
    ADD CONSTRAINT share_tracking_pkey PRIMARY KEY (id);


--
-- Name: stream_schedules stream_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stream_schedules
    ADD CONSTRAINT stream_schedules_pkey PRIMARY KEY (id);


--
-- Name: team_members team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_pkey PRIMARY KEY (id);


--
-- Name: topics topics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topics
    ADD CONSTRAINT topics_pkey PRIMARY KEY (id);


--
-- Name: tweets tweets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tweets
    ADD CONSTRAINT tweets_pkey PRIMARY KEY (id);


--
-- Name: article_reactions unique_user_article_reaction; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_reactions
    ADD CONSTRAINT unique_user_article_reaction UNIQUE (article_id, user_id, reaction_type);


--
-- Name: user user_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_email_key UNIQUE (email);


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);


--
-- Name: user_preferences user_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: user_teams user_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_teams
    ADD CONSTRAINT user_teams_pkey PRIMARY KEY (id);


--
-- Name: verification verification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);


--
-- Name: wiki_overrides wiki_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_overrides
    ADD CONSTRAINT wiki_overrides_pkey PRIMARY KEY (id);


--
-- Name: admin_audit_log_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_audit_log_user_id_idx ON public.admin_audit_log USING btree (user_id);


--
-- Name: article_series_author_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX article_series_author_id_idx ON public.article_series USING btree (author_id);


--
-- Name: chronicles_author_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chronicles_author_id_idx ON public.chronicles USING btree (author_id);


--
-- Name: comment_reports_reporter_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comment_reports_reporter_id_idx ON public.comment_reports USING btree (reporter_id);


--
-- Name: comment_reports_reviewed_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comment_reports_reviewed_by_idx ON public.comment_reports USING btree (reviewed_by);


--
-- Name: idx_account_provider_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_provider_account ON public.account USING btree (provider_id, account_id);


--
-- Name: idx_account_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_user ON public.account USING btree (user_id);


--
-- Name: idx_articles_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_articles_app ON public.articles USING btree (app);


--
-- Name: idx_articles_series; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_articles_series ON public.articles USING btree (series_id, series_order);


--
-- Name: idx_articles_status_published; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_articles_status_published ON public.articles USING btree (status, published_at DESC NULLS LAST);


--
-- Name: idx_audit_log_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_created ON public.admin_audit_log USING btree (created_at DESC);


--
-- Name: idx_audit_log_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_entity ON public.admin_audit_log USING btree (entity_type, entity_id);


--
-- Name: idx_characters_element; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_element ON public.inagle_characters USING btree (element);


--
-- Name: idx_characters_gender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_gender ON public.inagle_characters USING btree (gender);


--
-- Name: idx_characters_is_controllable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_is_controllable ON public.inagle_characters USING btree (is_controllable);


--
-- Name: idx_characters_playstyle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_playstyle ON public.inagle_characters USING btree (((sheet_data ->> 'playstyle'::text)));


--
-- Name: idx_characters_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_position ON public.inagle_characters USING btree ("position");


--
-- Name: idx_characters_rarity_label; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_rarity_label ON public.inagle_characters USING btree (rarity_label);


--
-- Name: idx_characters_series; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_series ON public.inagle_characters USING btree (series);


--
-- Name: idx_characters_zukan_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_zukan_order ON public.inagle_characters USING btree (zukan_order);


--
-- Name: idx_comment_reports_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comment_reports_status ON public.comment_reports USING btree (status) WHERE (status = 'pending'::text);


--
-- Name: idx_comments_article; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comments_article ON public.article_comments USING btree (article_id, created_at DESC);


--
-- Name: idx_comments_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comments_parent ON public.article_comments USING btree (parent_id);


--
-- Name: idx_comments_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comments_user ON public.article_comments USING btree (user_id);


--
-- Name: idx_coordinators_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coordinators_role ON public.inagle_coordinators USING btree (role);


--
-- Name: idx_discord_members_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_discord_members_username ON public.discord_members USING btree (username);


--
-- Name: idx_events_start_end; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_start_end ON public.events USING btree (end_time, start_time);


--
-- Name: idx_growth_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_growth_position ON public.inagle_growth_tables USING btree (main_position, sub_position);


--
-- Name: idx_growth_section; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_growth_section ON public.inagle_growth_tables USING btree (section);


--
-- Name: idx_icon_inventory_folder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_icon_inventory_folder ON public.inagle_icon_inventory USING btree (folder);


--
-- Name: idx_img_inventory_folder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_img_inventory_folder ON public.inagle_img_inventory USING btree (folder);


--
-- Name: idx_inagle_characters_internal_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inagle_characters_internal_code ON public.inagle_characters USING btree (internal_code);


--
-- Name: idx_newsletter_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_newsletter_active ON public.newsletter_subscriptions USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_patreon_legacy_discord; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patreon_legacy_discord ON public.patreon_legacy_members USING btree (discord_user_id) WHERE (discord_user_id IS NOT NULL);


--
-- Name: idx_patreon_legacy_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patreon_legacy_email ON public.patreon_legacy_members USING btree (email) WHERE (email IS NOT NULL);


--
-- Name: idx_patreon_legacy_resolved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patreon_legacy_resolved ON public.patreon_legacy_members USING btree (resolved_user_id) WHERE (resolved_user_id IS NOT NULL);


--
-- Name: idx_patreon_legacy_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patreon_legacy_status ON public.patreon_legacy_members USING btree (rg_subscription_status);


--
-- Name: idx_patreon_memberships_discord; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patreon_memberships_discord ON public.patreon_memberships USING btree (discord_user_id) WHERE (discord_user_id IS NOT NULL);


--
-- Name: idx_patreon_memberships_free_trial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patreon_memberships_free_trial ON public.patreon_memberships USING btree (is_free_trial) WHERE (is_free_trial = true);


--
-- Name: idx_patreon_memberships_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patreon_memberships_member ON public.patreon_memberships USING btree (patreon_member_id) WHERE (patreon_member_id IS NOT NULL);


--
-- Name: idx_patreon_memberships_next_charge; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patreon_memberships_next_charge ON public.patreon_memberships USING btree (next_charge_date) WHERE (next_charge_date IS NOT NULL);


--
-- Name: idx_patreon_memberships_patreon_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patreon_memberships_patreon_user ON public.patreon_memberships USING btree (patreon_user_id);


--
-- Name: idx_patreon_memberships_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patreon_memberships_status ON public.patreon_memberships USING btree (patron_status) WHERE (patron_status = 'active_patron'::text);


--
-- Name: idx_patreon_memberships_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patreon_memberships_user ON public.patreon_memberships USING btree (user_id);


--
-- Name: idx_patreon_post_events_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patreon_post_events_campaign ON public.patreon_post_events USING btree (campaign_id);


--
-- Name: idx_patreon_post_events_published; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patreon_post_events_published ON public.patreon_post_events USING btree (published_at DESC NULLS LAST);


--
-- Name: idx_patreon_post_images_post; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patreon_post_images_post ON public.patreon_post_images USING btree (patreon_post_id, "position");


--
-- Name: idx_patreon_tokens_creator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patreon_tokens_creator ON public.patreon_oauth_tokens USING btree (is_creator) WHERE (is_creator = true);


--
-- Name: idx_patreon_tokens_patreon_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patreon_tokens_patreon_user ON public.patreon_oauth_tokens USING btree (patreon_user_id);


--
-- Name: idx_patreon_tokens_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patreon_tokens_user ON public.patreon_oauth_tokens USING btree (user_id);


--
-- Name: idx_patreon_webhook_received; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patreon_webhook_received ON public.patreon_webhook_events USING btree (received_at DESC);


--
-- Name: idx_patreon_webhook_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patreon_webhook_status ON public.patreon_webhook_events USING btree (status) WHERE (status <> 'done'::text);


--
-- Name: idx_profiles_discord_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_discord_id ON public.profiles USING btree (discord_id);


--
-- Name: idx_profiles_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_role ON public.profiles USING btree (role);


--
-- Name: idx_reading_history_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reading_history_user ON public.reading_history USING btree (user_id, last_read_at DESC);


--
-- Name: idx_series_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_series_slug ON public.article_series USING btree (slug);


--
-- Name: idx_session_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_token ON public.session USING btree (token);


--
-- Name: idx_session_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_user ON public.session USING btree (user_id);


--
-- Name: idx_share_tracking_article; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_share_tracking_article ON public.share_tracking USING btree (article_id);


--
-- Name: idx_team_members_team_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_members_team_id ON public.team_members USING btree (team_id);


--
-- Name: idx_verification_identifier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_verification_identifier ON public.verification USING btree (identifier);


--
-- Name: inagle_growth_tables_unique_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inagle_growth_tables_unique_key ON public.inagle_growth_tables USING btree (section, main_position, sub_position, play_style, growth_pattern, chara_rank) NULLS NOT DISTINCT;


--
-- Name: newsletter_subscriptions_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX newsletter_subscriptions_user_id_idx ON public.newsletter_subscriptions USING btree (user_id);


--
-- Name: reading_history_article_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reading_history_article_id_idx ON public.reading_history USING btree (article_id);


--
-- Name: share_tracking_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX share_tracking_user_id_idx ON public.share_tracking USING btree (user_id);


--
-- Name: user_teams_is_public_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_teams_is_public_idx ON public.user_teams USING btree (is_public);


--
-- Name: user_teams_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_teams_user_id_idx ON public.user_teams USING btree (user_id);


--
-- Name: article_comments comments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER comments_updated_at BEFORE UPDATE ON public.article_comments FOR EACH ROW EXECUTE FUNCTION public.update_comment_updated_at();


--
-- Name: patreon_legacy_tiers trg_patreon_legacy_tiers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_patreon_legacy_tiers_updated_at BEFORE UPDATE ON public.patreon_legacy_tiers FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();


--
-- Name: patreon_memberships trg_patreon_memberships_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_patreon_memberships_updated_at BEFORE UPDATE ON public.patreon_memberships FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();


--
-- Name: patreon_oauth_tokens trg_patreon_oauth_tokens_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_patreon_oauth_tokens_updated_at BEFORE UPDATE ON public.patreon_oauth_tokens FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();


--
-- Name: patreon_post_events trg_patreon_post_events_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_patreon_post_events_updated_at BEFORE UPDATE ON public.patreon_post_events FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();


--
-- Name: patreon_webhook_state trg_patreon_webhook_state_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_patreon_webhook_state_updated_at BEFORE UPDATE ON public.patreon_webhook_state FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();


--
-- Name: patreon_memberships trg_promote_rg_creator_admin; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_promote_rg_creator_admin AFTER INSERT OR UPDATE OF patreon_user_id, patreon_url, user_id ON public.patreon_memberships FOR EACH ROW EXECUTE FUNCTION public.promote_rg_creator_to_admin();


--
-- Name: article_comments trigger_notify_article_comment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_notify_article_comment AFTER INSERT ON public.article_comments FOR EACH ROW EXECUTE FUNCTION public.notify_article_comment();


--
-- Name: team_members update_team_members_updated_at_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_team_members_updated_at_trigger BEFORE UPDATE ON public.team_members FOR EACH ROW EXECUTE FUNCTION public.update_team_members_updated_at();


--
-- Name: account account_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: admin_audit_log admin_audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: article_comments article_comments_article_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_comments
    ADD CONSTRAINT article_comments_article_id_fkey FOREIGN KEY (article_id) REFERENCES public.articles(id) ON DELETE CASCADE;


--
-- Name: article_comments article_comments_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_comments
    ADD CONSTRAINT article_comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.article_comments(id) ON DELETE CASCADE;


--
-- Name: article_comments article_comments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_comments
    ADD CONSTRAINT article_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: article_series article_series_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_series
    ADD CONSTRAINT article_series_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: articles articles_series_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_series_id_fkey FOREIGN KEY (series_id) REFERENCES public.article_series(id) ON DELETE SET NULL;


--
-- Name: chronicles chronicles_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chronicles
    ADD CONSTRAINT chronicles_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: comment_reports comment_reports_comment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_reports
    ADD CONSTRAINT comment_reports_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.article_comments(id) ON DELETE CASCADE;


--
-- Name: comment_reports comment_reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_reports
    ADD CONSTRAINT comment_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: comment_reports comment_reports_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_reports
    ADD CONSTRAINT comment_reports_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: newsletter_subscriptions newsletter_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_subscriptions
    ADD CONSTRAINT newsletter_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: patreon_legacy_members patreon_legacy_members_resolved_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patreon_legacy_members
    ADD CONSTRAINT patreon_legacy_members_resolved_user_id_fkey FOREIGN KEY (resolved_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: patreon_memberships patreon_memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patreon_memberships
    ADD CONSTRAINT patreon_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: patreon_oauth_tokens patreon_oauth_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patreon_oauth_tokens
    ADD CONSTRAINT patreon_oauth_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: patreon_post_images patreon_post_images_patreon_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patreon_post_images
    ADD CONSTRAINT patreon_post_images_patreon_post_id_fkey FOREIGN KEY (patreon_post_id) REFERENCES public.patreon_post_events(patreon_post_id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: reading_history reading_history_article_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reading_history
    ADD CONSTRAINT reading_history_article_id_fkey FOREIGN KEY (article_id) REFERENCES public.articles(id) ON DELETE CASCADE;


--
-- Name: reading_history reading_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reading_history
    ADD CONSTRAINT reading_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: session session_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: share_tracking share_tracking_article_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.share_tracking
    ADD CONSTRAINT share_tracking_article_id_fkey FOREIGN KEY (article_id) REFERENCES public.articles(id) ON DELETE CASCADE;


--
-- Name: share_tracking share_tracking_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.share_tracking
    ADD CONSTRAINT share_tracking_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: user_preferences user_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_teams user_teams_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_teams
    ADD CONSTRAINT user_teams_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: team_members Active team members viewable by everyone; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Active team members viewable by everyone" ON public.team_members FOR SELECT USING ((is_active = true));


--
-- Name: inagle_awakenings Admin Write Awakenings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin Write Awakenings" ON public.inagle_awakenings TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--
-- Name: inagle_formations Admin Write Formations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin Write Formations" ON public.inagle_formations TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--
-- Name: inagle_keshins Admin Write Keshins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin Write Keshins" ON public.inagle_keshins TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--
-- Name: inagle_miximax Admin Write Miximax; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin Write Miximax" ON public.inagle_miximax TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--
-- Name: inagle_mode_changes Admin Write ModeChanges; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin Write ModeChanges" ON public.inagle_mode_changes TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--
-- Name: inagle_passives Admin Write Passives; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin Write Passives" ON public.inagle_passives TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--
-- Name: inagle_quests Admin Write Quests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin Write Quests" ON public.inagle_quests TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--
-- Name: inagle_souls Admin Write Souls; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin Write Souls" ON public.inagle_souls TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--
-- Name: inagle_awakenings Admin manage inagle_awakenings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin manage inagle_awakenings" ON public.inagle_awakenings TO authenticated USING (public.is_admin());


--
-- Name: inagle_formations Admin manage inagle_formations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin manage inagle_formations" ON public.inagle_formations TO authenticated USING (public.is_admin());


--
-- Name: inagle_keshins Admin manage inagle_keshins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin manage inagle_keshins" ON public.inagle_keshins TO authenticated USING (public.is_admin());


--
-- Name: inagle_miximax Admin manage inagle_miximax; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin manage inagle_miximax" ON public.inagle_miximax TO authenticated USING (public.is_admin());


--
-- Name: inagle_mode_changes Admin manage inagle_mode_changes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin manage inagle_mode_changes" ON public.inagle_mode_changes TO authenticated USING (public.is_admin());


--
-- Name: inagle_souls Admin manage inagle_souls; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin manage inagle_souls" ON public.inagle_souls TO authenticated USING (public.is_admin());


--
-- Name: user_teams Admin manage user_teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin manage user_teams" ON public.user_teams TO authenticated USING (public.is_admin());


--
-- Name: team_members Admins can manage team members.; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage team members." ON public.team_members TO authenticated USING (public.is_admin());


--
-- Name: audit_logs Admins read audit; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins read audit" ON public.audit_logs FOR SELECT TO authenticated USING (public.is_admin());


--
-- Name: chronicles Chronicles admin all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Chronicles admin all" ON public.chronicles TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--
-- Name: chronicles Chronicles public read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Chronicles public read" ON public.chronicles FOR SELECT USING ((published = true));


--
-- Name: article_comments Création de commentaire par l'auteur; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Création de commentaire par l'auteur" ON public.article_comments FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: reading_history Création de son propre historique; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Création de son propre historique" ON public.reading_history FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: discord_sync_logs Discord sync logs admin read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Discord sync logs admin read" ON public.discord_sync_logs FOR SELECT USING ((auth.uid() IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.role = 'admin'::text))));


--
-- Name: email_templates Email templates admin all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Email templates admin all" ON public.email_templates USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--
-- Name: events Events admin all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Events admin all" ON public.events USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--
-- Name: events Events public read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Events public read" ON public.events FOR SELECT USING (true);


--
-- Name: article_series Gestion des séries par les admins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gestion des séries par les admins" ON public.article_series TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: reading_history Lecture de son propre historique; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Lecture de son propre historique" ON public.reading_history FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: article_comments Lecture publique des commentaires; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Lecture publique des commentaires" ON public.article_comments FOR SELECT USING (true);


--
-- Name: article_series Lecture publique des séries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Lecture publique des séries" ON public.article_series FOR SELECT USING (true);


--
-- Name: articles Les admins ont accès total aux chroniques; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Les admins ont accès total aux chroniques" ON public.articles TO authenticated USING (public.is_admin());


--
-- Name: reading_history Mise à jour de son propre historique; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Mise à jour de son propre historique" ON public.reading_history FOR UPDATE TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: article_comments Modification de commentaire par l'auteur; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Modification de commentaire par l'auteur" ON public.article_comments FOR UPDATE TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: inagle_characters Public Read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public Read" ON public.inagle_characters FOR SELECT USING (true);


--
-- Name: inagle_items Public Read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public Read" ON public.inagle_items FOR SELECT USING (true);


--
-- Name: inagle_override_skills Public Read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public Read" ON public.inagle_override_skills FOR SELECT USING (true);


--
-- Name: inagle_skills Public Read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public Read" ON public.inagle_skills FOR SELECT USING (true);


--
-- Name: inagle_teams Public Read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public Read" ON public.inagle_teams FOR SELECT USING (true);


--
-- Name: inagle_awakenings Public Read Awakenings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public Read Awakenings" ON public.inagle_awakenings FOR SELECT USING (true);


--
-- Name: inagle_formations Public Read Formations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public Read Formations" ON public.inagle_formations FOR SELECT USING (true);


--
-- Name: inagle_keshins Public Read Keshins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public Read Keshins" ON public.inagle_keshins FOR SELECT USING (true);


--
-- Name: merch_products Public Read Merch; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public Read Merch" ON public.merch_products FOR SELECT USING (true);


--
-- Name: inagle_miximax Public Read Miximax; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public Read Miximax" ON public.inagle_miximax FOR SELECT USING (true);


--
-- Name: inagle_mode_changes Public Read ModeChanges; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public Read ModeChanges" ON public.inagle_mode_changes FOR SELECT USING (true);


--
-- Name: inagle_passives Public Read Passives; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public Read Passives" ON public.inagle_passives FOR SELECT USING (true);


--
-- Name: inagle_quests Public Read Quests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public Read Quests" ON public.inagle_quests FOR SELECT USING (true);


--
-- Name: inagle_souls Public Read Souls; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public Read Souls" ON public.inagle_souls FOR SELECT USING (true);


--
-- Name: discord_members Public Read discord_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public Read discord_members" ON public.discord_members FOR SELECT USING (true);


--
-- Name: discord_roles Public Read discord_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public Read discord_roles" ON public.discord_roles FOR SELECT USING (true);


--
-- Name: tweets Public Read tweets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public Read tweets" ON public.tweets FOR SELECT USING (true);


--
-- Name: profiles Public profiles are viewable by everyone.; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public profiles are viewable by everyone." ON public.profiles FOR SELECT USING (true);


--
-- Name: inagle_exp_table Public read exp_table; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public read exp_table" ON public.inagle_exp_table FOR SELECT USING (true);


--
-- Name: inagle_growth_tables Public read growth_tables; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public read growth_tables" ON public.inagle_growth_tables FOR SELECT USING (true);


--
-- Name: article_reactions Public read reactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public read reactions" ON public.article_reactions FOR SELECT USING (true);


--
-- Name: rate_limits Rate limits service role; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Rate limits service role" ON public.rate_limits TO service_role USING (true) WITH CHECK (true);


--
-- Name: settings Settings admin update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Settings admin update" ON public.settings FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--
-- Name: settings Settings public read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Settings public read" ON public.settings FOR SELECT USING (true);


--
-- Name: stream_schedules Stream schedules admin manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Stream schedules admin manage" ON public.stream_schedules TO authenticated USING ((( SELECT profiles.role
   FROM public.profiles
  WHERE (profiles.id = auth.uid())) = 'admin'::text)) WITH CHECK ((( SELECT profiles.role
   FROM public.profiles
  WHERE (profiles.id = auth.uid())) = 'admin'::text));


--
-- Name: stream_schedules Stream schedules public read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Stream schedules public read" ON public.stream_schedules FOR SELECT USING (true);


--
-- Name: article_comments Suppression de commentaire par l'auteur ou un admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Suppression de commentaire par l'auteur ou un admin" ON public.article_comments FOR DELETE TO authenticated USING (((auth.uid() = user_id) OR public.is_admin()));


--
-- Name: reading_history Suppression de son propre historique; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Suppression de son propre historique" ON public.reading_history FOR DELETE TO authenticated USING ((auth.uid() = user_id));


--
-- Name: user_teams Users can delete their own teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own teams" ON public.user_teams FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: user_teams Users can insert their own teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own teams" ON public.user_teams FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: profiles Users can update their own profile.; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own profile." ON public.profiles FOR UPDATE USING ((auth.uid() = id));


--
-- Name: user_teams Users can update their own teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own teams" ON public.user_teams FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: user_teams Users can view public teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view public teams" ON public.user_teams FOR SELECT USING ((is_public = true));


--
-- Name: user_teams Users can view their own teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own teams" ON public.user_teams FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: article_bookmarks Users manage own bookmarks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own bookmarks" ON public.article_bookmarks TO authenticated USING ((user_id = auth.uid()));


--
-- Name: article_reactions Users manage own reactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own reactions" ON public.article_reactions TO authenticated USING ((user_id = auth.uid()));


--
-- Name: account; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account ENABLE ROW LEVEL SECURITY;

--
-- Name: account account_service_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY account_service_only ON public.account USING (false);


--
-- Name: admin_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_activity_photos anon_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_read ON public.inagle_activity_photos FOR SELECT TO anon USING (true);


--
-- Name: inagle_chara_menu_resource anon_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_read ON public.inagle_chara_menu_resource FOR SELECT TO anon USING (true);


--
-- Name: inagle_chat_emotes anon_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_read ON public.inagle_chat_emotes FOR SELECT TO anon USING (true);


--
-- Name: inagle_icon_inventory anon_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_read ON public.inagle_icon_inventory FOR SELECT TO anon USING (true);


--
-- Name: inagle_img_inventory anon_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_read ON public.inagle_img_inventory FOR SELECT TO anon USING (true);


--
-- Name: inagle_nameplates anon_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_read ON public.inagle_nameplates FOR SELECT TO anon USING (true);


--
-- Name: inagle_performances anon_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_read ON public.inagle_performances FOR SELECT TO anon USING (true);


--
-- Name: inagle_phase_titles anon_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_read ON public.inagle_phase_titles FOR SELECT TO anon USING (true);


--
-- Name: inagle_scene_archives anon_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_read ON public.inagle_scene_archives FOR SELECT TO anon USING (true);


--
-- Name: inagle_stadiums anon_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_read ON public.inagle_stadiums FOR SELECT TO anon USING (true);


--
-- Name: article_bookmarks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.article_bookmarks ENABLE ROW LEVEL SECURITY;

--
-- Name: article_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.article_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: article_categories article_categories_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY article_categories_public_read ON public.article_categories FOR SELECT USING (true);


--
-- Name: article_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.article_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: article_reactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.article_reactions ENABLE ROW LEVEL SECURITY;

--
-- Name: article_series; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.article_series ENABLE ROW LEVEL SECURITY;

--
-- Name: articles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;

--
-- Name: articles articles_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY articles_admin_all ON public.articles USING (public.is_admin());


--
-- Name: articles articles_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY articles_public_read ON public.articles FOR SELECT USING (((status)::text = 'published'::text));


--
-- Name: admin_audit_log audit_log_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_log_insert_authenticated ON public.admin_audit_log FOR INSERT TO authenticated WITH CHECK (public.is_admin());


--
-- Name: admin_audit_log audit_log_select_admins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_log_select_admins ON public.admin_audit_log FOR SELECT TO authenticated USING (public.is_admin());


--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: chronicles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chronicles ENABLE ROW LEVEL SECURITY;

--
-- Name: comment_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.comment_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: comment_reports comment_reports_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comment_reports_insert_authenticated ON public.comment_reports FOR INSERT TO authenticated WITH CHECK ((reporter_id = auth.uid()));


--
-- Name: comment_reports comment_reports_select_admins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comment_reports_select_admins ON public.comment_reports FOR SELECT TO authenticated USING (public.is_admin());


--
-- Name: comment_reports comment_reports_update_admins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comment_reports_update_admins ON public.comment_reports FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: discord_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.discord_members ENABLE ROW LEVEL SECURITY;

--
-- Name: discord_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.discord_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: discord_sync_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.discord_sync_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: email_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_activity_photos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_activity_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_auras; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_auras ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_awakenings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_awakenings ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_basara; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_basara ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_basara inagle_basara_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inagle_basara_public_read ON public.inagle_basara FOR SELECT USING (true);


--
-- Name: inagle_capsules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_capsules ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_capsules inagle_capsules_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inagle_capsules_public_read ON public.inagle_capsules FOR SELECT USING (true);


--
-- Name: inagle_chara_menu_resource; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_chara_menu_resource ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_characters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_characters ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_chat_emotes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_chat_emotes ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_coordinators; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_coordinators ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_coordinators inagle_coordinators_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inagle_coordinators_public_read ON public.inagle_coordinators FOR SELECT USING (true);


--
-- Name: inagle_costumes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_costumes ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_costumes inagle_costumes_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inagle_costumes_public_read ON public.inagle_costumes FOR SELECT USING (true);


--
-- Name: inagle_custom_passives; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_custom_passives ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_custom_passives inagle_custom_passives_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inagle_custom_passives_public_read ON public.inagle_custom_passives FOR SELECT USING (true);


--
-- Name: inagle_drops; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_drops ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_drops_battles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_drops_battles ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_drops_battles inagle_drops_battles_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inagle_drops_battles_public_read ON public.inagle_drops_battles FOR SELECT USING (true);


--
-- Name: inagle_drops inagle_drops_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inagle_drops_public_read ON public.inagle_drops FOR SELECT USING (true);


--
-- Name: inagle_drops_tables; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_drops_tables ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_drops_tables inagle_drops_tables_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inagle_drops_tables_public_read ON public.inagle_drops_tables FOR SELECT USING (true);


--
-- Name: inagle_drops_treasures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_drops_treasures ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_drops_treasures inagle_drops_treasures_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inagle_drops_treasures_public_read ON public.inagle_drops_treasures FOR SELECT USING (true);


--
-- Name: inagle_exp_table; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_exp_table ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_formations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_formations ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_gallery; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_gallery ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_gallery inagle_gallery_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inagle_gallery_public_read ON public.inagle_gallery FOR SELECT USING (true);


--
-- Name: inagle_growth_tables; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_growth_tables ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_heroes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_heroes ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_heroes inagle_heroes_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inagle_heroes_public_read ON public.inagle_heroes FOR SELECT USING (true);


--
-- Name: inagle_icon_inventory; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_icon_inventory ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_img_inventory; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_img_inventory ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_items ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_keshins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_keshins ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_kizuna_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_kizuna_items ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_kizuna_items inagle_kizuna_items_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inagle_kizuna_items_public_read ON public.inagle_kizuna_items FOR SELECT USING (true);


--
-- Name: inagle_manager_passives; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_manager_passives ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_manager_passives inagle_manager_passives_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inagle_manager_passives_public_read ON public.inagle_manager_passives FOR SELECT USING (true);


--
-- Name: inagle_media_assets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_media_assets ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_media_assets inagle_media_assets_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inagle_media_assets_public_read ON public.inagle_media_assets FOR SELECT USING (true);


--
-- Name: inagle_miximax; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_miximax ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_mode_changes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_mode_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_nameplates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_nameplates ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_opponent_teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_opponent_teams ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_opponent_teams inagle_opponent_teams_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inagle_opponent_teams_public_read ON public.inagle_opponent_teams FOR SELECT USING (true);


--
-- Name: inagle_override_skills; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_override_skills ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_passive_generation; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_passive_generation ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_passive_generation inagle_passive_generation_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inagle_passive_generation_public_read ON public.inagle_passive_generation FOR SELECT USING (true);


--
-- Name: inagle_passive_scaling; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_passive_scaling ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_passive_scaling inagle_passive_scaling_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inagle_passive_scaling_public_read ON public.inagle_passive_scaling FOR SELECT USING (true);


--
-- Name: inagle_passives; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_passives ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_performances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_performances ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_phase_titles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_phase_titles ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_quests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_quests ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_scene_archives; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_scene_archives ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_skills; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_skills ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_souls; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_souls ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_stadiums; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_stadiums ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_tactics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_tactics ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_tactics inagle_tactics_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inagle_tactics_public_read ON public.inagle_tactics FOR SELECT USING (true);


--
-- Name: inagle_teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inagle_teams ENABLE ROW LEVEL SECURITY;

--
-- Name: merch_products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.merch_products ENABLE ROW LEVEL SECURITY;

--
-- Name: newsletter_subscriptions newsletter_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY newsletter_delete_own ON public.newsletter_subscriptions FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: newsletter_subscriptions newsletter_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY newsletter_insert_authenticated ON public.newsletter_subscriptions FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: newsletter_subscriptions newsletter_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY newsletter_select_own ON public.newsletter_subscriptions FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.is_admin()));


--
-- Name: newsletter_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.newsletter_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: newsletter_subscriptions newsletter_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY newsletter_update_own ON public.newsletter_subscriptions FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: patch_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patch_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: patch_notes patch_notes_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patch_notes_admin_write ON public.patch_notes USING (public.is_admin());


--
-- Name: patch_notes patch_notes_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patch_notes_public_read ON public.patch_notes FOR SELECT USING (true);


--
-- Name: patreon_admin_owners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patreon_admin_owners ENABLE ROW LEVEL SECURITY;

--
-- Name: patreon_admin_owners patreon_admin_owners_admin_rw; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patreon_admin_owners_admin_rw ON public.patreon_admin_owners TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: patreon_legacy_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patreon_legacy_members ENABLE ROW LEVEL SECURITY;

--
-- Name: patreon_legacy_members patreon_legacy_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patreon_legacy_read ON public.patreon_legacy_members FOR SELECT TO authenticated USING ((public.is_admin() OR (resolved_user_id = auth.uid())));


--
-- Name: patreon_legacy_tiers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patreon_legacy_tiers ENABLE ROW LEVEL SECURITY;

--
-- Name: patreon_legacy_members patreon_legacy_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patreon_legacy_write ON public.patreon_legacy_members TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: patreon_memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patreon_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: patreon_memberships patreon_memberships_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patreon_memberships_admin_write ON public.patreon_memberships TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: patreon_memberships patreon_memberships_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patreon_memberships_owner_read ON public.patreon_memberships FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.is_admin()));


--
-- Name: patreon_oauth_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patreon_oauth_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: patreon_post_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patreon_post_events ENABLE ROW LEVEL SECURITY;

--
-- Name: patreon_post_events patreon_post_events_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patreon_post_events_admin_write ON public.patreon_post_events TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: patreon_post_events patreon_post_events_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patreon_post_events_read ON public.patreon_post_events FOR SELECT TO authenticated USING (true);


--
-- Name: patreon_post_images; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patreon_post_images ENABLE ROW LEVEL SECURITY;

--
-- Name: patreon_post_images patreon_post_images_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patreon_post_images_admin_read ON public.patreon_post_images FOR SELECT TO authenticated USING (public.is_admin());


--
-- Name: patreon_post_images patreon_post_images_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patreon_post_images_admin_write ON public.patreon_post_images TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: patreon_legacy_tiers patreon_tiers_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patreon_tiers_read ON public.patreon_legacy_tiers FOR SELECT TO authenticated USING (true);


--
-- Name: patreon_legacy_tiers patreon_tiers_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patreon_tiers_write ON public.patreon_legacy_tiers TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: patreon_oauth_tokens patreon_tokens_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patreon_tokens_owner ON public.patreon_oauth_tokens TO authenticated USING (((user_id = auth.uid()) OR public.is_admin())) WITH CHECK (((user_id = auth.uid()) OR public.is_admin()));


--
-- Name: patreon_webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patreon_webhook_events ENABLE ROW LEVEL SECURITY;

--
-- Name: patreon_webhook_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patreon_webhook_state ENABLE ROW LEVEL SECURITY;

--
-- Name: patreon_webhook_state patreon_webhook_state_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patreon_webhook_state_admin_read ON public.patreon_webhook_state FOR SELECT TO authenticated USING (public.is_admin());


--
-- Name: patreon_webhook_state patreon_webhook_state_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patreon_webhook_state_admin_write ON public.patreon_webhook_state TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: inagle_auras pub_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pub_read ON public.inagle_auras FOR SELECT USING (true);


--
-- Name: rate_limits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: rate_limits rate_limits_no_direct_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rate_limits_no_direct_access ON public.rate_limits FOR SELECT USING (false);


--
-- Name: reading_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reading_history ENABLE ROW LEVEL SECURITY;

--
-- Name: session; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.session ENABLE ROW LEVEL SECURITY;

--
-- Name: session session_service_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY session_service_only ON public.session USING (false);


--
-- Name: settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

--
-- Name: share_tracking; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.share_tracking ENABLE ROW LEVEL SECURITY;

--
-- Name: share_tracking share_tracking_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY share_tracking_insert_authenticated ON public.share_tracking FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) OR (user_id IS NULL)));


--
-- Name: share_tracking share_tracking_select_public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY share_tracking_select_public ON public.share_tracking FOR SELECT USING (true);


--
-- Name: stream_schedules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stream_schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: team_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

--
-- Name: topics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;

--
-- Name: topics topics_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY topics_admin_write ON public.topics USING (public.is_admin());


--
-- Name: topics topics_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY topics_public_read ON public.topics FOR SELECT USING (true);


--
-- Name: tweets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tweets ENABLE ROW LEVEL SECURITY;

--
-- Name: user; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."user" ENABLE ROW LEVEL SECURITY;

--
-- Name: user_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: user_preferences user_preferences_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_preferences_delete_own ON public.user_preferences FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: user_preferences user_preferences_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_preferences_insert_own ON public.user_preferences FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: user_preferences user_preferences_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_preferences_select_own ON public.user_preferences FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: user_preferences user_preferences_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_preferences_update_own ON public.user_preferences FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: user user_service_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_service_only ON public."user" USING (false);


--
-- Name: user_teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_teams ENABLE ROW LEVEL SECURITY;

--
-- Name: verification; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.verification ENABLE ROW LEVEL SECURITY;

--
-- Name: verification verification_service_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY verification_service_only ON public.verification USING (false);


--
-- Name: wiki_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wiki_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: wiki_overrides wiki_overrides_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wiki_overrides_admin_all ON public.wiki_overrides USING (public.is_admin());


--
-- PostgreSQL database dump complete
--

\unrestrict dAsXrhs4t0nEB25UDkeAmUolar53hdCb5VFjNUeP12mFEoBVqFapMhUdoJJs3Rj

