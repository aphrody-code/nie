#pragma once

/// @file gdd_serialize.h
/// Interface de serialisation des donnees de sauvegarde (game::CGDDSerialize).
/// Les CGDD* sont des donnees runtime mutables, opposees aux GDS* qui sont read-only.
/// FUN_1400babb0 dans nie.exe — rpg_savedata.c.

#include <cstdint>
#include <vector>
#include <string_view>

namespace game {

/// Interface de serialisation des donnees de sauvegarde (game::CGDDSerialize).
struct CGDDSerialize {
    virtual ~CGDDSerialize() = default;

    /// Serialise les donnees dans un buffer binaire.
    virtual bool serialize(std::vector<uint8_t>& out) const = 0;

    /// Deserialise les donnees depuis un buffer binaire.
    virtual bool deserialize(const std::vector<uint8_t>& in) = 0;

    /// Nom RTTI du type GDD.
    [[nodiscard]] virtual std::string_view gdd_type_name() const = 0;

    uint32_t version_ = 1;
};

/// En-tete de donnees de jeu — CGDDHeaderData.
struct CGDDHeaderData : CGDDSerialize {
    uint32_t save_version   = 0;
    uint32_t play_time_sec  = 0;
    uint64_t save_timestamp = 0;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDHeaderData"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Donnees de progression globale — CGDDPlayData.
struct CGDDPlayData : CGDDSerialize {
    uint32_t chapter        = 0;
    uint32_t current_map_id = 0;
    uint32_t gold           = 0;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDPlayData"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

} // namespace game
