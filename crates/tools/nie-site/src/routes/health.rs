//! `/healthz` — ce que la machine peut réellement répondre, mesuré à l'instant de l'appel.
//!
//! ## Ni nom ni version
//!
//! La réponse portait `service: "nie-site"` et `version: "0.5.11"`. Deux champs, deux
//! défauts. Le premier annonce à qui la lit qu'il y a un serveur d'outils derrière une origine
//! qui doit se présenter comme le jeu ; le second désigne exactement quelle version chercher
//! dans un avis de sécurité. Aucun des deux ne sert la question posée à une sonde — *est-ce que
//! ça répond, et que sait faire cette instance* —, à laquelle `etat` et `capacites` répondent
//! entièrement.
//!
//! La gate de déploiement cherchait la chaîne `nie-site` ici. Elle porte désormais sur
//! `capacites`, que l'ancien service de `:8083` ne rendait pas : c'est la même distinction,
//! faite sur ce que la sonde mesure au lieu de ce qu'elle déclare.

use axum::Json;
use axum::extract::State;
use serde::Serialize;

use crate::state::{Capacites, EtatSite};

/// Corps de `/healthz`.
#[derive(Debug, Serialize)]
pub struct Sante {
    /// `ok` tant que le processus répond — une capacité absente ne rend pas le service malade.
    pub etat: &'static str,
    /// Capacités mesurées, jamais supposées.
    pub capacites: Capacites,
}

/// Répond `/healthz`.
pub async fn healthz(State(etat): State<EtatSite>) -> Json<Sante> {
    Json(Sante {
        etat: "ok",
        capacites: etat.capacites(),
    })
}
