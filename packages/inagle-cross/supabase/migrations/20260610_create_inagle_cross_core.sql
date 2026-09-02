-- Migration : socle données « Inazuma Eleven Cross » (jeu DISTINCT d'IEVR).
-- Préfixe inagle_cross_ => routé miroir SQLite azalée (server.ts startsWith "inagle_")
-- + capté par mirror-sync.sh (--prefix=inagle_). RLS lecture publique (modèle inagle_events).
-- Généré depuis le schéma masterdata typé (dump IL2CPP). data jsonb = source de vérité ;
-- quelques colonnes promues pour les filtres/index. Valeurs poussées en Phase 1 (déblocage anti-triche).

-- AffinityItemMaster  (LGAマスター - アイテム - プレゼント.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_affinity_item_master (
  id          text PRIMARY KEY,
  code        integer,
  grade       integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_affinity_item_master_grade_idx ON public.inagle_cross_affinity_item_master (grade);
ALTER TABLE public.inagle_cross_affinity_item_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_affinity_item_master;
CREATE POLICY "Public Read" ON public.inagle_cross_affinity_item_master FOR SELECT TO public USING (true);

-- AffinityRankMaster  (LGAマスター - 信頼度ランク.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_affinity_rank_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_affinity_rank_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_affinity_rank_master;
CREATE POLICY "Public Read" ON public.inagle_cross_affinity_rank_master FOR SELECT TO public USING (true);

-- AffinityRewardMaster  (LGAマスター - 信頼度報酬.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_affinity_reward_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_affinity_reward_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_affinity_reward_master;
CREATE POLICY "Public Read" ON public.inagle_cross_affinity_reward_master FOR SELECT TO public USING (true);

-- AwakeningTierMaster  (LGAマスター - 覚醒度.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_awakening_tier_master (
  id          text PRIMARY KEY,
  code        integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_awakening_tier_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_awakening_tier_master;
CREATE POLICY "Public Read" ON public.inagle_cross_awakening_tier_master FOR SELECT TO public USING (true);

-- BackgroundMaster  (LGAマスター - 背景.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_background_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_background_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_background_master;
CREATE POLICY "Public Read" ON public.inagle_cross_background_master FOR SELECT TO public USING (true);

-- BaseScheduleMaster  (LGAマスター - スケジュール.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_base_schedule_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_base_schedule_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_base_schedule_master;
CREATE POLICY "Public Read" ON public.inagle_cross_base_schedule_master FOR SELECT TO public USING (true);

-- BattleBgmMaster  (LGAマスター - 試合BGM.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_battle_bgm_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_battle_bgm_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_battle_bgm_master;
CREATE POLICY "Public Read" ON public.inagle_cross_battle_bgm_master FOR SELECT TO public USING (true);

-- BattleOperationParameter  (LGAマスター - AI共通設定.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_battle_operation_parameter (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_battle_operation_parameter ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_battle_operation_parameter;
CREATE POLICY "Public Read" ON public.inagle_cross_battle_operation_parameter FOR SELECT TO public USING (true);

-- BattlePassLevelMaster  (LGAマスター - バトルパスレベル.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_battle_pass_level_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_battle_pass_level_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_battle_pass_level_master;
CREATE POLICY "Public Read" ON public.inagle_cross_battle_pass_level_master FOR SELECT TO public USING (true);

-- BattlePassMaster  (LGAマスター - バトルパス.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_battle_pass_master (
  id          text PRIMARY KEY,
  code        integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_battle_pass_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_battle_pass_master;
CREATE POLICY "Public Read" ON public.inagle_cross_battle_pass_master FOR SELECT TO public USING (true);

-- BattlePassMissionGroupMaster  (LGAマスター - ミッショングループ - バトルパス.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_battle_pass_mission_group_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_battle_pass_mission_group_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_battle_pass_mission_group_master;
CREATE POLICY "Public Read" ON public.inagle_cross_battle_pass_mission_group_master FOR SELECT TO public USING (true);

-- BattlePassMissionMaster  (LGAマスター - ミッション - バトルパス.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_battle_pass_mission_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_battle_pass_mission_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_battle_pass_mission_master;
CREATE POLICY "Public Read" ON public.inagle_cross_battle_pass_mission_master FOR SELECT TO public USING (true);

-- BeginnerMissionGroupMaster  (LGAマスター - ミッショングループ - 初心者.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_beginner_mission_group_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_beginner_mission_group_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_beginner_mission_group_master;
CREATE POLICY "Public Read" ON public.inagle_cross_beginner_mission_group_master FOR SELECT TO public USING (true);

-- BeginnerMissionMaster  (LGAマスター - ミッション - 初心者.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_beginner_mission_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_beginner_mission_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_beginner_mission_master;
CREATE POLICY "Public Read" ON public.inagle_cross_beginner_mission_master FOR SELECT TO public USING (true);

-- BonusPassMaster  (LGAマスター - ストア - ボーナスパス.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_bonus_pass_master (
  id          text PRIMARY KEY,
  code        integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_bonus_pass_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_bonus_pass_master;
CREATE POLICY "Public Read" ON public.inagle_cross_bonus_pass_master FOR SELECT TO public USING (true);

-- CharacterGradeMaster  (LGAマスター - グレード.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_character_grade_master (
  id          text PRIMARY KEY,
  grade       integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_character_grade_master_grade_idx ON public.inagle_cross_character_grade_master (grade);
ALTER TABLE public.inagle_cross_character_grade_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_character_grade_master;
CREATE POLICY "Public Read" ON public.inagle_cross_character_grade_master FOR SELECT TO public USING (true);

-- CharacterItemMaster  (LGAマスター - アイテム - キャラクター.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_character_item_master (
  id          text PRIMARY KEY,
  code        integer,
  grade       integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_character_item_master_grade_idx ON public.inagle_cross_character_item_master (grade);
ALTER TABLE public.inagle_cross_character_item_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_character_item_master;
CREATE POLICY "Public Read" ON public.inagle_cross_character_item_master FOR SELECT TO public USING (true);

-- CharacterMaster  (LGAマスター - キャラクター.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_character_master (
  id          text PRIMARY KEY,
  code        integer,
  name_key    text,
  element     integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_character_master_element_idx ON public.inagle_cross_character_master (element);
ALTER TABLE public.inagle_cross_character_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_character_master;
CREATE POLICY "Public Read" ON public.inagle_cross_character_master FOR SELECT TO public USING (true);

-- CharacterModelSetMaster  (LGAマスター - キャラクターモデルセット.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_character_model_set_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_character_model_set_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_character_model_set_master;
CREATE POLICY "Public Read" ON public.inagle_cross_character_model_set_master FOR SELECT TO public USING (true);

-- CharacterModelVariationMaster  (LGAマスター - 固有着こなし.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_character_model_variation_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_character_model_variation_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_character_model_variation_master;
CREATE POLICY "Public Read" ON public.inagle_cross_character_model_variation_master FOR SELECT TO public USING (true);

-- CharacterSoulItemMaster  (LGAマスター - アイテム - 覚醒素材.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_character_soul_item_master (
  id          text PRIMARY KEY,
  code        integer,
  grade       integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_character_soul_item_master_grade_idx ON public.inagle_cross_character_soul_item_master (grade);
ALTER TABLE public.inagle_cross_character_soul_item_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_character_soul_item_master;
CREATE POLICY "Public Read" ON public.inagle_cross_character_soul_item_master FOR SELECT TO public USING (true);

-- CharacterTagMaster  (LGAマスター - キャラクター - タグ.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_character_tag_master (
  id          text PRIMARY KEY,
  code        integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_character_tag_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_character_tag_master;
CREATE POLICY "Public Read" ON public.inagle_cross_character_tag_master FOR SELECT TO public USING (true);

-- CharacterizeItemMaster  (LGAマスター - アイテム - キャラクター結晶.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_characterize_item_master (
  id          text PRIMARY KEY,
  code        integer,
  grade       integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_characterize_item_master_grade_idx ON public.inagle_cross_characterize_item_master (grade);
ALTER TABLE public.inagle_cross_characterize_item_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_characterize_item_master;
CREATE POLICY "Public Read" ON public.inagle_cross_characterize_item_master FOR SELECT TO public USING (true);

-- ChatStampMaster  (LGAマスター - チャットスタンプ.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_chat_stamp_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_chat_stamp_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_chat_stamp_master;
CREATE POLICY "Public Read" ON public.inagle_cross_chat_stamp_master FOR SELECT TO public USING (true);

-- ClubHouseDecorationItemMaster  (LGAマスター - アイテム - 部室配置品.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_club_house_decoration_item_master (
  id          text PRIMARY KEY,
  code        integer,
  grade       integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_club_house_decoration_item_master_grade_idx ON public.inagle_cross_club_house_decoration_item_master (grade);
ALTER TABLE public.inagle_cross_club_house_decoration_item_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_club_house_decoration_item_master;
CREATE POLICY "Public Read" ON public.inagle_cross_club_house_decoration_item_master FOR SELECT TO public USING (true);

-- ClubHouseDecorationSlotTypeMaster  (LGAマスター - 部室配置品スロットタイプ設定.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_club_house_decoration_slot_type_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_club_house_decoration_slot_type_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_club_house_decoration_slot_type_master;
CREATE POLICY "Public Read" ON public.inagle_cross_club_house_decoration_slot_type_master FOR SELECT TO public USING (true);

-- ClubMemberOperationProfileMaster  (LGAマスター - キャラクターAI命令セット.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_club_member_operation_profile_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_club_member_operation_profile_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_club_member_operation_profile_master;
CREATE POLICY "Public Read" ON public.inagle_cross_club_member_operation_profile_master FOR SELECT TO public USING (true);

-- CommentaryMaster  (LGAマスター - 試合実況者.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_commentary_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_commentary_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_commentary_master;
CREATE POLICY "Public Read" ON public.inagle_cross_commentary_master FOR SELECT TO public USING (true);

-- ConnectionBoardAreaMaster  (LGAマスター - 人脈ボードエリア.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_connection_board_area_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_connection_board_area_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_connection_board_area_master;
CREATE POLICY "Public Read" ON public.inagle_cross_connection_board_area_master FOR SELECT TO public USING (true);

-- ConnectionBoardChapterMaster  (LGAマスター - 人脈ボードチャプター.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_connection_board_chapter_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_connection_board_chapter_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_connection_board_chapter_master;
CREATE POLICY "Public Read" ON public.inagle_cross_connection_board_chapter_master FOR SELECT TO public USING (true);

-- ConnectionBoardStageMaster  (LGAマスター - 人脈ボードステージ.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_connection_board_stage_master (
  id          text PRIMARY KEY,
  code        integer,
  type        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_connection_board_stage_master_type_idx ON public.inagle_cross_connection_board_stage_master (type);
ALTER TABLE public.inagle_cross_connection_board_stage_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_connection_board_stage_master;
CREATE POLICY "Public Read" ON public.inagle_cross_connection_board_stage_master FOR SELECT TO public USING (true);

-- DiamondItemMaster  (LGAマスター - アイテム - ダイヤ.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_diamond_item_master (
  id          text PRIMARY KEY,
  code        integer,
  grade       integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_diamond_item_master_grade_idx ON public.inagle_cross_diamond_item_master (grade);
ALTER TABLE public.inagle_cross_diamond_item_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_diamond_item_master;
CREATE POLICY "Public Read" ON public.inagle_cross_diamond_item_master FOR SELECT TO public USING (true);

-- DirectorGrowthRecipeMasterData  (LGAマスター - 監督 - 成長素材.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_director_growth_recipe_master_data (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_director_growth_recipe_master_data ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_director_growth_recipe_master_data;
CREATE POLICY "Public Read" ON public.inagle_cross_director_growth_recipe_master_data FOR SELECT TO public USING (true);

-- DirectorItemMaster  (LGAマスター - アイテム - 監督.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_director_item_master (
  id          text PRIMARY KEY,
  code        integer,
  grade       integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_director_item_master_grade_idx ON public.inagle_cross_director_item_master (grade);
ALTER TABLE public.inagle_cross_director_item_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_director_item_master;
CREATE POLICY "Public Read" ON public.inagle_cross_director_item_master FOR SELECT TO public USING (true);

-- DirectorLevelTotalPowerBonusMaster  (LGAマスター - 総合能力監督レベルボーナス.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_director_level_total_power_bonus_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_director_level_total_power_bonus_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_director_level_total_power_bonus_master;
CREATE POLICY "Public Read" ON public.inagle_cross_director_level_total_power_bonus_master FOR SELECT TO public USING (true);

-- DirectorLevelUpMaterialItemMaster  (LGAマスター - アイテム - 監督強化素材.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_director_level_up_material_item_master (
  id          text PRIMARY KEY,
  code        integer,
  grade       integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_director_level_up_material_item_master_grade_idx ON public.inagle_cross_director_level_up_material_item_master (grade);
ALTER TABLE public.inagle_cross_director_level_up_material_item_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_director_level_up_material_item_master;
CREATE POLICY "Public Read" ON public.inagle_cross_director_level_up_material_item_master FOR SELECT TO public USING (true);

-- ElementAwakenItemMaster  (LGAマスター - アイテム - 属性おにぎり.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_element_awaken_item_master (
  id          text PRIMARY KEY,
  code        integer,
  grade       integer,
  name_key    text,
  element     integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_element_awaken_item_master_grade_idx ON public.inagle_cross_element_awaken_item_master (grade);
CREATE INDEX IF NOT EXISTS inagle_cross_element_awaken_item_master_element_idx ON public.inagle_cross_element_awaken_item_master (element);
ALTER TABLE public.inagle_cross_element_awaken_item_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_element_awaken_item_master;
CREATE POLICY "Public Read" ON public.inagle_cross_element_awaken_item_master FOR SELECT TO public USING (true);

-- EnemyTeamMaster  (LGAマスター - 敵チーム.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_enemy_team_master (
  id          text PRIMARY KEY,
  code        integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_enemy_team_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_enemy_team_master;
CREATE POLICY "Public Read" ON public.inagle_cross_enemy_team_master FOR SELECT TO public USING (true);

-- EquipmentCraftingMaterialItemMaster  (LGAマスター - アイテム - 装備制作素材.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_equipment_crafting_material_item_master (
  id          text PRIMARY KEY,
  code        integer,
  grade       integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_equipment_crafting_material_item_master_grade_idx ON public.inagle_cross_equipment_crafting_material_item_master (grade);
ALTER TABLE public.inagle_cross_equipment_crafting_material_item_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_equipment_crafting_material_item_master;
CREATE POLICY "Public Read" ON public.inagle_cross_equipment_crafting_material_item_master FOR SELECT TO public USING (true);

-- EquipmentItemMaster  (LGAマスター - アイテム - 装備.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_equipment_item_master (
  id          text PRIMARY KEY,
  code        integer,
  grade       integer,
  name_key    text,
  position    integer,
  slot        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_equipment_item_master_grade_idx ON public.inagle_cross_equipment_item_master (grade);
CREATE INDEX IF NOT EXISTS inagle_cross_equipment_item_master_position_idx ON public.inagle_cross_equipment_item_master (position);
CREATE INDEX IF NOT EXISTS inagle_cross_equipment_item_master_slot_idx ON public.inagle_cross_equipment_item_master (slot);
ALTER TABLE public.inagle_cross_equipment_item_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_equipment_item_master;
CREATE POLICY "Public Read" ON public.inagle_cross_equipment_item_master FOR SELECT TO public USING (true);

-- EventConnectionBoardAreaMaster  (LGAマスター - イベント人脈ボードエリア.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_event_connection_board_area_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_event_connection_board_area_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_event_connection_board_area_master;
CREATE POLICY "Public Read" ON public.inagle_cross_event_connection_board_area_master FOR SELECT TO public USING (true);

-- EventConnectionBoardChapterMaster  (LGAマスター - イベント人脈ボードチャプター.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_event_connection_board_chapter_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_event_connection_board_chapter_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_event_connection_board_chapter_master;
CREATE POLICY "Public Read" ON public.inagle_cross_event_connection_board_chapter_master FOR SELECT TO public USING (true);

-- EventConnectionBoardStageMaster  (LGAマスター - イベント人脈ボードステージ.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_event_connection_board_stage_master (
  id          text PRIMARY KEY,
  code        integer,
  type        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_event_connection_board_stage_master_type_idx ON public.inagle_cross_event_connection_board_stage_master (type);
ALTER TABLE public.inagle_cross_event_connection_board_stage_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_event_connection_board_stage_master;
CREATE POLICY "Public Read" ON public.inagle_cross_event_connection_board_stage_master FOR SELECT TO public USING (true);

-- EventGuideMaster  (LGAマスター - イベントガイド.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_event_guide_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_event_guide_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_event_guide_master;
CREATE POLICY "Public Read" ON public.inagle_cross_event_guide_master FOR SELECT TO public USING (true);

-- EventMaster  (LGAマスター - イベント.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_event_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_event_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_event_master;
CREATE POLICY "Public Read" ON public.inagle_cross_event_master FOR SELECT TO public USING (true);

-- EventMissionGroupMaster  (LGAマスター - ミッショングループ - イベント.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_event_mission_group_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_event_mission_group_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_event_mission_group_master;
CREATE POLICY "Public Read" ON public.inagle_cross_event_mission_group_master FOR SELECT TO public USING (true);

-- EventMissionMaster  (LGAマスター - ミッション - イベント.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_event_mission_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_event_mission_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_event_mission_master;
CREATE POLICY "Public Read" ON public.inagle_cross_event_mission_master FOR SELECT TO public USING (true);

-- EventStoryAreaMaster  (LGAマスター - イベントストーリーエリア.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_event_story_area_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_event_story_area_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_event_story_area_master;
CREATE POLICY "Public Read" ON public.inagle_cross_event_story_area_master FOR SELECT TO public USING (true);

-- EventStoryChapterMaster  (LGAマスター - イベントストーリーチャプター.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_event_story_chapter_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_event_story_chapter_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_event_story_chapter_master;
CREATE POLICY "Public Read" ON public.inagle_cross_event_story_chapter_master FOR SELECT TO public USING (true);

-- EventStoryStageMaster  (LGAマスター - イベントストーリーステージ.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_event_story_stage_master (
  id          text PRIMARY KEY,
  code        integer,
  type        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_event_story_stage_master_type_idx ON public.inagle_cross_event_story_stage_master (type);
ALTER TABLE public.inagle_cross_event_story_stage_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_event_story_stage_master;
CREATE POLICY "Public Read" ON public.inagle_cross_event_story_stage_master FOR SELECT TO public USING (true);

-- ExpTableLevelMaster  (LGAマスター - 経験値テーブル.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_exp_table_level_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_exp_table_level_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_exp_table_level_master;
CREATE POLICY "Public Read" ON public.inagle_cross_exp_table_level_master FOR SELECT TO public USING (true);

-- ExternalLinkProductMaster  (LGAマスター - ストア - 外部決済商品.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_external_link_product_master (
  id          text PRIMARY KEY,
  code        integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_external_link_product_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_external_link_product_master;
CREATE POLICY "Public Read" ON public.inagle_cross_external_link_product_master FOR SELECT TO public USING (true);

-- ExtraCupGroupMaster  (LGAマスター - エクストラカップグループ.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_extra_cup_group_master (
  id          text PRIMARY KEY,
  code        integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_extra_cup_group_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_extra_cup_group_master;
CREATE POLICY "Public Read" ON public.inagle_cross_extra_cup_group_master FOR SELECT TO public USING (true);

-- ExtraCupStageMaster  (LGAマスター - エクストラカップステージ.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_extra_cup_stage_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_extra_cup_stage_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_extra_cup_stage_master;
CREATE POLICY "Public Read" ON public.inagle_cross_extra_cup_stage_master FOR SELECT TO public USING (true);

-- FieldAreaMaster  (LGAマスター - フィールドエリア.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_field_area_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_field_area_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_field_area_master;
CREATE POLICY "Public Read" ON public.inagle_cross_field_area_master FOR SELECT TO public USING (true);

-- FieldMaster  (LGAマスター - フィールド.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_field_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_field_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_field_master;
CREATE POLICY "Public Read" ON public.inagle_cross_field_master FOR SELECT TO public USING (true);

-- FieldTerrainMaster  (LGAマスター - フィールド地形.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_field_terrain_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_field_terrain_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_field_terrain_master;
CREATE POLICY "Public Read" ON public.inagle_cross_field_terrain_master FOR SELECT TO public USING (true);

-- FixedDropTableMaster  (LGAマスター - ドロップテーブル(固定).tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_fixed_drop_table_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_fixed_drop_table_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_fixed_drop_table_master;
CREATE POLICY "Public Read" ON public.inagle_cross_fixed_drop_table_master FOR SELECT TO public USING (true);

-- FixedPlayerMaster  (LGAマスター - 編成固定プレイヤー.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_fixed_player_master (
  id          text PRIMARY KEY,
  code        integer,
  slot        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_fixed_player_master_slot_idx ON public.inagle_cross_fixed_player_master (slot);
ALTER TABLE public.inagle_cross_fixed_player_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_fixed_player_master;
CREATE POLICY "Public Read" ON public.inagle_cross_fixed_player_master FOR SELECT TO public USING (true);

-- FocusedTrainingTicketItemMaster  (LGAマスター - アイテム - 集中部活券.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_focused_training_ticket_item_master (
  id          text PRIMARY KEY,
  code        integer,
  grade       integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_focused_training_ticket_item_master_grade_idx ON public.inagle_cross_focused_training_ticket_item_master (grade);
ALTER TABLE public.inagle_cross_focused_training_ticket_item_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_focused_training_ticket_item_master;
CREATE POLICY "Public Read" ON public.inagle_cross_focused_training_ticket_item_master FOR SELECT TO public USING (true);

-- FormationDeckMaster  (LGAマスター - フォーメーションデッキ.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_formation_deck_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_formation_deck_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_formation_deck_master;
CREATE POLICY "Public Read" ON public.inagle_cross_formation_deck_master FOR SELECT TO public USING (true);

-- FormationMaster  (LGAマスター - フォーメーション.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_formation_master (
  id          text PRIMARY KEY,
  code        integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_formation_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_formation_master;
CREATE POLICY "Public Read" ON public.inagle_cross_formation_master FOR SELECT TO public USING (true);

-- GachaBackgroundCutsceneMaster  (LGAマスター - ガチャ背景カットシーン.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_gacha_background_cutscene_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_gacha_background_cutscene_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_gacha_background_cutscene_master;
CREATE POLICY "Public Read" ON public.inagle_cross_gacha_background_cutscene_master FOR SELECT TO public USING (true);

-- GachaDroptableMaster  (LGAマスター - ガチャ抽選テーブル.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_gacha_droptable_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_gacha_droptable_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_gacha_droptable_master;
CREATE POLICY "Public Read" ON public.inagle_cross_gacha_droptable_master FOR SELECT TO public USING (true);

-- GachaItemPresentationMaster  (LGAマスター - ガチャ商品登場演出テーブル.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_gacha_item_presentation_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_gacha_item_presentation_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_gacha_item_presentation_master;
CREATE POLICY "Public Read" ON public.inagle_cross_gacha_item_presentation_master FOR SELECT TO public USING (true);

-- GachaMachineMaster  (LGAマスター - ガチャ筐体.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_gacha_machine_master (
  id          text PRIMARY KEY,
  code        integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_gacha_machine_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_gacha_machine_master;
CREATE POLICY "Public Read" ON public.inagle_cross_gacha_machine_master FOR SELECT TO public USING (true);

-- GachaMainPresentationMaster  (LGAマスター - ガチャメイン演出テーブル.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_gacha_main_presentation_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_gacha_main_presentation_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_gacha_main_presentation_master;
CREATE POLICY "Public Read" ON public.inagle_cross_gacha_main_presentation_master FOR SELECT TO public USING (true);

-- GachaPresentationMaster  (LGAマスター - ガチャ演出.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_gacha_presentation_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_gacha_presentation_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_gacha_presentation_master;
CREATE POLICY "Public Read" ON public.inagle_cross_gacha_presentation_master FOR SELECT TO public USING (true);

-- GachaPresentationVariationMaster  (LGAマスター - ガチャ演出バリエーショングループ.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_gacha_presentation_variation_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_gacha_presentation_variation_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_gacha_presentation_variation_master;
CREATE POLICY "Public Read" ON public.inagle_cross_gacha_presentation_variation_master FOR SELECT TO public USING (true);

-- GachaTicketItemMaster  (LGAマスター - アイテム - ガチャチケット.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_gacha_ticket_item_master (
  id          text PRIMARY KEY,
  code        integer,
  grade       integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_gacha_ticket_item_master_grade_idx ON public.inagle_cross_gacha_ticket_item_master (grade);
ALTER TABLE public.inagle_cross_gacha_ticket_item_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_gacha_ticket_item_master;
CREATE POLICY "Public Read" ON public.inagle_cross_gacha_ticket_item_master FOR SELECT TO public USING (true);

-- GachaWishlistCandidateMaster  (LGAマスター - ウィッシュリスト候補.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_gacha_wishlist_candidate_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_gacha_wishlist_candidate_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_gacha_wishlist_candidate_master;
CREATE POLICY "Public Read" ON public.inagle_cross_gacha_wishlist_candidate_master FOR SELECT TO public USING (true);

-- GameContentTutorialMaster  (LGAマスター - コンテンツ別チュートリアル.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_game_content_tutorial_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_game_content_tutorial_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_game_content_tutorial_master;
CREATE POLICY "Public Read" ON public.inagle_cross_game_content_tutorial_master FOR SELECT TO public USING (true);

-- GameContentUnlockConditionMaster  (LGAマスター - 機能解放.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_game_content_unlock_condition_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_game_content_unlock_condition_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_game_content_unlock_condition_master;
CREATE POLICY "Public Read" ON public.inagle_cross_game_content_unlock_condition_master FOR SELECT TO public USING (true);

-- GuildEmblemMaster  (LGAマスター - ギルド - エンブレム.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_guild_emblem_master (
  id          text PRIMARY KEY,
  code        integer,
  slot        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_guild_emblem_master_slot_idx ON public.inagle_cross_guild_emblem_master (slot);
ALTER TABLE public.inagle_cross_guild_emblem_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_guild_emblem_master;
CREATE POLICY "Public Read" ON public.inagle_cross_guild_emblem_master FOR SELECT TO public USING (true);

-- GuildMemberCountFilterMaster  (LGAマスター - ギルド - 規模分類.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_guild_member_count_filter_master (
  id          text PRIMARY KEY,
  code        text,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_guild_member_count_filter_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_guild_member_count_filter_master;
CREATE POLICY "Public Read" ON public.inagle_cross_guild_member_count_filter_master FOR SELECT TO public USING (true);

-- GuildMissionGroupMaster  (LGAマスター - ミッショングループ - ギルド.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_guild_mission_group_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_guild_mission_group_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_guild_mission_group_master;
CREATE POLICY "Public Read" ON public.inagle_cross_guild_mission_group_master FOR SELECT TO public USING (true);

-- GuildMissionMaster  (LGAマスター - ミッション - ギルド.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_guild_mission_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_guild_mission_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_guild_mission_master;
CREATE POLICY "Public Read" ON public.inagle_cross_guild_mission_master FOR SELECT TO public USING (true);

-- GuildRankAcquisitionMaster  (LGAマスター - ギルド - ランクボーナス.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_guild_rank_acquisition_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_guild_rank_acquisition_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_guild_rank_acquisition_master;
CREATE POLICY "Public Read" ON public.inagle_cross_guild_rank_acquisition_master FOR SELECT TO public USING (true);

-- GuildRankMaster  (LGAマスター - ギルド - ランク.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_guild_rank_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_guild_rank_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_guild_rank_master;
CREATE POLICY "Public Read" ON public.inagle_cross_guild_rank_master FOR SELECT TO public USING (true);

-- GuildResourceMaster  (LGAマスター - ギルド - 共有リソース.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_guild_resource_master (
  id          text PRIMARY KEY,
  code        integer,
  type        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_guild_resource_master_type_idx ON public.inagle_cross_guild_resource_master (type);
ALTER TABLE public.inagle_cross_guild_resource_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_guild_resource_master;
CREATE POLICY "Public Read" ON public.inagle_cross_guild_resource_master FOR SELECT TO public USING (true);

-- GuildWeeklyContributionRewardMaster  (LGAマスター - ギルド - 週間貢献度報酬.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_guild_weekly_contribution_reward_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_guild_weekly_contribution_reward_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_guild_weekly_contribution_reward_master;
CREATE POLICY "Public Read" ON public.inagle_cross_guild_weekly_contribution_reward_master FOR SELECT TO public USING (true);

-- HonoraryTitleItemMaster  (LGAマスター - アイテム - 称号.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_honorary_title_item_master (
  id          text PRIMARY KEY,
  code        integer,
  grade       integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_honorary_title_item_master_grade_idx ON public.inagle_cross_honorary_title_item_master (grade);
ALTER TABLE public.inagle_cross_honorary_title_item_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_honorary_title_item_master;
CREATE POLICY "Public Read" ON public.inagle_cross_honorary_title_item_master FOR SELECT TO public USING (true);

-- InAppLinkProductMaster  (LGAマスター - ストア - 内部決済商品.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_in_app_link_product_master (
  id          text PRIMARY KEY,
  code        integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_in_app_link_product_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_in_app_link_product_master;
CREATE POLICY "Public Read" ON public.inagle_cross_in_app_link_product_master FOR SELECT TO public USING (true);

-- InalinkGroupMaster  (LGAマスター - イナリンクグループ.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_inalink_group_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_inalink_group_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_inalink_group_master;
CREATE POLICY "Public Read" ON public.inagle_cross_inalink_group_master FOR SELECT TO public USING (true);

-- InitialFormationMaster  (LGAマスター - 初期フォーメーション.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_initial_formation_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_initial_formation_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_initial_formation_master;
CREATE POLICY "Public Read" ON public.inagle_cross_initial_formation_master FOR SELECT TO public USING (true);

-- InstructionNavigationMaster  (LGAマスター - 説明ナビゲーション.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_instruction_navigation_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_instruction_navigation_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_instruction_navigation_master;
CREATE POLICY "Public Read" ON public.inagle_cross_instruction_navigation_master FOR SELECT TO public USING (true);

-- InvitationRewardMaster  (LGAマスター - 招待報酬.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_invitation_reward_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_invitation_reward_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_invitation_reward_master;
CREATE POLICY "Public Read" ON public.inagle_cross_invitation_reward_master FOR SELECT TO public USING (true);

-- ItemAcquisitionMaster  (LGAマスター - アイテム - 入手先.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_item_acquisition_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_item_acquisition_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_item_acquisition_master;
CREATE POLICY "Public Read" ON public.inagle_cross_item_acquisition_master FOR SELECT TO public USING (true);

-- L5iDPointStatusRewardMaster  (LGAマスター - L5iD - ステータス特典.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_l5i_d_point_status_reward_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_l5i_d_point_status_reward_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_l5i_d_point_status_reward_master;
CREATE POLICY "Public Read" ON public.inagle_cross_l5i_d_point_status_reward_master FOR SELECT TO public USING (true);

-- LoginBonusMaster  (LGAマスター - ログインボーナス.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_login_bonus_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_login_bonus_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_login_bonus_master;
CREATE POLICY "Public Read" ON public.inagle_cross_login_bonus_master FOR SELECT TO public USING (true);

-- LoginBonusRewardMaster  (LGAマスター - ログインボーナス報酬.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_login_bonus_reward_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_login_bonus_reward_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_login_bonus_reward_master;
CREATE POLICY "Public Read" ON public.inagle_cross_login_bonus_reward_master FOR SELECT TO public USING (true);

-- LotteryDropTableMaster  (LGAマスター - ドロップテーブル(抽選).tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_lottery_drop_table_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_lottery_drop_table_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_lottery_drop_table_master;
CREATE POLICY "Public Read" ON public.inagle_cross_lottery_drop_table_master FOR SELECT TO public USING (true);

-- MVPTitleMaster  (LGAマスター - MVP称号.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_m_v_p_title_master (
  id          text PRIMARY KEY,
  position    integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_m_v_p_title_master_position_idx ON public.inagle_cross_m_v_p_title_master (position);
ALTER TABLE public.inagle_cross_m_v_p_title_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_m_v_p_title_master;
CREATE POLICY "Public Read" ON public.inagle_cross_m_v_p_title_master FOR SELECT TO public USING (true);

-- MainStoryAreaMaster  (LGAマスター - メインストーリーエリア.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_main_story_area_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_main_story_area_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_main_story_area_master;
CREATE POLICY "Public Read" ON public.inagle_cross_main_story_area_master FOR SELECT TO public USING (true);

-- MainStoryChapterMaster  (LGAマスター - メインストーリーチャプター.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_main_story_chapter_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_main_story_chapter_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_main_story_chapter_master;
CREATE POLICY "Public Read" ON public.inagle_cross_main_story_chapter_master FOR SELECT TO public USING (true);

-- MainStoryStageMaster  (LGAマスター - メインストーリーステージ.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_main_story_stage_master (
  id          text PRIMARY KEY,
  code        integer,
  type        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_main_story_stage_master_type_idx ON public.inagle_cross_main_story_stage_master (type);
ALTER TABLE public.inagle_cross_main_story_stage_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_main_story_stage_master;
CREATE POLICY "Public Read" ON public.inagle_cross_main_story_stage_master FOR SELECT TO public USING (true);

-- ManagerCommentMaster  (LGAマスター - マネージャーコメント.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_manager_comment_master (
  id          text PRIMARY KEY,
  position    integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_manager_comment_master_position_idx ON public.inagle_cross_manager_comment_master (position);
ALTER TABLE public.inagle_cross_manager_comment_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_manager_comment_master;
CREATE POLICY "Public Read" ON public.inagle_cross_manager_comment_master FOR SELECT TO public USING (true);

-- MissionGroupMaster  (LGAマスター - ミッショングループ.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_mission_group_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_mission_group_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_mission_group_master;
CREATE POLICY "Public Read" ON public.inagle_cross_mission_group_master FOR SELECT TO public USING (true);

-- MissionMaster  (LGAマスター - ミッション.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_mission_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_mission_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_mission_master;
CREATE POLICY "Public Read" ON public.inagle_cross_mission_master FOR SELECT TO public USING (true);

-- MissionPointMaster  (LGAマスター - ミッションポイント.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_mission_point_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_mission_point_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_mission_point_master;
CREATE POLICY "Public Read" ON public.inagle_cross_mission_point_master FOR SELECT TO public USING (true);

-- MissionPointRewardMaster  (LGAマスター - ミッションポイント - 進捗報酬.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_mission_point_reward_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_mission_point_reward_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_mission_point_reward_master;
CREATE POLICY "Public Read" ON public.inagle_cross_mission_point_reward_master FOR SELECT TO public USING (true);

-- ModifierPassiveItemMaster  (LGAマスター - アイテム - 鍛錬素材.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_modifier_passive_item_master (
  id          text PRIMARY KEY,
  code        integer,
  grade       integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_modifier_passive_item_master_grade_idx ON public.inagle_cross_modifier_passive_item_master (grade);
ALTER TABLE public.inagle_cross_modifier_passive_item_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_modifier_passive_item_master;
CREATE POLICY "Public Read" ON public.inagle_cross_modifier_passive_item_master FOR SELECT TO public USING (true);

-- ModifierPassiveLotteryTableMaster  (LGAマスター - 鍛錬抽選テーブル.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_modifier_passive_lottery_table_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_modifier_passive_lottery_table_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_modifier_passive_lottery_table_master;
CREATE POLICY "Public Read" ON public.inagle_cross_modifier_passive_lottery_table_master FOR SELECT TO public USING (true);

-- OfferMaster  (LGAマスター - ストア - オファー.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_offer_master (
  id          text PRIMARY KEY,
  code        integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_offer_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_offer_master;
CREATE POLICY "Public Read" ON public.inagle_cross_offer_master FOR SELECT TO public USING (true);

-- OfferMissionGroupMaster  (LGAマスター - ミッショングループ - オファー.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_offer_mission_group_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_offer_mission_group_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_offer_mission_group_master;
CREATE POLICY "Public Read" ON public.inagle_cross_offer_mission_group_master FOR SELECT TO public USING (true);

-- OfferMissionMaster  (LGAマスター - ミッション - オファー.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_offer_mission_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_offer_mission_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_offer_mission_master;
CREATE POLICY "Public Read" ON public.inagle_cross_offer_mission_master FOR SELECT TO public USING (true);

-- OfferStepMaster  (LGAマスター - ストア - オファーステップ.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_offer_step_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_offer_step_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_offer_step_master;
CREATE POLICY "Public Read" ON public.inagle_cross_offer_step_master FOR SELECT TO public USING (true);

-- OperationListMaster  (LGAマスター - AI命令リスト.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_operation_list_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_operation_list_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_operation_list_master;
CREATE POLICY "Public Read" ON public.inagle_cross_operation_list_master FOR SELECT TO public USING (true);

-- OperationProfileMaster  (LGAマスター - AI命令セット.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_operation_profile_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_operation_profile_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_operation_profile_master;
CREATE POLICY "Public Read" ON public.inagle_cross_operation_profile_master FOR SELECT TO public USING (true);

-- ParameterMaster  (LGAマスター - パラメータ.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_parameter_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_parameter_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_parameter_master;
CREATE POLICY "Public Read" ON public.inagle_cross_parameter_master FOR SELECT TO public USING (true);

-- PassiveMaster  (LGAマスター - パッシブ.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_passive_master (
  id          text PRIMARY KEY,
  code        integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_passive_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_passive_master;
CREATE POLICY "Public Read" ON public.inagle_cross_passive_master FOR SELECT TO public USING (true);

-- PassiveTotalPowerAdditionMaster  (LGAマスター - パッシブ総合能力加算値.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_passive_total_power_addition_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_passive_total_power_addition_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_passive_total_power_addition_master;
CREATE POLICY "Public Read" ON public.inagle_cross_passive_total_power_addition_master FOR SELECT TO public USING (true);

-- PassiveTriggerMaster  (LGAマスター - パッシブトリガー.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_passive_trigger_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_passive_trigger_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_passive_trigger_master;
CREATE POLICY "Public Read" ON public.inagle_cross_passive_trigger_master FOR SELECT TO public USING (true);

-- PlaywrightBookMaster  (LGAマスター - 試合脚本.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_playwright_book_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_playwright_book_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_playwright_book_master;
CREATE POLICY "Public Read" ON public.inagle_cross_playwright_book_master FOR SELECT TO public USING (true);

-- PreferredAreaRankMaster  (LGAマスター - 得意エリアランク.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_preferred_area_rank_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_preferred_area_rank_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_preferred_area_rank_master;
CREATE POLICY "Public Read" ON public.inagle_cross_preferred_area_rank_master FOR SELECT TO public USING (true);

-- ProfileIconItemMaster  (LGAマスター - アイテム - プロフィールアイコン.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_profile_icon_item_master (
  id          text PRIMARY KEY,
  code        integer,
  grade       integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_profile_icon_item_master_grade_idx ON public.inagle_cross_profile_icon_item_master (grade);
ALTER TABLE public.inagle_cross_profile_icon_item_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_profile_icon_item_master;
CREATE POLICY "Public Read" ON public.inagle_cross_profile_icon_item_master FOR SELECT TO public USING (true);

-- PvPMatchingSlotMaster  (LGAマスター - PvPマッチング枠.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_pv_p_matching_slot_master (
  id          text PRIMARY KEY,
  code        integer,
  slot        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_pv_p_matching_slot_master_slot_idx ON public.inagle_cross_pv_p_matching_slot_master (slot);
ALTER TABLE public.inagle_cross_pv_p_matching_slot_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_pv_p_matching_slot_master;
CREATE POLICY "Public Read" ON public.inagle_cross_pv_p_matching_slot_master FOR SELECT TO public USING (true);

-- PvPNpcTeamMaster  (LGAマスター - PvPNPCチーム.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_pv_p_npc_team_master (
  id          text PRIMARY KEY,
  code        integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_pv_p_npc_team_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_pv_p_npc_team_master;
CREATE POLICY "Public Read" ON public.inagle_cross_pv_p_npc_team_master FOR SELECT TO public USING (true);

-- PvpPlacementMaster  (LGAマスター - PvP振り分け戦.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_pvp_placement_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_pvp_placement_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_pvp_placement_master;
CREATE POLICY "Public Read" ON public.inagle_cross_pvp_placement_master FOR SELECT TO public USING (true);

-- PvpRankMaster  (LGAマスター - PvP階級.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_pvp_rank_master (
  id          text PRIMARY KEY,
  code        integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_pvp_rank_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_pvp_rank_master;
CREATE POLICY "Public Read" ON public.inagle_cross_pvp_rank_master FOR SELECT TO public USING (true);

-- PvpSeasonMaster  (LGAマスター - PvPシーズン.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_pvp_season_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_pvp_season_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_pvp_season_master;
CREATE POLICY "Public Read" ON public.inagle_cross_pvp_season_master FOR SELECT TO public USING (true);

-- PvpSeasonRankingRewardMaster  (LGAマスター - PvPシーズンランキング報酬.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_pvp_season_ranking_reward_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_pvp_season_ranking_reward_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_pvp_season_ranking_reward_master;
CREATE POLICY "Public Read" ON public.inagle_cross_pvp_season_ranking_reward_master FOR SELECT TO public USING (true);

-- RaidCycleMaster  (LGAマスター - 試練サイクル.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_raid_cycle_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_raid_cycle_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_raid_cycle_master;
CREATE POLICY "Public Read" ON public.inagle_cross_raid_cycle_master FOR SELECT TO public USING (true);

-- RaidDifficultyMaster  (LGAマスター - 試練難易度.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_raid_difficulty_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_raid_difficulty_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_raid_difficulty_master;
CREATE POLICY "Public Read" ON public.inagle_cross_raid_difficulty_master FOR SELECT TO public USING (true);

-- RaidGroupMaster  (LGAマスター - 試練グループ.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_raid_group_master (
  id          text PRIMARY KEY,
  code        integer,
  type        integer,
  element     integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_raid_group_master_type_idx ON public.inagle_cross_raid_group_master (type);
CREATE INDEX IF NOT EXISTS inagle_cross_raid_group_master_element_idx ON public.inagle_cross_raid_group_master (element);
ALTER TABLE public.inagle_cross_raid_group_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_raid_group_master;
CREATE POLICY "Public Read" ON public.inagle_cross_raid_group_master FOR SELECT TO public USING (true);

-- RaidMaster  (LGAマスター - 試練.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_raid_master (
  id          text PRIMARY KEY,
  code        integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_raid_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_raid_master;
CREATE POLICY "Public Read" ON public.inagle_cross_raid_master FOR SELECT TO public USING (true);

-- RaidRankingRewardMaster  (LGAマスター - 試練ランキング報酬テーブル.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_raid_ranking_reward_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_raid_ranking_reward_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_raid_ranking_reward_master;
CREATE POLICY "Public Read" ON public.inagle_cross_raid_ranking_reward_master FOR SELECT TO public USING (true);

-- RaidScoreRewardMaster  (LGAマスター - 試練スコア報酬テーブル.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_raid_score_reward_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_raid_score_reward_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_raid_score_reward_master;
CREATE POLICY "Public Read" ON public.inagle_cross_raid_score_reward_master FOR SELECT TO public USING (true);

-- RandomEquipmentBoxMaster  (LGAマスター - アイテム - ランダム装備ボックス.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_random_equipment_box_master (
  id          text PRIMARY KEY,
  code        integer,
  grade       integer,
  name_key    text,
  position    integer,
  slot        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_random_equipment_box_master_grade_idx ON public.inagle_cross_random_equipment_box_master (grade);
CREATE INDEX IF NOT EXISTS inagle_cross_random_equipment_box_master_position_idx ON public.inagle_cross_random_equipment_box_master (position);
CREATE INDEX IF NOT EXISTS inagle_cross_random_equipment_box_master_slot_idx ON public.inagle_cross_random_equipment_box_master (slot);
ALTER TABLE public.inagle_cross_random_equipment_box_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_random_equipment_box_master;
CREATE POLICY "Public Read" ON public.inagle_cross_random_equipment_box_master FOR SELECT TO public USING (true);

-- ShapeModelVariationMaster  (LGAマスター - 体型着こなし.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_shape_model_variation_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_shape_model_variation_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_shape_model_variation_master;
CREATE POLICY "Public Read" ON public.inagle_cross_shape_model_variation_master FOR SELECT TO public USING (true);

-- ShopCategoryMaster  (LGAマスター - ショップカテゴリー.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_shop_category_master (
  id          text PRIMARY KEY,
  code        integer,
  name_key    text,
  type        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_shop_category_master_type_idx ON public.inagle_cross_shop_category_master (type);
ALTER TABLE public.inagle_cross_shop_category_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_shop_category_master;
CREATE POLICY "Public Read" ON public.inagle_cross_shop_category_master FOR SELECT TO public USING (true);

-- ShopItemMaster  (LGAマスター - ショップ.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_shop_item_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_shop_item_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_shop_item_master;
CREATE POLICY "Public Read" ON public.inagle_cross_shop_item_master FOR SELECT TO public USING (true);

-- SkitMaster  (LGAマスター - スキット.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_skit_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_skit_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_skit_master;
CREATE POLICY "Public Read" ON public.inagle_cross_skit_master FOR SELECT TO public USING (true);

-- SpecialMoveLevelUpMaterialItemMaster  (LGAマスター - アイテム - 必殺技強化素材.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_special_move_level_up_material_item_master (
  id          text PRIMARY KEY,
  code        integer,
  grade       integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_special_move_level_up_material_item_master_grade_idx ON public.inagle_cross_special_move_level_up_material_item_master (grade);
ALTER TABLE public.inagle_cross_special_move_level_up_material_item_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_special_move_level_up_material_item_master;
CREATE POLICY "Public Read" ON public.inagle_cross_special_move_level_up_material_item_master FOR SELECT TO public USING (true);

-- SpecialMoveLevelUpRecipeMasterData  (LGAマスター - 必殺技 - 強化素材消費量.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_special_move_level_up_recipe_master_data (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_special_move_level_up_recipe_master_data ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_special_move_level_up_recipe_master_data;
CREATE POLICY "Public Read" ON public.inagle_cross_special_move_level_up_recipe_master_data FOR SELECT TO public USING (true);

-- SpecialMoveManualMaster  (LGAマスター - アイテム - 秘伝書.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_special_move_manual_master (
  id          text PRIMARY KEY,
  code        integer,
  grade       integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_special_move_manual_master_grade_idx ON public.inagle_cross_special_move_manual_master (grade);
ALTER TABLE public.inagle_cross_special_move_manual_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_special_move_manual_master;
CREATE POLICY "Public Read" ON public.inagle_cross_special_move_manual_master FOR SELECT TO public USING (true);

-- SpecialMoveMaster  (LGAマスター - 必殺技.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_special_move_master (
  id          text PRIMARY KEY,
  code        integer,
  type        integer,
  element     integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_special_move_master_type_idx ON public.inagle_cross_special_move_master (type);
CREATE INDEX IF NOT EXISTS inagle_cross_special_move_master_element_idx ON public.inagle_cross_special_move_master (element);
ALTER TABLE public.inagle_cross_special_move_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_special_move_master;
CREATE POLICY "Public Read" ON public.inagle_cross_special_move_master FOR SELECT TO public USING (true);

-- SpecialMoveTotalPowerAdditionMaster  (LGAマスター - 必殺技総合能力加算値.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_special_move_total_power_addition_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_special_move_total_power_addition_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_special_move_total_power_addition_master;
CREATE POLICY "Public Read" ON public.inagle_cross_special_move_total_power_addition_master FOR SELECT TO public USING (true);

-- StaffModelSetMaster  (LGAマスター - その他キャラクターモデル.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_staff_model_set_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_staff_model_set_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_staff_model_set_master;
CREATE POLICY "Public Read" ON public.inagle_cross_staff_model_set_master FOR SELECT TO public USING (true);

-- StatusEffectConditionMaster  (LGAマスター - 状態効果条件.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_status_effect_condition_master (
  id          text PRIMARY KEY,
  code        integer,
  type        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_status_effect_condition_master_type_idx ON public.inagle_cross_status_effect_condition_master (type);
ALTER TABLE public.inagle_cross_status_effect_condition_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_status_effect_condition_master;
CREATE POLICY "Public Read" ON public.inagle_cross_status_effect_condition_master FOR SELECT TO public USING (true);

-- StatusEffectGroupMaster  (LGAマスター - 状態効果グループ.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_status_effect_group_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_status_effect_group_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_status_effect_group_master;
CREATE POLICY "Public Read" ON public.inagle_cross_status_effect_group_master FOR SELECT TO public USING (true);

-- StatusEffectGrowthTableMaster  (LGAマスター - 状態効果成長テーブル.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_status_effect_growth_table_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_status_effect_growth_table_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_status_effect_growth_table_master;
CREATE POLICY "Public Read" ON public.inagle_cross_status_effect_growth_table_master FOR SELECT TO public USING (true);

-- StatusEffectMaster  (LGAマスター - 状態効果.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_status_effect_master (
  id          text PRIMARY KEY,
  code        integer,
  type        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_status_effect_master_type_idx ON public.inagle_cross_status_effect_master (type);
ALTER TABLE public.inagle_cross_status_effect_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_status_effect_master;
CREATE POLICY "Public Read" ON public.inagle_cross_status_effect_master FOR SELECT TO public USING (true);

-- StoreCategoryMaster  (LGAマスター - ストア - カテゴリー.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_store_category_master (
  id          text PRIMARY KEY,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_store_category_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_store_category_master;
CREATE POLICY "Public Read" ON public.inagle_cross_store_category_master FOR SELECT TO public USING (true);

-- StoreExchangeProductMaster  (LGAマスター - ストア - 交換商品.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_store_exchange_product_master (
  id          text PRIMARY KEY,
  code        integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_store_exchange_product_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_store_exchange_product_master;
CREATE POLICY "Public Read" ON public.inagle_cross_store_exchange_product_master FOR SELECT TO public USING (true);

-- StoreItemTableMaster  (LGAマスター - ストア - アイテムテーブル.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_store_item_table_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_store_item_table_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_store_item_table_master;
CREATE POLICY "Public Read" ON public.inagle_cross_store_item_table_master FOR SELECT TO public USING (true);

-- TeamUniformItemMaster  (LGAマスター - アイテム - チームユニフォーム.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_team_uniform_item_master (
  id          text PRIMARY KEY,
  code        integer,
  grade       integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_team_uniform_item_master_grade_idx ON public.inagle_cross_team_uniform_item_master (grade);
ALTER TABLE public.inagle_cross_team_uniform_item_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_team_uniform_item_master;
CREATE POLICY "Public Read" ON public.inagle_cross_team_uniform_item_master FOR SELECT TO public USING (true);

-- TokenItemMaster  (LGAマスター - アイテム - トークン.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_token_item_master (
  id          text PRIMARY KEY,
  code        integer,
  grade       integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_token_item_master_grade_idx ON public.inagle_cross_token_item_master (grade);
ALTER TABLE public.inagle_cross_token_item_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_token_item_master;
CREATE POLICY "Public Read" ON public.inagle_cross_token_item_master FOR SELECT TO public USING (true);

-- TrainingShowcaseMaster  (LGAマスター - 部活演出.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_training_showcase_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_training_showcase_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_training_showcase_master;
CREATE POLICY "Public Read" ON public.inagle_cross_training_showcase_master FOR SELECT TO public USING (true);

-- TrainingStageMaster  (LGAマスター - 部活ステージ.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_training_stage_master (
  id          text PRIMARY KEY,
  code        integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_training_stage_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_training_stage_master;
CREATE POLICY "Public Read" ON public.inagle_cross_training_stage_master FOR SELECT TO public USING (true);

-- VirtualCurrencyItemMaster  (LGAマスター - アイテム - 通貨.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_virtual_currency_item_master (
  id          text PRIMARY KEY,
  code        integer,
  grade       integer,
  name_key    text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inagle_cross_virtual_currency_item_master_grade_idx ON public.inagle_cross_virtual_currency_item_master (grade);
ALTER TABLE public.inagle_cross_virtual_currency_item_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_virtual_currency_item_master;
CREATE POLICY "Public Read" ON public.inagle_cross_virtual_currency_item_master FOR SELECT TO public USING (true);

-- WorldGroupMaster  (LGAマスター - ワールドグループ.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_world_group_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_world_group_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_world_group_master;
CREATE POLICY "Public Read" ON public.inagle_cross_world_group_master FOR SELECT TO public USING (true);

-- WorldMergeHistoryMaster  (LGAマスター - ワールド統合履歴.tsv)
CREATE TABLE IF NOT EXISTS public.inagle_cross_world_merge_history_master (
  id          text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inagle_cross_world_merge_history_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read" ON public.inagle_cross_world_merge_history_master;
CREATE POLICY "Public Read" ON public.inagle_cross_world_merge_history_master FOR SELECT TO public USING (true);
