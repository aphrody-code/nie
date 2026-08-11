#pragma once

/// @file chara_facial.h
/// CCharaFacial — systeme d'expressions faciales (blend shapes).
/// CCharaFaceSizeComponent — composant de taille de visage.
/// Classes RTTI : game::CCharaFacial, game::CCharaFaceSizeComponent.

#include <array>
#include <cstdint>

namespace game {

/// Expressions faciales connues.
enum class FacialExpression : uint8_t {
    Neutral  = 0,
    Happy    = 1,
    Angry    = 2,
    Sad      = 3,
    Surprise = 4,
    Pain     = 5,
    Focus    = 6,
    Shout    = 7,
};

/// Nombre maximum de blend shapes pour le visage.
inline constexpr uint32_t MAX_FACIAL_BLEND_SHAPES = 32;

/// Preset de poids de blend shapes pour une expression.
struct FacialExpressionPreset {
    FacialExpression expression = FacialExpression::Neutral;
    std::array<float, MAX_FACIAL_BLEND_SHAPES> weights = {};
};

/// Systeme d'expressions faciales — pilote les blend shapes du mesh visage.
struct CCharaFacial {
    virtual ~CCharaFacial() = default;

    /// Met a jour les blend shapes — interpole vers l'expression cible.
    virtual void update(float dt);

    /// Definit l'expression cible avec transition.
    virtual void set_expression(FacialExpression expr);

    /// Definit l'expression cible avec duree de transition personnalisee.
    void set_expression(FacialExpression expr, float transition_sec);

    /// Retourne true si la transition est en cours.
    [[nodiscard]] bool is_transitioning() const;

    /// Retourne le poids interpole d'un blend shape.
    [[nodiscard]] float get_blend_weight(uint32_t index) const;

    /// Definit les presets de blend shapes pour ce personnage.
    void set_presets(const std::array<FacialExpressionPreset, 8>& presets);

    FacialExpression current_expression_ = FacialExpression::Neutral;
    FacialExpression target_expression_  = FacialExpression::Neutral;

    /// Poids actuels des blend shapes (interpoles).
    std::array<float, MAX_FACIAL_BLEND_SHAPES> blend_weights_ = {};

    /// Poids source (debut de la transition).
    std::array<float, MAX_FACIAL_BLEND_SHAPES> source_weights_ = {};

    /// Presets par expression (8 expressions definies).
    std::array<FacialExpressionPreset, 8> presets_ = {};

    /// Duree de transition entre expressions (secondes).
    float transition_time_ = 0.2f;

    /// Temps ecoule dans la transition courante.
    float transition_elapsed_ = 0.f;

    /// Indique si les presets sont configures.
    bool presets_loaded_ = false;
};

/// Composant de taille de visage — ajuste les proportions faciales.
/// Utilise par le systeme d'edition de personnage.
struct CCharaFaceSizeComponent {
    float face_width_  = 1.f;
    float face_height_ = 1.f;
    float eye_size_    = 1.f;
    float nose_size_   = 1.f;
    float mouth_size_  = 1.f;
};

} // namespace game
