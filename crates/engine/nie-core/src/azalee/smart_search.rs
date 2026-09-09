//! Pure context-aware search from Azalee's `smart-search.ts`.
//!
//! [`smart_search`] only receives an already-built result projection. It
//! enhances multilingual names, filters, prioritizes, limits, and produces a
//! suggestion. It deliberately does not perform HTTP/SQLite/JSON access and
//! does not contain the TypeScript cache, TTL, debounce, or abort-controller
//! behavior. Those are host adapters; the adapter must project its payload to
//! [`GlobalSearchResult`] and can join the returned result back to its payload
//! using `id`.

use std::cmp::Ordering;

use super::search::{
    ClosestMatch, MatchedLanguage, MultilingualNames, detect_matched_language, find_closest_match,
};

/// Searchable IEVR/wiki result categories supported by Azalee.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SearchableType {
    /// BASARA player.
    Basara,
    /// Character.
    Character,
    /// Hissatsu skill.
    Skill,
    /// Item.
    Item,
    /// Tactic.
    Tactic,
    /// Keshin.
    Keshin,
    /// Soul.
    Soul,
    /// Miximax.
    Miximax,
    /// Awakening.
    Awakening,
    /// Mode change.
    ModeChange,
    /// Aura.
    Aura,
    /// Team.
    Team,
    /// News article.
    Article,
    /// Patch note.
    PatchNote,
    /// Passive skill.
    Passive,
    /// X/Twitter post.
    Tweet,
    /// IE RE information.
    Re,
    /// IE Cross information.
    Cross,
    /// LEVEL-5 information.
    Level5,
    /// Topic/documentation information.
    Topic,
    /// Documentation.
    Doc,
}

impl SearchableType {
    /// Returns the stable wire spelling used by the Azalee search payload.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Basara => "basara",
            Self::Character => "character",
            Self::Skill => "skill",
            Self::Item => "item",
            Self::Tactic => "tactic",
            Self::Keshin => "keshin",
            Self::Soul => "soul",
            Self::Miximax => "miximax",
            Self::Awakening => "awakening",
            Self::ModeChange => "modechange",
            Self::Aura => "aura",
            Self::Team => "team",
            Self::Article => "article",
            Self::PatchNote => "patchnote",
            Self::Passive => "passive",
            Self::Tweet => "tweet",
            Self::Re => "re",
            Self::Cross => "cross",
            Self::Level5 => "level5",
            Self::Topic => "topic",
            Self::Doc => "doc",
        }
    }
}

/// Context used to prioritize search result categories.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum SearchContext {
    /// Aura-related entities first.
    Aura,
    /// Characters and BASARA players first.
    Chara,
    /// All categories in the global order.
    #[default]
    Global,
    /// Items and tactics first.
    Item,
    /// News and patch-note categories first.
    News,
    /// Passives only have a preferred category.
    Passive,
    /// Patch notes and related news first.
    PatchNotes,
    /// Skills first.
    Skill,
    /// Tactics and items first.
    Tactic,
    /// Teams, characters, and BASARA players first.
    Team,
}

/// Owned multilingual names accepted by the pure search projection.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SearchNames {
    /// French name.
    pub french: Option<String>,
    /// English name.
    pub english: Option<String>,
    /// Japanese name.
    pub japanese: Option<String>,
}

impl SearchNames {
    /// Builds names from the language values supplied by a host adapter.
    #[must_use]
    pub fn new(french: Option<&str>, english: Option<&str>, japanese: Option<&str>) -> Self {
        Self {
            french: french.map(str::to_owned),
            english: english.map(str::to_owned),
            japanese: japanese.map(str::to_owned),
        }
    }

    fn has_value(&self) -> bool {
        self.french
            .as_deref()
            .is_some_and(|value| !value.is_empty())
            || self
                .english
                .as_deref()
                .is_some_and(|value| !value.is_empty())
            || self
                .japanese
                .as_deref()
                .is_some_and(|value| !value.is_empty())
    }

