#pragma once

/// @file gds_chara_base.h
/// Donnees de base des personnages — GDSCharaBase, GDSCharaParam, GDSCharaExpTableConfig.
/// Source : fichiers cfg.bin (CHARA_BASE_INFO, CHARA_PARAM_INFO, etc.).

#include "../gds_types.h"
#include "iecode/formats/level5/cfgbin.h"

#include <spdlog/spdlog.h>

#include <array>
#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <variant>
#include <vector>

namespace game {

/// Parametres de base d'un personnage — GDSCharaBase (cfg.bin CHARA_BASE_INFO).
struct GDSCharaBase {
    uint32_t      chara_id    = 0;
    lives::hash32 name_hash;
    std::string   name_key;       ///< cle de localisation
    Element       element     = Element::Fire;
    Position      position    = Position::FW;
    Rarity        rarity      = Rarity::N;
    uint8_t       series_id   = 0;
    bool          is_playable = true;

    static constexpr std::string_view CFG_KEY = "CHARA_BASE_INFO";

    /// Parse un fichier chara_base_*.cfg.bin (T2B) et retourne la liste des
    /// personnages. Cherche l'entree CHARA_BASE_INFO (count), les 14 descripteurs
    /// de colonnes, puis itere les N enregistrements.
    /// Retourne nullopt si le fichier n'est pas un cfg.bin valide.
    ///
    /// Structure T2B :
    ///   1. Entree CHARA_BASE_INFO (crc 0xB688E1A5) — 1 Int = nombre total.
    ///   2. 14 entrees 0x530F114B — descripteurs de colonnes (2 Int chacun).
    ///   3. N entrees — chaque record contient au moins 8 valeurs ordonnees :
    ///        [0] chara_id (Int)          [1] name_hash (Int CRC32)
    ///        [2] name_key (String)       [3] element (Int)
    ///        [4] position (Int)          [5] rarity (Int)
    ///        [6] series_id (Int)         [7] is_playable (Int 0/1)
    ///
    /// Implementation inline car referencee par iecode_core (loader) et
    /// iecode_game — evite un symbole LNK2019 inter-bibliotheques.
    [[nodiscard]] static inline std::optional<std::vector<GDSCharaBase>>
    from_cfgbin(std::span<const uint8_t> data) {
        auto cfg = iecode::level5::cfgbin_parse(data);
        if (!cfg) {
            spdlog::error("GDSCharaBase::from_cfgbin: echec cfgbin_parse");
            return std::nullopt;
        }
        if (cfg->format != iecode::level5::CfgBinFile::Format::T2B) {
            spdlog::warn("GDSCharaBase::from_cfgbin: format non-T2B ignore");
            return std::nullopt;
        }

        constexpr uint32_t CRC_HEADER     = 0xB688E1A5U; // CHARA_BASE_INFO
        constexpr uint32_t CRC_DESCRIPTOR = 0x530F114BU; // descripteur colonne

        auto var_int = [](const iecode::level5::CfgVariable& v) -> int32_t {
            if (auto* i = std::get_if<int32_t>(&v.value)) return *i;
            if (auto* f = std::get_if<float>(&v.value))
                return static_cast<int32_t>(*f);
            return 0;
        };
        auto var_str = [](const iecode::level5::CfgVariable& v) -> std::string {
            if (auto* s = std::get_if<std::string>(&v.value)) return *s;
            return {};
        };

        std::vector<GDSCharaBase> result;
        int32_t expected_count = 0;

        // Parcourir racines + enfants directs.
        std::vector<const iecode::level5::CfgEntry*> all;
        for (const auto& root : cfg->entries) {
            all.push_back(&root);
            for (const auto& child : root.children) all.push_back(&child);
        }

        for (const auto* entry : all) {
            if (entry->crc32 == CRC_HEADER) {
                if (!entry->variables.empty() && expected_count == 0) {
                    expected_count = var_int(entry->variables[0]);
                    continue;
                }
                if (entry->variables.size() < 8) continue;

                GDSCharaBase base;
                base.chara_id  = static_cast<uint32_t>(var_int(entry->variables[0]));
                base.name_hash = lives::hash32{
                    static_cast<uint32_t>(var_int(entry->variables[1]))};
                base.name_key  = var_str(entry->variables[2]);
                base.element   = static_cast<Element>(
                    static_cast<uint8_t>(var_int(entry->variables[3])));
                base.position  = static_cast<Position>(
                    static_cast<uint8_t>(var_int(entry->variables[4])));
                base.rarity    = static_cast<Rarity>(
                    static_cast<uint8_t>(var_int(entry->variables[5])));
                base.series_id = static_cast<uint8_t>(var_int(entry->variables[6]));
                base.is_playable = var_int(entry->variables[7]) != 0;
                result.push_back(std::move(base));
            }
            // CRC_DESCRIPTOR : ignore (2 Int de metadata colonne)
            (void)CRC_DESCRIPTOR;
        }

        spdlog::info("GDSCharaBase::from_cfgbin: {} records charges (attendu {})",
                     result.size(), expected_count);
        return result;
    }
};

/// Statistiques d'un personnage — GDSCharaParam (cfg.bin CHARA_PARAM_INFO).
struct GDSCharaParam {
    uint32_t chara_id = 0;
    int16_t  kick     = 0;
    int16_t  guard    = 0;
    int16_t  catch_   = 0;
    int16_t  body     = 0;
    int16_t  control  = 0;
    int16_t  speed    = 0;
    int16_t  stamina  = 0;
    int16_t  luck     = 0;

    static constexpr std::string_view CFG_KEY = "CHARA_PARAM_INFO";
};

/// Niveau max et table d'experience — GDSCharaExpTableConfig.
struct GDSCharaExpTableConfig {
    uint32_t chara_id  = 0;
    uint32_t max_level = 99;
    std::array<uint32_t, 99> exp_table = {};

    static constexpr std::string_view CFG_KEY = "CHARA_EXP_TABLE_CONFIG";
};

/// Description additionnelle — GDSCharaAddDesc.
struct GDSCharaAddDesc {
    uint32_t    chara_id = 0;
    std::string desc_key;

    static constexpr std::string_view CFG_KEY = "CHARA_ADD_DESC";
};

/// Expression faciale — GDSCharaExpression.
struct GDSCharaExpression {
    uint32_t    chara_id      = 0;
    uint32_t    expression_id = 0;
    std::string anim_name;

    static constexpr std::string_view CFG_KEY = "CHARA_EXPRESSION";
};

} // namespace game
