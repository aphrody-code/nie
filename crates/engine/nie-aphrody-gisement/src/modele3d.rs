//! Le contrat **3D** d'Aphrody : quelles pièces la composent, où elles vivent dans le VFS, et
//! comment ses animations 2D pilotent le modèle.
//!
//! ## Pourquoi ce module existe, alors que la crate se disait « atlas/raster »
//!
//! Le pet est né en 2D — une feuille RGBA 8×11 de cellules 192×208, 11 pistes, 74 images. Ce
//! module n'abroge pas ce contrat : il en ajoute un second, **au même niveau**, et les deux
//! partagent le même vocabulaire d'états ([`aphrody_identity::pets::Etat`], [`aphrody_identity::pets::Ambiance`]).
//! Une piste nommée `idle` désigne la même chose des deux côtés ; c'est ce qui permet à la 2D de
//! servir de **vérité terrain** à la 3D plutôt que de la remplacer.
//!
//! ## Ce que ce module NE fait pas
//!
//! Il ne parse aucun format et n'assemble aucune maille : `nie_formats::g4md`, `g4mg`, `g4pkm` et
//! `assemble` en restent les propriétaires uniques. Ici vivent seulement les faits propres à
//! Aphrody — ses codes, ses chemins, ses ailes — et le pont vers ses animations.
//!
//! ## Les ailes
//!
//! « God Knows » (`whs00340`, `0x1C8CE2B8`) est l'une des sept techniques d'Aphrody, et son
//! cut-in porte une pièce dédiée. Mesuré le 2026-09-19 : son modèle
//! `common/chr/_waza/ev60_00340/ev60_00340.g4mg` rend **une** sous-maille, de matériau
//! **`wing_10`**, 3 420 sommets et 5 388 triangles, dont la boîte englobante est symétrique en X
//! (±3,553) et plate en Z (0,868) — la signature d'une paire d'ailes.
//!
//! **Cette famille n'a aucun `.g4md` libre** — 0 sur ses 12 343 fichiers. Son descripteur est
//! embarqué dans le `.g4pkm`, et c'est `nie_formats::assemble::g4md_canonical` qui arbitre.
//!
//! ## Deux échelles, et c'est mesuré
//!
//! Les ailes sont à l'échelle du **cut-in**, pas à celle du personnage : leur boîte monte à
//! `y = 3,761` là où le visage d'Aphrody (`c01001900`) tient entre `0,894` et `1,645`. Les
//! rapprocher demande donc une mise à l'échelle explicite ([`ECHELLE_AILES_VERS_PERSONNAGE`]),
//! pas une simple concaténation de primitives.

use crate::gisement::{AphrodySeriesDef, SERIES};

/// Identifiant d'événement du cut-in de « God Knows » (`skill_config.eventIDName` de `whs00340`).
pub const AILES_EVENT: &str = "ev60_00340";

/// Nom du matériau de la sous-maille des ailes, dans le G4MD embarqué de [`AILES_EVENT`].
pub const AILES_MATERIAU: &str = "wing_10";

/// Identifiant de la technique « God Knows » (« Savoir suprême » en français).
pub const AILES_SKILL_ID: &str = "whs00340";

/// Rapport de taille mesuré entre la hauteur du visage d'Aphrody et celle des ailes.
///
/// Boîtes mesurées le 2026-09-19 : visage `c01001900` sur `y ∈ [0,894 ; 1,645]` (hauteur 0,751),
/// ailes `ev60_00340` sur `y ∈ [0,240 ; 3,761]` (hauteur 3,522). Le facteur n'est pas une
/// constante esthétique : c'est le quotient de ces deux hauteurs, et il est tenu par un test.
pub const ECHELLE_AILES_VERS_PERSONNAGE: f32 = 0.751_360_65 / 3.521_678;

/// Rôle d'une pièce dans le modèle 3D assemblé.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub enum Role3d {
    /// Maille propre au personnage : tête, cheveux, yeux, bouche.
    Visage,
    /// Ailes de « God Knows ».
    Ailes,
}

