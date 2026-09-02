-- Politiques d'acces des tables `inagle_*` (RLS).
--
-- Separees du schema parce qu'elles n'en dependent pas seulement : elles interrogent
-- `public.profiles` et `auth.uid()`, c'est-a-dire le socle Supabase. Une base neuve qui ne porte
-- que les tables du jeu doit pouvoir se construire sans ce socle — d'ou la garde ci-dessous,
-- plutot qu'un echec au milieu du schema.
--
-- Chaque politique est supprimee avant d'etre recreee : rejouer ce fichier est sans effet de
-- bord, ce qui est la condition pour qu'il serve de reference et pas seulement d'historique.
--
-- 66 tables passees en RLS · 81 politiques

DO $garde$
BEGIN
	IF to_regclass('public.profiles') IS NULL THEN
		RAISE NOTICE 'socle Supabase absent (public.profiles) — politiques inagle non appliquees';
		RETURN;
	END IF;

	EXECUTE $sql$
DROP POLICY IF EXISTS "Admin Write Awakenings" ON public.inagle_awakenings;
CREATE POLICY "Admin Write Awakenings" ON public.inagle_awakenings TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--

DROP POLICY IF EXISTS "Admin Write Formations" ON public.inagle_formations;
CREATE POLICY "Admin Write Formations" ON public.inagle_formations TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--

DROP POLICY IF EXISTS "Admin Write Keshins" ON public.inagle_keshins;
CREATE POLICY "Admin Write Keshins" ON public.inagle_keshins TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--

DROP POLICY IF EXISTS "Admin Write Miximax" ON public.inagle_miximax;
CREATE POLICY "Admin Write Miximax" ON public.inagle_miximax TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--

DROP POLICY IF EXISTS "Admin Write ModeChanges" ON public.inagle_mode_changes;
CREATE POLICY "Admin Write ModeChanges" ON public.inagle_mode_changes TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--

DROP POLICY IF EXISTS "Admin Write Passives" ON public.inagle_passives;
CREATE POLICY "Admin Write Passives" ON public.inagle_passives TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--

DROP POLICY IF EXISTS "Admin Write Quests" ON public.inagle_quests;
CREATE POLICY "Admin Write Quests" ON public.inagle_quests TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--

DROP POLICY IF EXISTS "Admin Write Souls" ON public.inagle_souls;
CREATE POLICY "Admin Write Souls" ON public.inagle_souls TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--

DROP POLICY IF EXISTS "Admin manage inagle_awakenings" ON public.inagle_awakenings;
CREATE POLICY "Admin manage inagle_awakenings" ON public.inagle_awakenings TO authenticated USING (public.is_admin());


--

DROP POLICY IF EXISTS "Admin manage inagle_formations" ON public.inagle_formations;
CREATE POLICY "Admin manage inagle_formations" ON public.inagle_formations TO authenticated USING (public.is_admin());


--

DROP POLICY IF EXISTS "Admin manage inagle_keshins" ON public.inagle_keshins;
CREATE POLICY "Admin manage inagle_keshins" ON public.inagle_keshins TO authenticated USING (public.is_admin());


--

DROP POLICY IF EXISTS "Admin manage inagle_lua_scripts" ON public.inagle_lua_scripts;
CREATE POLICY "Admin manage inagle_lua_scripts" ON public.inagle_lua_scripts TO authenticated USING (public.is_admin());


--

DROP POLICY IF EXISTS "Admin manage inagle_miximax" ON public.inagle_miximax;
CREATE POLICY "Admin manage inagle_miximax" ON public.inagle_miximax TO authenticated USING (public.is_admin());


--

DROP POLICY IF EXISTS "Admin manage inagle_mode_changes" ON public.inagle_mode_changes;
CREATE POLICY "Admin manage inagle_mode_changes" ON public.inagle_mode_changes TO authenticated USING (public.is_admin());


--

DROP POLICY IF EXISTS "Admin manage inagle_souls" ON public.inagle_souls;
CREATE POLICY "Admin manage inagle_souls" ON public.inagle_souls TO authenticated USING (public.is_admin());


--

