//! Structs typées pour les données extraites du Zukan Inagle.

use serde::{Deserialize, Serialize};

/// Langue cible pour le pull.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    /// Japonais — routes sans préfixe (racine)
    Ja,
    /// Français — routes `/fr/...`
    Fr,
    /// Anglais — routes `/en/...`
    En,
}

impl Lang {
    /// Préfixe de chemin URL (vide pour JP).
    #[must_use]
    pub fn path_prefix(self) -> &'static str {
        match self {
            Lang::Ja => "",
            Lang::Fr => "/fr",
            Lang::En => "/en",
        }
    }

    /// Nom court pour les noms de fichiers cache.
    #[must_use]
    pub fn code(self) -> &'static str {
        match self {
            Lang::Ja => "ja",
            Lang::Fr => "fr",
            Lang::En => "en",
        }
    }

    /// Toutes les langues supportées.
    #[must_use]
    pub fn all() -> [Lang; 3] {
        [Lang::Ja, Lang::Fr, Lang::En]
    }
}

impl std::fmt::Display for Lang {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}

/// Statistiques d'un personnage à un niveau donné.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StatBlock {
    pub kick: u32,
    pub control: u32,
    pub technique: u32,
    pub pressure: u32,
    pub physical: u32,
    pub agility: u32,
    pub intelligence: u32,
}

impl StatBlock {
    /// Somme des 7 stats.
    #[must_use]
    pub fn total(&self) -> u32 {
        self.kick
            + self.control
            + self.technique
            + self.pressure
            + self.physical
            + self.agility
            + self.intelligence
    }
}

/// Courbes de stats sur les 4 paliers de niveau.
///
/// Le Zukan n'expose que Lv50 par défaut (une seule colonne visible dans le HTML).
/// Les niveaux 100/150/200 sont présents dans le sélecteur mais rendus côté client via JS —
/// le HTML pré-rendu ne contient que Lv50. On stocke ce qu'on récupère réellement.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StatCurves {
    pub lv50: Option<StatBlock>,
    pub lv100: Option<StatBlock>,
    pub lv150: Option<StatBlock>,
    pub lv200: Option<StatBlock>,
}

/// Entrée de personnage extraite du Zukan Inagle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZukanChara {
    /// Identifiant jeu (ex. `c01000010`), clé de croisement avec inagle.
    pub game_id: String,
    /// Langue de cet enregistrement.
    pub lang: Lang,
    /// Nom complet (avec ruby/rubi si présent).
    pub name: String,
    /// Surnom/nickname (forme courte, ex. `円堂`).
    pub nickname: Option<String>,
    /// Description (bio du personnage).
    pub description: Option<String>,
    /// Œuvre d'origine (ex. `イナズマイレブン`).
    pub game_appearance: Option<String>,
    /// Méthode d'acquisition (texte libre du HTML).
    pub acquisition: Option<String>,
    /// Position : GK / DF / MF / FW
    pub position: Option<String>,
    /// Élément : 山/Forest/… (terme dans la langue du pull)
    pub element: Option<String>,
    /// Tranche d'âge (年代区分) : ex. `中学生`
    pub age_group: Option<String>,
    /// Année scolaire (学年) : ex. `二年生`
    pub school_year: Option<String>,
    /// Genre (性別) : 男/女
    pub gender: Option<String>,
    /// Catégorie perso (キャラカテゴリ) : 選手/監督/…
    pub chara_category: Option<String>,
    /// Stats par palier de niveau.
    pub stats: StatCurves,
    /// URL de l'image portrait (CDN CloudFront).
    pub image_url: Option<String>,
    /// Hash de l'image (extrait du path CDN, ex. `dwho-wi8ruk`).
    pub image_hash: Option<String>,
}

/// Entrée de skill (必殺技) extraite du Zukan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZukanSkill {
    /// Nom de la technique.
    pub name: String,
    /// Langue.
    pub lang: Lang,
    /// Description.
    pub description: Option<String>,
    /// Catégorie : シュート/オフェンス/ディフェンス/キーパー
    pub category: Option<String>,
    /// Page de provenance (pour la reprise).
    pub page: u32,
    /// URL vidéo de démonstration (WMV).
    pub video_url: Option<String>,
    /// URL poster (image de prévisualisation).
    pub poster_url: Option<String>,
    /// URL thumbnail.
    pub thumbnail_url: Option<String>,
}

/// Entrée d'item extraite du Zukan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZukanItem {
    /// Nom de l'item.
    pub name: String,
    /// Langue.
    pub lang: Lang,
    /// Catégorie : シューズ/ミサンガ/ペンダント/スペシャル
    pub category: Option<String>,
    /// URL de l'image.
    pub image_url: Option<String>,
    /// Hash de l'image (extrait du path CDN).
    pub image_hash: Option<String>,
    /// Rubi/lecture du nom (texte `<rt>`).
    pub name_rubi: Option<String>,
    /// Page de provenance.
    pub page: u32,
}

/// Résultats bruts d'une page chara_list.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharaListEntry {
    /// Identifiant jeu extrait du lien `chara_model_view/?q=`.
    pub game_id: String,
    /// q pour chara_param (extrait du lien `chara_param/?q=`).
    pub q_param: String,
    /// q pour chara_model_view.
    pub q_model: String,
    /// Nom affiché sur la liste.
    pub name: String,
}

/// Résultat du croisement avec le miroir inagle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossResult {
    /// Nombre total d'IDs zukan.
    pub zukan_total: usize,
    /// Nombre d'IDs matchant dans inagle (via `chara_id`).
    pub matched: usize,
    /// IDs présents dans le zukan mais absents d'inagle.
    pub absent_from_inagle: Vec<String>,
    /// Exemples de champs que le zukan a et pas inagle (pour les matchés).
    pub enrichment_examples: Vec<EnrichmentExample>,
}

/// Exemple de donnée présente dans le zukan mais absente ou différente dans inagle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrichmentExample {
    pub game_id: String,
    pub name_ja: String,
    pub field: String,
    pub zukan_value: String,
    pub inagle_value: Option<String>,
}