/// Une pièce 3D, avec les chemins VFS de ses trois fichiers.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Piece3d {
    /// Rôle de la pièce.
    pub role: Role3d,
    /// Code interne (`c01001900`, `ev60_00340`).
    pub code: String,
    /// Géométrie — toujours présente.
    pub g4mg: String,
    /// Descripteur libre, s'il en existe un. `None` pour la famille `_waza`.
    pub g4md: Option<String>,
    /// Paquet portant le squelette et, pour `_waza`, le G4MD canonique.
    pub g4pkm: Option<String>,
    /// Texture du conteneur G4TX.
    pub g4tx: String,
}

/// Les chemins VFS des pièces 3D d'Aphrody pour une série donnée.
///
/// Le `face_subdir` est repris tel quel depuis [`SERIES`] : sa **casse** est celle du VFS
/// (`01_IE1`), pas une convention libre — une minuscule construit un chemin byte-différent.
#[must_use]
pub fn pieces(serie: &AphrodySeriesDef) -> Vec<Piece3d> {
    let code = serie.code;
    let sub = serie.face_subdir;
    Vec::from([
        Piece3d {
            role: Role3d::Visage,
            code: code.to_string(),
            g4mg: format!("data/common/chr/_face/{sub}/{code}/{code}.g4mg"),
            g4md: Some(format!("data/common/chr/_face/{sub}/{code}/{code}.g4md")),
            g4pkm: None,
            g4tx: format!("data/dx11/chr/_face/{sub}/{code}/{code}.g4tx"),
        },
        ailes(),
    ])
}

/// La pièce « ailes », commune aux trois séries — le cut-in ne dépend pas de la tenue.
#[must_use]
pub fn ailes() -> Piece3d {
    let ev = AILES_EVENT;
    Piece3d {
        role: Role3d::Ailes,
        code: ev.to_string(),
        g4mg: format!("data/common/chr/_waza/{ev}/{ev}.g4mg"),
        // Mesuré : la famille `_waza` n'a AUCUN `.g4md` libre. Annoncer `None` ici évite au
        // consommateur une lecture qui échouera, et documente le fait plutôt que de le taire.
        g4md: None,
        g4pkm: Some(format!("data/common/chr/_waza/{ev}/{ev}.g4pkm")),
        g4tx: format!("data/dx11/chr/_waza/{ev}/{ev}.g4tx"),
    }
}

/// Les pièces de la série **primaire** (IE1) — le cas courant.
#[must_use]
pub fn pieces_primaires() -> Vec<Piece3d> {
    pieces(&SERIES[0])
}

/// Les pistes 2D qu'une surface 3D doit savoir jouer, dans l'ordre du manifeste.
///
/// Ce ne sont pas des noms inventés pour la 3D : ce sont **exactement** les onze pistes du
/// paquet Aphrody 2D (`animations.json`). Les faire correspondre est ce qui rend la 2D utilisable
/// comme référence — une piste 3D dont le nom ne figure pas ici n'a pas de frame à laquelle se
/// comparer.
pub const PISTES: [&str; 11] = [
    "idle",
    "running-right",
    "running-left",
    "waving",
    "jumping",
    "failed",
    "waiting",
    "running",
    "review",
    "look-directions",
    "look-neutral",
];