DROP POLICY IF EXISTS "Public Read" ON public.inagle_boost_groups;
CREATE POLICY "Public Read" ON public.inagle_boost_groups FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read" ON public.inagle_characters;
CREATE POLICY "Public Read" ON public.inagle_characters FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read" ON public.inagle_constellations;
CREATE POLICY "Public Read" ON public.inagle_constellations FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read" ON public.inagle_drop_rates;
CREATE POLICY "Public Read" ON public.inagle_drop_rates FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read" ON public.inagle_emblems;
CREATE POLICY "Public Read" ON public.inagle_emblems FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read" ON public.inagle_event_subtitles;
CREATE POLICY "Public Read" ON public.inagle_event_subtitles FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read" ON public.inagle_events;
CREATE POLICY "Public Read" ON public.inagle_events FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read" ON public.inagle_items;
CREATE POLICY "Public Read" ON public.inagle_items FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read" ON public.inagle_missions;
CREATE POLICY "Public Read" ON public.inagle_missions FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read" ON public.inagle_override_skills;
CREATE POLICY "Public Read" ON public.inagle_override_skills FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read" ON public.inagle_shops;
CREATE POLICY "Public Read" ON public.inagle_shops FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read" ON public.inagle_skill_technic;
CREATE POLICY "Public Read" ON public.inagle_skill_technic FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read" ON public.inagle_skill_videos;
CREATE POLICY "Public Read" ON public.inagle_skill_videos FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read" ON public.inagle_skills;
CREATE POLICY "Public Read" ON public.inagle_skills FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read" ON public.inagle_special_tactics;
CREATE POLICY "Public Read" ON public.inagle_special_tactics FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read" ON public.inagle_star_signs;
CREATE POLICY "Public Read" ON public.inagle_star_signs FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read" ON public.inagle_super_tactics;
CREATE POLICY "Public Read" ON public.inagle_super_tactics FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read" ON public.inagle_team_build;
CREATE POLICY "Public Read" ON public.inagle_team_build FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read" ON public.inagle_teams;
CREATE POLICY "Public Read" ON public.inagle_teams FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read" ON public.inagle_telop_waza;
CREATE POLICY "Public Read" ON public.inagle_telop_waza FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read" ON public.inagle_tricks;
CREATE POLICY "Public Read" ON public.inagle_tricks FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read" ON public.inagle_trophies;
CREATE POLICY "Public Read" ON public.inagle_trophies FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read" ON public.inagle_uniforms;
CREATE POLICY "Public Read" ON public.inagle_uniforms FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read" ON public.inagle_video_waza;
CREATE POLICY "Public Read" ON public.inagle_video_waza FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read Awakenings" ON public.inagle_awakenings;
CREATE POLICY "Public Read Awakenings" ON public.inagle_awakenings FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read Formations" ON public.inagle_formations;
CREATE POLICY "Public Read Formations" ON public.inagle_formations FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read Keshins" ON public.inagle_keshins;
CREATE POLICY "Public Read Keshins" ON public.inagle_keshins FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read Miximax" ON public.inagle_miximax;
CREATE POLICY "Public Read Miximax" ON public.inagle_miximax FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read ModeChanges" ON public.inagle_mode_changes;
CREATE POLICY "Public Read ModeChanges" ON public.inagle_mode_changes FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read Passives" ON public.inagle_passives;
CREATE POLICY "Public Read Passives" ON public.inagle_passives FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read Quests" ON public.inagle_quests;
CREATE POLICY "Public Read Quests" ON public.inagle_quests FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public Read Souls" ON public.inagle_souls;
CREATE POLICY "Public Read Souls" ON public.inagle_souls FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public read exp_table" ON public.inagle_exp_table;
CREATE POLICY "Public read exp_table" ON public.inagle_exp_table FOR SELECT USING (true);


--

DROP POLICY IF EXISTS "Public read growth_tables" ON public.inagle_growth_tables;
CREATE POLICY "Public read growth_tables" ON public.inagle_growth_tables FOR SELECT USING (true);


--

DROP POLICY IF EXISTS anon_read ON public.inagle_activity_photos;
CREATE POLICY anon_read ON public.inagle_activity_photos FOR SELECT TO anon USING (true);


--

DROP POLICY IF EXISTS anon_read ON public.inagle_chara_menu_resource;
CREATE POLICY anon_read ON public.inagle_chara_menu_resource FOR SELECT TO anon USING (true);


--

DROP POLICY IF EXISTS anon_read ON public.inagle_chat_emotes;
CREATE POLICY anon_read ON public.inagle_chat_emotes FOR SELECT TO anon USING (true);


--

DROP POLICY IF EXISTS anon_read ON public.inagle_icon_inventory;
CREATE POLICY anon_read ON public.inagle_icon_inventory FOR SELECT TO anon USING (true);


