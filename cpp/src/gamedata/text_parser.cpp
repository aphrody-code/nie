#include "iecode/gamedata/text_parser.h"
#include "iecode/gamedata/config_parser.h"

#include <algorithm>
#include <fstream>
#include <regex>
#include <spdlog/spdlog.h>

namespace iecode::gamedata {

// ── Implementation de MultiLocaleText ───────────────────────────────
// (defini dans types.h, implemente ici car c'est le premier .cpp gamedata)

namespace {

const TextMap gd_text_empty_map;

/// Types de fichiers texte connus et leur nom de fichier cfg.bin.
/// Port depuis inagle text-parser.ts TEXT_FILE_NAMES.
const std::unordered_map<std::string, std::string> gd_text_file_names = {
    {"chara",             "chara_text"},
    {"chara_description", "chara_description_text"},
    {"chara_add",         "chara_add_info_text"},
    {"skill",             "skill_text"},
    {"item",              "item_text"},
    {"item_explain",      "item_explain_text"},
    {"team",              "team_text"},
    {"system",            "system_text"},
    {"formation",         "formation_text"},
    {"help",              "help_list_text"},
    {"mission",           "mission_text"},
    {"quest_title",       "quest_title_text"},
    {"quest_purpose",     "quest_purpose_text"},
    {"map",               "map_text"},
    {"shop",              "shop_text"},
    {"medal",             "medal_text"},
    {"music",             "music_name_text"},
    {"constellation",     "players_universe_text"},
    {"soccer_common",     "soccer_common_text"},
    {"soccer_passive",    "soccer_team_passive_text"},
    {"soccer_technic",    "soccer_technic_text"},
};

/// Lit un fichier binaire complet en memoire.
std::vector<uint8_t> gd_text_read_file(const std::filesystem::path& path) {
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file.is_open()) return {};

    const auto size = file.tellg();
    if (size <= 0) return {};

    std::vector<uint8_t> buffer(static_cast<size_t>(size));
    file.seekg(0, std::ios::beg);
    file.read(reinterpret_cast<char*>(buffer.data()), size);
    return buffer;
}

/// Assigne un texte dans la map MultiLocaleText pour une locale donnee.
TextMap& gd_text_get_map(MultiLocaleText& mlt, const std::string& locale) {
    if (locale == "ja")      return mlt.ja;
    if (locale == "en")      return mlt.en;
    if (locale == "fr")      return mlt.fr;
    if (locale == "de")      return mlt.de;
    if (locale == "es")      return mlt.es;
    if (locale == "it")      return mlt.it;
    if (locale == "pt")      return mlt.pt;
    if (locale == "zh_hans") return mlt.zh_hans;
    if (locale == "zh_hant") return mlt.zh_hant;
    return mlt.en; // fallback
}

/// Recherche de fichiers texte dans un repertoire locale.
/// Gere les suffixes _v2, _v3, etc. et prend le plus recent.
std::filesystem::path gd_text_find_text_file(
    const std::filesystem::path& text_dir,
    const std::string& file_base_name) {

    namespace fs = std::filesystem;

    if (!fs::exists(text_dir) || !fs::is_directory(text_dir))
        return {};

    // Chercher le fichier le plus recent (versions multiples possibles)
    std::filesystem::path best;
    std::string best_name;

    std::error_code ec;
    for (const auto& entry : fs::directory_iterator(text_dir, ec)) {
        if (!entry.is_regular_file()) continue;
        const auto& name = entry.path().filename().string();

        // Matcher: file_base_name*.cfg.bin
        // Exemples: chara_text.cfg.bin, chara_text_v2.cfg.bin
        if (name.starts_with(file_base_name) && name.ends_with(".cfg.bin")) {
            // Prendre le fichier avec le nom le plus grand (tri lexicographique
            // pour que _v5 > _v4 > _v2 > pas de suffixe)
            if (best.empty() || name > best_name) {
                best = entry.path();
                best_name = name;
            }
        }
    }

    return best;
}

} // namespace

// ── MultiLocaleText ─────────────────────────────────────────────────

const TextMap& MultiLocaleText::get(const std::string& locale) const {
    if (locale == "ja")      return ja;
    if (locale == "en")      return en;
    if (locale == "fr")      return fr;
    if (locale == "de")      return de;
    if (locale == "es")      return es;
    if (locale == "it")      return it;
    if (locale == "pt")      return pt;
    if (locale == "zh_hans") return zh_hans;
    if (locale == "zh_hant") return zh_hant;
    return gd_text_empty_map;
}

std::string MultiLocaleText::find(const std::string& hash, const std::string& locale) const {
    const auto& map = get(locale);
    auto found = map.find(hash);
    if (found != map.end()) return found->second;
    return {};
}

