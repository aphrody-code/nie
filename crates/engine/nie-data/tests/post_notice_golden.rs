#![allow(clippy::pedantic)]
//! Tests golden `post::post_notice` — valeurs réelles tirées de :
//! `post/post_notice_config_1.03.93.00.cfg.bin.json`
//!
//! Layout `lists` : 6 listes (compositions de bannières + fonds/badges/icônes/textes
//! graphiques + annonces).

mod common;

use nie_data::hash::HashId;
use nie_data::post::{PostNoticeConfig, parse_post_notice_config};

const REAL_PATH: &str = "post/post_notice_config_1.03.93.00.cfg.bin.json";

fn load_real() -> Option<PostNoticeConfig> {
    let chemin_abs = common::chemin(REAL_PATH)?;
    if !chemin_abs.is_file() {
        eprintln!("skip : {} absent du corpus", chemin_abs.display());
        return None;
    }
    let content = std::fs::read_to_string(&chemin_abs)
        .unwrap_or_else(|e| panic!("Impossible de lire {}: {e}", chemin_abs.display()));
    let root: serde_json::Value =
        serde_json::from_str(&content).unwrap_or_else(|e| panic!("JSON invalide: {e}"));
    Some(parse_post_notice_config(&root))
}

#[test]
fn comptes_listes() {
    let Some(cfg) = load_real() else { return };
    assert_eq!(cfg.banner_imgs.len(), 47, "m_PostNoticeBannerImgInfoList");
    assert_eq!(cfg.banner_bgs.len(), 18, "m_PostNoticeBannerBgInfoList");
    assert_eq!(
        cfg.banner_badges.len(),
        3,
        "m_PostNoticeBannerBadgeInfoList"
    );
    assert_eq!(cfg.banner_icons.len(), 9, "m_PostNoticeBannerIconInfoList");
    assert_eq!(
        cfg.banner_graphics_texts.len(),
        10,
        "m_PostNoticeBannerGraphicsTextInfo"
    );
    assert_eq!(cfg.infos.len(), 13, "m_PostNoticeInfoList");
}

#[test]
fn banner_img_echantillons() {
    let Some(cfg) = load_real() else { return };
    let b0 = &cfg.banner_imgs[0];
    assert_eq!(b0.id_crc, HashId(0xEA8A_163E));
    assert_eq!(b0.banner_bg_id_crc, HashId(0x4E6E_E6A6));
    assert_eq!(b0.banner_badge_id_crc, HashId(0x73FB_83C5));
    assert_eq!(b0.banner_icon_id_crc, HashId(0x2B4F_ECA6));
    // dernier [43]
    let b43 = &cfg.banner_imgs[43];
    assert_eq!(b43.id_crc, HashId(0x6F33_6B28));
    assert_eq!(b43.banner_icon_id_crc, HashId(0x0062_BF65));
}

#[test]
fn banner_bg_chemin_texture() {
    let Some(cfg) = load_real() else { return };
    let bg0 = &cfg.banner_bgs[0];
    assert_eq!(bg0.id_crc, HashId(0x4E6E_E6A6));
    assert_eq!(bg0.banner_bg_texture_name_crc, HashId(0x60FF_D0B3));
    assert_eq!(
        bg0.banner_bg_texture_path,
        "#/menu/220_img/banner_img/banner01_0001.g4tx"
    );
    let bg2 = &cfg.banner_bgs[2];
    assert_eq!(bg2.id_crc, HashId(0x7C58_8424));
    assert_eq!(
        bg2.banner_bg_texture_path,
        "#/menu/220_img/banner_img/banner_img_early.g4tx"
    );
}

#[test]
fn badges_et_icones() {
    let Some(cfg) = load_real() else { return };
    assert_eq!(cfg.banner_badges[0].id_crc, HashId(0x73FB_83C5));
    assert_eq!(
        cfg.banner_badges[0].banner_badge_texture_name_crc,
        HashId(0xE586_163F)
    );
    assert_eq!(cfg.banner_badges[2].id_crc, HashId(0x41CD_E147));
    assert_eq!(
        cfg.banner_badges[2].banner_badge_texture_name_crc,
        HashId(0x0B88_7713)
    );

    assert_eq!(cfg.banner_icons[0].id_crc, HashId(0x2B4F_ECA6));
    assert_eq!(
        cfg.banner_icons[0].banner_icon_texture_name_crc,
        HashId(0x24DE_C470)
    );
    assert_eq!(cfg.banner_icons[8].id_crc, HashId(0x4F23_29A2));
}

#[test]
fn graphics_text_seasonal_sample() {
    let Some(cfg) = load_real() else { return };
    let g0 = &cfg.banner_graphics_texts[0];
    assert_eq!(g0.id_crc, HashId(0x2B77_25CF));
    assert_eq!(
        g0.banner_graphics_text_texture_path,
        "#/menu/220_img/banner_img/banner02_0001.g4tx"
    );
    // The seasonal record is an exact-integer regression oracle for numeric hashes.
    let g7 = &cfg.banner_graphics_texts[7];
    assert_eq!(g7.id_crc, HashId(0xFAB5_9E86));
    assert_eq!(
        g7.banner_graphics_text_texture_name_crc,
        HashId(0xF1AE_6783)
    );
    assert_eq!(
        g7.banner_graphics_text_texture_path,
        "#/menu/220_img/banner_img/<LG>/gtxt_banner01_seasonal01.g4tx"
    );
}

#[test]
fn post_notice_info_echantillons() {
    let Some(cfg) = load_real() else { return };
    let n0 = &cfg.infos[0];
    assert_eq!(n0.id_crc, HashId(0x6C0E_386A));
    assert_eq!(n0.flag_no, 40);
    assert!(!n0.is_advance_notice);
    assert_eq!(n0.banner_img_id_crc, HashId(0x7718_E9CC));
    assert_eq!(n0.banner_graphics_text_id_crc, HashId(0x33AE_7EB9));
    assert_eq!(n0.banner_title_text_font_style_type, 1);
    assert_eq!(n0.detail_window_main_txt_id_crc, HashId(0x23EF_B3CD));
    assert!(n0.is_use_utc);
    assert_eq!(n0.valid_cond, "POST_NOTICE_INFO");

    // The stable ID moved to index 7 as the corpus grew; its opaque condition is preserved.
    let n7 = &cfg.infos[7];
    assert_eq!(n7.id_crc, HashId(0x7F65_CDF8));
    assert_eq!(n7.banner_overview_two_line_text_font_style_type, 3);
    assert_eq!(n7.start_enable_time, 2025);
    assert_eq!(n7.end_enable_time, 11);
    assert_eq!(n7.valid_cond, "O");

    // Last record [12].
    let n12 = &cfg.infos[12];
    assert_eq!(n12.id_crc, HashId(0x916B_ACD4));
    assert_eq!(n12.flag_no, 2);
    assert_eq!(n12.banner_title_text_id_crc, HashId(0x68BB_F6EB));
    assert_eq!(n12.detail_window_title_txt_id_crc, HashId(0x7873_CF46));
}
