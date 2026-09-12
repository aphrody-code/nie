//! `GET /api/v1/profile/complete` — the save-like state every game screen reads, per
//! `docs/GAME-SCREENS-PLAN.md` ("The completed profile"): level 99, 100 % achievements,
//! story/chronicle/extend cleared, shops fully stocked, gallery/movies/musics unlocked,
//! constellations complete. A pure function of the mounted VFS, computed once and cached for
//! the life of the process (the VFS content never changes while `nie-site` runs) plus an
//! HTTP `Cache-Control` for any intermediary.
//!
//! # What is derived, and from what
//!
//! | Field | Source | Note |
//! |---|---|---|
//! | `charas` | `game_data::list_charas` | already carries `stats` computed at level 99, UR rarity, cf. `CharaDto::stats` doc — reused rather than recomputed 6000+ times |
//! | `trophies` | `game_data::list_trophies` | `unlocked == total`, everything at 100 % |
//! | `shops` | `game_data::list_shops` | every listed item marked `in_stock: true` |
//! | `story`/`chronicle`/`extend` | `game_data::list_quests` | `QuestDto` has no field naming these three modes (only `quest_type`: Main/Sub/Daily); grouped by `phase` instead and the SAME grouped chapter list is reported under all three keys — documented here as an honest gap, not a guess |
//! | `formations`, `uniforms`, `emblems`, `special_tactics`, `gallery`, `movies`, `musics` | matching `list_*` | `unlocked == total`, `ids` list every identifier |
//! | `constellations` | `game_data::list_belong_teams` | teams as "constellations" (players universe), no member sub-list exists in `BelongTeamDto` — the team roster itself stands for "every member present" |
//!
//! Nothing here re-derives game logic: every number comes from an existing `nie_app::game_data`
//! `list_*`/`calculate_character_stats`, unmodified.

use std::sync::Arc;
use std::time::Instant;

use axum::extract::State;
use axum::http::{HeaderValue, header};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;
use tokio::sync::OnceCell;

use crate::error::ErreurSite;
use crate::state::EtatSite;
use nie_app::game_data;
use nie_formats::vfs::Vfs;

const CACHE_CONTROL: &str = "public, max-age=3600";

/// A finished character: full stats (already at level 99 in `CharaDto::stats`), every skill it
/// can learn, and its ability board marked fully lit — there is no per-node board data exposed
/// by `game_data` today, so `board_complete` is a flat flag, not a list of node ids.
#[derive(Serialize)]
pub struct CompleteCharaDto {
    /// `chara_param_id`, the identity `CharaDto` itself uses (a `chara_base_id` can carry
    /// several `chara_param` variants).
    pub id: String,
    /// `CharaDto::name`.
    pub name: String,
    /// Always `99`: the profile is the finished game.
    pub level: u8,
    /// Computed by `CharaDto` at level 99 already (UR rarity, the comparison baseline
    /// `calculate_character_stats` documents) — not recomputed per character here.
    pub stats: game_data::StatBlockDto,
    /// Every technique this character learns, `"level — name"` strings as `CharaDto::skills`
    /// already resolves them (no separate skill-id list exists on `CharaDto`).
    pub skills: Vec<String>,
    /// Always `true`: every ability-board node is lit.
    pub board_complete: bool,
}

