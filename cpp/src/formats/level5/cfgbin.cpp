#include "iecode/formats/level5/cfgbin.h"

#include "iecode/crypto/xorshift.h"
#include "iecode/crypto/crc32.h"

#include <algorithm>
#include <cstring>
#include <fmt/format.h>
#include <spdlog/spdlog.h>
#include <nlohmann/json.hpp>

namespace iecode::level5 {

namespace {

// ── Helpers lecture LE (prefixe cfgbin_ pour unity build) ────────────

inline uint32_t cfgbin_r32(const uint8_t* p) { uint32_t v; std::memcpy(&v, p, 4); return v; }
inline int32_t  cfgbin_ri32(const uint8_t* p) { int32_t v;  std::memcpy(&v, p, 4); return v; }
inline uint16_t cfgbin_r16(const uint8_t* p) { uint16_t v; std::memcpy(&v, p, 2); return v; }
inline int16_t  cfgbin_ri16(const uint8_t* p) { int16_t v;  std::memcpy(&v, p, 2); return v; }
inline float    cfgbin_rf(const uint8_t* p) { float v; std::memcpy(&v, p, 4); return v; }

inline std::string cfgbin_read_cstr(const uint8_t* base, size_t max_len) {
    size_t len = 0;
    while (len < max_len && base[len] != 0) ++len;
    return std::string(reinterpret_cast<const char*>(base), len);
}

// ── Table statique de noms T2B connus (fallback pour la key_table) ──
//
// Les cfg.bin T2B du jeu n'embarquent quasiment jamais leur key_table :
// les noms des noeuds sont seulement presents sous forme de CRC32.
// On maintient ici une liste exhaustive des noms referenceess par les
// loaders gamedata::, avec toutes leurs variantes usuelles (BEG/END,
// LIST_BEG/LIST_END, INFO, EFFECT, REF, TABLE...).
//
// Ajouter un nom : il suffit de l'ajouter a la liste, la resolution
// CRC32 est automatique a l'initialisation statique.

const std::unordered_map<uint32_t, std::string>& cfgbin_builtin_key_table() {
    static const std::unordered_map<uint32_t, std::string> table = [] {
        // Noms racines — pour chacun, on genere {name, name_BEG, name_END,
        // name_LIST_BEG, name_LIST_END}. Certains loaders matchent sur
        // find("NAME_") donc on ajoute aussi name_INFO quand pertinent.
        static const char* const roots[] = {
            // Characters
            "CHARA_PARAM_INFO", "CHARA_PARAM", "CHARA_PARAM_TABLE",
            "CHARA_BASE_INFO", "CHARA_BASE_INFO_N", "CHARA_BASE_INFO_LIST",
            "CHARA_BASE_INFO_LIST_BEG", "CHARA_BASE_INFO_LIST_END",
            "CHARA_COSTUME_MODEL", "CHARA_SERIES",
            // Skills / passives
            "PASSIVE_SKILL_EFFECT", "PASSIVE_SKILL_INFO",
            "SPECIAL_TACTICS_EFFECT", "SPECIAL_TACTICS_INFO",
            "SUPER_TACTICS_EFFECT", "SUPER_TACTICS_INFO",
            "AURA_SKILL_INFO",
            // Items
            "ITEM_CONSUME_INFO", "ITEM_SHOES_INFO", "ITEM_MISANGA_INFO",
            "ITEM_ACCESSORY_INFO", "ITEM_SPECIAL_INFO", "ITEM_FORMATION_INFO",
            "ITEM_SPECIAL_TACTICS_INFO", "ITEM_SUPER_TACTICS_INFO",
            "ITEM_SPECIAL_SKILL_INFO", "ITEM_TITLE_INFO", "ITEM_FASHION_INFO",
            "ITEM_COSTUME_INFO", "ITEM_EMBLEM_INFO", "ITEM_UNIQUE_INFO",
            "ITEM_CRAFT_OBJ_INFO", "ITEM_ANIMAL_INFO", "ITEM_KIZUNA_LINK_INFO",
            "ITEM_NAME_PLATE_INFO", "ITEM_PERFORMANCE_INFO", "ITEM_IMPORTANT_INFO",
            // Quests
            "QUEST_DATA_CFG", "QUEST_DATA_CFG_INFO",
            // Shops
            "SHOP_INFO", "SHOP_INFO_ITEM",
            // Missions / trophies
            "MISSION_CONFIG_INFO", "TROPHY_INFO",
            // Item table
            "ITBL_INFO", "ITBL_ITEMS",
            // Capsule
            "CPSL_PRIZE_INFO", "CPSL_LOT_RANK_RATE_INFO", "CPSL_CONFIG_INFO",
            // Team / enjoy
            "ENJOY_MODE_TEAM_INFO",
            "TEAM_BUILD_EFFECT_DATA", "TEAM_BUILD_UP_DATA",
            "TEAM_BUILD_DOWN_DATA", "TEAM_BUILD_INFO",
            // Boost grp
            "BOOST_PLAYER_GRP_SPRIT_TABLE_INFO", "BOOST_PLAYER_GRP_CONFIG",
            // Soccer control
            "CTRL_CHR_DATA",
            // Music / help / nfc
            "MUSIC_APP_INFO_ITEM", "HELP_LIST_IMAGE", "NFC_LOTTERY_INFO",
        };

        // Noms specifiques (pas de generation auto BEG/END — a conserver tels quels)
        static const char* const literals[] = {
            // NFC tables imbriquees
            "NFC_LOTTERY_INFO_TABLE", "NFC_LOTTERY_INFO_TABLE_LIST_BEG",
            "NFC_LOTTERY_INFO_TABLE_LIST_END", "NFC_LOTTERY_INFO_TABLE_ITEM",
            // PTREE racines vues couramment
            "PTREE", "PTREE_BEG", "PTREE_END",
        };

        std::unordered_map<uint32_t, std::string> map;
        map.reserve(2048);

        auto put = [&](const std::string& name) {
            const uint32_t crc = crypto::crc32_compute(name);
            map.emplace(crc, name);
        };

        for (const char* root : roots) {
            const std::string r = root;
            put(r);
            put(r + "_BEG");
            put(r + "_END");
            put(r + "_LIST_BEG");
            put(r + "_LIST_END");
            put(r + "_REF");
            put(r + "_REF_BEG");
            put(r + "_REF_END");
        }
        for (const char* lit : literals) put(lit);

        return map;
    }();
    return table;
}

// ── T2B Footer detection ─────────────────────────────────────────────

bool cfgbin_has_t2b_footer(std::span<const uint8_t> data) {
    if (data.size() < 16) return false;
    const size_t start = data.size() > 32 ? data.size() - 32 : 0;
    for (size_t i = start; i + 3 < data.size(); ++i) {
        if (data[i] == 0x01 && data[i+1] == 0x74 && data[i+2] == 0x32 && data[i+3] == 0x62)
            return true;
    }
    return false;
}

// ── RDBN Parser ──────────────────────────────────────────────────────

constexpr uint32_t RDBN_MAGIC = 0x4E424452;
constexpr int RDBN_MIN_SIZE = 0x50;
constexpr int RDBN_ENTRY_SIZE = 0x20;

std::optional<CfgBinFile> cfgbin_parse_rdbn(std::span<const uint8_t> data) {
    if (data.size() < static_cast<size_t>(RDBN_MIN_SIZE)) return std::nullopt;
    if (cfgbin_r32(data.data()) != RDBN_MAGIC) return std::nullopt;

    const auto* d = data.data();
    const int data_offset = cfgbin_ri16(d + 0x0A) << 2;

    const int type_offset   = (cfgbin_ri16(d + 0x24) << 2) + data_offset;
    const int type_count    = cfgbin_ri16(d + 0x26);
    const int field_offset  = (cfgbin_ri16(d + 0x28) << 2) + data_offset;
    const int field_count   = cfgbin_ri16(d + 0x2A);
    const int root_offset   = (cfgbin_ri16(d + 0x2C) << 2) + data_offset;
    const int root_count    = cfgbin_ri16(d + 0x2E);
    const int hash_offset   = (cfgbin_ri16(d + 0x30) << 2) + data_offset;
    const int offs_offset   = (cfgbin_ri16(d + 0x32) << 2) + data_offset;
    const int hash_count    = cfgbin_ri16(d + 0x34);
    const int value_offset  = (cfgbin_ri16(d + 0x36) << 2) + data_offset;
    const int string_offset = cfgbin_ri32(d + 0x38) + data_offset;

    const auto sz = static_cast<int>(data.size());

    // Bounds check
    auto check = [&](int off, int count, int entry_sz) {
        return off >= 0 && off + count * entry_sz <= sz;
    };
    if (!check(root_offset, root_count, RDBN_ENTRY_SIZE) ||
        !check(type_offset, type_count, RDBN_ENTRY_SIZE) ||
        !check(field_offset, field_count, RDBN_ENTRY_SIZE)) {
        spdlog::error("cfgbin_parse_rdbn: offsets hors limites");
        return std::nullopt;
    }

    // Lire la string table (hash → nom)
    std::unordered_map<uint32_t, std::string> strings;
    for (int i = 0; i < hash_count; ++i) {
        if (hash_offset + i * 4 + 4 > sz || offs_offset + i * 4 + 4 > sz) break;
        const uint32_t hash = cfgbin_r32(d + hash_offset + i * 4);
        const int str_off = cfgbin_ri32(d + offs_offset + i * 4);
        const int str_pos = string_offset + str_off;
        if (str_pos >= 0 && str_pos < sz) {
            strings[hash] = cfgbin_read_cstr(d + str_pos, static_cast<size_t>(sz - str_pos));
        }
    }

    auto resolve = [&](uint32_t hash) -> std::string {
        auto it = strings.find(hash);
        if (it != strings.end()) return it->second;
        return fmt::format("Unknown_0x{:08X}", hash);
    };

    CfgBinFile result;
    result.format = CfgBinFile::Format::RDBN;

    for (int ri = 0; ri < root_count; ++ri) {
        const auto* rp = d + root_offset + ri * RDBN_ENTRY_SIZE;
        const int16_t type_index = cfgbin_ri16(rp);
        const int32_t val_off    = cfgbin_ri32(rp + 4);
        const int32_t val_size   = cfgbin_ri32(rp + 8);
        const int32_t val_count  = cfgbin_ri32(rp + 12);
        const uint32_t name_hash = cfgbin_r32(rp + 16);

        if (type_index < 0 || type_index >= type_count) continue;

        const auto* tp = d + type_offset + type_index * RDBN_ENTRY_SIZE;
        const int16_t fi_start = cfgbin_ri16(tp + 8);
        const int16_t fi_count = cfgbin_ri16(tp + 10);

        RdbnList list;
        list.name = resolve(name_hash);
        list.name_hash = name_hash;

        const int root_val_offset = value_offset + val_off;

        for (int vi = 0; vi < val_count; ++vi) {
            const int entry_off = root_val_offset + vi * val_size;
            if (entry_off + val_size > sz) break;

            RdbnEntry entry;

            for (int fi = 0; fi < fi_count; ++fi) {
                if (fi_start + fi >= field_count) break;
                const auto* fp = d + field_offset + (fi_start + fi) * RDBN_ENTRY_SIZE;
                const uint32_t fhash = cfgbin_r32(fp);
                const int16_t ftype  = cfgbin_ri16(fp + 4);
                const int32_t fsize  = cfgbin_ri32(fp + 8);
                const int32_t foff   = cfgbin_ri32(fp + 12);

                const int field_val_off = entry_off + foff;
                if (field_val_off + fsize > sz) continue;
                const auto* fv = d + field_val_off;

                RdbnField field;
                field.name = resolve(fhash);
                field.name_hash = fhash;
                field.type = static_cast<RdbnFieldType>(ftype);

                switch (field.type) {
                    case RdbnFieldType::Bool:
                        field.value = static_cast<bool>(fv[0] != 0);
                        break;
                    case RdbnFieldType::Byte:
                        field.value = fv[0];
                        break;
                    case RdbnFieldType::Short:
                    case RdbnFieldType::ActType:
                        field.value = cfgbin_ri16(fv);
                        break;
                    case RdbnFieldType::Int:
                    case RdbnFieldType::Flag:
                        field.value = cfgbin_ri32(fv);
                        break;
                    case RdbnFieldType::Float:
                        field.value = cfgbin_rf(fv);
                        break;
                    case RdbnFieldType::Hash:
                        field.value = fmt::format("0x{:08X}", cfgbin_r32(fv));
                        break;
                    case RdbnFieldType::Rates:
                    case RdbnFieldType::Position:
                        if (fsize >= 16) {
                            field.value = std::vector<float>{
                                cfgbin_rf(fv), cfgbin_rf(fv+4),
                                cfgbin_rf(fv+8), cfgbin_rf(fv+12)};
                        }
                        break;
                    case RdbnFieldType::Condition: {
                        uint32_t cval = cfgbin_r32(fv);
                        int str_pos = string_offset + static_cast<int>(cval);
                        if (str_pos > 0 && str_pos < sz) {
                            field.value = cfgbin_read_cstr(d + str_pos,
                                static_cast<size_t>(sz - str_pos));
                        } else {
                            field.value = fmt::format("0x{:08X}", cval);
                        }
                        break;
                    }
                    case RdbnFieldType::ShortTuple:
                        if (fsize >= 4) {
                            field.value = std::vector<int16_t>{
                                cfgbin_ri16(fv), cfgbin_ri16(fv+2)};
                        }
                        break;
                    default: {
                        // Fallback: hex blob
                        std::vector<uint8_t> blob(fv, fv + fsize);
                        field.value = std::move(blob);
                        break;
                    }
                }

                entry.fields.push_back(std::move(field));
            }

            list.entries.push_back(std::move(entry));
        }

        result.lists.push_back(std::move(list));
    }

    spdlog::debug("cfgbin_parse_rdbn: {} listes parsees", result.lists.size());
    return result;
}

// ── T2B Parser ───────────────────────────────────────────────────────

int64_t cfgbin_round_up(int64_t n, int64_t align) {
    return ((n + align - 1) / align) * align;
}

std::optional<CfgBinFile> cfgbin_parse_t2b(std::span<const uint8_t> data) {
    const auto sz = static_cast<int64_t>(data.size());
    if (sz < 0x10) return std::nullopt;
    if (!cfgbin_has_t2b_footer(data)) return std::nullopt;

    const auto* d = data.data();

    // Header
    const int32_t entries_count      = cfgbin_ri32(d);
    const int32_t string_table_off   = cfgbin_ri32(d + 4);
    const int32_t string_table_len   = cfgbin_ri32(d + 8);
    const int32_t string_table_count = cfgbin_ri32(d + 12);

    if (string_table_off < 0x10 || string_table_off > sz) return std::nullopt;
    if (string_table_off + string_table_len > sz) return std::nullopt;

    // String table
    std::unordered_map<int32_t, std::string> strings;
    {
        int32_t pos = 0;
        int count = 0;
        while (pos < string_table_len && count < string_table_count) {
            const auto* base = d + string_table_off + pos;
            auto s = cfgbin_read_cstr(base, static_cast<size_t>(string_table_len - pos));
            strings[pos] = s;
            pos += static_cast<int32_t>(s.size()) + 1;
            ++count;
        }
    }

    // Key table
    const int64_t key_table_offset = cfgbin_round_up(
        static_cast<int64_t>(string_table_off) + string_table_len, 16);
    std::unordered_map<uint32_t, std::string> key_table;

    if (key_table_offset + 16 <= sz) {
        const auto* kp = d + key_table_offset;
        const int32_t key_length = cfgbin_ri32(kp);

        if (key_length > 0 && key_table_offset + key_length <= sz) {
            const int32_t key_count = cfgbin_ri32(kp + 4);
            const int32_t key_str_off = cfgbin_ri32(kp + 8);
            const int32_t key_str_len = cfgbin_ri32(kp + 12);

            // Sanity check: key_count must be reasonable and key_str_off must be
            // within the key table block to avoid OOB / runaway iteration.
            const int32_t max_possible = key_length / 8;
            const bool key_str_off_valid = key_str_off > 0 && key_str_off < key_length;
            const bool key_count_valid = key_count >= 0 && key_count <= max_possible;

            if (key_count_valid && key_str_off_valid) {
                const auto* key_base = kp + 16;
                const auto* str_blob = kp + key_str_off;

                for (int32_t i = 0; i < key_count; ++i) {
                    const auto* ep = key_base + i * 8;
                    if (ep + 8 > d + sz) break;
                    const uint32_t crc = cfgbin_r32(ep);
                    const int32_t str_start = cfgbin_ri32(ep + 4);

                    if (str_start >= 0 && str_start < key_str_len) {
                        key_table[crc] = cfgbin_read_cstr(
                            str_blob + str_start,
                            static_cast<size_t>(key_str_len - str_start));
                    }
                }
            }
        }
    }

    // Parse entries (flat)
    std::vector<CfgEntry> flat_entries;
    {
        const auto* buf = d + 0x10;
        const auto buf_len = string_table_off - 0x10;
        int64_t pos = 0;

        for (int32_t ei = 0; ei < entries_count && pos + 5 <= buf_len; ++ei) {
            const uint32_t crc = cfgbin_r32(buf + pos); pos += 4;
            const uint8_t param_count = buf[pos]; pos += 1;

            // Resolve name : key_table du fichier, puis fallback table builtin.
            std::string name;
            auto kit = key_table.find(crc);
            if (kit != key_table.end()) {
                name = kit->second;
            } else {
                const auto& builtin = cfgbin_builtin_key_table();
                auto bit = builtin.find(crc);
                if (bit != builtin.end()) {
                    name = bit->second;
                } else {
                    name = fmt::format("UNKNOWN_{:08X}", crc);
                }
            }

            // Read type bytes (2 bits per param, ceil(param_count/4) bytes)
            const int type_bytes = (param_count + 3) / 4;
            std::vector<CfgVarType> param_types(param_count, CfgVarType::Unknown);
            int pi = 0;
            for (int j = 0; j < type_bytes && pos < buf_len; ++j, ++pos) {
                uint8_t tb = buf[pos];
                for (int k = 0; k < 4 && pi < param_count; ++k, ++pi) {
                    param_types[pi] = static_cast<CfgVarType>((tb >> (2 * k)) & 3);
                }
            }

            // Align to 4 bytes (position after CRC(4) + paramCount(1) + typeBytes)
            const int64_t total_header = 5 + type_bytes;
            if (total_header % 4 != 0) {
                pos += 4 - (total_header % 4);
            }

            // Read values
            CfgEntry entry;
            entry.name = name;
            entry.crc32 = crc;

            for (int j = 0; j < param_count && pos + 4 <= buf_len; ++j) {
                CfgVariable var;
                var.type = param_types[j];

                switch (var.type) {
                    case CfgVarType::String: {
                        int32_t off = cfgbin_ri32(buf + pos);
                        if (off != -1) {
                            auto sit = strings.find(off);
                            if (sit != strings.end()) {
                                var.value = sit->second;
                            } else {
                                var.value = std::string{};
                            }
                        } else {
                            var.value = std::monostate{};
                        }
                        break;
                    }
                    case CfgVarType::Int:
                        var.value = cfgbin_ri32(buf + pos);
                        break;
                    case CfgVarType::Float:
                        var.value = cfgbin_rf(buf + pos);
                        break;
                    default:
                        var.value = cfgbin_ri32(buf + pos);
                        break;
                }
                pos += 4;
                entry.variables.push_back(std::move(var));
            }

            flat_entries.push_back(std::move(entry));
        }
    }

    // Ajouter un suffixe d'index sequentiel (compatible C# GetName())
    std::unordered_map<std::string, int> name_counts;
    for (auto& e : flat_entries) {
        int idx = name_counts[e.name]++;
        e.name = fmt::format("{}_{}", e.name, idx);
    }

    // Helper : extraire le nom de base (tout sauf la derniere partie apres '_')
    // Ex: "SKILL_BEG_0" -> "SKILL_BEG", "CHARA_PARAM_END_2" -> "CHARA_PARAM_END"
    auto get_base_name = [](const std::string& nm) -> std::string {
        auto last = nm.rfind('_');
        if (last == std::string::npos) return nm;
        return nm.substr(0, last);
    };

    // Helper : verifier si un nom de base est un marqueur de debut
    auto is_begin_name = [](const std::string& base) -> bool {
        // Suffixe apres le dernier underscore du base name
        auto last = base.rfind('_');
        if (last == std::string::npos) return false;
        auto suffix = base.substr(last + 1);
        return suffix == "BEG" || suffix == "BEGIN" || suffix == "START";
    };

    // Helper : verifier si un nom de base est un marqueur de fin
    auto is_end_name = [](const std::string& base) -> bool {
        if (base == "_PTREE") return true;
        auto last = base.rfind('_');
        if (last == std::string::npos) return false;
        auto suffix = base.substr(last + 1);
        return suffix == "END";
    };

    // Helper : verifier si un nom de base est un PTREE (begin special)
    auto is_ptree_begin = [](const std::string& base) -> bool {
        return base.size() >= 5 && base.substr(0, 5) == "PTREE";
    };

    // Construire la hierarchie (BEG/END markers)
    CfgBinFile result;
    result.format = CfgBinFile::Format::T2B;
    result.key_table = std::move(key_table);

    std::vector<CfgEntry*> stack;
    for (auto& entry : flat_entries) {
        std::string base = get_base_name(entry.name);

        // Marqueur de fin : param_count == 0 et nom de type END/_PTREE
        if (entry.variables.empty() && is_end_name(base)) {
            if (!stack.empty()) {
                stack.back()->end_terminator = true;
                stack.pop_back();
            }
            continue;
        }

        // Marqueur de debut : nom se termine par BEG/BEGIN/START ou est PTREE
        bool is_begin = is_begin_name(base) || is_ptree_begin(base);

        if (is_begin) {
            entry.end_terminator = false; // sera mis a true par le END correspondant
            if (stack.empty()) {
                result.entries.push_back(std::move(entry));
                stack.push_back(&result.entries.back());
            } else {
                stack.back()->children.push_back(std::move(entry));
                stack.push_back(&stack.back()->children.back());
            }
            continue;
        }

        // Entree normale — ajouter au parent courant ou a la racine
        if (stack.empty()) {
            result.entries.push_back(std::move(entry));
        } else {
            stack.back()->children.push_back(std::move(entry));
        }
    }

    spdlog::debug("cfgbin_parse_t2b: {} root entries", result.entries.size());
    return result;
}

// ── JSON serialization ───────────────────────────────────────────────

nlohmann::json cfgbin_entry_to_json(const CfgEntry& e) {
    nlohmann::json j;
    j["name"] = e.name;
    j["crc32"] = fmt::format("0x{:08X}", e.crc32);

    if (!e.variables.empty()) {
        auto& vars = j["variables"] = nlohmann::json::array();
        for (const auto& v : e.variables) {
            nlohmann::json vj;
            switch (v.type) {
                case CfgVarType::String: vj["type"] = "String"; break;
                case CfgVarType::Int:    vj["type"] = "Int";    break;
                case CfgVarType::Float:  vj["type"] = "Float";  break;
                default:                 vj["type"] = "Unknown"; break;
            }
            std::visit([&](const auto& val) {
                using T = std::decay_t<decltype(val)>;
                if constexpr (std::is_same_v<T, std::monostate>) {
                    vj["value"] = nullptr;
                } else {
                    vj["value"] = val;
                }
            }, v.value);
            vars.push_back(std::move(vj));
        }
    }

    if (!e.children.empty()) {
        auto& ch = j["children"] = nlohmann::json::array();
        for (const auto& child : e.children) {
            ch.push_back(cfgbin_entry_to_json(child));
        }
    }

    return j;
}

nlohmann::json cfgbin_rdbn_to_json(const CfgBinFile& cfg) {
    nlohmann::json root = nlohmann::json::object();
    root["format"] = "RDBN";

    auto& lists_arr = root["lists"] = nlohmann::json::array();
    for (const auto& list : cfg.lists) {
        nlohmann::json lj;
        lj["name"] = list.name;
        auto& entries = lj["entries"] = nlohmann::json::array();

        for (const auto& entry : list.entries) {
            nlohmann::json ej = nlohmann::json::object();
            for (const auto& field : entry.fields) {
                std::visit([&](const auto& val) {
                    using T = std::decay_t<decltype(val)>;
                    if constexpr (std::is_same_v<T, std::vector<uint8_t>>) {
                        // Hex blob
                        std::string hex;
                        for (auto b : val) hex += fmt::format("{:02X}", b);
                        ej[field.name] = hex;
                    } else {
                        ej[field.name] = val;
                    }
                }, field.value);
            }
            entries.push_back(std::move(ej));
        }

        lists_arr.push_back(std::move(lj));
    }

    return root;
}

} // namespace

// ── Public API ───────────────────────────────────────────────────────

size_t CfgBinFile::node_count() const noexcept {
    if (format == Format::RDBN) {
        size_t count = 0;
        for (const auto& list : lists)
            count += list.entries.size();
        return count;
    }

    std::function<size_t(const std::vector<CfgEntry>&)> count_rec;
    count_rec = [&](const std::vector<CfgEntry>& entries) -> size_t {
        size_t n = entries.size();
        for (const auto& e : entries)
            n += count_rec(e.children);
        return n;
    };
    return count_rec(entries);
}

std::optional<CfgBinFile> cfgbin_parse(std::span<const uint8_t> data) {
    if (data.size() < 8) {
        spdlog::error("cfgbin_parse: donnees trop courtes ({} octets)", data.size());
        return std::nullopt;
    }

    // 1. Tenter RDBN
    if (data.size() >= 4 && cfgbin_r32(data.data()) == RDBN_MAGIC) {
        return cfgbin_parse_rdbn(data);
    }

    // 2. Tenter T2B
    if (cfgbin_has_t2b_footer(data)) {
        return cfgbin_parse_t2b(data);
    }

    // 3. Tenter dechiffrement XorShift
    if (data.size() >= 8) {
        std::vector<uint8_t> copy(data.begin(), data.end());
        crypto::xorshift_decrypt(copy);

        if (copy.size() >= 4 && cfgbin_r32(copy.data()) == RDBN_MAGIC) {
            return cfgbin_parse_rdbn(copy);
        }
        if (cfgbin_has_t2b_footer(copy)) {
            return cfgbin_parse_t2b(copy);
        }
    }

    spdlog::warn("cfgbin_parse: format non reconnu");
    return std::nullopt;
}

std::string cfgbin_to_json(const CfgBinFile& cfg) {
    if (cfg.format == CfgBinFile::Format::RDBN) {
        return cfgbin_rdbn_to_json(cfg).dump(2);
    }

    nlohmann::json root = nlohmann::json::object();
    root["format"] = "T2B";
    auto& entries_arr = root["entries"] = nlohmann::json::array();
    for (const auto& entry : cfg.entries) {
        entries_arr.push_back(cfgbin_entry_to_json(entry));
    }
    return root.dump(2);
}

// ── T2B Write ───────────────────────────────────────────────────────

namespace {

/// Collecte toutes les chaines distinctes dans l'arbre d'entrees (recursivement).
void cfgbin_collect_strings(const CfgEntry& entry,
                             std::vector<std::string>& out,
                             std::unordered_map<std::string, bool>& seen) {
    for (const auto& var : entry.variables) {
        if (var.type == CfgVarType::String) {
            const auto* s = std::get_if<std::string>(&var.value);
            if (s && !seen.contains(*s)) {
                seen[*s] = true;
                out.push_back(*s);
            }
        }
    }
    for (const auto& child : entry.children) {
        cfgbin_collect_strings(child, out, seen);
    }
}

/// Extrait le nom de base d'une entree (sans le suffixe _N d'index).
std::string cfgbin_get_base_name(const std::string& name) {
    auto last = name.rfind('_');
    if (last == std::string::npos) return name;
    // Verifier que le suffixe est numerique
    bool all_digits = true;
    for (size_t i = last + 1; i < name.size(); ++i) {
        if (!std::isdigit(static_cast<unsigned char>(name[i]))) {
            all_digits = false;
            break;
        }
    }
    if (all_digits && last + 1 < name.size()) return name.substr(0, last);
    return name;
}

/// Extrait le nom de la cle CRC32 pour une entree (nom de base sans suffixe d'index).
std::string cfgbin_get_entry_name(const CfgEntry& entry) {
    return cfgbin_get_base_name(entry.name);
}

/// Collecte recursivement tous les noms uniques de cles (pour la key table).
void cfgbin_collect_keys(const CfgEntry& entry,
                          std::vector<std::string>& out,
                          std::unordered_map<std::string, bool>& seen) {
    std::string name = cfgbin_get_entry_name(entry);
    if (!seen.contains(name)) {
        seen[name] = true;
        out.push_back(name);
    }
    for (const auto& child : entry.children) {
        cfgbin_collect_keys(child, out, seen);
    }
    // Si l'entree a un end_terminator, ajouter le nom END correspondant
    if (entry.end_terminator) {
        std::string end_name;
        if (name.starts_with("PTREE")) {
            end_name = "_PTREE";
        } else {
            // Remplacer BEG/BEGIN par END
            auto pos_beg = name.rfind("_BEG");
            auto pos_begin = name.rfind("_BEGIN");
            auto pos_start = name.rfind("_START");
            if (pos_begin != std::string::npos && pos_begin + 6 == name.size()) {
                end_name = name.substr(0, pos_begin) + "_END";
            } else if (pos_beg != std::string::npos && pos_beg + 4 == name.size()) {
                end_name = name.substr(0, pos_beg) + "_END";
            } else if (pos_start != std::string::npos && pos_start + 6 == name.size()) {
                end_name = name.substr(0, pos_start) + "_END";
            } else {
                end_name = name + "_END";
            }
        }
        if (!seen.contains(end_name)) {
            seen[end_name] = true;
            out.push_back(end_name);
        }
    }
}

/// Compte recursivement le nombre total d'entrees (y compris les terminateurs END).
int cfgbin_count_entries(const std::vector<CfgEntry>& entries) {
    int count = 0;
    for (const auto& e : entries) {
        ++count;
        count += cfgbin_count_entries(e.children);
        if (e.end_terminator) ++count; // Le terminateur END
    }
    return count;
}

/// Encode les types de variables en octets (2 bits par type, packing 4 par octet).
std::vector<uint8_t> cfgbin_encode_types(const std::vector<CfgVariable>& vars) {
    const size_t n = vars.size();
    const size_t num_bytes = (n + 3) / 4;
    std::vector<uint8_t> result;

    for (size_t i = 0; i < num_bytes; ++i) {
        uint8_t byte_val = 0;
        for (size_t j = 4 * i; j < std::min(4 * (i + 1), n); ++j) {
            uint8_t tag = 0;
            switch (vars[j].type) {
                case CfgVarType::String: tag = 0; break;
                case CfgVarType::Int:    tag = 1; break;
                case CfgVarType::Float:  tag = 2; break;
                default:                 tag = 0; break;
            }
            byte_val |= static_cast<uint8_t>(tag << ((j % 4) * 2));
        }
        result.push_back(byte_val);
    }

    // Padding : (param_count_byte(1) + type_bytes) doit etre aligne a 4
    while ((result.size() + 1) % 4 != 0) {
        result.push_back(0xFF);
    }

    return result;
}

/// Ecrit les donnees d'une entree T2B dans un buffer (recursivement).
void cfgbin_encode_entry(const CfgEntry& entry,
                          const std::unordered_map<std::string, int32_t>& string_offsets,
                          std::vector<uint8_t>& out) {
    std::string name = cfgbin_get_entry_name(entry);
    uint32_t crc = crypto::crc32_compute(name);

    // CRC32 (4 bytes LE)
    size_t pos = out.size();
    out.resize(pos + 4);
    std::memcpy(out.data() + pos, &crc, 4);

    // Param count (1 byte)
    out.push_back(static_cast<uint8_t>(entry.variables.size()));

    // Types (packed 2-bit)
    auto types = cfgbin_encode_types(entry.variables);
    out.insert(out.end(), types.begin(), types.end());

    // Valeurs (4 bytes chacune, LE)
    for (const auto& var : entry.variables) {
        size_t vpos = out.size();
        out.resize(vpos + 4);
        switch (var.type) {
            case CfgVarType::String: {
                const auto* s = std::get_if<std::string>(&var.value);
                int32_t off = -1;
                if (s) {
                    auto it = string_offsets.find(*s);
                    if (it != string_offsets.end()) {
                        off = it->second;
                    }
                }
                std::memcpy(out.data() + vpos, &off, 4);
                break;
            }
            case CfgVarType::Int: {
                const auto* v = std::get_if<int32_t>(&var.value);
                int32_t val = v ? *v : 0;
                std::memcpy(out.data() + vpos, &val, 4);
                break;
            }
            case CfgVarType::Float: {
                const auto* v = std::get_if<float>(&var.value);
                float val = v ? *v : 0.0f;
                std::memcpy(out.data() + vpos, &val, 4);
                break;
            }
            default: {
                const auto* v = std::get_if<int32_t>(&var.value);
                int32_t val = v ? *v : 0;
                std::memcpy(out.data() + vpos, &val, 4);
                break;
            }
        }
    }

    // Enfants (recursif)
    for (const auto& child : entry.children) {
        cfgbin_encode_entry(child, string_offsets, out);
    }

    // Terminateur END
    if (entry.end_terminator) {
        std::string end_name;
        if (name.starts_with("PTREE")) {
            end_name = "_PTREE";
        } else {
            auto pos_beg = name.rfind("_BEG");
            auto pos_begin = name.rfind("_BEGIN");
            auto pos_start = name.rfind("_START");
            if (pos_begin != std::string::npos && pos_begin + 6 == name.size()) {
                end_name = name.substr(0, pos_begin) + "_END";
            } else if (pos_beg != std::string::npos && pos_beg + 4 == name.size()) {
                end_name = name.substr(0, pos_beg) + "_END";
            } else if (pos_start != std::string::npos && pos_start + 6 == name.size()) {
                end_name = name.substr(0, pos_start) + "_END";
            } else {
                end_name = name + "_END";
            }
        }

        uint32_t end_crc = crypto::crc32_compute(end_name);
        size_t epos = out.size();
        out.resize(epos + 8);
        std::memcpy(out.data() + epos, &end_crc, 4);
        // param_count = 0, padding = FF FF FF
        out[epos + 4] = 0x00;
        out[epos + 5] = 0xFF;
        out[epos + 6] = 0xFF;
        out[epos + 7] = 0xFF;
    }
}

/// Aligne un buffer a `alignment` avec des octets de remplissage `fill`.
void cfgbin_align_buffer(std::vector<uint8_t>& buf, size_t alignment, uint8_t fill = 0xFF) {
    const size_t remainder = buf.size() % alignment;
    if (remainder != 0) {
        buf.insert(buf.end(), alignment - remainder, fill);
    }
}

} // namespace

// ── RDBN Write ──────────────────────────────────────────────────────

namespace {

/// Helpers ecriture LE (prefixe rdbn_ pour unity build)
inline void rdbn_w16(uint8_t* p, uint16_t v) { std::memcpy(p, &v, 2); }
inline void rdbn_w16s(uint8_t* p, int16_t v)  { std::memcpy(p, &v, 2); }
inline void rdbn_w32(uint8_t* p, uint32_t v)  { std::memcpy(p, &v, 4); }
inline void rdbn_w32s(uint8_t* p, int32_t v)  { std::memcpy(p, &v, 4); }
inline void rdbn_wf(uint8_t* p, float v)      { std::memcpy(p, &v, 4); }

/// Taille en octets d'un champ RDBN selon son type et sa valeur.
int32_t rdbn_field_size(const RdbnField& f) {
    switch (f.type) {
        case RdbnFieldType::Bool:
        case RdbnFieldType::Byte:
            return 1;
        case RdbnFieldType::Short:
        case RdbnFieldType::ActType:
            return 2;
        case RdbnFieldType::Int:
        case RdbnFieldType::Flag:
        case RdbnFieldType::Float:
        case RdbnFieldType::Hash:
        case RdbnFieldType::Condition:
        case RdbnFieldType::ShortTuple:
            return 4;
        case RdbnFieldType::Rates:
        case RdbnFieldType::Position:
            return 16;
        default: {
            // Blob fallback : taille du vecteur
            const auto* blob = std::get_if<std::vector<uint8_t>>(&f.value);
            return blob ? static_cast<int32_t>(blob->size()) : 4;
        }
    }
}

/// Calcule la taille d'un enregistrement de valeur (stride) pour une liste RDBN.
/// Aligne chaque champ selon sa taille naturelle et retourne la taille totale alignee a 4.
struct RdbnFieldLayout {
    int32_t offset;
    int32_t size;
};

struct RdbnTypeLayout {
    int32_t record_size;                    // Taille d'un enregistrement (stride)
    std::vector<RdbnFieldLayout> fields;    // Layout de chaque champ
};

/// Calcule le layout des champs pour une liste RDBN.
/// Reproduit le layout original : champs sequentiels, pas d'alignement intermediaire.
RdbnTypeLayout rdbn_compute_layout(const RdbnList& list) {
    RdbnTypeLayout layout;

    if (list.entries.empty()) {
        layout.record_size = 0;
        return layout;
    }

    // Utiliser les champs de la premiere entree comme reference
    const auto& ref_fields = list.entries.front().fields;
    int32_t offset = 0;

    for (const auto& f : ref_fields) {
        int32_t fsize = rdbn_field_size(f);
        layout.fields.push_back({offset, fsize});
        offset += fsize;
    }

    // Aligner la taille totale a 4 octets
    if (offset % 4 != 0) {
        offset += 4 - (offset % 4);
    }
    layout.record_size = offset;
    return layout;
}

/// Collecte toutes les chaines utilisees dans les noms de listes et de champs RDBN.
/// Retourne une map hash → chaine.
struct RdbnStringPool {
    std::vector<std::string> strings;               // Chaines distinctes dans l'ordre
    std::unordered_map<std::string, uint32_t> hashes; // Chaine → CRC32
    std::unordered_map<uint32_t, size_t> hash_to_index; // Hash → index dans strings
    std::vector<std::string> condition_strings;      // Chaines de type Condition
    std::unordered_map<std::string, int32_t> condition_offsets; // Chaine Condition → offset
};

void rdbn_collect_string(RdbnStringPool& pool, const std::string& str, uint32_t hash) {
    if (pool.hash_to_index.contains(hash)) return;
    pool.hash_to_index[hash] = pool.strings.size();
    pool.strings.push_back(str);
    pool.hashes[str] = hash;
}

RdbnStringPool rdbn_build_string_pool(const CfgBinFile& cfg) {
    RdbnStringPool pool;

    // Collecter les noms de listes
    for (const auto& list : cfg.lists) {
        rdbn_collect_string(pool, list.name, list.name_hash);
    }

    // Collecter les noms de champs
    for (const auto& list : cfg.lists) {
        for (const auto& entry : list.entries) {
            for (const auto& field : entry.fields) {
                rdbn_collect_string(pool, field.name, field.name_hash);
            }
        }
    }

    // Collecter les chaines de type Condition
    int32_t cond_offset = 0;
    for (const auto& list : cfg.lists) {
        for (const auto& entry : list.entries) {
            for (const auto& field : entry.fields) {
                if (field.type == RdbnFieldType::Condition) {
                    const auto* s = std::get_if<std::string>(&field.value);
                    if (s && !s->starts_with("0x") && !pool.condition_offsets.contains(*s)) {
                        pool.condition_offsets[*s] = cond_offset;
                        pool.condition_strings.push_back(*s);
                        cond_offset += static_cast<int32_t>(s->size()) + 1;
                    }
                }
            }
        }
    }

    return pool;
}

/// Encode la valeur d'un champ RDBN dans un buffer.
void rdbn_encode_value(const RdbnField& field, uint8_t* out, int32_t size,
                       const RdbnStringPool& pool) {
    // Zero-initialiser pour les champs plus petits que 4 bytes
    std::memset(out, 0, static_cast<size_t>(size));

    switch (field.type) {
        case RdbnFieldType::Bool: {
            const auto* v = std::get_if<bool>(&field.value);
            out[0] = (v && *v) ? 1 : 0;
            break;
        }
        case RdbnFieldType::Byte: {
            const auto* v = std::get_if<uint8_t>(&field.value);
            out[0] = v ? *v : 0;
            break;
        }
        case RdbnFieldType::Short:
        case RdbnFieldType::ActType: {
            const auto* v = std::get_if<int16_t>(&field.value);
            int16_t val = v ? *v : 0;
            rdbn_w16s(out, val);
            break;
        }
        case RdbnFieldType::Int:
        case RdbnFieldType::Flag: {
            const auto* v = std::get_if<int32_t>(&field.value);
            int32_t val = v ? *v : 0;
            rdbn_w32s(out, val);
            break;
        }
        case RdbnFieldType::Float: {
            const auto* v = std::get_if<float>(&field.value);
            float val = v ? *v : 0.0f;
            rdbn_wf(out, val);
            break;
        }
        case RdbnFieldType::Hash: {
            // Stocke comme chaine "0x..." dans le variant — parser le uint32
            const auto* s = std::get_if<std::string>(&field.value);
            uint32_t val = 0;
            if (s && s->starts_with("0x")) {
                val = static_cast<uint32_t>(std::stoul(s->substr(2), nullptr, 16));
            }
            rdbn_w32(out, val);
            break;
        }
        case RdbnFieldType::Rates:
        case RdbnFieldType::Position: {
            const auto* v = std::get_if<std::vector<float>>(&field.value);
            if (v && v->size() >= 4 && size >= 16) {
                rdbn_wf(out,      (*v)[0]);
                rdbn_wf(out + 4,  (*v)[1]);
                rdbn_wf(out + 8,  (*v)[2]);
                rdbn_wf(out + 12, (*v)[3]);
            }
            break;
        }
        case RdbnFieldType::Condition: {
            const auto* s = std::get_if<std::string>(&field.value);
            if (s) {
                if (s->starts_with("0x")) {
                    // Valeur numerique brute
                    uint32_t val = static_cast<uint32_t>(std::stoul(s->substr(2), nullptr, 16));
                    rdbn_w32(out, val);
                } else {
                    // Offset dans la string table des conditions
                    auto it = pool.condition_offsets.find(*s);
                    if (it != pool.condition_offsets.end()) {
                        rdbn_w32(out, static_cast<uint32_t>(it->second));
                    }
                }
            }
            break;
        }
        case RdbnFieldType::ShortTuple: {
            const auto* v = std::get_if<std::vector<int16_t>>(&field.value);
            if (v && v->size() >= 2) {
                rdbn_w16s(out,     (*v)[0]);
                rdbn_w16s(out + 2, (*v)[1]);
            }
            break;
        }
        default: {
            // Blob fallback
            const auto* blob = std::get_if<std::vector<uint8_t>>(&field.value);
            if (blob && static_cast<int32_t>(blob->size()) <= size) {
                std::memcpy(out, blob->data(), blob->size());
            }
            break;
        }
    }
}

} // namespace

std::vector<uint8_t> cfgbin_write_rdbn(const CfgBinFile& cfg) {
    if (cfg.format != CfgBinFile::Format::RDBN) {
        spdlog::error("cfgbin_write_rdbn: format n'est pas RDBN");
        return {};
    }

    if (cfg.lists.empty()) {
        spdlog::warn("cfgbin_write_rdbn: aucune liste a ecrire");
        return {};
    }

    // ── 1. Construire le pool de chaines (noms + conditions) ──────────
    auto pool = rdbn_build_string_pool(cfg);

    // ── 2. Construire les layouts de types/champs par liste ───────────
    // Chaque liste correspond a un root entry et un type entry.
    // Les types sont dedupliques si deux listes ont les memes champs.
    // Pour simplifier et garantir le roundtrip, on cree un type par liste.

    struct TypeInfo {
        int16_t field_start;
        int16_t field_count;
    };

    std::vector<TypeInfo> types;
    std::vector<RdbnTypeLayout> layouts;

    // Champs globaux (concatenes pour toutes les listes)
    struct FieldInfo {
        uint32_t hash;
        int16_t type;
        int32_t size;
        int32_t offset;
    };
    std::vector<FieldInfo> all_fields;

    for (const auto& list : cfg.lists) {
        auto layout = rdbn_compute_layout(list);

        int16_t fi_start = static_cast<int16_t>(all_fields.size());
        int16_t fi_count = 0;

        if (!list.entries.empty()) {
            const auto& ref = list.entries.front();
            fi_count = static_cast<int16_t>(ref.fields.size());

            for (size_t i = 0; i < ref.fields.size(); ++i) {
                FieldInfo fi;
                fi.hash = ref.fields[i].name_hash;
                fi.type = static_cast<int16_t>(ref.fields[i].type);
                fi.size = layout.fields[i].size;
                fi.offset = layout.fields[i].offset;
                all_fields.push_back(fi);
            }
        }

        types.push_back({fi_start, fi_count});
        layouts.push_back(std::move(layout));
    }

    // ── 3. Encoder les valeurs ────────────────────────────────────────
    std::vector<uint8_t> values_blob;
    std::vector<int32_t> root_val_offsets;  // Offset de chaque liste dans values_blob
    std::vector<int32_t> root_val_sizes;    // Taille d'un enregistrement par liste
    std::vector<int32_t> root_val_counts;   // Nombre d'entrees par liste

    for (size_t li = 0; li < cfg.lists.size(); ++li) {
        const auto& list = cfg.lists[li];
        const auto& layout = layouts[li];

        root_val_offsets.push_back(static_cast<int32_t>(values_blob.size()));
        root_val_sizes.push_back(layout.record_size);
        root_val_counts.push_back(static_cast<int32_t>(list.entries.size()));

        for (const auto& entry : list.entries) {
            size_t record_start = values_blob.size();
            values_blob.resize(record_start + static_cast<size_t>(layout.record_size), 0);

            for (size_t fi = 0; fi < entry.fields.size() && fi < layout.fields.size(); ++fi) {
                rdbn_encode_value(
                    entry.fields[fi],
                    values_blob.data() + record_start + layout.fields[fi].offset,
                    layout.fields[fi].size,
                    pool);
            }
        }
    }

    // ── 4. Construire la string table ─────────────────────────────────
    // Hashes et offsets des noms
    std::vector<uint32_t> str_hashes;
    std::vector<int32_t> str_offsets_vals;
    std::vector<uint8_t> str_blob;

    for (const auto& s : pool.strings) {
        uint32_t hash = pool.hashes.at(s);
        str_hashes.push_back(hash);
        str_offsets_vals.push_back(static_cast<int32_t>(str_blob.size()));
        str_blob.insert(str_blob.end(), s.begin(), s.end());
        str_blob.push_back(0);
    }

    // Ajouter les chaines Condition apres les noms
    // (les offsets Condition sont relatifs au debut de la string table complete)
    // On doit ajuster les offsets Condition pour etre relatifs au debut de str_blob
    int32_t name_strings_size = static_cast<int32_t>(str_blob.size());

    // Re-calculer les offsets Condition relativement a la string table
    // Le reader lit : string_offset + cval, ou string_offset est le debut de la string pool
    // Les noms sont aussi dans cette pool (references par str_offsets_vals)
    // Les conditions sont des offsets directs dans cette meme pool
    // => les conditions doivent pointer vers name_strings_size + position dans condition_strings
    {
        int32_t cond_pos = name_strings_size;
        for (const auto& cs : pool.condition_strings) {
            // Mettre a jour l'offset pour pointer dans la pool finale
            pool.condition_offsets[cs] = cond_pos;
            str_blob.insert(str_blob.end(), cs.begin(), cs.end());
            str_blob.push_back(0);
            cond_pos += static_cast<int32_t>(cs.size()) + 1;
        }
    }

    // Re-encoder les valeurs Condition avec les offsets corriges
    // (il faut re-parcourir les valeurs qui utilisent des Condition)
    for (size_t li = 0; li < cfg.lists.size(); ++li) {
        const auto& list = cfg.lists[li];
        const auto& layout = layouts[li];
        int32_t base = root_val_offsets[li];

        for (size_t ei = 0; ei < list.entries.size(); ++ei) {
            const auto& entry = list.entries[ei];
            int32_t entry_off = base + static_cast<int32_t>(ei) * layout.record_size;

            for (size_t fi = 0; fi < entry.fields.size() && fi < layout.fields.size(); ++fi) {
                if (entry.fields[fi].type == RdbnFieldType::Condition) {
                    rdbn_encode_value(
                        entry.fields[fi],
                        values_blob.data() + entry_off + layout.fields[fi].offset,
                        layout.fields[fi].size,
                        pool);
                }
            }
        }
    }

    // ── 5. Calculer les offsets dans le fichier ───────────────────────
    // Layout: Header (0x50) + types + fields + roots + hashes + offsets + values + strings
    // Tout est relatif a data_offset.

    constexpr int HEADER_SIZE = 0x50;
    const int data_offset = HEADER_SIZE;

    // Positions relatives a data_offset (en octets)
    int type_pos  = 0;
    int type_size = static_cast<int>(types.size()) * RDBN_ENTRY_SIZE;

    int field_pos  = type_pos + type_size;
    int field_size = static_cast<int>(all_fields.size()) * RDBN_ENTRY_SIZE;

    int root_pos  = field_pos + field_size;
    int root_size = static_cast<int>(cfg.lists.size()) * RDBN_ENTRY_SIZE;

    int hash_pos  = root_pos + root_size;
    int hash_size = static_cast<int>(str_hashes.size()) * 4;

    int offs_pos  = hash_pos + hash_size;
    int offs_size = static_cast<int>(str_offsets_vals.size()) * 4;

    int value_pos  = offs_pos + offs_size;
    int value_size = static_cast<int>(values_blob.size());

    int string_pos = value_pos + value_size;
    int string_size = static_cast<int>(str_blob.size());

    int total_data = string_pos + string_size;
    int total_file = data_offset + total_data;

    // ── 6. Assembler le fichier ───────────────────────────────────────
    std::vector<uint8_t> result(static_cast<size_t>(total_file), 0);
    auto* out = result.data();

    // Header RDBN (0x50 bytes)
    // +0x00: magic "RDBN"
    out[0] = 'R'; out[1] = 'D'; out[2] = 'B'; out[3] = 'N';

    // +0x04: header_size (uint16_t)
    rdbn_w16(out + 0x04, static_cast<uint16_t>(HEADER_SIZE));

    // +0x06: version (uint32_t, 0x64 = 100)
    rdbn_w32(out + 0x06, 0x64);

    // +0x0A: data_offset (word offset, shifted >> 2)
    rdbn_w16(out + 0x0A, static_cast<uint16_t>(data_offset >> 2));

    // +0x0C: data_size (uint32_t)
    rdbn_w32(out + 0x0C, static_cast<uint32_t>(total_data));

    // Offsets des sections (word offset = pos >> 2, relatif a data_offset deja soustrait)
    // +0x24: type_offset (word), +0x26: type_count
    rdbn_w16(out + 0x24, static_cast<uint16_t>(type_pos >> 2));
    rdbn_w16(out + 0x26, static_cast<uint16_t>(types.size()));

    // +0x28: field_offset (word), +0x2A: field_count
    rdbn_w16(out + 0x28, static_cast<uint16_t>(field_pos >> 2));
    rdbn_w16(out + 0x2A, static_cast<uint16_t>(all_fields.size()));

    // +0x2C: root_offset (word), +0x2E: root_count
    rdbn_w16(out + 0x2C, static_cast<uint16_t>(root_pos >> 2));
    rdbn_w16(out + 0x2E, static_cast<uint16_t>(cfg.lists.size()));

    // +0x30: hash_offset (word), +0x32: offsets_offset (word), +0x34: hash_count
    rdbn_w16(out + 0x30, static_cast<uint16_t>(hash_pos >> 2));
    rdbn_w16(out + 0x32, static_cast<uint16_t>(offs_pos >> 2));
    rdbn_w16(out + 0x34, static_cast<uint16_t>(str_hashes.size()));

    // +0x36: value_offset (word)
    rdbn_w16(out + 0x36, static_cast<uint16_t>(value_pos >> 2));

    // +0x38: string_offset (int32, absolu depuis data_offset)
    rdbn_w32s(out + 0x38, string_pos);

    // ── Ecrire les type entries (0x20 bytes chacune) ──────────────────
    for (size_t i = 0; i < types.size(); ++i) {
        auto* tp = out + data_offset + type_pos + i * RDBN_ENTRY_SIZE;
        // +0x08: fi_start, +0x0A: fi_count
        rdbn_w16s(tp + 8, types[i].field_start);
        rdbn_w16s(tp + 10, types[i].field_count);
    }

    // ── Ecrire les field entries (0x20 bytes chacune) ─────────────────
    for (size_t i = 0; i < all_fields.size(); ++i) {
        auto* fp = out + data_offset + field_pos + i * RDBN_ENTRY_SIZE;
        // +0x00: hash, +0x04: type, +0x08: size, +0x0C: offset
        rdbn_w32(fp, all_fields[i].hash);
        rdbn_w16s(fp + 4, all_fields[i].type);
        rdbn_w32s(fp + 8, all_fields[i].size);
        rdbn_w32s(fp + 12, all_fields[i].offset);
    }

    // ── Ecrire les root entries (0x20 bytes chacune) ──────────────────
    for (size_t i = 0; i < cfg.lists.size(); ++i) {
        auto* rp = out + data_offset + root_pos + i * RDBN_ENTRY_SIZE;
        // +0x00: type_index (int16_t)
        rdbn_w16s(rp, static_cast<int16_t>(i));
        // +0x04: val_off (int32_t, offset dans values_blob)
        rdbn_w32s(rp + 4, root_val_offsets[i]);
        // +0x08: val_size (int32_t, taille d'un enregistrement)
        rdbn_w32s(rp + 8, root_val_sizes[i]);
        // +0x0C: val_count (int32_t, nombre d'entrees)
        rdbn_w32s(rp + 12, root_val_counts[i]);
        // +0x10: name_hash (uint32_t)
        rdbn_w32(rp + 16, cfg.lists[i].name_hash);
    }

    // ── Ecrire la table de hashes ─────────────────────────────────────
    for (size_t i = 0; i < str_hashes.size(); ++i) {
        rdbn_w32(out + data_offset + hash_pos + i * 4, str_hashes[i]);
    }

    // ── Ecrire la table d'offsets de chaines ──────────────────────────
    for (size_t i = 0; i < str_offsets_vals.size(); ++i) {
        rdbn_w32s(out + data_offset + offs_pos + i * 4, str_offsets_vals[i]);
    }

    // ── Ecrire les valeurs ────────────────────────────────────────────
    if (!values_blob.empty()) {
        std::memcpy(out + data_offset + value_pos, values_blob.data(), values_blob.size());
    }

    // ── Ecrire les chaines ────────────────────────────────────────────
    if (!str_blob.empty()) {
        std::memcpy(out + data_offset + string_pos, str_blob.data(), str_blob.size());
    }

    spdlog::debug("cfgbin_write_rdbn: {} octets, {} listes, {} types, {} champs, {} chaines",
                   result.size(), cfg.lists.size(), types.size(), all_fields.size(),
                   pool.strings.size());
    return result;
}

std::vector<uint8_t> cfgbin_write(const CfgBinFile& cfg) {
    if (cfg.format == CfgBinFile::Format::RDBN) {
        return cfgbin_write_rdbn(cfg);
    }

    if (cfg.format != CfgBinFile::Format::T2B) {
        spdlog::error("cfgbin_write: format non reconnu");
        return {};
    }

    if (cfg.entries.empty()) {
        spdlog::warn("cfgbin_write: aucune entree a ecrire");
        return {};
    }

    // 1. Collecter les chaines distinctes et construire la string table
    std::vector<std::string> distinct_strings;
    std::unordered_map<std::string, bool> seen_strings;
    for (const auto& entry : cfg.entries) {
        cfgbin_collect_strings(entry, distinct_strings, seen_strings);
    }

    // Construire la map string → offset dans la string table
    std::unordered_map<std::string, int32_t> string_offsets;
    int32_t str_pos = 0;
    for (const auto& s : distinct_strings) {
        string_offsets[s] = str_pos;
        str_pos += static_cast<int32_t>(s.size()) + 1; // +1 pour le null terminator
    }

    // 2. Encoder les strings en binaire
    std::vector<uint8_t> strings_blob;
    for (const auto& s : distinct_strings) {
        strings_blob.insert(strings_blob.end(), s.begin(), s.end());
        strings_blob.push_back(0);
    }

    // 3. Encoder les entrees recursivement
    std::vector<uint8_t> entries_blob;
    for (const auto& entry : cfg.entries) {
        cfgbin_encode_entry(entry, string_offsets, entries_blob);
    }

    // Aligner les entrees a 16 bytes (avec 0xFF)
    cfgbin_align_buffer(entries_blob, 16, 0xFF);

    // 4. Construire la key table
    std::vector<std::string> keys;
    std::unordered_map<std::string, bool> seen_keys;
    for (const auto& entry : cfg.entries) {
        cfgbin_collect_keys(entry, keys, seen_keys);
    }

    // Encoder la key table
    // Format : 16-byte header + N*(8 bytes: crc32 + string_offset) + aligned + strings + aligned
    std::vector<uint8_t> key_entries;
    std::vector<uint8_t> key_strings;
    int32_t key_str_off = 0;
    for (const auto& key : keys) {
        uint32_t crc = crypto::crc32_compute(key);
        size_t kp = key_entries.size();
        key_entries.resize(kp + 8);
        std::memcpy(key_entries.data() + kp, &crc, 4);
        std::memcpy(key_entries.data() + kp + 4, &key_str_off, 4);
        key_str_off += static_cast<int32_t>(key.size()) + 1;
    }

    for (const auto& key : keys) {
        key_strings.insert(key_strings.end(), key.begin(), key.end());
        key_strings.push_back(0);
    }

    // Construire le bloc key table complet (header + entries + aligned + strings + aligned)
    std::vector<uint8_t> key_table_blob;
    key_table_blob.resize(16, 0); // Header placeholder

    key_table_blob.insert(key_table_blob.end(), key_entries.begin(), key_entries.end());
    cfgbin_align_buffer(key_table_blob, 16, 0xFF);

    int32_t key_string_offset = static_cast<int32_t>(key_table_blob.size());
    key_table_blob.insert(key_table_blob.end(), key_strings.begin(), key_strings.end());
    cfgbin_align_buffer(key_table_blob, 16, 0xFF);

    int32_t key_total_length = static_cast<int32_t>(key_table_blob.size());
    int32_t key_count = static_cast<int32_t>(keys.size());
    int32_t key_string_length = static_cast<int32_t>(key_strings.size());

    // Ecrire le header de la key table
    std::memcpy(key_table_blob.data() + 0, &key_total_length, 4);
    std::memcpy(key_table_blob.data() + 4, &key_count, 4);
    std::memcpy(key_table_blob.data() + 8, &key_string_offset, 4);
    std::memcpy(key_table_blob.data() + 12, &key_string_length, 4);

    // 5. Assembler le fichier complet
    // Header (16 bytes) + entries + string_table (aligned) + key_table + footer

    int32_t entries_count = cfgbin_count_entries(cfg.entries);
    int32_t string_table_offset = 0x10 + static_cast<int32_t>(entries_blob.size());
    int32_t string_table_length = static_cast<int32_t>(strings_blob.size());
    int32_t string_table_count = static_cast<int32_t>(distinct_strings.size());

    std::vector<uint8_t> result;
    result.reserve(16 + entries_blob.size() + strings_blob.size() + 32 +
                   key_table_blob.size() + 16);

    // Header
    result.resize(16);
    std::memcpy(result.data() + 0, &entries_count, 4);
    std::memcpy(result.data() + 4, &string_table_offset, 4);
    std::memcpy(result.data() + 8, &string_table_length, 4);
    std::memcpy(result.data() + 12, &string_table_count, 4);

    // Entrees
    result.insert(result.end(), entries_blob.begin(), entries_blob.end());

    // String table
    result.insert(result.end(), strings_blob.begin(), strings_blob.end());
    cfgbin_align_buffer(result, 16, 0xFF);

    // Key table
    result.insert(result.end(), key_table_blob.begin(), key_table_blob.end());

    // Footer T2B : 01 74 32 62 FE 01 <encoding> 00 01
    result.push_back(0x01);
    result.push_back(0x74);
    result.push_back(0x32);
    result.push_back(0x62);
    result.push_back(0xFE);
    result.push_back(0x01);
    result.push_back(0x01); // UTF-8 encoding
    result.push_back(0x00);
    result.push_back(0x01);
    cfgbin_align_buffer(result, 4, 0x00);

    spdlog::debug("cfgbin_write: {} octets, {} entrees, {} chaines, {} cles",
                   result.size(), entries_count, distinct_strings.size(), keys.size());
    return result;
}

// ── CRUD — Entrees T2B ──────────────────────────────────────────

/// Extrait le nom de base d'une entree (sans le suffixe _N d'index sequentiel).
/// Compatible avec cfgbin_get_base_name() du namespace anonyme ci-dessus.
static std::string cfgbin_base_name(std::string_view full_name) {
    auto last = full_name.rfind('_');
    if (last == std::string_view::npos || last + 1 >= full_name.size()) {
        return std::string(full_name);
    }
    // Verifier que le suffixe est entierement numerique
    bool all_digits = true;
    for (size_t i = last + 1; i < full_name.size(); ++i) {
        if (!std::isdigit(static_cast<unsigned char>(full_name[i]))) {
            all_digits = false;
            break;
        }
    }
    if (all_digits) return std::string(full_name.substr(0, last));
    return std::string(full_name);
}

/// Compare le nom de base d'une entree avec un nom cible.
static bool cfgbin_name_matches(const CfgEntry& entry, std::string_view target) {
    // Comparaison directe d'abord (la plus courante)
    if (entry.name == target) return true;
    // Comparaison sur le nom de base (sans suffixe _N)
    return cfgbin_base_name(entry.name) == target;
}

CfgEntry& cfgbin_add_entry(CfgEntry& parent, std::string_view name) {
    CfgEntry child;
    child.name = std::string(name);
    child.crc32 = crypto::crc32_compute(name);
    parent.children.push_back(std::move(child));
    return parent.children.back();
}

bool cfgbin_remove_entry(CfgEntry& parent, std::string_view name) {
    auto it = std::find_if(parent.children.begin(), parent.children.end(),
        [&](const CfgEntry& e) { return cfgbin_name_matches(e, name); });
    if (it == parent.children.end()) return false;
    parent.children.erase(it);
    return true;
}

CfgEntry* cfgbin_find_entry(CfgEntry& parent, std::string_view name, bool recursive) {
    for (auto& child : parent.children) {
        if (cfgbin_name_matches(child, name)) return &child;
        if (recursive) {
            auto* found = cfgbin_find_entry(child, name, true);
            if (found) return found;
        }
    }
    return nullptr;
}

const CfgEntry* cfgbin_find_entry(const CfgEntry& parent, std::string_view name, bool recursive) {
    for (const auto& child : parent.children) {
        if (cfgbin_name_matches(child, name)) return &child;
        if (recursive) {
            const auto* found = cfgbin_find_entry(child, name, true);
            if (found) return found;
        }
    }
    return nullptr;
}

// ── CRUD — Variables (champs) d'une entree T2B ──────────────────

void cfgbin_add_field(CfgEntry& entry, std::string_view name, CfgVarType type, CfgVarValue value) {
    CfgVariable var;
    var.name = std::string(name);
    var.type = type;
    var.value = std::move(value);
    entry.variables.push_back(std::move(var));
}

bool cfgbin_remove_field(CfgEntry& entry, size_t field_index) {
    if (field_index >= entry.variables.size()) return false;
    entry.variables.erase(entry.variables.begin() +
                          static_cast<std::ptrdiff_t>(field_index));
    return true;
}

bool cfgbin_set_field(CfgEntry& entry, std::string_view name, CfgVarValue value) {
    for (auto& var : entry.variables) {
        if (var.name == name) {
            var.value = std::move(value);
            return true;
        }
    }
    return false;
}

CfgVarValue* cfgbin_find_field(CfgEntry& entry, std::string_view name) {
    for (auto& var : entry.variables) {
        if (var.name == name) return &var.value;
    }
    return nullptr;
}

const CfgVarValue* cfgbin_find_field(const CfgEntry& entry, std::string_view name) {
    for (const auto& var : entry.variables) {
        if (var.name == name) return &var.value;
    }
    return nullptr;
}

} // namespace iecode::level5