// ── Extraction de textes depuis un CfgBinFile ───────────────────────

TextMap extract_text_map(const level5::CfgBinFile& cfg) {
    TextMap result;

    if (cfg.format == level5::CfgBinFile::Format::T2B) {
        // Format T2B : parcourir les entries pour trouver TEXT_INFO / NOUN_INFO
        // Les textes sont dans les noeuds enfants de TEXT_INFO_BEGIN ou NOUN_INFO_BEGIN
        //
        // TEXT_INFO format: [hashId(int), 0(int), text(string)]
        // NOUN_INFO format: [hashId(int), ?, ?, ?, ?, text(string), ...]

        auto process_node = [&](const level5::CfgEntry& entry) {
            // Matcher TEXT_INFO_N ou NOUN_INFO_N (pas les BEG/END)
            const auto& name = entry.name;
            const bool is_text_info = name.starts_with("TEXT_INFO_") &&
                                       !name.starts_with("TEXT_INFO_BEGIN") &&
                                       !name.starts_with("TEXT_INFO_END");
            const bool is_noun_info = name.starts_with("NOUN_INFO_") &&
                                       !name.starts_with("NOUN_INFO_BEGIN") &&
                                       !name.starts_with("NOUN_INFO_END");

            if (!is_text_info && !is_noun_info) return;

            const auto& vars = entry.variables;
            if (vars.size() < 3) return;

            // Premier champ : hash (Int)
            if (vars[0].type != level5::CfgVarType::Int) return;
            const int32_t hash_val = parse_int_var(vars[0]);
            const std::string hash_hex = to_hex(hash_val);

            // Texte : index 5 pour NOUN_INFO, index 2 pour TEXT_INFO
            size_t text_idx = is_noun_info ? 5 : 2;
            if (text_idx >= vars.size()) return;

            const auto& text_var = vars[text_idx];
            if (text_var.type != level5::CfgVarType::String) return;

            const std::string& raw_text = parse_string_var(text_var);
            if (raw_text.empty()) return;

            std::string clean = sanitize_text(raw_text);
            if (!clean.empty()) {
                result[hash_hex] = std::move(clean);
            }
        };

        // Parcourir tous les noeuds recursivement
        visit_nodes(cfg.entries, process_node);
    }
    else if (cfg.format == level5::CfgBinFile::Format::RDBN) {
        // Format RDBN : chercher des listes liees aux textes
        // Les noms de listes typiques sont m_textInfoList, m_nounInfoList, etc.
        for (const auto& list : cfg.lists) {
            // Chercher les listes contenant des textes
            // Heuristique : une liste avec des champs "textId"/"hashId" et "text"
            for (const auto& entry : list.entries) {
                // Essayer de trouver un champ hash et un champ texte
                std::string hash_hex;
                std::string text;

                for (const auto& field : entry.fields) {
                    const auto& fname = field.name;
                    // Champ hash ID
                    if (hash_hex.empty() &&
                        (fname.find("textId") != std::string::npos ||
                         fname.find("hashId") != std::string::npos ||
                         fname.find("TextId") != std::string::npos ||
                         fname.find("nameId") != std::string::npos ||
                         fname.find("NameId") != std::string::npos)) {
                        hash_hex = rdbn_string(field);
                    }
                    // Champ texte
                    if (text.empty() &&
                        (fname.find("text") != std::string::npos ||
                         fname.find("Text") != std::string::npos ||
                         fname.find("name") != std::string::npos) &&
                        fname.find("Id") == std::string::npos) {
                        auto s = rdbn_string(field);
                        if (!s.empty() && !s.starts_with("0x")) {
                            text = sanitize_text(s);
                        }
                    }
                }

                if (!hash_hex.empty() && !text.empty()) {
                    result[hash_hex] = std::move(text);
                }
            }
        }
    }

    spdlog::debug("extract_text_map: {} textes extraits (format {})",
                  result.size(),
                  cfg.format == level5::CfgBinFile::Format::T2B ? "T2B" : "RDBN");
    return result;
}

// ── Chargement depuis le disque ─────────────────────────────────────

TextMap load_text_file(const std::filesystem::path& path) {
    if (!std::filesystem::exists(path)) {
        spdlog::debug("load_text_file: fichier inexistant '{}'", path.string());
        return {};
    }

    auto data = gd_text_read_file(path);
    if (data.empty()) {
        spdlog::warn("load_text_file: fichier vide '{}'", path.string());
        return {};
    }

    auto cfg = level5::cfgbin_parse(data);
    if (!cfg) {
        spdlog::warn("load_text_file: echec du parsing '{}'", path.string());
        return {};
    }

    return extract_text_map(*cfg);
}

