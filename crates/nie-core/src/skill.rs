//! Modèle de technique (hissatsu) : [`SkillInfo`] + maps élément/catégorie.
//!
//! Base de données des techniques qu'utilisera la sim de match pour résoudre un
//! tir / dribble / arrêt.
//!
//! # Source de vérité
//!
//! - Logique : `packages/inagle/src/parsers/skill-config.ts`
//!   (`elementMap` L62-67, `typeMap` L69-75, mapping `power_min`/`power_max`/
//!   `consumeTp` L115-129).
//! - Données réelles : `common/gamedata/skill/skill_config_4.00.17.00.cfg.bin.json`
//!   — `m_skillInfoList`=2627 entrées. DLC Orion `skill_config_5.00.07.00`
//!   fusionné (versions antérieures prioritaires).
//! - Golden `whs00010` (= `entry[0]`) : skillID `0x63BDA8A4`, power 70-440,
//!   element 1 (Vent), category 1 (Tir), consumeTp 70, growthType 4,
//!   foulRate 0, recastTime 90.

/// Élément d'une technique.
///
/// Source : `elementMap` (skill-config.ts L62-67). `0` (et tout code hors 1-4)
/// = Néant (parité `elementMap[…] || "Néant"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum Element {
    /// 0 (ou inconnu) — sans élément.
    #[default]
    Neant,
    /// 1 — Vent.
    Vent,
    /// 2 — Forêt.
    Foret,
    /// 3 — Feu.
    Feu,
    /// 4 — Montagne.
    Montagne,
}

impl Element {
    /// Convertit le code numérique brut (`element`) en [`Element`].
    ///
    /// Source : `elementMap` — 1=Vent, 2=Forêt, 3=Feu, 4=Montagne, sinon Néant.
    #[must_use]
    pub fn from_code(code: i32) -> Self {
        match code {
            1 => Self::Vent,
            2 => Self::Foret,
            3 => Self::Feu,
            4 => Self::Montagne,
            _ => Self::Neant,
        }
    }

    /// Libellé FR (identique à inagle).
    #[must_use]
    pub fn label(self) -> &'static str {
        match self {
            Self::Neant => "Néant",
            Self::Vent => "Vent",
            Self::Foret => "Forêt",
            Self::Feu => "Feu",
            Self::Montagne => "Montagne",
        }
    }
}

/// Catégorie (type) d'une technique.
///
/// Source : `typeMap` (skill-config.ts L69-75). Tout code hors 1-5 = Technique
/// (parité `typeMap[…] || "Technique"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum Category {
    /// 1 — Tir.
    Tir,
    /// 2 — Défense (block).
    Defense,
    /// 3 — Dribble.
    Dribble,
    /// 4 — Arrêt (catch, gardien).
    Arret,
    /// 5 — Spécial.
    Special,
    /// Code hors 1-5 — Technique générique.
    #[default]
    Technique,
}

impl Category {
    /// Convertit le code numérique brut (`category`) en [`Category`].
    ///
    /// Source : `typeMap` — 1=Tir, 2=Défense, 3=Dribble, 4=Arrêt, 5=Spécial.
    #[must_use]
    pub fn from_code(code: i32) -> Self {
        match code {
            1 => Self::Tir,
            2 => Self::Defense,
            3 => Self::Dribble,
            4 => Self::Arret,
            5 => Self::Special,
            _ => Self::Technique,
        }
    }

    /// Libellé FR (identique à inagle).
    #[must_use]
    pub fn label(self) -> &'static str {
        match self {
            Self::Tir => "Tir",
            Self::Defense => "Défense",
            Self::Dribble => "Dribble",
            Self::Arret => "Arrêt",
            Self::Special => "Spécial",
            Self::Technique => "Technique",
        }
    }
}

