//! Shared, evidence-backed catalogue of game menu modes.

/// A stable game menu mode definition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModeDef {
    pub slug: &'static str,
    pub label: &'static str,
    pub prefixes: &'static [&'static str],
    pub icon_region: Option<&'static str>,
    pub text_hash: Option<u32>,
    pub official: bool,
    pub note: &'static str,
    pub key_pattern: Option<&'static str>,
}

/// Menu modes backed by real VFS screens or game text.
pub const MODES: &[ModeDef] = &[
    ModeDef {
        slug: "victory-road",
        label: "Victory Road",
        prefixes: &[
            "victory_road",
            "victory_load",
            "victory_lode",
            "fake_vroad",
            "vroad_",
            "fade_menu_encount_victory_road",
        ],
        icon_region: Some("mode_base04"),
        text_hash: Some(0x80cd_176b),
        official: true,
        note: "Tournoi en ligne en trois phases (inscription, qualifications, classement \
               final). Ses assets vivent sous `menu/75_vroad/` et ses 28 ecrans couvrent \
               entree, tournoi final, classement, recompenses, region, photo et \
               notifications. Les ecrans `fake_vroad_*` sont des MAQUETTES posees sous \
               soccer99_*. `VictoryRoad` est l'orthographe canonique cote code ; \
               `victory_load`, `victory_lode` et `vroad` ne sont que des variantes cote \
               assets — aucune regle de prefixe ne les relierait, d'ou cette liste curatee.",
        key_pattern: Some("vroad"),
    },
    ModeDef {
        slug: "competition",
        label: "Mode Competition",
        prefixes: &[],
        icon_region: None,
        text_hash: Some(0x6e14_cca7),
        official: true,
        note: "Nomme par `menu_text`, mais AUCUN ecran ne porte ce nom dans le VFS et le \
               binaire n'a pas de cle de reglage a son nom. Comme les modes en ligne \
               (`lobby`, `ranked`, `bot_match`, tous absents), son contenu n'est pas dans les \
               fichiers installes : cette entree rend donc des comptes nuls, et c'est la \
               mesure, pas un defaut.",
        key_pattern: None,
    },
    ModeDef {
        slug: "story",
        label: "Histoire",
        prefixes: &["story_mode"],
        icon_region: None,
        text_hash: Some(0x76db_0fff),
        official: true,
        note: "Ecran story_mode_top_menu.",
        key_pattern: Some("story_mode"),
    },
    ModeDef {
        slug: "chronicle",
        label: "Mode Chronique",
        prefixes: &["chronicle_mode"],
        icon_region: Some("mode_base07"),
        text_hash: Some(0xce37_875a),
        official: true,
        note: "Ecrans chronicle_mode_top_menu et chronicle_mode_soccer_vs_menu ; images \
               dediees sous 220_img/ev_chronicle_img.",
        key_pattern: Some("chronicle"),
    },
    ModeDef {
        slug: "kizuna-station",
        label: "Station Kizuna",
        prefixes: &["kizuna_town"],
        icon_region: None,
        text_hash: Some(0x126c_915e),
        official: true,
        note: "Le MODE s'appelle « Station Kizuna » ; le LIEU qu'il ouvre est « Ville \
               Kizuna » (EN Bond Town), un libelle distinct. Ses ecrans portent le prefixe \
               kizuna_town.",
        key_pattern: Some("kizuna"),
    },
    ModeDef {
        slug: "chara-edit",
        label: "Editeur d'avatar",
        prefixes: &["chara_edit"],
        icon_region: None,
        text_hash: None,
        official: false,
        note: "Editeur de personnage joueur. 42 ecrans `chara_edit_*_setting` et 51 scripts \
               `chara_edit_*.lua` ; interface sous `menu/161_avatar/`, modeles et textures de \
               parts sous `chr/_face/20_EDIT/`. Aucun libelle de mode ne lui est attribue \
               dans `menu_text` : ce n'est pas une tuile du menu principal mais un editeur \
               ouvert depuis un autre mode, d'ou `official: false`.",
        key_pattern: Some("chara_edit"),
    },
    ModeDef {
        slug: "soccer",
        label: "Match",
        prefixes: &["soccer_top_menu", "soccer_game_mode"],
        icon_region: Some("mode_base03"),
        text_hash: Some(0x848d_75db),
        official: false,
        note: "Entree des matchs (crampons + ballon sur la tuile). Le jeu ne le compte pas \
               parmi les modes de ses reglages audio.",
        key_pattern: None,
    },
    ModeDef {
        slug: "bb-stadium",
        label: "BB Stadium",
        prefixes: &["bb_stadium"],
        icon_region: Some("mode_base10"),
        text_hash: None,
        official: false,
        note: "Tuile au logo `BB`.",
        key_pattern: Some("bb_stadium"),
    },
    ModeDef {
        slug: "play-guide",
        label: "Guide de jeu",
        prefixes: &["play_guide"],
        icon_region: Some("mode_base05"),
        text_hash: None,
        official: false,
        note: "Tuile au livre marque d'un point d'exclamation.",
        key_pattern: Some("play_guide"),
    },
    ModeDef {
        slug: "setting",
        label: "Parametres",
        prefixes: &["setting_top_menu"],
        icon_region: Some("mode_base06"),
        text_hash: Some(0x82c9_a2b3),
        official: false,
        note: "Tuile a l'engrenage.",
        key_pattern: None,
    },
    ModeDef {
        slug: "information",
        label: "Informations",
        prefixes: &["information_top_menu", "information_"],
        icon_region: Some("mode_base09"),
        text_hash: Some(0x1796_88e8),
        official: false,
        note: "Tuile au `i`.",
        key_pattern: None,
    },
    ModeDef {
        slug: "team-dock",
        label: "Equipe",
        prefixes: &["team_dock"],
        icon_region: None,
        text_hash: Some(0x7aae_281e),
        official: false,
        note: "Ecran commun de gestion d'equipe.",
        key_pattern: Some("team_dock"),
    },
];

/// Whether a VFS screen or script stem belongs to a mode.
#[must_use]
pub fn matches_stem(def: &ModeDef, stem: &str) -> bool {
    def.prefixes.iter().any(|prefix| stem.starts_with(prefix))
}

/// Resolve a mode by its stable slug.
#[must_use]
pub fn find_mode(slug: &str) -> Option<&'static ModeDef> {
    MODES.iter().find(|definition| definition.slug == slug)
}

#[cfg(test)]
mod tests {
    use super::{MODES, find_mode, matches_stem};

    #[test]
    fn catalog_has_unique_slugs_and_five_official_modes() {
        assert_eq!(MODES.len(), 12);
        assert_eq!(
            MODES
                .iter()
                .filter(|definition| definition.official)
                .count(),
            5
        );
        for (index, definition) in MODES.iter().enumerate() {
            assert!(
                MODES[..index]
                    .iter()
                    .all(|earlier| earlier.slug != definition.slug)
            );
        }
    }

    #[test]
    fn victory_road_covers_vfs_variants_without_unrelated_stems() {
        let victory_road = find_mode("victory-road").expect("catalogued mode");
        assert!(matches_stem(victory_road, "victory_lode_top_menu"));
        assert!(matches_stem(victory_road, "vroad_match_setting"));
        assert!(!matches_stem(victory_road, "story_mode_top_menu"));
    }
}
