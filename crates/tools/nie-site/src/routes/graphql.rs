//! `/api/v1/graphql` — le corpus de texte du jeu, interrogeable en une requête.
//!
//! ## Pourquoi cette route existe à côté du REST
//!
//! `/api/v1/text` sert le même corpus, et le sert bien : catalogue mesuré, familles, lignes
//! paginées, recherche. Mais une question comme *« le texte de l'écran de la boutique en
//! français ET en japonais, avec le nombre de lignes de la famille »* coûte trois allers-retours
//! et trois réponses dont on jette l'essentiel. C'est exactement ce que GraphQL résout, et c'est
//! la seule raison pour laquelle il est là : pas une mode, une économie mesurable de requêtes.
//!
//! Rien n'est dupliqué. Les résolveurs appellent les MÊMES fonctions que les routes REST
//! (`super::text::survey`, `resolve`, `load`), donc le catalogue est construit une fois pour les
//! deux surfaces et un correctif profite aux deux.
//!
//! ## Ce que le schéma ne fait pas
//!
//! Il n'expose ni mutation, ni abonnement : ce service est en lecture seule, et un schéma qui
//! déclarerait `Mutation` sans en avoir mentirait à son introspection. Il ne pagine pas non plus
//! « à la Relay » (curseurs, `edges`, `pageInfo`) — les routes REST paginent par page et par
//! taille, et offrir deux modèles de pagination pour un seul corpus ferait diverger les deux
//! surfaces à la première évolution.

use async_graphql::{Context, EmptyMutation, EmptySubscription, Object, Schema, SimpleObject};
use axum::extract::State;
use axum::response::{Html, IntoResponse, Response};

use crate::error::ErreurSite;
use crate::state::EtatSite;

/// Une famille de texte et ce qu'on en sait, sans son contenu.
#[derive(SimpleObject)]
pub struct Family {
    /// Nom de la famille, tel que le jeu nomme ses fichiers (`menu_text`, `skill_text`…).
    pub family: String,
    /// Les langues dans lesquelles elle existe réellement.
    pub languages: Vec<String>,
    /// Nombre de fichiers agrégés.
    pub files: i32,
    /// Nombre de lignes, toutes langues confondues.
    pub lines: i32,
}

/// Une ligne de texte, avec l'identité sous laquelle le jeu l'adresse.
#[derive(SimpleObject)]
pub struct TextLine {
    /// Le hash, en hexadécimal — c'est sous cette forme que le reverse le cite.
    pub hash: String,
    /// Le texte, nettoyé (furigana, balises, échappements) par `nie_data::text`.
    pub text: String,
}

/// La racine de lecture.
pub struct Query;

#[Object]
impl Query {
    /// Les langues que le jeu livre réellement — mesurées sur le VFS, pas déclarées ici.
    ///
    /// Neuf au dernier relevé (`de`, `en`, `es`, `fr`, `it`, `ja`, `pt`, `zh_hans`, `zh_hant`),
    /// là où le SITE n'en sert que trois : les deux nombres n'ont pas à coïncider, et publier
    /// celui du jeu évite de faire croire que le reste n'existe pas.
    async fn languages(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<String>> {
        let state = ctx.data_unchecked::<EtatSite>().clone();
        let survey = super::text::survey(&state).await.map_err(erreur)?;
        Ok(survey
            .languages()
            .into_iter()
            .map(str::to_owned)
            .collect())
    }

    /// Les familles, filtrées par langue quand on en donne une.
    async fn families(
        &self,
        ctx: &Context<'_>,
        language: Option<String>,
    ) -> async_graphql::Result<Vec<Family>> {
        let state = ctx.data_unchecked::<EtatSite>().clone();
        let survey = super::text::survey(&state).await.map_err(erreur)?;
        // Sans langue demandée, on agrège les familles de toutes les langues : une famille
        // n'existe pas « en général », elle existe dans les langues où le jeu la livre, et c'est
        // ce que le champ `languages` de chaque entrée dit.
        let langues: Vec<String> = match language {
            Some(demandee) => vec![demandee],
            None => survey
                .languages()
                .into_iter()
                .map(str::to_owned)
                .collect(),
        };
        let mut par_famille: std::collections::BTreeMap<String, (Vec<String>, usize, usize)> =
            std::collections::BTreeMap::new();
        for langue in &langues {
            for (famille, fichiers, lignes) in survey.families_of_language(langue) {
                let entree = par_famille.entry(famille.to_owned()).or_default();
                entree.0.push(langue.clone());
                entree.1 += fichiers;
                entree.2 += lignes;
            }
        }
        Ok(par_famille
            .into_iter()
            .map(|(famille, (langues, fichiers, lignes))| Family {
                family: famille,
                languages: langues,
                files: i32::try_from(fichiers).unwrap_or(i32::MAX),
                lines: i32::try_from(lignes).unwrap_or(i32::MAX),
            })
            .collect())
    }

    /// Les lignes d'une famille dans une langue, bornées.
    ///
    /// `limit` est plafonné : une famille en compte jusqu'à 187 218 (`chara_text`), et rendre un
    /// corpus entier dans une réponse GraphQL ferait de ce service un générateur de mémoire.
    async fn lines(
        &self,
        ctx: &Context<'_>,
        language: String,
        family: String,
        #[graphql(default = 100)] limit: i32,
        #[graphql(default = 0)] offset: i32,
        contains: Option<String>,
    ) -> async_graphql::Result<Vec<TextLine>> {
        let state = ctx.data_unchecked::<EtatSite>().clone();
        let survey = super::text::survey(&state).await.map_err(erreur)?;
        let paths = super::text::resolve(survey, &language, &family).map_err(erreur)?;
        let lines = super::text::load(&state, paths).await.map_err(erreur)?;
        let needle = contains
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_lowercase);
        let limit = limit.clamp(1, MAX_LINES) as usize;
        let offset = offset.max(0) as usize;
        Ok(lines
            .iter()
            .filter(|line| {
                needle
                    .as_ref()
                    .is_none_or(|value| line.text.to_lowercase().contains(value))
            })
            .skip(offset)
            .take(limit)
            .map(|line| TextLine {
                hash: line.hash_hex.clone(),
                text: line.text.clone(),
            })
            .collect())
    }
}

