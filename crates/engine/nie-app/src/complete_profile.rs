//! Complete-profile application model shared by delivery hosts.
//!
//! Every collection is derived from the typed VFS readers in [`crate::game_data`]. The profile
//! intentionally reports story, chronicle and extend with the same phase-grouped quest list:
//! [`game_data::QuestDto`] does not expose a measured field that separates those modes.

use std::collections::BTreeSet;

use nie_formats::vfs::Vfs;
use serde::Serialize;

use crate::game_data;

/// A finished character whose level, skills and board state are ready for presentation.
#[derive(Serialize)]
pub struct CompleteCharaDto {
    pub id: String,
    pub name: String,
    pub level: u8,
    pub stats: game_data::StatBlockDto,
    pub skills: Vec<String>,
    pub board_complete: bool,
}

/// An unlocked collection whose identifier list is the source of both counts.
#[derive(Debug, Serialize)]
pub struct UnlockedCollectionDto {
    pub total: usize,
    pub unlocked: usize,
    pub ids: Vec<String>,
}

impl UnlockedCollectionDto {
    fn from_ids(ids: Vec<String>) -> Self {
        Self {
            total: ids.len(),
            unlocked: ids.len(),
            ids,
        }
    }
}

/// A shop with every listed item in stock.
#[derive(Debug, Serialize)]
pub struct CompleteShopDto {
    pub shop_id: String,
    pub name: Option<String>,
    pub items: Vec<CompleteShopItemDto>,
}

#[derive(Debug, Serialize)]
pub struct CompleteShopItemDto {
    pub name: String,
    pub in_stock: bool,
}

