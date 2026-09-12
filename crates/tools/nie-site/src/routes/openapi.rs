//! `/api/v1/openapi.json` — la surface servie, décrite par le routeur lui-même.
//!
//! ## Pourquoi ce document est GÉNÉRÉ
//!
//! Une spécification écrite à la main décrit ce que quelqu'un croyait servir le jour où il l'a
//! écrite. Celle-ci est construite à partir de [`crate::app::chemins`] et de
//! [`crate::app::CHEMINS_HORS_GET`] — les deux mêmes constantes que le routeur monte — donc elle
//! ne peut pas dériver : ajouter une route sans l'y voir apparaître demanderait de contourner la
//! macro qui monte le routeur, ce que le test `seules_les_routes_declarees_sortent_du_get`
//! interdit déjà.
//!
//! C'est la leçon de la façade voisine : là-bas PostgREST dérive son OpenAPI du schéma SQL et
//! `pg_graphql` en dérive son schéma GraphQL, si bien qu'aucune des deux surfaces ne peut mentir
//! sur la base. Ici la source unique n'est pas une base, c'est le routeur.
//!
//! ## Ce que ce document N'EST PAS
//!
//! Ce n'est pas un contrat de corps de réponse. Les routes rendent des formes très
//! différentes — un catalogue de texte, une image PNG, un layout de menu, un plan de site — et
//! décrire chacune demanderait d'écrire à la main ce que le code sait déjà, donc de créer
//! exactement la dérive que ce module évite. Le document publie **ce qui est servi, sous quel
//! verbe, et ce que le chemin attend comme paramètres** ; le reste se lit dans la réponse, qui
//! est du JSON auto-descriptif partout sauf sur les routes d'octets.
//!
//! Un champ `description` nomme cette limite dans le document lui-même, pour qu'un client ne
//! prenne pas une absence de schéma pour une promesse de forme libre.

use axum::Json;
use axum::extract::State;
use serde_json::{Value, json};

use crate::app::{CHEMINS_HORS_GET, chemins};
use crate::state::EtatSite;

/// Version d'OpenAPI émise. 3.1 parce que c'est celle qui aligne son modèle de schéma sur JSON
/// Schema ; rien ici n'en dépend, mais annoncer 3.0 pour un document 3.1 tromperait les outils.
const OPENAPI_VERSION: &str = "3.1.0";

/// Les paramètres qu'un motif de route déclare.
///
/// `{param}` consomme un segment, `{*joker}` consomme tout le reste — la règle de `matchit`, que
/// le routeur applique réellement, pas une approximation.
fn parametres(motif: &str) -> Vec<Value> {
    motif
        .split('/')
        .filter_map(|segment| {
            let nom = segment.strip_prefix('{')?.strip_suffix('}')?;
            let (nom, description) = match nom.strip_prefix('*') {
                Some(reste) => (
                    reste,
                    "Chemin complet : ce paramètre consomme tous les segments restants.",
                ),
                None => (nom, "Un segment de chemin."),
            };
            Some(json!({
                "name": nom,
                "in": "path",
                "required": true,
                "description": description,
                "schema": { "type": "string" },
            }))
        })
        .collect()
}

/// Le document, construit depuis le routeur.
fn document(origine: &str) -> Value {
    let mut paths = serde_json::Map::new();
    for motif in chemins() {
        let hors_get = CHEMINS_HORS_GET.contains(&motif);
        let parametres = parametres(motif);
        let mut operations = serde_json::Map::new();
        // Toute route répond à `GET`, y compris celles qui acceptent aussi un `POST` : leur
        // pendant `GET` publie le contrat attendu plutôt qu'un `405` muet.
        operations.insert(
            "get".to_owned(),
            json!({
                "summary": motif,
                "parameters": parametres,
                "responses": { "200": { "description": "Réponse servie." } },
            }),
        );
        if hors_get {
            operations.insert(
                "post".to_owned(),
                json!({
                    "summary": format!("{motif} — calcul sur un corps de requête"),
                    "description": "Le corps porte ce qu'une query string ne peut pas : \
                                    deux personnages entiers, un effectif, une requête GraphQL. \
                                    Aucune écriture : ce service est en lecture seule.",
                    "parameters": parametres,
                    "requestBody": {
                        "required": true,
                        "content": { "application/json": {} },
                    },
                    "responses": { "200": { "description": "Réponse calculée." } },
                }),
            );
        }
        paths.insert(motif.to_owned(), Value::Object(operations));
    }

    json!({
        "openapi": OPENAPI_VERSION,
        "info": {
            "title": "nie",
            "version": "v1",
            "description": "L'inventaire des routes réellement montées, construit depuis le \
                            routeur. Il décrit CE QUI EST SERVI et sous quel verbe ; il ne \
                            décrit pas la forme de chaque corps de réponse, qui se lit dans la \
                            réponse elle-même. Service en lecture seule : aucune route n'écrit.",
        },
        "servers": [{ "url": origine }],
        "paths": Value::Object(paths),
    })
}

/// `GET /api/v1/openapi.json` — le document.
pub async fn document_json(State(state): State<EtatSite>) -> Json<Value> {
    Json(document(&state.config.origine))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_document_decrit_chaque_route_montee() {
        let doc = document("https://exemple.test");
        let paths = doc["paths"].as_object().expect("paths");
        assert_eq!(
            paths.len(),
            chemins().len(),
            "une route montée sans entrée dans le document serait invisible"
        );
        for motif in chemins() {
            assert!(paths.contains_key(motif), "{motif} absent du document");
        }
    }

    #[test]
    fn seules_les_routes_hors_get_declarent_un_post() {
        let doc = document("https://exemple.test");
        let paths = doc["paths"].as_object().expect("paths");
        for (motif, operations) in paths {
            let a_post = operations.get("post").is_some();
            assert_eq!(
                a_post,
                CHEMINS_HORS_GET.contains(&motif.as_str()),
                "{motif} : le document doit déclarer le POST si et seulement si le routeur l'accepte"
            );
            assert!(operations.get("get").is_some(), "{motif} doit répondre à GET");
        }
    }

    #[test]
    fn les_parametres_de_chemin_viennent_du_motif() {
        let simple = parametres("/api/v1/text/{language}/{family}");
        assert_eq!(simple.len(), 2);
        assert_eq!(simple[0]["name"], "language");
        assert_eq!(simple[1]["name"], "family");
        assert_eq!(simple[0]["in"], "path");

        // Un joker consomme tout le reste, et le document le dit.
        let joker = parametres("/api/v1/export/file/{*path}");
        assert_eq!(joker.len(), 1);
        assert_eq!(joker[0]["name"], "path");
        assert!(
            joker[0]["description"]
                .as_str()
                .expect("description")
                .contains("tous les segments")
        );

        assert!(parametres("/api/v1/text").is_empty());
    }
}
