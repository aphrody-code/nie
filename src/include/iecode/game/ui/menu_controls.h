#pragma once

/// @file menu_controls.h
/// Widgets de controle menu game:: — compteurs, faders, animations, gradients.
/// Classes RTTI identifiees dans nie.exe pour le systeme de menu.

#include "../../engine/core/object.h"
#include "../../engine/menu/menu_object.h"
#include "../../engine/menu/menu_animation.h"
#include <glm/vec4.hpp>
#include <cstdint>
#include <string_view>
#include <vector>

namespace game {

/// Rouleau numerique — affichage type odometre (game::CMenuNumRoll).
/// Anime le changement de valeur numerique avec un defilement vertical.
struct CMenuNumRoll : lives::CMenuObject {
    static constexpr std::string_view CLASS_NAME = "CMenuNumRoll";

    /// Valeur cible.
    int32_t target_value_ = 0;
    /// Valeur affichee courante (interpolee).
    float display_value_ = 0.f;
    /// Nombre de chiffres affiches.
    uint32_t digit_count_ = 3;
    /// Vitesse de defilement (unites par seconde).
    float roll_speed_ = 10.f;
    /// Animation en cours ?
    bool rolling_ = false;
    /// Afficher les zeros non significatifs ?
    bool leading_zeros_ = false;

    /// Definit la valeur cible et demarre l'animation.
    void set_value(int32_t value);
    /// Definit la valeur immediatement sans animation.
    void set_value_immediate(int32_t value);
    /// Met a jour l'animation.
    void update(float dt) override;
    /// Rendu du rouleau.
    void draw() override;

    [[nodiscard]] bool is_rolling() const { return rolling_; }
    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Controle de compteur avec animation (game::CMenuCountUpCtrl).
/// Anime un comptage de 0 a N (score, XP, monnaie, etc.).
struct CMenuCountUpCtrl : lives::CMenuObject {
    static constexpr std::string_view CLASS_NAME = "CMenuCountUpCtrl";

    /// Valeur de depart.
    int32_t start_value_ = 0;
    /// Valeur d'arrivee.
    int32_t end_value_ = 0;
    /// Valeur courante (affichee).
    int32_t current_value_ = 0;
    /// Duree totale de l'animation en secondes.
    float duration_ = 1.f;
    /// Timer de progression.
    float timer_ = 0.f;
    /// Acceleration : 0=lineaire, 1=ease_in, 2=ease_out, 3=ease_in_out.
    uint32_t easing_ = 0;
    /// Comptage en cours ?
    bool counting_ = false;
    /// Comptage termine ?
    bool finished_ = false;

    /// Demarre le comptage.
    void start(int32_t from, int32_t to, float duration, uint32_t easing = 0);
    /// Met a jour le comptage.
    void update(float dt) override;
    /// Saute a la fin.
    void skip();
    /// Remet a zero.
    void reset();

    [[nodiscard]] bool is_finished() const { return finished_; }
    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }

private:
    /// Applique la fonction d'easing.
    [[nodiscard]] float apply_easing(float t) const;
};

/// Controle de fondu de modele 3D dans les menus (game::CMenuRefModelFadeCtrl).
/// Gere le fondu d'apparition/disparition d'un modele de reference.
struct CMenuRefModelFadeCtrl : lives::CMenuObject {
    static constexpr std::string_view CLASS_NAME = "CMenuRefModelFadeCtrl";

    /// Opacite courante (0-1).
    float opacity_ = 1.f;
    /// Opacite cible.
    float target_opacity_ = 1.f;
    /// Vitesse de fondu (unites par seconde).
    float fade_speed_ = 2.f;
    /// Fondu en cours ?
    bool fading_ = false;

    /// Fondu vers l'apparition.
    void fade_in(float speed = 2.f);
    /// Fondu vers la disparition.
    void fade_out(float speed = 2.f);
    /// Met a jour le fondu.
    void update(float dt) override;

