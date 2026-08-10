#pragma once

/// @file gdd_spirit.h
/// Esprits runtime — basara, element, heros, normal, token.
/// Chaque esprit a un ID, un niveau et de l'experience.

#include "gdd_serialize.h"
#include <vector>
#include <cstdint>

namespace game {

/// Esprit Basara — CGDDBasaraSpirit.
struct CGDDBasaraSpirit : CGDDSerialize {
    uint32_t spirit_id = 0;
    uint32_t level     = 1;
    uint32_t exp       = 0;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDBasaraSpirit"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Esprit elementaire — CGDDElementSpirit.
struct CGDDElementSpirit : CGDDSerialize {
    uint32_t spirit_id = 0;
    uint32_t level     = 1;
    uint32_t exp       = 0;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDElementSpirit"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Esprit heros — CGDDHeroSpirit.
struct CGDDHeroSpirit : CGDDSerialize {
    uint32_t spirit_id = 0;
    uint32_t level     = 1;
    uint32_t exp       = 0;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDHeroSpirit"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Esprit normal — CGDDNormalSpirit.
struct CGDDNormalSpirit : CGDDSerialize {
    uint32_t spirit_id = 0;
    uint32_t level     = 1;
    uint32_t exp       = 0;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDNormalSpirit"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Esprit jeton — CGDDTokenSpirit.
struct CGDDTokenSpirit : CGDDSerialize {
    uint32_t spirit_id = 0;
    uint32_t level     = 1;
    uint32_t exp       = 0;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDTokenSpirit"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

} // namespace game
