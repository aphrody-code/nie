//! Les routes du serveur, une par module, plus le DTO de pagination qu'elles partagent.

pub mod aphrody;
pub mod api_v1;
pub mod assets;
pub mod conditions;
pub mod couverture;
pub mod donnees;
pub mod downloads;
pub mod entites;
pub mod episodes;
pub mod feed;
pub mod formats;
pub mod game_data;
pub mod geometrie;
/// GraphQL en lecture seule sur le corpus de texte (cf. `routes::text`).
pub mod graphql;
pub mod growth;
pub mod health;
pub mod inspect;
/// La Ville de lien de la Station Kizuna — cf. le module pour ce que le catalogue prouve.
pub mod kizuna;
pub mod level5;
pub mod lua;
pub mod menu;
pub mod menu_audio;
pub mod menu_runtime;
pub mod modeles3d;
pub mod motion;
pub mod native_export;
pub mod online;
/// OpenAPI généré depuis le routeur — cf. le module pour ce qu'il décrit et ce qu'il ne décrit pas.
pub mod openapi;
pub mod pages;
pub mod passives;
pub mod playstyles;
pub mod profile;
pub mod recherche;
pub mod regles;
pub mod related;
pub mod save;
pub mod screens;
pub mod spatial_preview;
pub mod static_files;
pub mod team;
pub mod text;
pub(crate) mod text_cache;
pub mod ut;
pub mod vfs;
pub mod well_known;
pub mod wiki;
pub mod zukan;

use serde::{Deserialize, Serialize};

use crate::config::Pagination;
use crate::error::ErreurSite;

/// Demande de pagination telle qu'elle arrive en query (`?page=&per_page=`).
///
/// Les deux champs historiques restent la forme acceptée par toutes les routes qui partagent
/// ce DTO ; `query`, `limit` et `cursor` sont les noms canoniques posés par
/// `aphrody-contracts/docs/API.md` §6.3/§6.4, ajoutés en **alias**, jamais en remplacement —
/// `q`/`page`/`per_page` continuent de fonctionner seuls, sans jamais être retirés.
///
/// **Champs à plat, jamais `#[serde(flatten)]`** : `Query<T>` d'axum désérialise une structure
/// aplatie à travers un tampon où toute valeur de query string est une **chaîne**, et
/// `?limit=2` échouerait alors en « invalid type: string "2", expected u32 » — piège déjà payé
/// sur `Demande` (`routes::recherche`) et `SearchQuery` (`routes::text`).
#[derive(Debug, Default, Clone, Deserialize)]
pub struct DemandePage {
    /// Numéro de page, à partir de 1.
    pub page: Option<u32>,
    /// Nombre d'éléments par page, plafonné à [`crate::config::PER_PAGE_MAX`].
    pub per_page: Option<u32>,
    /// Motif de recherche, comparé sans casse au chemin ENTIER. Vide ou absent : aucun filtre.
    pub q: Option<String>,
    /// Alias canonique de `q` (`aphrody-contracts` §6.3). Les deux sont acceptés ; `query`
    /// gagne quand le client fournit les deux.
    pub query: Option<String>,
    /// Alias canonique de `per_page` (`aphrody-contracts` §6.3). Même priorité que `query`.
    pub limit: Option<u32>,
    /// Curseur de page opaque (`aphrody-contracts` §6.4) : base64 standard de la représentation
    /// décimale ASCII d'un numéro de page. Ignoré si `page` est fourni explicitement ; un
    /// curseur illisible est un `400`, jamais une page 1 rendue en silence.
    pub cursor: Option<String>,
}

impl DemandePage {
    /// Le motif de recherche réellement retenu : `query` prime sur `q`, son alias historique.
    #[must_use]
    pub fn effective_q(&self) -> Option<String> {
        self.query.clone().or_else(|| self.q.clone())
    }

    /// La taille de page réellement demandée : `limit` prime sur `per_page`.
    fn effective_per_page(&self) -> Option<u32> {
        self.limit.or(self.per_page)
    }

    /// Le numéro de page réellement demandé : `page` explicite prime sur `cursor`.
    ///
    /// # Errors
    ///
    /// [`ErreurSite::Demande`] si `cursor` est fourni, que `page` ne l'est pas, et que le
    /// curseur ne décode pas en un numéro de page valide.
    fn resolved_page(&self) -> Result<Option<u32>, ErreurSite> {
        if self.page.is_some() {
            return Ok(self.page);
        }
        match self.cursor.as_deref().filter(|c| !c.is_empty()) {
            Some(cursor) => decoder_curseur(cursor).map(Some),
            None => Ok(None),
        }
    }

    /// Bornes effectives de la demande.
    ///
    /// # Errors
    ///
    /// [`ErreurSite::Demande`] si `cursor` est fourni et illisible — cf. [`Self::resolved_page`].
    pub fn bornee(&self) -> Result<Pagination, ErreurSite> {
        Ok(Pagination::borner(
            self.resolved_page()?,
            self.effective_per_page(),
        ))
    }
}

/// Encode le curseur qui désigne `page` : base64 standard de son écriture décimale
/// (`encoder_curseur(3) == "Mw=="`). C'est la réciproque exacte de [`decoder_curseur`], et la
/// seule façon dont un serveur publie un curseur — un client n'a jamais à le fabriquer.
#[must_use]
pub(crate) fn encoder_curseur(page: u32) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(page.to_string())
}