    fn borrowed(&self) -> MultilingualNames<'_> {
        MultilingualNames {
            french: self.french.as_deref(),
            english: self.english.as_deref(),
            japanese: self.japanese.as_deref(),
        }
    }

    fn value_for(&self, language: MatchedLanguage) -> Option<&str> {
        match language {
            MatchedLanguage::French => self.french.as_deref(),
            MatchedLanguage::English => self.english.as_deref(),
            MatchedLanguage::Japanese => self.japanese.as_deref(),
        }
    }

    fn values<'a>(&'a self, output: &mut Vec<&'a str>) {
        for value in [&self.french, &self.english, &self.japanese] {
            if let Some(value) = value.as_deref().filter(|value| !value.is_empty()) {
                output.push(value);
            }
        }
    }
}

/// Name fields recognized from Azalee's JSON result shapes.
///
/// `names` corresponds to character/BASARA rows, `skill_names` to the
/// uppercase `name_FR`/`name_EN`/`name_JA` fields, and `localized_names` to
/// lowercase `name_fr`/`name_en`/`name_ja` fields. The latter is used for
/// annotation but, like the TypeScript source, is not used for suggestions.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SearchData {
    /// Character/BASARA `names` object.
    pub names: Option<SearchNames>,
    /// Skill sheet `name_FR`/`name_EN`/`name_JA` fields.
    pub skill_names: Option<SearchNames>,
    /// Lowercase `name_fr`/`name_en`/`name_ja` fields.
    pub localized_names: Option<SearchNames>,
}

/// A result projection supplied by a database or web adapter.
#[derive(Debug, Clone, PartialEq)]
pub struct GlobalSearchResult {
    /// Stable result identifier.
    pub id: String,
    /// Default display name.
    pub name: String,
    /// Result category.
    pub result_type: SearchableType,
    /// Upstream relevance score.
    pub score: f32,
    /// Recognized multilingual name fields.
    pub data: Option<SearchData>,
}

/// Search result after language annotation and optional suggestion metadata.
#[derive(Debug, Clone, PartialEq)]
pub struct SmartSearchResult {
    /// Stable result identifier.
    pub id: String,
    /// Default display name.
    pub name: String,
    /// Result category.
    pub result_type: SearchableType,
    /// Upstream relevance score.
    pub score: f32,
    /// Recognized multilingual name fields.
    pub data: Option<SearchData>,
    /// Language that matched the query.
    pub matched_language: Option<MatchedLanguage>,
    /// Original spelling of the matched name.
    pub matched_name: Option<String>,
    /// Original spelling of a closest suggestion when no result survives.
    pub suggestion: Option<String>,
}

/// Configuration for the pure smart-search operation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SmartSearchConfig {
    /// Context-specific result priority.
    pub context: SearchContext,
    /// Maximum number of returned results.
    pub limit: usize,
    /// Whether to emit a suggestion placeholder when no result survives.
    pub enable_suggestions: bool,
    /// Minimum upstream score. Values `<= 0` disable filtering.
    pub min_score: f32,
}

impl Default for SmartSearchConfig {
    fn default() -> Self {
        Self {
            context: SearchContext::Global,
            limit: 20,
            enable_suggestions: true,
            min_score: 0.0,
        }
    }
}