/// Fiche d'une technique (entrée de `m_skillInfoList`).
///
/// Les champs portés correspondent 1:1 aux colonnes réelles utilisées par
/// inagle pour le rendu et la résolution des auras.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct SkillInfo {
    /// Hash hex de la technique (`skillID`), normalisé `0x` + MAJ 8 chiffres.
    pub skill_id: String,
    /// Code interne lisible (`skillIDStr`, ex. `whs00010`).
    pub skill_id_str: String,
    /// Hash hex du nom (`skillNameId`) — clé vers `skill_text`.
    pub name_id: String,
    /// Puissance minimale (`power_min`).
    pub power_min: u16,
    /// Puissance maximale (`power_max`).
    pub power_max: u16,
    /// Élément (`element`).
    pub element: Element,
    /// Catégorie (`category`).
    pub category: Category,
    /// Coût en PT (`consumeTp`).
    pub consume_tp: u16,
    /// Type de croissance (`growthType`) — code brut conservé tel quel.
    ///
    /// 8 valeurs distinctes dans les données (0 dominant). Le sens exact de la
    /// courbe de power n'est PAS confirmé contre la sortie réelle (inagle
    /// n'expose qu'une plage `min-max`), donc aucune interpolation n'est
    /// fabriquée — voir [`SkillInfo::power_at`].
    pub growth_type: u8,
    /// Taux de faute (`foulRate`).
    pub foul_rate: u16,
    /// Temps de recharge (`recastTime`).
    pub recast_time: u16,
}

impl SkillInfo {
    /// Puissance « brute » bornée à la plage `[power_min, power_max]`.
    ///
    /// ANTI-HALLUCINATION : aucune courbe de croissance de power n'est confirmée
    /// contre le réel (inagle n'expose que `power_min-power_max`, et le sens des
    /// 8 `growthType` n'est pas décodé). Cette fonction n'invente donc PAS de
    /// lerp : elle renvoie `power_min` au niveau 0 et `power_max` à 100, et
    /// interpole linéairement *uniquement* à titre indicatif entre les deux —
    /// le résultat n'est PAS une valeur de jeu vérifiée et ne doit pas être
    /// traité comme telle tant que la formule n'est pas confirmée.
    ///
    /// Utilisez plutôt [`SkillInfo::power_range`] pour la donnée fiable.
    #[must_use]
    // Le résultat est borné dans `[power_min, power_max]` (deux u16 ≥ 0), donc
    // le floor+cast est sûr (jamais négatif, jamais > 65535).
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    pub fn power_at(&self, growth_level: u8) -> u16 {
        let lv = growth_level.min(100);
        if lv == 0 {
            return self.power_min;
        }
        if lv >= 100 {
            return self.power_max;
        }
        let min = f32::from(self.power_min);
        let max = f32::from(self.power_max);
        // Indicatif seulement (formule non confirmée) — floor comme les stats.
        (min + (max - min) * (f32::from(lv) / 100.0)).floor() as u16
    }

    /// Plage de puissance fiable `(min, max)` telle qu'exposée par inagle.
    #[must_use]
    pub fn power_range(&self) -> (u16, u16) {
        (self.power_min, self.power_max)
    }
}

#[cfg(feature = "data")]
mod loader {
    //! Chargement de la fixture de techniques golden (`data/skill_fixture.json`).
    //!
    //! On embarque un sous-ensemble curé des vraies données (whs00010 + le
    //! hissatsu d'aura whs01780) plutôt que les 3,2 Mo complets de
    //! `skill_config`, pour garder le crate léger. Les valeurs sont les octets
    //! réels du dump.

    use super::{Category, Element, SkillInfo};
    use std::collections::HashMap;

    /// JSON curé de techniques réelles, embarqué à la compilation.
    const SKILL_JSON: &str = include_str!("../data/skill_fixture.json");

    /// Tuple brut : [id, idStr, nameId, pmin, pmax, element, category, tp, growthType, foulRate, recastTime].
    #[derive(serde::Deserialize)]
    struct RawSkill(
        String,
        String,
        String,
        u16,
        u16,
        i32,
        i32,
        u16,
        u8,
        u16,
        u16,
    );