/// Décode un curseur de pagination : base64 standard de la représentation décimale ASCII d'un
/// numéro de page (`cursor("3") == "Mw=="`). Un curseur illisible est un `400` nommé, jamais une
/// page 1 rendue en silence — le client croirait avoir atteint le début de la collection.
fn decoder_curseur(cursor: &str) -> Result<u32, ErreurSite> {
    use base64::Engine as _;
    let octets = base64::engine::general_purpose::STANDARD
        .decode(cursor)
        .map_err(|e| ErreurSite::Demande(format!("cursor illisible: {e}")))?;
    let texte = String::from_utf8(octets)
        .map_err(|_| ErreurSite::Demande("cursor illisible: pas de l'UTF-8".to_owned()))?;
    texte
        .parse::<u32>()
        .map_err(|_| ErreurSite::Demande(format!("cursor illisible: `{texte}` n'est pas une page")))
}

/// Une page de résultats. Tous les catalogues de l'API en passent par là — il n'existe aucune
/// route qui rende une collection entière.
#[derive(Debug, Clone, Serialize)]
pub struct Page<T> {
    /// Éléments de la page.
    pub elements: Vec<T>,
    /// Page rendue (après bornage).
    pub page: u32,
    /// Taille de page appliquée (après bornage).
    pub per_page: u32,
    /// Nombre total d'éléments, toutes pages confondues — **après** filtrage.
    pub total: usize,
    /// Nombre total de pages.
    pub pages: usize,
    /// Le motif `q` réellement appliqué, `null` s'il n'y en avait pas.
    ///
    /// # Pourquoi ce champ existe
    ///
    /// Mesuré le 2026-09-06 par `scripts/validation/mesurer-filtres.sh` : six routes
    /// appliquaient `q` correctement — le total baissait — mais **ne le republiaient pas**.
    /// Vu du client, « filtre appliqué » et « filtre avalé » se ressemblent alors exactement :
    /// dans les deux cas il reçoit une liste et un total, et rien ne dit lequel des deux il
    /// tient. `/api/v1/recherche` et `/b` republiaient déjà leur bloc `filtres` ; ce champ
    /// donne la même garantie à tout ce qui passe par `Page`.
    ///
    /// C'est le pendant du défaut n°1 du lot 8 (`/b` acceptait `q` et l'ignorait) : là on
    /// n'appliquait pas, ici on n'avouait pas.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub q: Option<String>,
}

impl<T> Page<T> {
    /// Assemble une page à partir des éléments déjà découpés et du total connu.
    #[must_use]
    pub fn nouvelle(elements: Vec<T>, p: Pagination, total: usize) -> Self {
        let per_page = p.per_page as usize;
        Self {
            elements,
            page: p.page,
            per_page: p.per_page,
            total,
            pages: total.div_ceil(per_page.max(1)),
            q: None,
        }
    }

    /// La même page, en **republiant** le motif appliqué.
    ///
    /// À utiliser dès qu'une route accepte `q` : un filtre honoré mais tu est indiscernable
    /// d'un filtre ignoré.
    #[must_use]
    pub fn filtree(mut self, q: Option<String>) -> Self {
        self.q = q;
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compte_des_pages() {
        let p = Pagination::borner(Some(1), Some(50));
        assert_eq!(Page::nouvelle(vec![1, 2], p, 101).pages, 3);
        assert_eq!(Page::nouvelle(Vec::<u8>::new(), p, 0).pages, 0);
        assert_eq!(Page::nouvelle(vec![1], p, 50).pages, 1);
    }

    #[test]
    fn query_et_limit_sont_des_alias_qui_priment_sur_q_et_per_page() {
        // Les noms canoniques (`aphrody-contracts` §6.3) l'emportent, mais les historiques
        // restent lisibles : aucun des deux n'est jamais retiré.
        let d = DemandePage {
            q: Some("ancien".to_owned()),
            query: Some("canonique".to_owned()),
            per_page: Some(10),
            limit: Some(25),
            ..DemandePage::default()
        };
        assert_eq!(d.effective_q(), Some("canonique".to_owned()));
        assert_eq!(d.bornee().unwrap().per_page, 25);

        // Sans l'alias, l'historique fonctionne toujours seul.
        let historique = DemandePage {
            q: Some("ancien".to_owned()),
            per_page: Some(10),
            ..DemandePage::default()
        };
        assert_eq!(historique.effective_q(), Some("ancien".to_owned()));
        assert_eq!(historique.bornee().unwrap().per_page, 10);
    }

    #[test]
    fn cursor_decode_en_page_et_page_explicite_prime_sur_lui() {
        let curseur = encoder_curseur(3);
        assert_eq!(curseur, "Mw==");
        let d = DemandePage {
            cursor: Some(curseur.clone()),
            ..DemandePage::default()
        };
        assert_eq!(d.bornee().unwrap().page, 3);

        // `page` explicite gagne : le curseur ne doit jamais l'écraser en silence.
        let d = DemandePage {
            page: Some(1),
            cursor: Some(curseur),
            ..DemandePage::default()
        };
        assert_eq!(d.bornee().unwrap().page, 1);
    }

    #[test]
    fn un_cursor_illisible_est_refuse_pas_avale_en_page_1() {
        for illisible in ["!!!pas du base64!!!", "dGV4dGUgcGFzIHVuIG5vbWJyZQ=="] {
            let d = DemandePage {
                cursor: Some(illisible.to_owned()),
                ..DemandePage::default()
            };
            assert!(
                d.bornee().is_err(),
                "`{illisible}` doit etre refuse, pas retomber sur la page 1"
            );
        }
    }
}