/// Applies Azalee's context-aware enhancement, ordering, filtering, limiting,
/// and suggestion rules to already-loaded results.
#[must_use]
pub fn smart_search(
    query: &str,
    raw_results: &[GlobalSearchResult],
    config: SmartSearchConfig,
) -> Vec<SmartSearchResult> {
    let mut results: Vec<_> = raw_results
        .iter()
        .map(|result| enhance(result, query))
        .collect();

    if config.min_score > 0.0 {
        results.retain(|result| result.score >= config.min_score);
    }

    let priorities = priorities(config.context);
    results.sort_by(|left, right| {
        type_priority(left.result_type, priorities)
            .cmp(&type_priority(right.result_type, priorities))
            .then_with(|| {
                right
                    .score
                    .partial_cmp(&left.score)
                    .unwrap_or(Ordering::Equal)
            })
    });
    results.truncate(config.limit);

    if results.is_empty()
        && config.enable_suggestions
        && let Some(suggestion) = generate_suggestion(query, raw_results)
    {
        results.push(SmartSearchResult {
            id: String::new(),
            name: String::new(),
            result_type: SearchableType::Character,
            score: 0.0,
            data: None,
            matched_language: None,
            matched_name: None,
            suggestion: Some(suggestion.value),
        });
    }

    results
}

fn enhance(result: &GlobalSearchResult, query: &str) -> SmartSearchResult {
    let mut enhanced = SmartSearchResult {
        id: result.id.clone(),
        name: result.name.clone(),
        result_type: result.result_type,
        score: result.score,
        data: result.data.clone(),
        matched_language: None,
        matched_name: None,
        suggestion: None,
    };

    if let Some(data) = result.data.as_ref() {
        for names in [&data.names, &data.skill_names, &data.localized_names]
            .into_iter()
            .flatten()
            .filter(|names| names.has_value())
        {
            if let Some(language) = detect_matched_language(query, names.borrowed()) {
                enhanced.matched_language = Some(language);
                enhanced.matched_name = Some(
                    names
                        .value_for(language)
                        .filter(|value| !value.is_empty())
                        .unwrap_or(&result.name)
                        .to_owned(),
                );
            }
        }
    }

    enhanced
}

fn generate_suggestion(query: &str, raw_results: &[GlobalSearchResult]) -> Option<ClosestMatch> {
    let mut names = Vec::new();
    for result in raw_results {
        if let Some(data) = result.data.as_ref() {
            if let Some(values) = data.names.as_ref() {
                values.values(&mut names);
            }
            if let Some(values) = data.skill_names.as_ref() {
                values.values(&mut names);
            }
        }
    }
    find_closest_match(query, &names, 0.6)
}

fn priorities(context: SearchContext) -> &'static [SearchableType] {
    match context {
        SearchContext::Aura => &[
            SearchableType::Keshin,
            SearchableType::Soul,
            SearchableType::Miximax,
            SearchableType::Awakening,
            SearchableType::ModeChange,
            SearchableType::Aura,
        ],
        SearchContext::Chara => &[SearchableType::Basara, SearchableType::Character],
        SearchContext::Global => &[
            SearchableType::Basara,
            SearchableType::Character,
            SearchableType::Skill,
            SearchableType::Keshin,
            SearchableType::Soul,
            SearchableType::Miximax,
            SearchableType::Awakening,
            SearchableType::ModeChange,
            SearchableType::Aura,
            SearchableType::Item,
            SearchableType::Tactic,
            SearchableType::Team,
            SearchableType::Article,
            SearchableType::PatchNote,
            SearchableType::Tweet,
            SearchableType::Re,
            SearchableType::Cross,
            SearchableType::Level5,
            SearchableType::Topic,
            SearchableType::Doc,
        ],
        SearchContext::Item => &[SearchableType::Item, SearchableType::Tactic],
        SearchContext::News => &[
            SearchableType::Article,
            SearchableType::PatchNote,
            SearchableType::Tweet,
            SearchableType::Level5,
            SearchableType::Topic,
        ],
        SearchContext::Passive => &[SearchableType::Passive],
        SearchContext::PatchNotes => &[
            SearchableType::PatchNote,
            SearchableType::Article,
            SearchableType::Tweet,
            SearchableType::Topic,
        ],
        SearchContext::Skill => &[SearchableType::Skill],
        SearchContext::Tactic => &[SearchableType::Tactic, SearchableType::Item],
        SearchContext::Team => &[
            SearchableType::Team,
            SearchableType::Character,
            SearchableType::Basara,
        ],
    }
}