--

DROP POLICY IF EXISTS anon_read ON public.inagle_img_inventory;
CREATE POLICY anon_read ON public.inagle_img_inventory FOR SELECT TO anon USING (true);


--

DROP POLICY IF EXISTS anon_read ON public.inagle_nameplates;
CREATE POLICY anon_read ON public.inagle_nameplates FOR SELECT TO anon USING (true);


--

DROP POLICY IF EXISTS anon_read ON public.inagle_performances;
CREATE POLICY anon_read ON public.inagle_performances FOR SELECT TO anon USING (true);


--

DROP POLICY IF EXISTS anon_read ON public.inagle_phase_titles;
CREATE POLICY anon_read ON public.inagle_phase_titles FOR SELECT TO anon USING (true);


--

DROP POLICY IF EXISTS anon_read ON public.inagle_scene_archives;
CREATE POLICY anon_read ON public.inagle_scene_archives FOR SELECT TO anon USING (true);


--

DROP POLICY IF EXISTS anon_read ON public.inagle_stadiums;
CREATE POLICY anon_read ON public.inagle_stadiums FOR SELECT TO anon USING (true);


--

DROP POLICY IF EXISTS anon_read_inagle_game_assets ON public.inagle_game_assets;
CREATE POLICY anon_read_inagle_game_assets ON public.inagle_game_assets FOR SELECT TO anon, authenticated USING (true);


--

ALTER TABLE public.inagle_activity_photos ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_auras ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_awakenings ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_basara ENABLE ROW LEVEL SECURITY;

--

DROP POLICY IF EXISTS inagle_basara_public_read ON public.inagle_basara;
CREATE POLICY inagle_basara_public_read ON public.inagle_basara FOR SELECT USING (true);


--

ALTER TABLE public.inagle_boost_groups ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_capsules ENABLE ROW LEVEL SECURITY;

--

DROP POLICY IF EXISTS inagle_capsules_public_read ON public.inagle_capsules;
CREATE POLICY inagle_capsules_public_read ON public.inagle_capsules FOR SELECT USING (true);


--

ALTER TABLE public.inagle_chara_menu_resource ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_characters ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_chat_emotes ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_constellations ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_coordinators ENABLE ROW LEVEL SECURITY;

--

DROP POLICY IF EXISTS inagle_coordinators_public_read ON public.inagle_coordinators;
CREATE POLICY inagle_coordinators_public_read ON public.inagle_coordinators FOR SELECT USING (true);


--

ALTER TABLE public.inagle_costumes ENABLE ROW LEVEL SECURITY;

--

DROP POLICY IF EXISTS inagle_costumes_public_read ON public.inagle_costumes;
CREATE POLICY inagle_costumes_public_read ON public.inagle_costumes FOR SELECT USING (true);


--

ALTER TABLE public.inagle_custom_passives ENABLE ROW LEVEL SECURITY;

--

DROP POLICY IF EXISTS inagle_custom_passives_public_read ON public.inagle_custom_passives;
CREATE POLICY inagle_custom_passives_public_read ON public.inagle_custom_passives FOR SELECT USING (true);


--

ALTER TABLE public.inagle_drop_rates ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_drops ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_drops_battles ENABLE ROW LEVEL SECURITY;

--

DROP POLICY IF EXISTS inagle_drops_battles_public_read ON public.inagle_drops_battles;
CREATE POLICY inagle_drops_battles_public_read ON public.inagle_drops_battles FOR SELECT USING (true);


--

DROP POLICY IF EXISTS inagle_drops_public_read ON public.inagle_drops;
CREATE POLICY inagle_drops_public_read ON public.inagle_drops FOR SELECT USING (true);


--

ALTER TABLE public.inagle_drops_tables ENABLE ROW LEVEL SECURITY;

--

DROP POLICY IF EXISTS inagle_drops_tables_public_read ON public.inagle_drops_tables;
CREATE POLICY inagle_drops_tables_public_read ON public.inagle_drops_tables FOR SELECT USING (true);


--

ALTER TABLE public.inagle_drops_treasures ENABLE ROW LEVEL SECURITY;

--

DROP POLICY IF EXISTS inagle_drops_treasures_public_read ON public.inagle_drops_treasures;
CREATE POLICY inagle_drops_treasures_public_read ON public.inagle_drops_treasures FOR SELECT USING (true);


--

