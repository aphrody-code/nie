#pragma once

/// @file menu_properties.h
/// Proprietes de menu game:: — donnees attachees aux objets menu.
/// Les proprietes sont des data holders avec getters/setters et chargement JSON.

#include "../../engine/core/object.h"
#include "../../engine/menu/menu_object.h"
#include <glm/vec2.hpp>
#include <glm/vec4.hpp>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace game {

// ============================================================================
// Base propriete menu
// ============================================================================

/// Propriete de base attachable a un objet menu.
struct CMenuPropertyBase : lives::CComponent {
    bool dirty_ = true;

    /// Marque la propriete comme modifiee.
    void mark_dirty() { dirty_ = true; }

    /// Consomme le flag dirty (retourne true si c'etait dirty).
    [[nodiscard]] bool consume_dirty() {
        if (dirty_) {
            dirty_ = false;
            return true;
        }
        return false;
    }
};

// ============================================================================
// Proprietes specifiques
// ============================================================================

/// Info de legende/tooltip (game::CMenuCaptionInfoProperty).
/// Haute complexite — gere le formatage, le positionnement et l'affichage
/// des tooltips contextuels dans les menus.
struct CMenuCaptionInfoProperty : CMenuPropertyBase {
    static constexpr std::string_view CLASS_NAME = "CMenuCaptionInfoProperty";

    /// Cle de localisation du titre.
    std::string title_key_;
    /// Cle de localisation du corps.
    std::string body_key_;
    /// Texte du titre resolu.
    std::string title_text_;
    /// Texte du corps resolu.
    std::string body_text_;
    /// Position preferee du tooltip.
    glm::vec2 preferred_pos_{0.f, 0.f};
    /// Taille maximum du tooltip.
    glm::vec2 max_size_{400.f, 200.f};
    /// Direction d'affichage : 0=auto, 1=haut, 2=bas, 3=gauche, 4=droite.
    uint32_t direction_ = 0;
    /// Delai avant affichage en secondes.
    float show_delay_ = 0.3f;
    /// Timer courant.
    float timer_ = 0.f;
    /// Tooltip visible ?
    bool visible_ = false;
    /// Verrouille (ne disparait pas au mouvement) ?
    bool locked_ = false;

    /// Definit le contenu du tooltip.
    void set_content(const std::string& title_key, const std::string& body_key);
    /// Met a jour le timer et la visibilite.
    void update(float dt);
    /// Affiche immediatement.
    void show();
    /// Cache immediatement.
    void hide();

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Declencheur de mise a jour de plaque de texte (game::CMenuTextPlateUpdateProperty).
/// Signale quand le texte d'une plaque doit etre rafraichi.
struct CMenuTextPlateUpdateProperty : CMenuPropertyBase {
    static constexpr std::string_view CLASS_NAME = "CMenuTextPlateUpdateProperty";

    /// Identifiant de la plaque de texte.
    uint32_t plate_id_ = 0;
    /// Cle de texte courante.
    std::string text_key_;
    /// Parametres de formatage.
    std::vector<std::string> format_args_;
    /// Mise a jour necessaire ?
    bool needs_update_ = false;

    /// Definit le texte de la plaque.
    void set_text(uint32_t plate_id, const std::string& key);
    /// Definit le texte avec arguments de formatage.
    void set_text_formatted(uint32_t plate_id, const std::string& key,
                            const std::vector<std::string>& args);
    /// Consomme le flag needs_update_.
    [[nodiscard]] bool consume_update();

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Commande son sur evenements de menu (game::CMenuSoundCmdProperty).
/// Associe des sons aux evenements de menu (selection, validation, annulation).
struct CMenuSoundCmdProperty : CMenuPropertyBase {
    static constexpr std::string_view CLASS_NAME = "CMenuSoundCmdProperty";

    /// Identifiant du son de selection/navigation.
    uint32_t select_sound_id_ = 0;
    /// Identifiant du son de validation.
    uint32_t confirm_sound_id_ = 0;
    /// Identifiant du son d'annulation.
    uint32_t cancel_sound_id_ = 0;
    /// Identifiant du son d'erreur.
    uint32_t error_sound_id_ = 0;
    /// Volume (0.0 - 1.0).
    float volume_ = 1.f;
    /// Sons actifs ?
    bool enabled_ = true;

    /// Joue le son de selection.
    void play_select();
    /// Joue le son de validation.
    void play_confirm();
    /// Joue le son d'annulation.
    void play_cancel();
    /// Joue le son d'erreur.
    void play_error();

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Masque de personnage pour affichage (game::CMenuCharaMaskProperty).
/// Controle quel masque/filtre est applique a l'icone du personnage.
struct CMenuCharaMaskProperty : CMenuPropertyBase {
    static constexpr std::string_view CLASS_NAME = "CMenuCharaMaskProperty";

    /// Type de masque : 0=aucun, 1=greyed_out, 2=silhouette, 3=highlight.
    uint32_t mask_type_ = 0;
    /// Couleur du masque (overlay).
    glm::vec4 mask_color_{0.f, 0.f, 0.f, 0.5f};
    /// Identifiant du personnage masque.
    uint32_t chara_id_ = 0;
    /// Masque actif ?
    bool active_ = false;

    /// Active un masque pour un personnage.
    void apply_mask(uint32_t chara_id, uint32_t mask_type);
    /// Retire le masque.
    void clear_mask();

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Info de guide de bouton (game::MenuButtonGuideInfoProperty).
/// Donnees brutes d'un guide de bouton avant affichage.
struct MenuButtonGuideInfoProperty : CMenuPropertyBase {
    static constexpr std::string_view CLASS_NAME = "MenuButtonGuideInfoProperty";

    /// Entree de guide.
    struct Entry {
        uint32_t    button_id = 0;   ///< Identifiant du bouton.
        std::string action_key;       ///< Cle de localisation de l'action.
        uint32_t    priority = 0;     ///< Priorite d'affichage.
        bool        visible = true;   ///< Visible ?
    };

    /// Liste des entrees.
    std::vector<Entry> entries_;

    /// Ajoute une entree.
    void add_entry(uint32_t button_id, const std::string& action_key, uint32_t priority = 0);
    /// Retire une entree par button_id.
    void remove_entry(uint32_t button_id);
    /// Efface toutes les entrees.
    void clear();
    /// Trie par priorite.
    void sort_by_priority();

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

} // namespace game