/// Plafond de lignes par requête. `chara_text` en compte 187 218 : sans borne, une seule requête
/// suffirait à faire rendre tout le corpus.
const MAX_LINES: i32 = 500;

/// Traduit une erreur du service en erreur GraphQL, en gardant son message.
fn erreur(source: ErreurSite) -> async_graphql::Error {
    async_graphql::Error::new(source.to_string())
}

/// Le schéma, construit une fois par requête — il ne porte aucun état, l'état vient du contexte.
fn schema(state: EtatSite) -> Schema<Query, EmptyMutation, EmptySubscription> {
    Schema::build(Query, EmptyMutation, EmptySubscription)
        .data(state)
        .finish()
}

/// `POST /api/v1/graphql` — exécute une requête.
pub async fn execute(
    State(state): State<EtatSite>,
    request: async_graphql_axum::GraphQLRequest,
) -> async_graphql_axum::GraphQLResponse {
    schema(state).execute(request.into_inner()).await.into()
}

/// `GET /api/v1/graphql` — ce que la route attend, en clair.
///
/// Pas un bac à sable interactif : celui-ci chargerait du JavaScript depuis un CDN, et cette
/// origine ne publie rien qu'elle n'héberge pas. Une page qui montre le schéma et un exemple
/// suffit à savoir quoi envoyer.
pub async fn playground() -> Response {
    Html(
        r#"<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>GraphQL</title></head><body>
<h1>/api/v1/graphql</h1>
<p>Une requête POST, corps JSON <code>{"query": "…"}</code>. Lecture seule.</p>
<pre>{
  languages
  families(language: "fr") { family lines }
  lines(language: "fr", family: "menu_text", limit: 5) { hash text }
}</pre>
<p>Le même corpus est servi en JSON et en texte brut sur <code>/api/v1/text</code>.</p>
</body></html>"#,
    )
    .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Le schéma s'introspecte, et il déclare ce qu'il fait vraiment : pas de mutation.
    #[test]
    fn le_schema_est_en_lecture_seule() {
        let sdl = Schema::build(Query, EmptyMutation, EmptySubscription)
            .finish()
            .sdl();
        assert!(sdl.contains("type Query"), "la racine de lecture existe");
        assert!(
            !sdl.contains("type Mutation"),
            "aucune mutation ne doit être déclarée : ce service est en lecture seule"
        );
        for champ in ["languages", "families", "lines"] {
            assert!(sdl.contains(champ), "{champ} doit être exposé");
        }
    }

    /// Le plafond de lignes est réel, et il borne aussi une demande absurde.
    #[test]
    fn le_plafond_de_lignes_borne_les_deux_bouts() {
        assert_eq!(i32::MAX.clamp(1, MAX_LINES), MAX_LINES);
        assert_eq!((-5_i32).clamp(1, MAX_LINES), 1);
        assert_eq!(100_i32.clamp(1, MAX_LINES), 100);
    }
}
