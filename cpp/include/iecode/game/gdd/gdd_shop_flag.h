#pragma once

/// @file gdd_shop_flag.h
/// Etat des boutiques, flags globaux et statut aleatoire.

#include "gdd_serialize.h"
#include <vector>
#include <array>
#include <cstdint>

namespace game {

/// Statut d'une boutique — CGDDShopStatus.
struct CGDDShopStatus : CGDDSerialize {
    uint32_t shop_id        = 0;
    bool     is_unlocked    = false;
    uint32_t restock_count  = 0;
    uint64_t last_visit_ts  = 0;    ///< Timestamp derniere visite

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDShopStatus"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Flags globaux du jeu — CGDDFlagStatus.
/// Bitfield de flags booleens pour le suivi de progression.
struct CGDDFlagStatus : CGDDSerialize {
    static constexpr uint32_t MAX_FLAGS = 4096;

    std::array<uint32_t, MAX_FLAGS / 32> flags = {};  ///< Bitfield (128 x 32 = 4096 flags)

    /// Teste un flag.
    [[nodiscard]] bool get_flag(uint32_t index) const {
        if (index >= MAX_FLAGS) return false;
        return (flags[index / 32] >> (index % 32)) & 1u;
    }

    /// Active un flag.
    void set_flag(uint32_t index, bool value) {
        if (index >= MAX_FLAGS) return;
        if (value)
            flags[index / 32] |= (1u << (index % 32));
        else
            flags[index / 32] &= ~(1u << (index % 32));
    }

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDFlagStatus"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Statut aleatoire — CGDDRandStatus.
struct CGDDRandStatus : CGDDSerialize {
    uint32_t seed       = 0;
    uint32_t call_count = 0;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDRandStatus"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

} // namespace game
