#pragma once

/// @file chara_edit.h
/// CCharaEditParam — parametres d'edition de personnage.
/// Structs d'edition de costume et parties du corps.
/// Classes RTTI : game::CCharaEditParam, game::CCharaEditVariableParam,
///                game::CCharaEditModelMenu, game::CCharaEditModelUpdater,
///                game::CCharaEditCustomMdlComp, game::CCharaEditCustomTextureComp,
///                game::CCharaEditingCustomPartsComponent.

#include <array>
#include <cstdint>

namespace game {

/// Types de parties editables d'un personnage.
enum class CharaEditPartType : uint8_t {
    Hair      = 0,
    Face      = 1,
    Eyes      = 2,
    Eyebrows  = 3,
    Nose      = 4,
    Mouth     = 5,
    Skin      = 6,
    Body      = 7,
    Uniform   = 8,
    Shoes     = 9,
    Accessory = 10,
};

/// Couleur RGBA8 pour les parties editables.
struct CharaEditColor {
    uint8_t r = 255;
    uint8_t g = 255;
    uint8_t b = 255;
    uint8_t a = 255;
};

/// Parametres d'une partie editable.
struct CharaEditPart {
    CharaEditPartType type  = CharaEditPartType::Hair;
    uint32_t          id    = 0;     // ID du modele/texture
    CharaEditColor    color = {};
    float             scale = 1.f;
};

/// Parametres d'edition de personnage (game::CCharaEditParam).
/// Regroupe toutes les parties editables d'un personnage cree par le joueur.
struct CCharaEditParam {
    uint32_t chara_id    = 0;
    uint32_t preset_id   = 0;

    /// Parties editables (indexees par CharaEditPartType).
    std::array<CharaEditPart, 11> parts = {};

    /// Taille du personnage (facteur).
    float height_scale   = 1.f;

    /// Corpulence (facteur).
    float body_scale     = 1.f;
};

/// Parametres variables d'edition — valeurs modifiees en temps reel
/// dans l'editeur de personnage (game::CCharaEditVariableParam).
struct CCharaEditVariableParam {
    uint32_t       editing_part_index = 0;
    CharaEditColor current_color      = {};
    float          current_scale      = 1.f;
    bool           is_dirty           = false;
};

} // namespace game
