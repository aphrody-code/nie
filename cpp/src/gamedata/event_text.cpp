#include "iecode/gamedata/event_text.h"

#include "iecode/gamedata/config_parser.h"
#include "iecode/gamedata/text_parser.h"
#include "iecode/crypto/crc32.h"

#include <algorithm>
#include <spdlog/spdlog.h>

namespace iecode::gamedata {

namespace {

// ── Hashes CRC32 precalcules des noms de sections evenementielles ────
// JamCRC = CRC32 standard (polynome 0xEDB88320), meme que iecode::crypto::crc32_compute.
// Precalcules au compile-time pour eviter le calcul runtime.

/// CRC32 de "EVENT_TEXT_INFO" — section principale des textes de dialogue.
constexpr uint32_t HASH_EVENT_TEXT_INFO        = 0xA7131928u;
/// CRC32 de "EVENT_TEXT_INDEX" — index/ordonnancement des textes.
constexpr uint32_t HASH_EVENT_TEXT_INDEX       = 0x7BCBB14Cu;
/// CRC32 de "EVENT_BUSTUP_TALK_DATA" — dialogues bust-up (portrait + texte).
constexpr uint32_t HASH_EVENT_BUSTUP_TALK_DATA = 0x8AFE38AFu;
/// CRC32 de "EVENT_SUBTITLE_DATA" — sous-titres avec timing.
constexpr uint32_t HASH_EVENT_SUBTITLE_DATA    = 0xB0F7EACFu;
/// CRC32 de "TEXT_INFO" — fallback section texte generique.
constexpr uint32_t HASH_TEXT_INFO              = 0x49F47E89u;

/// Verifie si un CRC32 d'entree correspond a une section de texte evenementiel.
[[nodiscard]] bool is_event_text_section(uint32_t crc) noexcept {
    return crc == HASH_EVENT_TEXT_INFO
        || crc == HASH_EVENT_TEXT_INDEX
        || crc == HASH_EVENT_BUSTUP_TALK_DATA
        || crc == HASH_EVENT_SUBTITLE_DATA
        || crc == HASH_TEXT_INFO;
}

/// Verifie si le nom d'une entree correspond a une section de texte evenementiel.
[[nodiscard]] [[maybe_unused]] bool is_event_text_name(const std::string& name) noexcept {
    return name.starts_with("EVENT_TEXT_INFO")
        || name.starts_with("EVENT_TEXT_INDEX")
        || name.starts_with("EVENT_BUSTUP_TALK_DATA")
        || name.starts_with("EVENT_SUBTITLE_DATA")
        || name.starts_with("TEXT_INFO");
}

/// Determine le nom de cle associe a un hash connu.
[[nodiscard]] [[maybe_unused]] std::string key_from_hash(uint32_t crc) {
    switch (crc) {
        case HASH_EVENT_TEXT_INFO:        return "EVENT_TEXT_INFO";
        case HASH_EVENT_TEXT_INDEX:       return "EVENT_TEXT_INDEX";
        case HASH_EVENT_BUSTUP_TALK_DATA: return "EVENT_BUSTUP_TALK_DATA";
        case HASH_EVENT_SUBTITLE_DATA:    return "EVENT_SUBTITLE_DATA";
        case HASH_TEXT_INFO:              return "TEXT_INFO";
        default:                          return {};
    }
}

// ── Extraction depuis le format T2B (entries) ─────────────────────────

/// Extrait les textes evenementiels depuis les entries T2B.
/// Parcourt recursivement l'arbre cfg.bin a la recherche de noeuds
/// dont le nom matche les prefixes de sections connues.
void extract_from_t2b(const std::vector<level5::CfgEntry>& entries,
                      std::vector<EventTextEntry>& out) {
    auto visitor = [&](const level5::CfgEntry& entry) {
        const auto& name = entry.name;

        // ── EVENT_TEXT_INFO_N / TEXT_INFO_N ──────────────────────────
        // Format : [hash(int), unk(int), text(string)]
        // ou     : [hash(int), unk(int), text(string), speaker(int), voice(int)]
        const bool is_text_info =
            (name.starts_with("EVENT_TEXT_INFO_") || name.starts_with("TEXT_INFO_")) &&
            !name.ends_with("_BEGIN") && !name.ends_with("_END");

        if (is_text_info) {
            const auto& vars = entry.variables;
            if (vars.size() < 3) return;
            if (vars[0].type != level5::CfgVarType::Int) return;
            if (vars[2].type != level5::CfgVarType::String) return;

            EventTextEntry evt;
            evt.hash = static_cast<uint32_t>(parse_int_var(vars[0]));
            evt.key  = name;
            evt.text = sanitize_text(parse_string_var(vars[2]));

            // Champs optionnels : speaker_id et voice_id
            if (vars.size() > 3 && vars[3].type == level5::CfgVarType::Int) {
                evt.speaker_id = static_cast<uint32_t>(parse_int_var(vars[3]));
            }
            if (vars.size() > 4 && vars[4].type == level5::CfgVarType::Int) {
                evt.voice_id = static_cast<uint32_t>(parse_int_var(vars[4]));
            }

            if (!evt.text.empty()) {
                out.push_back(std::move(evt));
            }
            return;
        }

        // ── EVENT_BUSTUP_TALK_DATA_N ────────────────────────────────
        // Format : [hash(int), speaker(int), text(string), voice(int), ...]
        const bool is_bustup =
            name.starts_with("EVENT_BUSTUP_TALK_DATA_") &&
            !name.ends_with("_BEGIN") && !name.ends_with("_END");

        if (is_bustup) {
            const auto& vars = entry.variables;
            if (vars.size() < 3) return;
            if (vars[0].type != level5::CfgVarType::Int) return;

            EventTextEntry evt;
            evt.hash = static_cast<uint32_t>(parse_int_var(vars[0]));
            evt.key  = name;

            // Speaker ID (2e champ)
            if (vars[1].type == level5::CfgVarType::Int) {
                evt.speaker_id = static_cast<uint32_t>(parse_int_var(vars[1]));
            }

            // Texte (3e champ)
            if (vars[2].type == level5::CfgVarType::String) {
                evt.text = sanitize_text(parse_string_var(vars[2]));
            }

            // Voice ID (4e champ optionnel)
            if (vars.size() > 3 && vars[3].type == level5::CfgVarType::Int) {
                evt.voice_id = static_cast<uint32_t>(parse_int_var(vars[3]));
            }

            if (!evt.text.empty()) {
                out.push_back(std::move(evt));
            }
            return;
        }

        // ── EVENT_SUBTITLE_DATA_N ───────────────────────────────────
        // Format : [hash(int), text(string), start(float), end(float), speaker(int)]
        const bool is_subtitle =
            name.starts_with("EVENT_SUBTITLE_DATA_") &&
            !name.ends_with("_BEGIN") && !name.ends_with("_END");

        if (is_subtitle) {
            const auto& vars = entry.variables;
            if (vars.size() < 4) return;
            if (vars[0].type != level5::CfgVarType::Int) return;

            EventTextEntry evt;
            evt.hash = static_cast<uint32_t>(parse_int_var(vars[0]));
            evt.key  = name;

            // Texte (2e champ)
            if (vars[1].type == level5::CfgVarType::String) {
                evt.text = sanitize_text(parse_string_var(vars[1]));
            }

            // Timing (3e et 4e champs)
            if (vars[2].type == level5::CfgVarType::Float) {
                evt.start_time = parse_float_var(vars[2]);
            }
            if (vars[3].type == level5::CfgVarType::Float) {
                evt.end_time = parse_float_var(vars[3]);
            }

            // Speaker ID optionnel (5e champ)
            if (vars.size() > 4 && vars[4].type == level5::CfgVarType::Int) {
                evt.speaker_id = static_cast<uint32_t>(parse_int_var(vars[4]));
            }

            if (!evt.text.empty()) {
                out.push_back(std::move(evt));
            }
            return;
        }

        // ── EVENT_TEXT_INDEX_N ───────────────────────────────────────
        // Format : [hash(int), index(int), text(string)]
        const bool is_text_index =
            name.starts_with("EVENT_TEXT_INDEX_") &&
            !name.ends_with("_BEGIN") && !name.ends_with("_END");

        if (is_text_index) {
            const auto& vars = entry.variables;
            if (vars.size() < 3) return;
            if (vars[0].type != level5::CfgVarType::Int) return;

            EventTextEntry evt;
            evt.hash = static_cast<uint32_t>(parse_int_var(vars[0]));
            evt.key  = name;

            // Texte (3e champ, apres l'index)
            if (vars[2].type == level5::CfgVarType::String) {
                evt.text = sanitize_text(parse_string_var(vars[2]));
            }

            if (!evt.text.empty()) {
                out.push_back(std::move(evt));
            }
        }
    };

    visit_nodes(entries, visitor);
}

// ── Extraction depuis le format RDBN (lists) ──────────────────────────

/// Extrait les textes evenementiels depuis les listes RDBN.
/// Parcourt les listes dont le nom correspond a une section connue,
/// et extrait les champs pertinents de chaque entree.
void extract_from_rdbn(const level5::CfgBinFile& cfg,
                       std::vector<EventTextEntry>& out) {
    for (const auto& list : cfg.lists) {
        // Verifier si c'est une liste de texte evenementiel
        const bool is_event_list =
            list.name.find("EVENT_TEXT") != std::string::npos ||
            list.name.find("event_text") != std::string::npos ||
            list.name.find("BUSTUP_TALK") != std::string::npos ||
            list.name.find("bustup_talk") != std::string::npos ||
            list.name.find("SUBTITLE") != std::string::npos ||
            list.name.find("subtitle") != std::string::npos ||
            list.name.find("textInfo") != std::string::npos ||
            list.name.find("TextInfo") != std::string::npos;

        // Verifier aussi par hash
        const bool hash_match = is_event_text_section(list.name_hash);

        if (!is_event_list && !hash_match) continue;

        for (const auto& entry : list.entries) {
            EventTextEntry evt;

            // Parcourir les champs de l'entree pour extraire les valeurs
            for (const auto& field : entry.fields) {
                const auto& fname = field.name;

                // Hash ID
                if (fname.find("hashId") != std::string::npos ||
                    fname.find("HashId") != std::string::npos ||
                    fname.find("textId") != std::string::npos ||
                    fname.find("TextId") != std::string::npos ||
                    fname.find("nameId") != std::string::npos) {
                    evt.hash = static_cast<uint32_t>(rdbn_int(field));
                    continue;
                }

                // Speaker ID
                if (fname.find("speakerId") != std::string::npos ||
                    fname.find("SpeakerId") != std::string::npos ||
                    fname.find("speaker_id") != std::string::npos ||
                    fname.find("charaId") != std::string::npos) {
                    evt.speaker_id = static_cast<uint32_t>(rdbn_int(field));
                    continue;
                }

                // Voice ID
                if (fname.find("voiceId") != std::string::npos ||
                    fname.find("VoiceId") != std::string::npos ||
                    fname.find("voice_id") != std::string::npos ||
                    fname.find("cueId") != std::string::npos) {
                    evt.voice_id = static_cast<uint32_t>(rdbn_int(field));
                    continue;
                }

                // Timing — start
                if (fname.find("startTime") != std::string::npos ||
                    fname.find("StartTime") != std::string::npos ||
                    fname.find("start_time") != std::string::npos ||
                    fname == "start") {
                    evt.start_time = rdbn_float(field);
                    continue;
                }

                // Timing — end
                if (fname.find("endTime") != std::string::npos ||
                    fname.find("EndTime") != std::string::npos ||
                    fname.find("end_time") != std::string::npos ||
                    fname == "end") {
                    evt.end_time = rdbn_float(field);
                    continue;
                }

                // Texte (dernier — eviter les champs contenant "Id")
                if (evt.text.empty() &&
                    (fname.find("text") != std::string::npos ||
                     fname.find("Text") != std::string::npos ||
                     fname.find("message") != std::string::npos ||
                     fname.find("Message") != std::string::npos) &&
                    fname.find("Id") == std::string::npos &&
                    fname.find("id") == std::string::npos) {
                    auto s = rdbn_string(field);
                    if (!s.empty() && !s.starts_with("0x")) {
                        evt.text = sanitize_text(s);
                    }
                }
            }

            // Generer une cle depuis le nom de la liste
            if (!evt.text.empty()) {
                evt.key = list.name;
                out.push_back(std::move(evt));
            }
        }
    }
}

} // namespace

// ── API publique ────────────────────────────────────────────────────────

EventTextResult event_text_extract(const level5::CfgBinFile& cfg) {
    EventTextResult result;

    if (cfg.format == level5::CfgBinFile::Format::T2B) {
        extract_from_t2b(cfg.entries, result.entries);
    } else {
        extract_from_rdbn(cfg, result.entries);
    }

    spdlog::debug("event_text_extract: {} entrees extraites (format {})",
                  result.entries.size(),
                  cfg.format == level5::CfgBinFile::Format::T2B ? "T2B" : "RDBN");

    return result;
}

EventTextResult event_text_extract_raw(std::span<const uint8_t> cfg_data) {
    auto cfg = level5::cfgbin_parse(cfg_data);
    if (!cfg) {
        spdlog::error("event_text_extract_raw: echec du parsing cfg.bin");
        return {};
    }

    return event_text_extract(*cfg);
}

std::optional<EventTextEntry> event_text_find(const EventTextResult& result, uint32_t hash) {
    for (const auto& entry : result.entries) {
        if (entry.hash == hash) {
            return entry;
        }
    }
    return std::nullopt;
}

std::optional<EventTextEntry> event_text_find(const EventTextResult& result, std::string_view key) {
    for (const auto& entry : result.entries) {
        if (entry.key == key) {
            return entry;
        }
    }
    return std::nullopt;
}

} // namespace iecode::gamedata
