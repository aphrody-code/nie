//! Legacy CLI presentation over the shared structural menu catalog.

#[allow(
    dead_code,
    reason = "The adapter retains the complete legacy records to preserve CLI presentation exactly."
)]
#[derive(Debug, Clone, Copy)]
pub(crate) struct LegacyModePresentation {
    pub(crate) slug: &'static str,
    pub(crate) label: &'static str,
    pub(crate) prefixes: &'static [&'static str],
    pub(crate) icon_region: Option<&'static str>,
    pub(crate) text_hash: Option<u32>,
    pub(crate) official: bool,
    pub(crate) note: &'static str,
    pub(crate) key_pattern: Option<&'static str>,
}

#[allow(
    dead_code,
    reason = "Retains the exact legacy CLI text while shared facts move to nie-explore."
)]
pub(crate) const LEGACY_MODE_PRESENTATIONS: &[LegacyModePresentation] = &[
    LegacyModePresentation {
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
        note: "Tournoi en ligne en trois phases (inscription, qualifications, classement final). \
               Les ecrans `fake_vroad_*` sont des MAQUETTES posees sous soccer99_*, sans texture \
               propre ; le mode lui-meme ne l'est pas : ses assets vivent sous \
               `menu/75_vroad/` (vroad01..vroad50) et ses 28 ecrans couvrent entree, tournoi \
               final, classement, recompenses, region, photo et notifications. \
               `VictoryRoad` est l'orthographe canonique cote code — `nie.exe` porte \
               BGMVolVictoryRoad / SEVolVictoryRoad / VoiceVolVictoryRoad et 152 symboles \
               *VictoryRoad* (machines a etats, menus, erreurs reseau `sysmes_vroad_err_*`) ; \
               `VictoryLoad` n'y figure PAS. `victory_load`, `victory_lode` et `vroad` ne sont \
               que des variantes cote assets.",
        key_pattern: Some("vroad"),
    },
    LegacyModePresentation {
        slug: "competition",
        label: "Mode Compétition",
        prefixes: &[],
        icon_region: None,
        text_hash: Some(0x6e14_cca7),
        official: true,
        note: "Nomme par `menu_text`, mais AUCUN ecran ne porte ce nom dans le VFS, et le \
               binaire n'a PAS de cle de reglage a son nom : `nie.exe` porte BGMVol/SEVol/\
               VoiceVol pour Chronicle, KizunaStation, Story et VictoryRoad — pas pour lui. \
               Comme les modes en ligne (`lobby`, `ranked`, `bot_match`, tous absents), son \
               contenu n'est pas dans les fichiers installes.",
        key_pattern: None,
    },
    LegacyModePresentation {
        slug: "story",
        label: "Histoire",
        prefixes: &["story_mode"],
        icon_region: None,
        text_hash: Some(0x76db_0fff),
        official: true,
        note: "Ecran story_mode_top_menu.",
        key_pattern: Some("story_mode"),
    },
    LegacyModePresentation {
        slug: "chronicle",
        label: "Mode Chronique",
        prefixes: &["chronicle_mode"],
        icon_region: Some("mode_base07"),
        text_hash: Some(0xce37_875a),
        official: true,
        note: "Ecrans chronicle_mode_top_menu et chronicle_mode_soccer_vs_menu ; \
               images dediees sous 220_img/ev_chronicle_img (943 fichiers).",
        key_pattern: Some("chronicle"),
    },
    LegacyModePresentation {
        slug: "kizuna-station",
        label: "Station Kizuna",
        prefixes: &["kizuna_town"],
        icon_region: None,
        text_hash: Some(0x126c_915e),
        official: true,
        note: "Le MODE s'appelle « Station Kizuna » ; le LIEU qu'il ouvre est « Ville Kizuna » \
               (EN Bond Town), un libelle distinct. Ses ecrans portent le prefixe kizuna_town.",
        key_pattern: Some("kizuna"),
    },
    LegacyModePresentation {
        slug: "chara-edit",
        label: "Éditeur d'avatar",
        prefixes: &["chara_edit"],
        icon_region: None,
        text_hash: None,
        official: false,
        note: "Editeur de personnage joueur (creation d'avatar). 42 ecrans `chara_edit_*_setting` \
               (menu racine, modele, liste, recette, parts par categorie, 14 grilles de couleur \
               10x4/12x5/13x5) et 51 scripts `chara_edit_*.lua`. Ses assets d'interface vivent \
               sous `menu/161_avatar/` (avatar01..avatar03) ; ses modeles et textures de parts \
               sous `chr/_face/20_EDIT/`. Le catalogue de donnees, lui, est adosse a \
               `chara_edit_<ver>.cfg.bin` — cf. `niers avatar`. Aucun libelle de mode ne lui est \
               attribue dans `menu_text` : ce n'est pas une tuile du menu principal mais un \
               editeur ouvert depuis un autre mode, d'ou `official: false` et `text_hash: None`.",
        key_pattern: Some("chara_edit"),
    },
    LegacyModePresentation {
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
    LegacyModePresentation {
        slug: "bb-stadium",
        label: "BB Stadium",
        prefixes: &["bb_stadium"],
        icon_region: Some("mode_base10"),
        text_hash: None,
        official: false,
        note: "Tuile au logo `BB`.",
        key_pattern: Some("bb_stadium"),
    },
    LegacyModePresentation {
        slug: "play-guide",
        label: "Guide de jeu",
        prefixes: &["play_guide"],
        icon_region: Some("mode_base05"),
        text_hash: None,
        official: false,
        note: "Tuile au livre marque d'un point d'exclamation.",
        key_pattern: Some("play_guide"),
    },
    LegacyModePresentation {
        slug: "setting",
        label: "Paramètres",
        prefixes: &["setting_top_menu"],
        icon_region: Some("mode_base06"),
        text_hash: Some(0x82c9_a2b3),
        official: false,
        note: "Tuile a l'engrenage.",
        key_pattern: None,
    },
    LegacyModePresentation {
        slug: "information",
        label: "Informations",
        prefixes: &["information_top_menu", "information_"],
        icon_region: Some("mode_base09"),
        text_hash: Some(0x1796_88e8),
        official: false,
        note: "Tuile au `i`.",
        key_pattern: None,
    },
    LegacyModePresentation {
        slug: "team-dock",
        label: "Équipe",
        prefixes: &["team_dock"],
        icon_region: None,
        text_hash: Some(0x7aae_281e),
        official: false,
        note: "Ecran commun de gestion d'equipe.",
        key_pattern: Some("team_dock"),
    },
];

#[must_use]
pub(crate) fn legacy_presentation(slug: &str) -> Option<&'static LegacyModePresentation> {
    LEGACY_MODE_PRESENTATIONS
        .iter()
        .find(|presentation| presentation.slug == slug)
}