    [[nodiscard]] bool is_fading() const { return fading_; }
    [[nodiscard]] bool is_visible() const { return opacity_ > 0.001f; }
    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Animation de calque (game::CMenuLayerAnim).
/// Controle l'animation d'un calque (CMenuLayerGroup/CMenuLayerObject).
struct CMenuLayerAnim : lives::CMenuObject {
    static constexpr std::string_view CLASS_NAME = "CMenuLayerAnim";

    /// Animation en cours.
    lives::CMenuAnimation* animation_ = nullptr;
    /// Identifiant du calque cible.
    uint32_t layer_id_ = 0;
    /// Mode de lecture : 0=once, 1=loop, 2=ping_pong.
    uint32_t play_mode_ = 0;
    /// Animation en cours ?
    bool playing_ = false;

    /// Joue l'animation sur le calque.
    void play(uint32_t layer_id, uint32_t mode = 0);
    /// Arrete l'animation.
    void stop();
    /// Met a jour.
    void update(float dt) override;

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Animation de personnage en pixels/dot (game::CMenuDotCharaAnim).
/// Anime les sprites de personnages en style pixel art.
struct CMenuDotCharaAnim : lives::CMenuObject {
    static constexpr std::string_view CLASS_NAME = "CMenuDotCharaAnim";

    /// Identifiant du personnage.
    uint32_t chara_id_ = 0;
    /// Frame courante d'animation.
    uint32_t current_frame_ = 0;
    /// Nombre total de frames.
    uint32_t total_frames_ = 4;
    /// Duree par frame en secondes.
    float frame_duration_ = 0.15f;
    /// Timer de frame.
    float frame_timer_ = 0.f;
    /// Animation en boucle ?
    bool looping_ = true;
    /// Animation en cours ?
    bool playing_ = false;

    /// Charge l'animation pour un personnage.
    void load(uint32_t chara_id);
    /// Joue l'animation.
    void play();
    /// Arrete l'animation.
    void stop();
    /// Met a jour.
    void update(float dt) override;
    /// Rendu.
    void draw() override;

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Lien entre animations (game::MenuAnimationLink).
/// Enchaine automatiquement des animations l'une apres l'autre.
struct MenuAnimationLink : lives::CObject {
    static constexpr std::string_view CLASS_NAME = "MenuAnimationLink";

    /// Entree de chaine d'animation.
    struct ChainEntry {
        lives::CMenuAnimation* animation = nullptr;
        float                  delay     = 0.f;  ///< Delai avant de demarrer.
    };

    /// Chaine d'animations.
    std::vector<ChainEntry> chain_;
    /// Index courant dans la chaine.
    uint32_t current_index_ = 0;
    /// Timer de delai.
    float delay_timer_ = 0.f;
    /// Chaine en cours ?
    bool running_ = false;

    /// Ajoute une animation a la chaine.
    void add(lives::CMenuAnimation* anim, float delay = 0.f);
    /// Demarre la chaine.
    void start();
    /// Met a jour.
    void update(float dt);
    /// Remet a zero.
    void reset();

    [[nodiscard]] bool is_finished() const;
    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Gradation de couleur materiau (game::MenuMaterialColorGradation).
/// Interpole cycliquement entre plusieurs couleurs sur un materiau.
struct MenuMaterialColorGradation : lives::CObject {
    static constexpr std::string_view CLASS_NAME = "MenuMaterialColorGradation";

    /// Points de couleur dans le gradient.
    std::vector<glm::vec4> color_stops_;
    /// Progression normalisee (0-1 a travers tout le gradient).
    float progress_ = 0.f;
    /// Vitesse de progression par seconde.
    float speed_ = 0.5f;
    /// Couleur courante interpolee.
    glm::vec4 current_color_{1.f, 1.f, 1.f, 1.f};
    /// Mode boucle ?
    bool looping_ = true;
    /// Actif ?
    bool active_ = false;

    /// Ajoute un point de couleur au gradient.
    void add_stop(const glm::vec4& color);
    /// Efface tous les points.
    void clear_stops();
    /// Demarre la gradation.
    void start();
    /// Arrete la gradation.
    void stop();
    /// Met a jour la couleur courante.
    void update(float dt);

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

} // namespace game
