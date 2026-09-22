//! Adapter from the portable Chara Edit OC document to an optional typed ocgen recipe.
//!
//! Loading this adapter performs no filesystem access and writes nothing. A Chara Edit state is
//! not itself an ocgen recipe: morphology indices and part selections do not identify the
//! measured morphology stem, probes, or hashed target slots required by [`Recipe`].

use nie_data::avatar_reference::OcAvatarDocument;

use crate::recipe::Recipe;

/// Typed result of checking whether an OC draft is ready for the generator.
#[derive(Debug, Clone, PartialEq)]
pub struct AvatarDocumentAdapter {
    pub recipe: Option<Recipe>,
    pub blockers: Vec<String>,
}

/// Validate the optional embedded recipe without loading game data or OC source images.
#[must_use]
pub fn adapt_avatar_document(document: &OcAvatarDocument) -> AvatarDocumentAdapter {
    let Some(value) = document.generation_recipe.clone() else {
        return AvatarDocumentAdapter {
            recipe: None,
            blockers: vec![
                "generationRecipe is absent; Chara Edit selections do not prove ocgen slot bindings"
                    .to_string(),
            ],
        };
    };
    let recipe = match serde_json::from_value::<Recipe>(value) {
        Ok(recipe) => recipe,
        Err(error) => {
            return AvatarDocumentAdapter {
                recipe: None,
                blockers: vec![format!("generationRecipe is invalid: {error}")],
            };
        }
    };
    let mut blockers = Vec::new();
    if recipe.slug != document.slug {
        blockers.push("generationRecipe.slug differs from the OC document slug".to_string());
    }
    if document.internal_code.as_deref() != Some(recipe.internal_code.as_str()) {
        blockers.push(
            "generationRecipe.internal_code differs from the OC document internalCode".to_string(),
        );
    }
    AvatarDocumentAdapter {
        recipe: blockers.is_empty().then_some(recipe),
        blockers,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nie_data::avatar::AvatarState;
    use nie_data::avatar_reference::OcAvatarDocument;
    use serde_json::json;

    fn document(recipe: Option<serde_json::Value>) -> OcAvatarDocument {
        OcAvatarDocument {
            schema: "nie.oc.avatar-document/v1".into(),
            slug: "new-oc".into(),
            internal_code: Some("c99000010".into()),
            avatar_state: AvatarState::default(),
            generation_recipe: recipe,
            references: vec![],
            provenance: vec![],
        }
    }

    #[test]
    fn missing_recipe_is_an_explicit_blocker_not_a_guessed_conversion() {
        let adapted = adapt_avatar_document(&document(None));
        assert!(adapted.recipe.is_none());
        assert_eq!(adapted.blockers.len(), 1);
    }

    #[test]
    fn accepts_a_typed_identity_consistent_recipe_without_filesystem_io() {
        let recipe = json!({
            "slug": "new-oc",
            "internal_code": "c99000010",
            "name": "new_oc",
            "morphology": {"stem": "mdl_editpreview_avatar_tall01"},
            "probes": [], "colors": [], "parts": [], "bones": [], "icons": []
        });
        let adapted = adapt_avatar_document(&document(Some(recipe)));
        assert!(adapted.blockers.is_empty());
        assert_eq!(adapted.recipe.unwrap().internal_code, "c99000010");
    }

    #[test]
    fn refuses_a_recipe_for_another_character() {
        let recipe = json!({
            "slug": "other", "internal_code": "c99000020", "name": "other",
            "morphology": {"stem": "mdl_editpreview_avatar_tall01"},
            "probes": [], "colors": []
        });
        let adapted = adapt_avatar_document(&document(Some(recipe)));
        assert!(adapted.recipe.is_none());
        assert_eq!(adapted.blockers.len(), 2);
    }
}