/// Quests grouped by their measured phase value.
#[derive(Clone, Debug, Serialize)]
pub struct ClearedChapterDto {
    pub phase: i64,
    pub cleared: bool,
    pub quest_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ClearedModeDto {
    pub cleared: bool,
    pub chapters: Vec<ClearedChapterDto>,
}

/// A players-universe team represented as complete because no per-member roster is exposed.
#[derive(Debug, Serialize)]
pub struct ConstellationDto {
    pub team_id: String,
    pub name: Option<String>,
    pub complete: bool,
}

/// The portable payload delivered by `/api/v1/profile/complete`.
#[derive(Serialize)]
pub struct CompleteProfileDto {
    pub charas: Vec<CompleteCharaDto>,
    pub trophies: UnlockedCollectionDto,
    pub shops: Vec<CompleteShopDto>,
    pub story: ClearedModeDto,
    pub chronicle: ClearedModeDto,
    pub extend: ClearedModeDto,
    pub formations: UnlockedCollectionDto,
    pub uniforms: UnlockedCollectionDto,
    pub emblems: UnlockedCollectionDto,
    pub special_tactics: UnlockedCollectionDto,
    pub gallery: UnlockedCollectionDto,
    pub movies: UnlockedCollectionDto,
    pub musics: UnlockedCollectionDto,
    pub constellations: Vec<ConstellationDto>,
}

struct ProfileSources {
    charas: Vec<game_data::CharaDto>,
    trophies: Vec<game_data::TrophyDto>,
    shops: Vec<game_data::ShopDto>,
    quests: Vec<game_data::QuestDto>,
    formations: Vec<game_data::FormationDto>,
    uniforms: Vec<game_data::UniformDto>,
    emblems: Vec<game_data::EmblemDto>,
    special_tactics: Vec<game_data::SpecialTacticsDto>,
    gallery: Vec<game_data::GalleryDto>,
    movies: Vec<game_data::MovieDto>,
    musics: Vec<game_data::MusicDto>,
    belong_teams: Vec<game_data::BelongTeamDto>,
}

impl ProfileSources {
    fn load(vfs: &Vfs) -> Result<Self, String> {
        Ok(Self {
            charas: game_data::list_charas(vfs)?,
            trophies: game_data::list_trophies(vfs)?,
            shops: game_data::list_shops(vfs)?,
            quests: game_data::list_quests(vfs)?,
            formations: game_data::list_formations(vfs)?,
            uniforms: game_data::list_uniforms(vfs)?,
            emblems: game_data::list_emblems(vfs)?,
            special_tactics: game_data::list_special_tactics(vfs)?,
            gallery: game_data::list_gallery(vfs)?,
            movies: game_data::list_movies(vfs)?,
            musics: game_data::list_musics(vfs)?,
            belong_teams: game_data::list_belong_teams(vfs)?,
        })
    }
}

fn cleared_mode_from_quests(quests: &[game_data::QuestDto]) -> ClearedModeDto {
    let chapters = quests
        .iter()
        .map(|quest| quest.phase as i64)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .map(|phase| ClearedChapterDto {
            phase,
            cleared: true,
            quest_ids: quests
                .iter()
                .filter(|quest| quest.phase as i64 == phase)
                .map(|quest| quest.quest_id.clone())
                .collect(),
        })
        .collect();
    ClearedModeDto {
        cleared: true,
        chapters,
    }
}

fn build_from_sources(sources: ProfileSources) -> CompleteProfileDto {
    let mode = cleared_mode_from_quests(&sources.quests);
    CompleteProfileDto {
        charas: sources
            .charas
            .into_iter()
            .map(|chara| CompleteCharaDto {
                id: chara.chara_param_id,
                name: chara.name,
                level: 99,
                stats: chara.stats,
                skills: chara.skills,
                board_complete: true,
            })
            .collect(),
        trophies: UnlockedCollectionDto::from_ids(
            sources
                .trophies
                .into_iter()
                .map(|trophy| trophy.trophy_id)
                .collect(),
        ),
        shops: sources
            .shops
            .into_iter()
            .map(|shop| CompleteShopDto {
                shop_id: shop.shop_id,
                name: shop.name,
                items: shop
                    .items
                    .into_iter()
                    .map(|name| CompleteShopItemDto {
                        name,
                        in_stock: true,
                    })
                    .collect(),
            })
            .collect(),
        story: mode.clone(),
        chronicle: mode.clone(),
        extend: mode,
        formations: UnlockedCollectionDto::from_ids(
            sources
                .formations
                .into_iter()
                .map(|formation| formation.form_id)
                .collect(),
        ),
        uniforms: UnlockedCollectionDto::from_ids(
            sources
                .uniforms
                .into_iter()
                .map(|uniform| uniform.name_id)
                .collect(),
        ),
        emblems: UnlockedCollectionDto::from_ids(
            sources
                .emblems
                .into_iter()
                .map(|emblem| emblem.emblem_id)
                .collect(),
        ),
        special_tactics: UnlockedCollectionDto::from_ids(
            sources
                .special_tactics
                .into_iter()
                .map(|tactic| tactic.tactics_id)
                .collect(),
        ),
        gallery: UnlockedCollectionDto::from_ids(
            sources
                .gallery
                .into_iter()
                .map(|entry| entry.gallery_id)
                .collect(),
        ),
        movies: UnlockedCollectionDto::from_ids(
            sources
                .movies
                .into_iter()
                .map(|movie| movie.movie_id)
                .collect(),
        ),
        musics: UnlockedCollectionDto::from_ids(
            sources
                .musics
                .into_iter()
                .map(|music| music.entry_id)
                .collect(),
        ),
        constellations: sources
            .belong_teams
            .into_iter()
            .map(|team| ConstellationDto {
                team_id: team.team_id,
                name: team.name,
                complete: true,
            })
            .collect(),
    }
}

/// Build a complete profile from the mounted VFS. This performs blocking cfg.bin reads and must
/// be called from a host's blocking worker.
pub fn build_complete_profile(vfs: &Vfs) -> Result<CompleteProfileDto, String> {
    Ok(build_from_sources(ProfileSources::load(vfs)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stats() -> game_data::StatBlockDto {
        game_data::StatBlockDto {
            kc: 1,
            cr: 1,
            tc: 1,
            pr: 1,
            ps: 1,
            ag: 1,
            it: 1,
            total: 7,
        }
    }

    #[test]
    fn builds_the_documented_shape_from_typed_sources() {
        let profile = build_from_sources(ProfileSources {
            charas: vec![game_data::CharaDto {
                chara_param_id: "c01000010".into(),
                chara_base_id: "base-1".into(),
                internal_code: "c01000010".into(),
                name: "Mark Evans".into(),
                description: None,
                gender: 1.0,
                element: "Earth".into(),
                main_position: "GK".into(),
                sub_position: "—".into(),
                growth_pattern: 0.0,
                series: None,
                team: None,
                skills: vec!["1 — Fire Tornado".into()],
                skill_count: 1.0,
                stats: stats(),
            }],
            trophies: vec![game_data::TrophyDto {
                trophy_id: "t1".into(),
                code: "trophy-1".into(),
                category: 0.0,
                name: "Winner".into(),
                description: None,
                unlock_kind: "always".into(),
                story_episode: None,
            }],
            shops: vec![game_data::ShopDto {
                shop_id: "s1".into(),
                name: Some("Shop".into()),
                item_count: 1,
                items: vec!["Ball".into()],
            }],
            quests: vec![
                game_data::QuestDto {
                    quest_id: "q1".into(),
                    phase: 0.0,
                    quest_type: 1.0,
                    title: "First".into(),
                    image: None,
                },
                game_data::QuestDto {
                    quest_id: "q2".into(),
                    phase: 0.0,
                    quest_type: 2.0,
                    title: "Second".into(),
                    image: None,
                },
                game_data::QuestDto {
                    quest_id: "q3".into(),
                    phase: 1.0,
                    quest_type: 1.0,
                    title: "Third".into(),
                    image: None,
                },
            ],
            formations: vec![],
            uniforms: vec![],
            emblems: vec![],
            special_tactics: vec![],
            gallery: vec![],
            movies: vec![],
            musics: vec![],
            belong_teams: vec![game_data::BelongTeamDto {
                team_id: "team1".into(),
                name: Some("Raimon".into()),
                binder_order: 1.0,
                seasons: vec![],
                emblem_id_v: "emblem".into(),
                kit_id_v: "kit".into(),
            }],
        });

        let value = serde_json::to_value(profile).expect("complete profile serializes");
        assert_eq!(value["charas"][0]["level"], 99);
        assert_eq!(value["charas"][0]["board_complete"], true);
        assert_eq!(value["trophies"]["ids"][0], "t1");
        assert_eq!(value["trophies"]["unlocked"], value["trophies"]["total"]);
        assert_eq!(value["shops"][0]["items"][0]["in_stock"], true);
        assert_eq!(value["story"], value["chronicle"]);
        assert_eq!(value["chronicle"], value["extend"]);
        assert_eq!(
            value["story"]["chapters"][0]["quest_ids"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(value["story"]["chapters"][1]["quest_ids"][0], "q3");
        assert_eq!(value["constellations"][0]["complete"], true);
    }

    #[test]
    fn quest_phases_are_sorted_and_empty_collections_stay_complete() {
        let mode = cleared_mode_from_quests(&[
            game_data::QuestDto {
                quest_id: "later".into(),
                phase: 3.0,
                quest_type: 1.0,
                title: String::new(),
                image: None,
            },
            game_data::QuestDto {
                quest_id: "first".into(),
                phase: 1.0,
                quest_type: 1.0,
                title: String::new(),
                image: None,
            },
        ]);
        assert_eq!(mode.chapters[0].phase, 1);
        assert_eq!(mode.chapters[1].phase, 3);

        let collection = UnlockedCollectionDto::from_ids(Vec::new());
        assert_eq!(collection.total, 0);
        assert_eq!(collection.unlocked, 0);
        assert!(collection.ids.is_empty());
    }
}