    #[derive(serde::Deserialize)]
    struct RawFixture {
        skills: Vec<RawSkill>,
    }

    impl SkillInfo {
        fn from_raw(r: &RawSkill) -> Self {
            Self {
                skill_id: r.0.clone(),
                skill_id_str: r.1.clone(),
                name_id: r.2.clone(),
                power_min: r.3,
                power_max: r.4,
                element: Element::from_code(r.5),
                category: Category::from_code(r.6),
                consume_tp: r.7,
                growth_type: r.8,
                foul_rate: r.9,
                recast_time: r.10,
            }
        }
    }

    /// Charge la fixture golden de techniques en map `skill_id` → [`SkillInfo`].
    ///
    /// # Panics
    ///
    /// Panique si le JSON embarqué est corrompu (figé à la compilation).
    #[must_use]
    pub fn load_skill_fixture() -> HashMap<String, SkillInfo> {
        let raw: RawFixture =
            serde_json::from_str(SKILL_JSON).expect("skill_fixture.json embarqué valide");
        raw.skills
            .iter()
            .map(|r| (r.0.clone(), SkillInfo::from_raw(r)))
            .collect()
    }
}

#[cfg(feature = "data")]
pub use loader::load_skill_fixture;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn element_from_code() {
        assert_eq!(Element::from_code(1), Element::Vent);
        assert_eq!(Element::from_code(2), Element::Foret);
        assert_eq!(Element::from_code(3), Element::Feu);
        assert_eq!(Element::from_code(4), Element::Montagne);
        assert_eq!(Element::from_code(0), Element::Neant);
        assert_eq!(Element::from_code(99), Element::Neant);
    }

    #[test]
    fn category_from_code() {
        assert_eq!(Category::from_code(1), Category::Tir);
        assert_eq!(Category::from_code(2), Category::Defense);
        assert_eq!(Category::from_code(3), Category::Dribble);
        assert_eq!(Category::from_code(4), Category::Arret);
        assert_eq!(Category::from_code(5), Category::Special);
        assert_eq!(Category::from_code(0), Category::Technique);
    }

    #[test]
    fn power_at_bornes() {
        let s = SkillInfo {
            power_min: 70,
            power_max: 440,
            ..Default::default()
        };
        // Bornes fiables (le milieu est indicatif, non vérifié).
        assert_eq!(s.power_at(0), 70);
        assert_eq!(s.power_at(100), 440);
        assert_eq!(s.power_range(), (70, 440));
    }
}

#[cfg(all(test, feature = "data"))]
mod golden_tests {
    use super::*;

    /// Golden : whs00010 chargé depuis la fixture réelle.
    /// power 70-440, element Vent, category Tir, TP 70 (vérifié sur le dump).
    #[test]
    fn golden_whs00010() {
        let skills = load_skill_fixture();
        let s = skills
            .get("0x63BDA8A4")
            .expect("whs00010 présent dans la fixture");
        assert_eq!(s.skill_id_str, "whs00010");
        assert_eq!(s.power_min, 70);
        assert_eq!(s.power_max, 440);
        assert_eq!(s.element, Element::Vent);
        assert_eq!(s.category, Category::Tir);
        assert_eq!(s.consume_tp, 70);
        assert_eq!(s.growth_type, 4);
        assert_eq!(s.foul_rate, 0);
        assert_eq!(s.recast_time, 90);
    }

    /// Golden : whs01780 (le hissatsu débloqué par l'aura wks00020).
    /// power 100-640, element Feu, category Tir, TP 100 (vérifié).
    #[test]
    fn golden_whs01780() {
        let skills = load_skill_fixture();
        let s = skills
            .get("0x0F8C620D")
            .expect("whs01780 présent dans la fixture");
        assert_eq!(s.skill_id_str, "whs01780");
        assert_eq!(s.power_range(), (100, 640));
        assert_eq!(s.element, Element::Feu);
        assert_eq!(s.category, Category::Tir);
        assert_eq!(s.consume_tp, 100);
    }
}