fn type_priority(result_type: SearchableType, priorities: &[SearchableType]) -> usize {
    priorities
        .iter()
        .position(|candidate| *candidate == result_type)
        .unwrap_or(usize::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn result(
        id: &str,
        name: &str,
        result_type: SearchableType,
        score: f32,
        data: SearchData,
    ) -> GlobalSearchResult {
        GlobalSearchResult {
            id: id.to_owned(),
            name: name.to_owned(),
            result_type,
            score,
            data: Some(data),
        }
    }

    fn character_data() -> SearchData {
        SearchData {
            names: Some(SearchNames::new(
                Some("Mark Evans"),
                Some("Mark Evans"),
                Some("円堂 守"),
            )),
            ..Default::default()
        }
    }

    #[test]
    fn prioritizes_context_then_score_and_respects_limit() {
        let raw = vec![
            result(
                "team",
                "Mark's team",
                SearchableType::Team,
                1.0,
                character_data(),
            ),
            result(
                "skill",
                "Mark skill",
                SearchableType::Skill,
                0.1,
                character_data(),
            ),
            result(
                "chara",
                "Mark",
                SearchableType::Character,
                0.8,
                character_data(),
            ),
        ];
        let results = smart_search(
            "Mark",
            &raw,
            SmartSearchConfig {
                context: SearchContext::Skill,
                limit: 2,
                ..Default::default()
            },
        );
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].result_type, SearchableType::Skill);
        assert_eq!(results[1].result_type, SearchableType::Team);
    }

    #[test]
    fn enhances_uppercase_and_lowercase_name_shapes() {
        let raw = vec![result(
            "skill",
            "Tornade de feu",
            SearchableType::Skill,
            1.0,
            SearchData {
                skill_names: Some(SearchNames::new(
                    Some("Tornade de feu"),
                    Some("Fire Tornado"),
                    Some("ファイアトルネード"),
                )),
                ..Default::default()
            },
        )];
        let results = smart_search("ファイア", &raw, SmartSearchConfig::default());
        assert_eq!(results[0].matched_language, Some(MatchedLanguage::Japanese));
        assert_eq!(
            results[0].matched_name.as_deref(),
            Some("ファイアトルネード")
        );

        let localized = vec![result(
            "item",
            "Objet",
            SearchableType::Item,
            1.0,
            SearchData {
                localized_names: Some(SearchNames::new(Some("Objet"), Some("Item"), None)),
                ..Default::default()
            },
        )];
        let localized_results = smart_search("Item", &localized, SmartSearchConfig::default());
        assert_eq!(
            localized_results[0].matched_language,
            Some(MatchedLanguage::English)
        );
        assert_eq!(localized_results[0].matched_name.as_deref(), Some("Item"));
    }

    #[test]
    fn filters_before_suggesting_and_keeps_raw_spelling() {
        let raw = vec![result(
            "team",
            "L'Étoffe des Héros",
            SearchableType::Team,
            1.0,
            SearchData {
                names: Some(SearchNames::new(
                    Some("L'Étoffe des Héros"),
                    Some("Legendary Heroes"),
                    Some("英雄の証"),
                )),
                ..Default::default()
            },
        )];
        let results = smart_search(
            "L'Étoffe des Hero",
            &raw,
            SmartSearchConfig {
                min_score: 2.0,
                ..Default::default()
            },
        );
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].suggestion, Some("L'Étoffe des Héros".to_owned()));
    }

    #[test]
    fn suggestion_uses_only_the_source_name_fields() {
        let raw = vec![result(
            "item",
            "Objet",
            SearchableType::Item,
            1.0,
            SearchData {
                localized_names: Some(SearchNames::new(Some("Objet réel"), None, None)),
                ..Default::default()
            },
        )];
        let results = smart_search(
            "Objet reel",
            &raw,
            SmartSearchConfig {
                min_score: 2.0,
                ..Default::default()
            },
        );
        assert!(results.is_empty());
    }
}
