//! Portable bounded JSON contract shared by native HTTP and WebAssembly callers.

pub const MAX_ZUKAN_ENTRY_JSON_BYTES: usize = 1024 * 1024;
pub const MAX_ZUKAN_CANDIDATES_JSON_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_ZUKAN_RESULT_JSON_BYTES: usize = 1024 * 1024;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ZukanRankEntryInput {
    name: String,
    zukan_hash: Option<String>,
    position: Option<String>,
    element: Option<String>,
    stats: Option<crate::matching::MatchingStats>,
    game: Option<String>,
    gender: Option<String>,
    description: Option<String>,
}

impl From<ZukanRankEntryInput> for crate::matching::ZukanMatchEntry {
    fn from(input: ZukanRankEntryInput) -> Self {
        Self {
            nom: input.name,
            zukan_hash: input.zukan_hash,
            position: input.position,
            element: input.element,
            stats: input.stats,
            jeu: input.game,
            genre: input.gender,
            description: input.description,
        }
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ZukanRankCandidateInput {
    id: String,
    name_en: String,
    name_fr: Option<String>,
    name_ja: Option<String>,
    position: String,
    element: String,
    gender: Option<String>,
    rarity_label: String,
    series: Option<String>,
    zukan_hash: Option<String>,
    stats: Option<crate::matching::MatchingStats>,
    description_en: Option<String>,
}

impl From<ZukanRankCandidateInput> for crate::matching::InagleMatchCandidate {
    fn from(input: ZukanRankCandidateInput) -> Self {
        Self {
            id: input.id,
            name_en: input.name_en,
            name_fr: input.name_fr,
            name_ja: input.name_ja,
            position: input.position,
            element: input.element,
            gender: input.gender,
            rarity_label: input.rarity_label,
            series: input.series,
            zukan_hash: input.zukan_hash,
            stats: input.stats,
            description_en: input.description_en,
        }
    }
}

pub fn rank_json(
    entry_json: &str,
    candidates_json: &str,
    max_results: u32,
) -> Result<String, String> {
    if entry_json.len() > MAX_ZUKAN_ENTRY_JSON_BYTES {
        return Err(format!(
            "Zukan entry JSON exceeds {MAX_ZUKAN_ENTRY_JSON_BYTES} bytes"
        ));
    }
    if candidates_json.len() > MAX_ZUKAN_CANDIDATES_JSON_BYTES {
        return Err(format!(
            "Zukan candidate JSON exceeds {MAX_ZUKAN_CANDIDATES_JSON_BYTES} bytes"
        ));
    }
    let entry: ZukanRankEntryInput =
        serde_json::from_str(entry_json).map_err(|error| error.to_string())?;
    let candidates: Vec<ZukanRankCandidateInput> =
        serde_json::from_str(candidates_json).map_err(|error| error.to_string())?;
    let entry = entry.into();
    let candidates: Vec<crate::matching::InagleMatchCandidate> =
        candidates.into_iter().map(Into::into).collect();
    let ranked =
        crate::matching::rank_candidates_bounded(&entry, &candidates, max_results as usize)
            .map_err(|error| error.to_string())?;
    let rows: Vec<_> = ranked
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "candidateId": row.candidate_id,
                "score": row.score,
            })
        })
        .collect();
    let output = serde_json::json!({
        "schemaVersion": 1,
        "results": rows,
    })
    .to_string();
    if output.len() > MAX_ZUKAN_RESULT_JSON_BYTES {
        return Err(format!(
            "Zukan result JSON exceeds {MAX_ZUKAN_RESULT_JSON_BYTES} bytes"
        ));
    }
    Ok(output)
}
