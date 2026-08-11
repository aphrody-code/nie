#pragma once

/// @file gdd_chara.h
/// Donnees runtime des personnages — etat, niveau, competences equipees.
/// Les CGDD*Chara stockent l'etat mutable d'un personnage en cours de partie.

#include "gdd_serialize.h"
#include "../gds/gds_types.h"
#include <vector>
#include <array>
#include <string>
#include <cstdint>

namespace game {

/// Etat runtime d'un personnage — CGDDChara.
struct CGDDChara : CGDDSerialize {
    uint32_t chara_id       = 0;
    uint32_t level          = 1;
    uint32_t exp            = 0;
    int16_t  kick           = 0;
    int16_t  guard          = 0;
    int16_t  catch_         = 0;
    int16_t  body           = 0;
    int16_t  control        = 0;
    int16_t  speed          = 0;
    int16_t  stamina        = 0;
    int16_t  luck           = 0;
    std::array<uint32_t, 6> equipped_skills = {};  ///< IDs des competences equipees
    uint32_t costume_id     = 0;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDChara"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Collection de tous les personnages possedes — CGDDCharaCollection.
struct CGDDCharaCollection : CGDDSerialize {
    std::vector<CGDDChara> characters;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDCharaCollection"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Statut additionnel d'un personnage — CGDDCharaStatus.
struct CGDDCharaStatus : CGDDSerialize {
    uint32_t chara_id    = 0;
    uint32_t friendship  = 0;   ///< Niveau d'amitie
    bool     is_injured  = false;
    bool     is_fatigued = false;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDCharaStatus"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Personnage humain (joueur principal) — CGDDHumanChara.
struct CGDDHumanChara : CGDDSerialize {
    uint32_t    chara_id  = 0;
    std::string custom_name;
    uint32_t    avatar_id = 0;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDHumanChara"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Personnage edite (creation personnalisee) — CGDDEditChara.
struct CGDDEditChara : CGDDSerialize {
    uint32_t    chara_id     = 0;
    std::string custom_name;
    Element     element      = Element::Fire;
    Position    position     = Position::FW;
    uint32_t    parts_head   = 0;
    uint32_t    parts_body   = 0;
    uint32_t    color_skin   = 0;
    uint32_t    color_hair   = 0;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDEditChara"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

} // namespace game