/// An unlocked/counted collection: every id, `unlocked == total` by construction (the profile is
/// a finished game).
#[derive(Debug, Serialize)]
pub struct UnlockedCollectionDto {
    /// Number of ids.
    pub total: usize,
    /// Always equal to `total`: the profile is a finished game.
    pub unlocked: usize,
    /// Every identifier in this collection.
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

/// A shop with every one of its items in stock.
#[derive(Debug, Serialize)]
pub struct CompleteShopDto {
    /// `ShopDto::shop_id`.
    pub shop_id: String,
    /// `ShopDto::name`, when resolved.
    pub name: Option<String>,
    /// Every item the shop sells, all in stock.
    pub items: Vec<CompleteShopItemDto>,
}

/// One item of a [`CompleteShopDto`], always in stock.
#[derive(Debug, Serialize)]
pub struct CompleteShopItemDto {
    /// Resolved item name, cf. `ShopDto::items`.
    pub name: String,
    /// Always `true`: the shop is fully stocked.
    pub in_stock: bool,
}

/// A quest chapter, grouped by `QuestDto::phase` since neither "story", "chronicle" nor "extend"
/// exist as a field on `QuestDto` — cf. module documentation.
#[derive(Debug, Serialize)]
pub struct ClearedChapterDto {
    /// `QuestDto::phase`, truncated (phases are small integers in the game data).
    pub phase: i64,
    /// Always `true`: the profile is a finished game.
    pub cleared: bool,
    /// Every quest of this phase.
    pub quest_ids: Vec<String>,
}

/// A cleared game mode: every chapter (grouped by `phase`, cf. [`ClearedChapterDto`]) marked
/// cleared.
#[derive(Debug, Serialize)]
pub struct ClearedModeDto {
    /// Always `true`: the profile is a finished game.
    pub cleared: bool,
    /// Every chapter of this mode, grouped by `QuestDto::phase`.
    pub chapters: Vec<ClearedChapterDto>,
}

/// A constellation (players-universe team): every listed member present. `BelongTeamDto` has no
/// per-member roster field today, so "every member present" is represented by the team itself
/// being listed whole, not a placeholder list.
#[derive(Debug, Serialize)]
pub struct ConstellationDto {
    /// `BelongTeamDto::team_id`.
    pub team_id: String,
    /// `BelongTeamDto::name`, when resolved.
    pub name: Option<String>,
    /// Always `true`: every listed member present.
    pub complete: bool,
}

/// The full shape of `GET /api/v1/profile/complete`.
#[derive(Serialize)]
pub struct CompleteProfileDto {
    /// Every character owned, level 99, full stats, every skill, board complete.
    pub charas: Vec<CompleteCharaDto>,
    /// Every trophy unlocked.
    pub trophies: UnlockedCollectionDto,
    /// Every shop, every item in stock.
    pub shops: Vec<CompleteShopDto>,
    /// Story mode, every chapter cleared.
    pub story: ClearedModeDto,
    /// Chronicle mode, every chapter cleared.
    pub chronicle: ClearedModeDto,
    /// Extended story, every chapter cleared.
    pub extend: ClearedModeDto,
    /// Every formation unlocked.
    pub formations: UnlockedCollectionDto,
    /// Every uniform unlocked.
    pub uniforms: UnlockedCollectionDto,
    /// Every emblem unlocked.
    pub emblems: UnlockedCollectionDto,
    /// Every special tactic unlocked.
    pub special_tactics: UnlockedCollectionDto,
    /// Every gallery illustration unlocked.
    pub gallery: UnlockedCollectionDto,
    /// Every movie unlocked.
    pub movies: UnlockedCollectionDto,
    /// Every music track unlocked.
    pub musics: UnlockedCollectionDto,
    /// Players-universe teams, every member present.
    pub constellations: Vec<ConstellationDto>,
}

fn cleared_mode_from_quests(quests: &[game_data::QuestDto]) -> ClearedModeDto {
    let mut phases: Vec<i64> = quests
        .iter()
        .map(|q| q.phase as i64)
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    phases.sort_unstable();
    let chapters = phases
        .into_iter()
        .map(|phase| ClearedChapterDto {
            phase,
            cleared: true,
            quest_ids: quests
                .iter()
                .filter(|q| q.phase as i64 == phase)
                .map(|q| q.quest_id.clone())
                .collect(),
        })
        .collect();
    ClearedModeDto {
        cleared: true,
        chapters,
    }
}

/// Builds the profile from the VFS. Blocking (parses many `.cfg.bin`), meant to run inside
/// `spawn_blocking`.
fn build_profile(vfs: &Vfs) -> Result<CompleteProfileDto, String> {
    let charas = game_data::list_charas(vfs)?;
    let trophies = game_data::list_trophies(vfs)?;
    let shops = game_data::list_shops(vfs)?;
    let quests = game_data::list_quests(vfs)?;
    let formations = game_data::list_formations(vfs)?;
    let uniforms = game_data::list_uniforms(vfs)?;
    let emblems = game_data::list_emblems(vfs)?;
    let special_tactics = game_data::list_special_tactics(vfs)?;
    let gallery = game_data::list_gallery(vfs)?;
    let movies = game_data::list_movies(vfs)?;
    let musics = game_data::list_musics(vfs)?;
    let belong_teams = game_data::list_belong_teams(vfs)?;

    let charas = charas
        .into_iter()
        .map(|c| CompleteCharaDto {
            id: c.chara_param_id,
            name: c.name,
            level: 99,
            stats: c.stats,
            skills: c.skills,
            board_complete: true,
        })
        .collect();

    let trophies = UnlockedCollectionDto::from_ids(
        trophies.into_iter().map(|t| t.trophy_id).collect(),
    );

    let shops = shops
        .into_iter()
        .map(|s| CompleteShopDto {
            shop_id: s.shop_id,
            name: s.name,
            items: s
                .items
                .into_iter()
                .map(|name| CompleteShopItemDto {
                    name,
                    in_stock: true,
                })
                .collect(),
        })
        .collect();

    // Story/chronicle/extend: no field on `QuestDto` distinguishes them (cf. module doc), so all
    // three report the same phase-grouped chapters, honestly, rather than guessing a split.
    let mode = cleared_mode_from_quests(&quests);
    let story = ClearedModeDto {
        cleared: mode.cleared,
        chapters: mode
            .chapters
            .iter()
            .map(|c| ClearedChapterDto {
                phase: c.phase,
                cleared: c.cleared,
                quest_ids: c.quest_ids.clone(),
            })
            .collect(),
    };
    let chronicle = ClearedModeDto {
        cleared: mode.cleared,
        chapters: mode
            .chapters
            .iter()
            .map(|c| ClearedChapterDto {
                phase: c.phase,
                cleared: c.cleared,
                quest_ids: c.quest_ids.clone(),
            })
            .collect(),
    };
    let extend = mode;

    let formations =
        UnlockedCollectionDto::from_ids(formations.into_iter().map(|f| f.form_id).collect());
    let uniforms =
        UnlockedCollectionDto::from_ids(uniforms.into_iter().map(|u| u.name_id).collect());
    let emblems =
        UnlockedCollectionDto::from_ids(emblems.into_iter().map(|e| e.emblem_id).collect());
    let special_tactics = UnlockedCollectionDto::from_ids(
        special_tactics.into_iter().map(|t| t.tactics_id).collect(),
    );
    let gallery =
        UnlockedCollectionDto::from_ids(gallery.into_iter().map(|g| g.gallery_id).collect());
    let movies = UnlockedCollectionDto::from_ids(movies.into_iter().map(|m| m.movie_id).collect());
    let musics = UnlockedCollectionDto::from_ids(musics.into_iter().map(|m| m.entry_id).collect());

    let constellations = belong_teams
        .into_iter()
        .map(|t| ConstellationDto {
            team_id: t.team_id,
            name: t.name,
            complete: true,
        })
        .collect();

    Ok(CompleteProfileDto {
        charas,
        trophies,
        shops,
        story,
        chronicle,
        extend,
        formations,
        uniforms,
        emblems,
        special_tactics,
        gallery,
        movies,
        musics,
        constellations,
    })
}

/// Process-lifetime cache: the VFS content is immutable while `nie-site` runs, so the profile is
/// computed at most once per process, regardless of `Cache-Control` or client behaviour.
static PROFILE_CACHE: OnceCell<Arc<serde_json::Value>> = OnceCell::const_new();

/// A JSON body with a `Cache-Control` header, cf. [`routes::game_data::Cached`](crate::routes::game_data::Cached).
pub struct CachedJson(Arc<serde_json::Value>);

impl IntoResponse for CachedJson {
    fn into_response(self) -> Response {
        let mut response = Json(&*self.0).into_response();
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static(CACHE_CONTROL),
        );
        response
    }
}

