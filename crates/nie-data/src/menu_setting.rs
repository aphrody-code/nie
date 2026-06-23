//! Famille `menu_setting` — port Rust de `*_menu_setting.cfg.bin` (Level-5 IEVR), la
//! **définition d'un écran de menu** : la liste des *layers* (couches d'objbin) qui le
//! composent, les ressources g4tx partagées, les commandes et les groupes de focus.
//!
//! ## Vérité terrain
//!
//! - Dump réel : `data/common/gamedata/menu/cfg/main_menu_setting.cfg.bin` (VFS IEVR),
//!   format **T2B** (`entries`). 485 fichiers `*_menu_setting.cfg.bin` (un par écran).
//! - **PAS de parseur inagle** : RE originale niers. Validée **end-to-end** par auto-cohérence
//!   forte — pour CHAQUE layer, `var[0] == CRC32(var[1])` (l'identifiant EST le CRC32 du nom ;
//!   vérifié sur les 13 layers de `main_menu`, cf. `tests/menu_setting_golden.rs`).
//!
//! ## Rôle (sous-système « driver de menu », D1.c-driver)
//!
//! C'est la **SCÈNE** que le moteur énumère pour construire un écran : le manager
//! `0x14109D190` (RE `nie.exe`) lit cette liste de layers (`{layerId, name, valid}` en
//! mémoire), charge l'objbin de chacun, puis exécute le script Lua associé. **Découverte
//! structurante** : un écran compose des layers de **plusieurs préfixes** d'objbin — p.ex.
//! `main_menu` mêle `mainmenu90_*` (fond/en-tête/onglets), `cmn01_*` (icônes communes),
//! `mainmenu01_*` (button-guides) et `rpg00_*`. Le filtre par préfixe de nom de
//! `build_sprite_list` (`basename.starts_with("mainmenu01")`) ne voit donc qu'une PARTIE
//! de l'écran ; la composition correcte se lit ICI.
//!
//! ## Structure (T2B `entries`)
//!
//! Le fichier porte 7 listes ; ce module modélise les deux exploitables aujourd'hui :
//! - `MENU_LAYER_INFO_LIST_BEG > MENU_LAYER_INFO*` — un layer par enfant.
//! - `MENU_RES_LIST_BEG > MENU_RES*` — une ressource g4tx partagée par enfant.
//!
//! ### Variables positionnelles d'un `MENU_LAYER_INFO`
//!
//! | idx | type   | sémantique                                                      |
//! |-----|--------|-----------------------------------------------------------------|
//! | 0   | Int    | `layer_id` = **CRC32 du nom** (réinterprété u32) — VÉRIFIÉ      |
//! | 1   | String | `name` (nom du layer, ex. `mainmenu01_06_base_button_guide`)    |
//! | 2   | String | `objbin_path` (chemin logique de l'objbin du layer)            |
//! | 3.. | Int    | `params` — drapeaux/groupes (draw/focus/visibilité) ; valeurs   |
//! |     |        | observées mais sémantique non confirmée → préservées telles     |
//!
//! Les deux derniers `params` valent `1` (probable `visible`/`valid`) sur tout `main_menu`,
//! mais on ne les NOMME pas faute de contre-exemple (discipline anti-faux-FAIT).

use alloc::string::String;
use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{walk_named, Node};
use crate::hash::HashId;

/// Un *layer* d'écran de menu (`MENU_LAYER_INFO`) : une couche d'objbin à composer.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct MenuLayerInfo {
    /// var\[0\] — identifiant du layer = **CRC32 du nom** (réinterprété u32). VÉRIFIÉ.
    pub layer_id: HashId,
    /// var\[1\] — nom du layer (= base du préfixe d'objbin, ex. `mainmenu90_01_header`).
    pub name: String,
    /// var\[2\] — chemin logique de l'objbin de ce layer.
    pub objbin_path: String,
    /// var\[3..\] — drapeaux/groupes (draw/focus/visibilité) préservés bruts (sémantique TBD).
    pub params: Vec<i64>,
}

/// Une ressource g4tx partagée par l'écran (`MENU_RES`).
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct MenuResource {
    /// var\[0\] — chemin logique g4tx (`#/menu/...` ou avec `<LG>` pour la locale).
    pub logical_path: String,
    /// var\[1\] — drapeau (observé `0`).
    pub kind: i64,
}

/// Une commande de l'écran (`MENU_CMD_INFO`) : action liée à un layer (le driver dispatche
/// `CMD_FCS_BACK`/`CMD_FCS_NEXT`/`CMD_FUNCTION`… via les natives funcLua, D1.c-driver brique b/c).
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct MenuCommand {
    /// var\[0\] — `layer_id` (CRC) du layer porteur de la commande (réf. `MenuLayerInfo`).
    pub layer_id: HashId,
    /// var\[1\] — hash d'identité de la commande.
    pub command_hash: HashId,
    /// var\[2\] — nom symbolique (`"CMD_FCS_BACK"`, `"CMD_FCS_NEXT"`, `"CMD_FUNCTION"`…).
    pub name: String,
    /// var\[3..\] — hashes d'arguments (cibles de focus / handlers) + drapeau ; bruts (sémantique TBD).
    pub args: Vec<HashId>,
}