ALTER TABLE public.inagle_emblems ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_event_subtitles ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_events ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_exp_table ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_formations ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_gallery ENABLE ROW LEVEL SECURITY;

--

DROP POLICY IF EXISTS inagle_gallery_public_read ON public.inagle_gallery;
CREATE POLICY inagle_gallery_public_read ON public.inagle_gallery FOR SELECT USING (true);


--

ALTER TABLE public.inagle_game_assets ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_growth_tables ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_heroes ENABLE ROW LEVEL SECURITY;

--

DROP POLICY IF EXISTS inagle_heroes_public_read ON public.inagle_heroes;
CREATE POLICY inagle_heroes_public_read ON public.inagle_heroes FOR SELECT USING (true);


--

ALTER TABLE public.inagle_icon_inventory ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_img_inventory ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_items ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_keshins ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_kizuna_items ENABLE ROW LEVEL SECURITY;

--

DROP POLICY IF EXISTS inagle_kizuna_items_public_read ON public.inagle_kizuna_items;
CREATE POLICY inagle_kizuna_items_public_read ON public.inagle_kizuna_items FOR SELECT USING (true);


--

ALTER TABLE public.inagle_lua_scripts ENABLE ROW LEVEL SECURITY;

--

DROP POLICY IF EXISTS inagle_lua_scripts_public_read ON public.inagle_lua_scripts;
CREATE POLICY inagle_lua_scripts_public_read ON public.inagle_lua_scripts FOR SELECT USING (true);


--

ALTER TABLE public.inagle_manager_passives ENABLE ROW LEVEL SECURITY;

--

DROP POLICY IF EXISTS inagle_manager_passives_public_read ON public.inagle_manager_passives;
CREATE POLICY inagle_manager_passives_public_read ON public.inagle_manager_passives FOR SELECT USING (true);


--

ALTER TABLE public.inagle_media_assets ENABLE ROW LEVEL SECURITY;

--

DROP POLICY IF EXISTS inagle_media_assets_public_read ON public.inagle_media_assets;
CREATE POLICY inagle_media_assets_public_read ON public.inagle_media_assets FOR SELECT USING (true);


--

ALTER TABLE public.inagle_missions ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_miximax ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_mode_changes ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_nameplates ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_opponent_teams ENABLE ROW LEVEL SECURITY;

--

DROP POLICY IF EXISTS inagle_opponent_teams_public_read ON public.inagle_opponent_teams;
CREATE POLICY inagle_opponent_teams_public_read ON public.inagle_opponent_teams FOR SELECT USING (true);


--

ALTER TABLE public.inagle_override_skills ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_passive_generation ENABLE ROW LEVEL SECURITY;

--

DROP POLICY IF EXISTS inagle_passive_generation_public_read ON public.inagle_passive_generation;
CREATE POLICY inagle_passive_generation_public_read ON public.inagle_passive_generation FOR SELECT USING (true);


--

ALTER TABLE public.inagle_passive_scaling ENABLE ROW LEVEL SECURITY;

--

DROP POLICY IF EXISTS inagle_passive_scaling_public_read ON public.inagle_passive_scaling;
CREATE POLICY inagle_passive_scaling_public_read ON public.inagle_passive_scaling FOR SELECT USING (true);


--

ALTER TABLE public.inagle_passives ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_performances ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_phase_titles ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_quests ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_rag_edges ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_scene_archives ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_shops ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_skill_technic ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_skill_videos ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_skills ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_souls ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_special_tactics ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_stadiums ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_star_signs ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_super_tactics ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_tactics ENABLE ROW LEVEL SECURITY;

--

DROP POLICY IF EXISTS inagle_tactics_public_read ON public.inagle_tactics;
CREATE POLICY inagle_tactics_public_read ON public.inagle_tactics FOR SELECT USING (true);


--

ALTER TABLE public.inagle_team_build ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_teams ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_telop_waza ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_tricks ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_trophies ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_uniforms ENABLE ROW LEVEL SECURITY;

--

ALTER TABLE public.inagle_video_waza ENABLE ROW LEVEL SECURITY;

--

DROP POLICY IF EXISTS "lecture publique" ON public.inagle_rag_edges;
CREATE POLICY "lecture publique" ON public.inagle_rag_edges FOR SELECT TO anon, authenticated USING (true);


--

DROP POLICY IF EXISTS pub_read ON public.inagle_auras;
CREATE POLICY pub_read ON public.inagle_auras FOR SELECT USING (true);
	$sql$;
END
$garde$;