MultiLocaleText load_all_locales(const std::filesystem::path& data_root,
                                  const std::string& text_type) {
    MultiLocaleText result;

    // Resoudre le nom de fichier base
    std::string file_base;
    auto it = gd_text_file_names.find(text_type);
    if (it != gd_text_file_names.end()) {
        file_base = it->second;
    } else {
        // Utiliser le type directement comme nom de base
        file_base = text_type + "_text";
    }

    const auto text_root = data_root / "common" / "text";

    for (size_t i = 0; i < LOCALE_COUNT; ++i) {
        const std::string locale = LOCALES[i];
        const auto locale_dir = text_root / locale;

        auto file_path = gd_text_find_text_file(locale_dir, file_base);
        if (file_path.empty()) {
            spdlog::debug("load_all_locales: pas de fichier {} pour locale {}",
                          file_base, locale);
            continue;
        }

        auto texts = load_text_file(file_path);
        if (!texts.empty()) {
            spdlog::debug("load_all_locales: {} textes charges pour locale {} depuis {}",
                          texts.size(), locale, file_path.filename().string());
            gd_text_get_map(result, locale) = std::move(texts);
        }
    }

    return result;
}

// ── Nettoyage de texte ──────────────────────────────────────────────

std::string sanitize_text(const std::string& raw) {
    if (raw.empty()) return {};

    std::string text = raw;

    // 1. Supprimer le furigana : [Kanji/Reading] → Kanji
    //    Pattern: [texte_avant/texte_apres] → garde texte_avant
    {
        static const std::regex furigana_re(R"(\[([^/]+)/[^\]]+\])");
        text = std::regex_replace(text, furigana_re, "$1");
    }

    // 2. Extraire la valeur des tags de jeu sauf COL (couleur)
    //    <FLA:SAKAMAKI> → SAKAMAKI, <FUL:DAISUKE> → DAISUKE, <VAL:10> → 10
    {
        static const std::regex tag_value_re(R"(<(?!COL:)[^:>]+:([^>]+)>)");
        text = std::regex_replace(text, tag_value_re, "$1");
    }

    // 3. Supprimer les tags restants : <COL:FFAA00>, <CLO>, <TX0>, etc.
    {
        static const std::regex tags_re(R"(<[^>]+>)");
        text = std::regex_replace(text, tags_re, "");
    }

    // 4. Gerer les sequences d'echappement
    {
        std::string out;
        out.reserve(text.size());
        for (size_t i = 0; i < text.size(); ++i) {
            if (text[i] == '\\' && i + 1 < text.size()) {
                switch (text[i + 1]) {
                    case 'n': out.push_back('\n'); ++i; break;
                    case 'r': ++i; break; // Supprimer \r
                    case 't': out.push_back('\t'); ++i; break;
                    case '"': out.push_back('"'); ++i; break;
                    case '\'': out.push_back('\''); ++i; break;
                    default: out.push_back(text[i]); break;
                }
            } else {
                out.push_back(text[i]);
            }
        }
        text = std::move(out);
    }

    // 5. Supprimer les caracteres de controle (sauf \n et \t)
    {
        std::string out;
        out.reserve(text.size());
        for (char c : text) {
            auto uc = static_cast<unsigned char>(c);
            if (uc < 0x20) {
                // Garder newline et tab
                if (c == '\n' || c == '\t')
                    out.push_back(c);
                // Sinon supprimer
            } else if (uc == 0x7F) {
                // Supprimer DEL
            } else {
                out.push_back(c);
            }
        }
        text = std::move(out);
    }

    // 6. Normaliser les espaces multiples (mais garder les newlines)
    {
        std::string out;
        out.reserve(text.size());
        bool prev_space = false;
        for (char c : text) {
            if (c == ' ') {
                if (!prev_space) {
                    out.push_back(c);
                    prev_space = true;
                }
            } else {
                out.push_back(c);
                prev_space = false;
            }
        }
        text = std::move(out);
    }

    // 7. Normaliser les newlines multiples (max 2 consecutives)
    {
        std::string out;
        out.reserve(text.size());
        int newline_count = 0;
        for (char c : text) {
            if (c == '\n') {
                ++newline_count;
                if (newline_count <= 2) {
                    out.push_back(c);
                }
            } else {
                newline_count = 0;
                out.push_back(c);
            }
        }
        text = std::move(out);
    }

    // 8. Trim global
    {
        auto start = text.find_first_not_of(" \t\n\r");
        if (start == std::string::npos) return {};
        auto end = text.find_last_not_of(" \t\n\r");
        text = text.substr(start, end - start + 1);
    }

    return text;
}

} // namespace iecode::gamedata