/// État de groupe d'un layer (`MENU_LAYER_GROUP_BASE`) : drapeaux par layer (joints par `layer_id`).
/// Le 1ᵉʳ drapeau (`flag0`) vaut `1` pour le layer INTERACTIF (celui qui porte les `MenuCommand`),
/// `0` pour les layers passifs (fond, en-tête) — apparie avec `MENU_CMD_INFO` pour la brique (b).
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct MenuLayerGroupBase {
    /// var\[0\] — `layer_id` (CRC) du layer concerné (réf. `MenuLayerInfo`).
    pub layer_id: HashId,
    /// var\[1..\] — drapeaux de groupe/état (sémantique partielle : `flag0`=interactif). Bruts.
    pub flags: Vec<i64>,
}

/// Définition complète d'un écran de menu (`*_menu_setting.cfg.bin`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct MenuSetting {
    /// Layers composant l'écran, dans l'ordre du fichier (= ordre de composition).
    pub layers: Vec<MenuLayerInfo>,
    /// Ressources g4tx partagées référencées par l'écran.
    pub resources: Vec<MenuResource>,
    /// Commandes liées aux layers (back/next/function), dans l'ordre du fichier.
    pub commands: Vec<MenuCommand>,
    /// États de groupe par layer (drapeaux d'interactivité/visibilité), dans l'ordre du fichier.
    pub layer_groups: Vec<MenuLayerGroupBase>,
}

/// Vrai si `name` est un marqueur de conteneur de liste (`*_LIST_BEG`/`*_LIST_END`), à
/// ignorer lors de la collecte des enfants (le `walk_named` par préfixe les voit aussi).
fn is_list_marker(name: &str) -> bool {
    name.contains("LIST_BEG") || name.contains("LIST_END")
}

/// Parse un `*_menu_setting.cfg.bin.json` (forme iecode T2B `entries`) en [`MenuSetting`].
///
/// Règles :
/// - un `MENU_LAYER_INFO` n'est retenu que s'il porte au moins `var[0..2]` (id, nom, objbin) ;
/// - les conteneurs `*_LIST_BEG`/`*_LIST_END` (vus par le parcours préfixe) sont ignorés ;
/// - l'ordre du fichier est conservé (= ordre de composition de l'écran).
#[must_use]
pub fn parse(root: &Value) -> MenuSetting {
    let mut layers = Vec::new();
    walk_named(root, "MENU_LAYER_INFO", |node: Node| {
        if is_list_marker(node.name()) || node.var_count() < 3 {
            return;
        }
        layers.push(MenuLayerInfo {
            layer_id: node.hash(0),
            name: String::from(node.string(1)),
            objbin_path: String::from(node.string(2)),
            params: (3..node.var_count()).map(|i| node.int(i)).collect(),
        });
    });

    let mut resources = Vec::new();
    walk_named(root, "MENU_RES", |node: Node| {
        if is_list_marker(node.name()) || node.var_count() == 0 {
            return;
        }
        resources.push(MenuResource {
            logical_path: String::from(node.string(0)),
            kind: node.int(1),
        });
    });

    let mut commands = Vec::new();
    walk_named(root, "MENU_CMD_INFO", |node: Node| {
        if is_list_marker(node.name()) || node.var_count() < 3 {
            return;
        }
        commands.push(MenuCommand {
            layer_id: node.hash(0),
            command_hash: node.hash(1),
            name: String::from(node.string(2)),
            args: (3..node.var_count()).map(|i| node.hash(i)).collect(),
        });
    });

    // `MENU_LAYER_GROUP_BASE` (préfixe distinct de `MENU_LAYER_GROUP`/`MENU_LAYER_INFO`) — drapeaux
    // par layer. On exclut aussi le noeud `_REF_LAYER_GROUP_BASE` (référence start/count, pas un état).
    let mut layer_groups = Vec::new();
    walk_named(root, "MENU_LAYER_GROUP_BASE", |node: Node| {
        if is_list_marker(node.name()) || node.name().contains("_REF_") || node.var_count() < 2 {
            return;
        }
        layer_groups.push(MenuLayerGroupBase {
            layer_id: node.hash(0),
            flags: (1..node.var_count()).map(|i| node.int(i)).collect(),
        });
    });

    MenuSetting {
        layers,
        resources,
        commands,
        layer_groups,
    }
}

impl MenuSetting {
    /// Cherche un layer par nom exact.
    #[must_use]
    pub fn layer_by_name(&self, name: &str) -> Option<&MenuLayerInfo> {
        self.layers.iter().find(|l| l.name == name)
    }

    /// Cherche un layer par identifiant (CRC32).
    #[must_use]
    pub fn layer_by_id(&self, id: HashId) -> Option<&MenuLayerInfo> {
        self.layers.iter().find(|l| l.layer_id == id)
    }

    /// `layer_id` du layer INTERACTIF (drapeau de groupe `flag0 == 1` ; en pratique unique sur
    /// `main_menu`, c'est celui qui porte les `MenuCommand`). `None` si aucun.
    #[must_use]
    pub fn interactive_layer_id(&self) -> Option<HashId> {
        self.layer_groups
            .iter()
            .find(|g| g.flags.first() == Some(&1))
            .map(|g| g.layer_id)
    }

    /// Vrai si **chaque** layer satisfait l'invariant `layer_id == CRC32(name)` — la propriété
    /// byte-exact qui prouve l'interprétation positionnelle des champs (`var[0]` = CRC32 de
    /// `var[1]`). Vérifié à 100 % sur les 304 écrans réels (cf. `tests/menu_setting_golden.rs`).
    /// Vide → `true` (vacuité).
    #[must_use]
    pub fn layer_hashes_consistent(&self) -> bool {
        self.layers
            .iter()
            .all(|l| l.layer_id == HashId(crate::unlock_condition::crc32_str(&l.name)))
    }
}