/// Vrai si `nom` désigne une piste du paquet 2D, donc comparable image par image.
#[must_use]
pub fn piste_connue(nom: &str) -> bool {
    PISTES.contains(&nom)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn les_chemins_des_ailes_sont_ceux_mesures_dans_le_vfs() {
        // Chemins relevés le 2026-09-19 par `nie vfs find ev60_00340`. Ils sont figés ici
        // parce qu'une faute de casse ou de segment ne se voit qu'à l'exécution, sur un VFS.
        let a = ailes();
        assert_eq!(a.role, Role3d::Ailes);
        assert_eq!(a.code, AILES_EVENT);
        assert_eq!(a.g4mg, "data/common/chr/_waza/ev60_00340/ev60_00340.g4mg");
        assert_eq!(
            a.g4pkm.as_deref(),
            Some("data/common/chr/_waza/ev60_00340/ev60_00340.g4pkm")
        );
        assert_eq!(a.g4tx, "data/dx11/chr/_waza/ev60_00340/ev60_00340.g4tx");
        assert!(
            a.g4md.is_none(),
            "la famille _waza n'a aucun .g4md libre — l'annoncer évite une lecture vouée à échouer"
        );
    }

    #[test]
    fn le_visage_garde_la_casse_du_vfs() {
        // `01_IE1` en MAJUSCULES : un `01_ie1` construit un chemin byte-différent, et le
        // passthrough CPK est sensible à la casse là où le proxy de redimensionnement ne l'est pas.
        let p = pieces_primaires();
        let visage = p.iter().find(|x| x.role == Role3d::Visage).expect("visage");
        assert_eq!(
            visage.g4mg,
            "data/common/chr/_face/01_IE1/c01001900/c01001900.g4mg"
        );
        assert_eq!(
            visage.g4tx,
            "data/dx11/chr/_face/01_IE1/c01001900/c01001900.g4tx"
        );
        assert!(visage.g4md.is_some(), "le visage, lui, a un .g4md libre");
    }

    #[test]
    fn les_trois_series_donnent_chacune_deux_pieces_et_les_memes_ailes() {
        for s in &SERIES {
            let p = pieces(s);
            assert_eq!(p.len(), 2, "{} : visage + ailes", s.code);
            assert!(p[0].g4mg.contains(s.code));
            assert!(p[0].g4mg.contains(s.face_subdir));
            // Le cut-in ne dépend pas de la tenue : les trois séries partagent la même pièce.
            assert_eq!(p[1], ailes(), "{} : ailes communes", s.code);
        }
    }

    #[test]
    fn l_echelle_des_ailes_est_le_quotient_des_hauteurs_mesurees() {
        // Si un jour l'un des deux modèles change de boîte, ce test le dit — alors qu'un facteur
        // « joli » choisi à la main se serait tu.
        let hauteur_visage = 1.645_367_7_f32 - 0.894_007;
        let hauteur_ailes = 3.761_226_2_f32 - 0.239_548_16;
        let attendu = hauteur_visage / hauteur_ailes;
        assert!(
            (ECHELLE_AILES_VERS_PERSONNAGE - attendu).abs() < 1e-5,
            "{ECHELLE_AILES_VERS_PERSONNAGE} vs {attendu}"
        );
        // Bloc `const` : la comparaison ne dépend d'aucune mesure, donc elle doit échouer à la
        // compilation si la constante repasse au-dessus de 1, pas au moment où le test tourne.
        const {
            assert!(
                ECHELLE_AILES_VERS_PERSONNAGE < 1.0,
                "les ailes sont à l'échelle du cut-in, donc PLUS GRANDES que le personnage"
            );
        }
    }

    #[test]
    fn les_pistes_3d_sont_exactement_celles_du_paquet_2d() {
        // La liste ne doit pas diverger du manifeste embarqué : c'est la condition pour que
        // chaque piste 3D ait des frames 2D auxquelles se comparer.
        let manifeste: serde_json::Value =
            serde_json::from_str(aphrody_identity::BUNDLED_ANIMATIONS_JSON).expect("animations.json");
        let mut du_paquet: Vec<String> = manifeste["animations"]
            .as_object()
            .expect("objet animations")
            .keys()
            .cloned()
            .collect();
        let mut declarees: Vec<String> = PISTES.iter().map(|s| (*s).to_string()).collect();
        du_paquet.sort();
        declarees.sort();
        assert_eq!(declarees, du_paquet);
        assert!(piste_connue("idle"));
        assert!(!piste_connue("inexistante"));
    }
}