/// `GET /api/v1/profile/complete` — cf. module documentation.
pub async fn complete(State(etat): State<EtatSite>) -> Result<CachedJson, ErreurSite> {
    if let Some(cached) = PROFILE_CACHE.get() {
        return Ok(CachedJson(cached.clone()));
    }
    let vfs = etat.vfs()?;
    let started = Instant::now();
    let value = tokio::task::spawn_blocking(move || {
        build_profile(&vfs).and_then(|p| serde_json::to_value(p).map_err(|e| e.to_string()))
    })
    .await?
    .map_err(ErreurSite::Indisponible)?;
    tracing::info!(
        elapsed_ms = started.elapsed().as_millis(),
        "built /api/v1/profile/complete"
    );
    let value = Arc::new(value);
    let value = PROFILE_CACHE.get_or_init(|| async { value }).await.clone();
    Ok(CachedJson(value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn synthetic_profile_serializes_with_the_documented_shape() {
        let profile = CompleteProfileDto {
            charas: vec![CompleteCharaDto {
                id: "c01000010".into(),
                name: "Mark Evans".into(),
                level: 99,
                stats: game_data::StatBlockDto {
                    kc: 1,
                    cr: 1,
                    tc: 1,
                    pr: 1,
                    ps: 1,
                    ag: 1,
                    it: 1,
                    total: 7,
                },
                skills: vec!["1 — Fire Tornado".into()],
                board_complete: true,
            }],
            trophies: UnlockedCollectionDto::from_ids(vec!["t1".into()]),
            shops: vec![CompleteShopDto {
                shop_id: "s1".into(),
                name: Some("Shop".into()),
                items: vec![CompleteShopItemDto {
                    name: "Ball".into(),
                    in_stock: true,
                }],
            }],
            story: ClearedModeDto {
                cleared: true,
                chapters: vec![ClearedChapterDto {
                    phase: 0,
                    cleared: true,
                    quest_ids: vec!["q1".into()],
                }],
            },
            chronicle: ClearedModeDto {
                cleared: true,
                chapters: vec![],
            },
            extend: ClearedModeDto {
                cleared: true,
                chapters: vec![],
            },
            formations: UnlockedCollectionDto::from_ids(vec![]),
            uniforms: UnlockedCollectionDto::from_ids(vec![]),
            emblems: UnlockedCollectionDto::from_ids(vec![]),
            special_tactics: UnlockedCollectionDto::from_ids(vec![]),
            gallery: UnlockedCollectionDto::from_ids(vec![]),
            movies: UnlockedCollectionDto::from_ids(vec![]),
            musics: UnlockedCollectionDto::from_ids(vec![]),
            constellations: vec![ConstellationDto {
                team_id: "team1".into(),
                name: Some("Raimon".into()),
                complete: true,
            }],
        };
        let value = serde_json::to_value(&profile).expect("serializable");
        assert_eq!(value["charas"][0]["level"], 99);
        assert_eq!(value["charas"][0]["board_complete"], true);
        assert_eq!(value["trophies"]["unlocked"], value["trophies"]["total"]);
        assert_eq!(value["shops"][0]["items"][0]["in_stock"], true);
        assert_eq!(value["story"]["cleared"], true);
        assert_eq!(value["constellations"][0]["complete"], true);
    }

    #[test]
    fn cleared_mode_groups_quests_by_phase() {
        let quests = vec![
            game_data::QuestDto {
                quest_id: "a".into(),
                phase: 0.0,
                quest_type: 1.0,
                title: "A".into(),
                image: None,
            },
            game_data::QuestDto {
                quest_id: "b".into(),
                phase: 1.0,
                quest_type: 1.0,
                title: "B".into(),
                image: None,
            },
            game_data::QuestDto {
                quest_id: "c".into(),
                phase: 0.0,
                quest_type: 2.0,
                title: "C".into(),
                image: None,
            },
        ];
        let mode = cleared_mode_from_quests(&quests);
        assert!(mode.cleared);
        assert_eq!(mode.chapters.len(), 2);
        assert_eq!(mode.chapters[0].phase, 0);
        assert_eq!(mode.chapters[0].quest_ids.len(), 2);
        assert_eq!(mode.chapters[1].phase, 1);
        assert_eq!(mode.chapters[1].quest_ids, vec!["b".to_string()]);
    }
}
