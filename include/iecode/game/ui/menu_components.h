#pragma once

/// @file menu_components.h
/// Composants de menu game:: — icones, primitives 3D, modeles personnages,
/// effets, texte controle, couleurs, souris, items, boucles, carte, etc.
/// Chaque composant s'attache a un CMenuObject via le systeme de composants.

#include "menu_paths.h"
#include "../../engine/core/object.h"
#include <glm/vec2.hpp>
#include <glm/vec3.hpp>
#include <glm/vec4.hpp>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace game {

// ============================================================================
// Composant de base game:: pour les menus
// ============================================================================

/// Composant de menu game:: — base commune avec init/update/draw/cleanup.
struct CMenuComponentBase : lives::CComponent {
    bool initialized_ = false;

    virtual void init() { initialized_ = true; }
    virtual void update(float dt) { (void)dt; }
    virtual void draw() {}
    virtual void cleanup() { initialized_ = false; }
};

// ============================================================================
// Composants visuels
// ============================================================================

/// Echange d'icone selon l'etat du menu (game::CMenuIconSwapComponent).
/// Change la texture de l'icone quand le focus/etat change.
struct CMenuIconSwapComponent : CMenuComponentBase {
    static constexpr std::string_view CLASS_NAME = "CMenuIconSwapComponent";

    /// Identifiant de la texture courante.
    uint32_t current_icon_id_  = 0;
    /// Identifiant de la texture au repos.
    uint32_t default_icon_id_  = 0;
    /// Identifiant de la texture en focus.
    uint32_t focused_icon_id_  = 0;
    /// Identifiant de la texture selectionnee.
    uint32_t selected_icon_id_ = 0;
    /// Etat courant : 0=defaut, 1=focus, 2=selectionne.
    uint32_t icon_state_ = 0;

    void init() override;
    void update(float dt) override;

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Creation de primitive 3D pour le menu (game::CMenuCreatePrimitiveComponent).
/// Permet d'afficher des formes geometriques dans l'UI (fond, cadres, etc.).
struct CMenuCreatePrimitiveComponent : CMenuComponentBase {
    static constexpr std::string_view CLASS_NAME = "CMenuCreatePrimitiveComponent";

    /// Type de primitive : 0=quad, 1=circle, 2=line, 3=custom.
    uint32_t primitive_type_ = 0;
    /// Couleur de la primitive (RGBA).
    glm::vec4 color_{1.f, 1.f, 1.f, 1.f};
    /// Taille de la primitive.
    glm::vec2 size_{100.f, 100.f};
    /// Epaisseur de ligne (pour les primitives de type ligne).
    float line_width_ = 1.f;
    /// Primitive creee ?
    bool created_ = false;

    void init() override;
    void draw() override;
    void cleanup() override;

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Affichage du modele 3D d'un personnage dans le menu (game::CMenuCharaModelComponent).
/// Utilise pour les ecrans de selection, equipement, etc.
/// Config poses : menu_paths::config::CHARA_MODEL_POSE_CONFIG
/// Images bustup : menu_paths::img::generic("bustup_img", lang, name)
struct CMenuCharaModelComponent : CMenuComponentBase {
    static constexpr std::string_view CLASS_NAME = "CMenuCharaModelComponent";

    /// Config cfg.bin des poses de modeles dans les menus.
    /// @see menu_paths::config::CHARA_MODEL_POSE_CONFIG
    static constexpr std::string_view POSE_CONFIG_PATH =
        menu_paths::config::CHARA_MODEL_POSE_CONFIG;

    /// Identifiant du personnage affiche.
    uint32_t chara_id_ = 0;
    /// Position 3D dans l'espace menu.
    glm::vec3 position_{0.f, 0.f, 0.f};
    /// Rotation en degres autour de l'axe Y.
    float rotation_y_ = 0.f;
    /// Echelle du modele.
    float scale_ = 1.f;
    /// Animation en cours (idle, pose, etc.).
    uint32_t anim_id_ = 0;
    /// Le modele est-il charge ?
    bool model_loaded_ = false;

    void init() override;
    void update(float dt) override;
    void draw() override;
    void cleanup() override;

    /// Charge le modele pour un personnage donne.
    void load_chara_model(uint32_t chara_id);

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Attache un effet visuel (VFX) a un element de menu (game::CMenuEffectAttachComponent).
struct CMenuEffectAttachComponent : CMenuComponentBase {
    static constexpr std::string_view CLASS_NAME = "CMenuEffectAttachComponent";

    /// Identifiant de l'effet VFX.
    uint32_t effect_id_ = 0;
    /// Position d'attache (relative au parent).
    glm::vec3 attach_offset_{0.f, 0.f, 0.f};
    /// Echelle de l'effet.
    float effect_scale_ = 1.f;
    /// Effet actif ?
    bool playing_ = false;

    void init() override;
    void update(float dt) override;
    void cleanup() override;

    /// Demarre la lecture de l'effet.
    void play();
    /// Arrete la lecture de l'effet.
    void stop();

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Texte controle — machine a ecrire, fondu, etc. (game::CMenuCtrlTextComponent).
struct CMenuCtrlTextComponent : CMenuComponentBase {
    static constexpr std::string_view CLASS_NAME = "CMenuCtrlTextComponent";

    /// Texte complet a afficher.
    std::string full_text_;
    /// Nombre de caracteres visibles (pour effet typewriter).
    uint32_t visible_chars_ = 0;
    /// Vitesse d'affichage (caracteres par seconde).
    float chars_per_second_ = 30.f;
    /// Accumulateur de temps pour le prochain caractere.
    float char_timer_ = 0.f;
    /// Opacite courante (pour effet fondu).
    float opacity_ = 1.f;
    /// Mode : 0=immediat, 1=typewriter, 2=fade_in.
    uint32_t mode_ = 0;
    /// Affichage termine ?
    bool complete_ = false;

    void init() override;
    void update(float dt) override;

    /// Demarre l'affichage du texte.
    void start(const std::string& text, uint32_t mode = 1);
    /// Saute a la fin de l'animation.
    void skip();
    /// Remet a zero.
    void reset();

    [[nodiscard]] bool is_complete() const { return complete_; }
    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Animation de changement de couleur materiau (game::CMenuChangeMaterialColor).
struct CMenuChangeMaterialColor : CMenuComponentBase {
    static constexpr std::string_view CLASS_NAME = "CMenuChangeMaterialColor";

    /// Couleur de depart.
    glm::vec4 from_color_{1.f, 1.f, 1.f, 1.f};
    /// Couleur d'arrivee.
    glm::vec4 to_color_{1.f, 1.f, 1.f, 1.f};
    /// Couleur courante interpolee.
    glm::vec4 current_color_{1.f, 1.f, 1.f, 1.f};
    /// Duree de la transition en secondes.
    float duration_ = 0.5f;
    /// Timer de progression.
    float timer_ = 0.f;
    /// Transition en cours ?
    bool transitioning_ = false;

    void init() override;
    void update(float dt) override;

    /// Demarre une transition de couleur.
    void start_transition(const glm::vec4& from, const glm::vec4& to, float duration);

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Desactive la souris quand le focus change (game::CMenuFocusDeactiveMouse).
struct CMenuFocusDeactiveMouse : CMenuComponentBase {
    static constexpr std::string_view CLASS_NAME = "CMenuFocusDeactiveMouse";

    /// La souris est-elle desactivee ?
    bool mouse_deactivated_ = false;
    /// Focus precedent connu.
    bool last_focus_state_ = false;

    void init() override;
    void update(float dt) override;

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Animation de drop d'objet (game::CMenuDropItemComponent).
struct CMenuDropItemComponent : CMenuComponentBase {
    static constexpr std::string_view CLASS_NAME = "CMenuDropItemComponent";

    /// Identifiant de l'objet droppé.
    uint32_t item_id_ = 0;
    /// Quantite.
    uint32_t quantity_ = 1;
    /// Position initiale du drop.
    glm::vec2 start_pos_{0.f, 0.f};
    /// Position finale du drop (inventaire).
    glm::vec2 end_pos_{0.f, 0.f};
    /// Progression de l'animation (0-1).
    float progress_ = 0.f;
    /// Duree de l'animation en secondes.
    float duration_ = 0.8f;
    /// Hauteur du rebond.
    float bounce_height_ = 50.f;
    /// Animation terminee ?
    bool finished_ = false;

    void init() override;
    void update(float dt) override;
    void draw() override;

    /// Demarre le drop d'un objet.
    void start_drop(uint32_t item_id, const glm::vec2& from, const glm::vec2& to);

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Boucle d'animation basee sur le temps (game::CMenuLoopTimeComponent).
struct CMenuLoopTimeComponent : CMenuComponentBase {
    static constexpr std::string_view CLASS_NAME = "CMenuLoopTimeComponent";

    /// Duree d'un cycle complet en secondes.
    float loop_duration_ = 1.f;
    /// Temps courant dans le cycle.
    float current_time_ = 0.f;
    /// Progression normalisee (0-1).
    float progress_ = 0.f;
    /// Nombre de boucles effectuees.
    uint32_t loop_count_ = 0;
    /// En pause ?
    bool paused_ = false;

    void init() override;
    void update(float dt) override;

    /// Remet a zero le timer.
    void reset();

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Affichage de la minimap/carte (game::CMenuMapComponent).
/// Charge les textures mmp_%s_00.g4tx depuis le VFS.
struct CMenuMapComponent : CMenuComponentBase {
    static constexpr std::string_view CLASS_NAME = "CMenuMapComponent";

    /// Chemin du prefixe texture : #/menu/210_minimap/%s/mmp_%s_00.g4tx
    /// Adresse nie.exe : FUN_141079750.
    static constexpr std::string_view TEXTURE_PATH_FMT = "#/menu/210_minimap/{}/mmp_{}_00.g4tx";

    /// Identifiant de la carte chargee.
    std::string map_id_;
    /// Position du joueur sur la carte (coordonnees normalisees 0-1).
    glm::vec2 player_pos_{0.5f, 0.5f};
    /// Rotation de la carte (degres).
    float rotation_ = 0.f;
    /// Zoom courant.
    float zoom_ = 1.f;
    /// Zoom minimum.
    float zoom_min_ = 0.5f;
    /// Zoom maximum.
    float zoom_max_ = 4.f;
    /// Texture chargee ?
    bool texture_loaded_ = false;

    void init() override;
    void update(float dt) override;
    void draw() override;
    void cleanup() override;

    /// Charge la carte pour un identifiant donne.
    void load_map(const std::string& map_id);
    /// Met a jour la position du joueur.
    void set_player_position(const glm::vec2& pos);

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Deplacement simple d'un locator (game::CMenuSimpleMoveLocator).
struct CMenuSimpleMoveLocator : CMenuComponentBase {
    static constexpr std::string_view CLASS_NAME = "CMenuSimpleMoveLocator";

    /// Position de depart.
    glm::vec2 from_pos_{0.f, 0.f};
    /// Position d'arrivee.
    glm::vec2 to_pos_{0.f, 0.f};
    /// Duree du deplacement en secondes.
    float duration_ = 0.3f;
    /// Timer de progression.
    float timer_ = 0.f;
    /// En mouvement ?
    bool moving_ = false;

    void init() override;
    void update(float dt) override;

    /// Demarre un deplacement.
    void move_to(const glm::vec2& from, const glm::vec2& to, float duration);

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Filtre image pour evenement en une image (game::CMenuEventOnePictureFilter).
struct CMenuEventOnePictureFilter : CMenuComponentBase {
    static constexpr std::string_view CLASS_NAME = "CMenuEventOnePictureFilter";

    /// Type de filtre : 0=aucun, 1=sepia, 2=monochrome, 3=vignette.
    uint32_t filter_type_ = 0;
    /// Intensite du filtre (0-1).
    float intensity_ = 1.f;
    /// Filtre actif ?
    bool active_ = false;

    void init() override;
    void update(float dt) override;
    void draw() override;

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

// ============================================================================
// Composants systeme (sans prefixe CMenu)
// ============================================================================

/// Controle de texte long — defilement et pagination (game::MenuTextLongCtrlComponent).
struct MenuTextLongCtrlComponent : CMenuComponentBase {
    static constexpr std::string_view CLASS_NAME = "MenuTextLongCtrlComponent";

    /// Texte complet.
    std::string full_text_;
    /// Decalage de defilement en pixels.
    float scroll_offset_ = 0.f;
    /// Hauteur totale du contenu en pixels.
    float content_height_ = 0.f;
    /// Hauteur de la zone visible en pixels.
    float viewport_height_ = 200.f;
    /// Vitesse de defilement.
    float scroll_speed_ = 100.f;
    /// Page courante (si pagination active).
    uint32_t current_page_ = 0;
    /// Nombre total de pages.
    uint32_t total_pages_ = 1;
    /// Mode pagination (sinon defilement libre).
    bool pagination_mode_ = false;

    void init() override;
    void update(float dt) override;
    void draw() override;

    /// Definit le texte et recalcule la pagination.
    void set_text(const std::string& text);
    /// Defilement vers le haut.
    void scroll_up(float amount);
    /// Defilement vers le bas.
    void scroll_down(float amount);
    /// Page suivante.
    void next_page();
    /// Page precedente.
    void prev_page();

    [[nodiscard]] bool is_at_end() const;
    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Systeme de guides de boutons (game::MenuButtonGuideSystemComponent).
/// Affiche les icones de boutons et le texte d'action associe.
struct MenuButtonGuideSystemComponent : CMenuComponentBase {
    static constexpr std::string_view CLASS_NAME = "MenuButtonGuideSystemComponent";

    /// Entree du guide de bouton.
    struct GuideEntry {
        uint32_t    button_id_ = 0;     ///< Identifiant du bouton (A, B, X, Y, etc.).
        std::string label_;              ///< Texte de l'action.
        bool        visible_ = true;     ///< Entree visible ?
    };

    /// Entrees de guide actives.
    std::vector<GuideEntry> entries_;
    /// Type d'appareil d'entree courant : 0=clavier, 1=Xbox, 2=PS, 3=Switch.
    uint32_t input_device_type_ = 0;
    /// Guides visibles ?
    bool visible_ = true;

    void init() override;
    void update(float dt) override;
    void draw() override;

    /// Ajoute ou met a jour une entree de guide.
    void set_guide(uint32_t button_id, const std::string& label);
    /// Retire une entree de guide.
    void remove_guide(uint32_t button_id);
    /// Efface toutes les entrees.
    void clear();

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Gestionnaire de guide de boutons (game::MenuButtonGuideManageComponent).
/// Coordonne plusieurs MenuButtonGuideSystemComponent.
struct MenuButtonGuideManageComponent : CMenuComponentBase {
    static constexpr std::string_view CLASS_NAME = "MenuButtonGuideManageComponent";

    /// Pile de contextes de guides (push/pop avec les ecrans).
    std::vector<MenuButtonGuideSystemComponent*> guide_stack_;
    /// Contexte actif (sommet de la pile).
    MenuButtonGuideSystemComponent* active_guide_ = nullptr;

    void init() override;
    void update(float dt) override;

    /// Empile un nouveau contexte de guide.
    void push_guide(MenuButtonGuideSystemComponent* guide);
    /// Depile le contexte courant.
    void pop_guide();

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Overlay de manette virtuelle (game::MenuVirtualPadComponent).
/// Gere l'affichage du pad tactile (m_virtualPadLayoutInfoList — FUN_1401326f0).
/// Config RDBN : virtual_pad_button_config (3 types, 37 fields, 3 root lists).
struct MenuVirtualPadComponent : CMenuComponentBase {
    static constexpr std::string_view CLASS_NAME = "MenuVirtualPadComponent";

    /// Layout info (from RDBN VirtualPadLayoutInfo).
    struct LayoutInfo {
        float screen_anchor_body_hor_v_  = 0.f;   ///< screenAnchorBodyHorV
        float screen_anchor_body_hor_hv_ = 0.f;   ///< screenAnchorBodyHorHV
        float screen_anchor_body_ver_v_  = 0.f;   ///< screenAnchorBodyVerV
        float screen_anchor_body_vert_h_ = 0.f;   ///< screenAnchorBodyVertH
        float auto_scale_               = 1.f;    ///< autoScale
    };

    /// Drawn info (from RDBN VirtualPadDrawnInfo).
    struct DrawnInfo {
        std::string tex_name_;         ///< texName — texture VFS path
        float draw_width_  = 0.f;     ///< drawWidth
        float draw_height_ = 0.f;     ///< drawHeight
        float col_width_   = 0.f;     ///< colWidth — collision area
        float col_height_  = 0.f;     ///< colHeight
    };

    /// Button info (from RDBN VirtualPadButtonInfo).
    struct ButtonInfo {
        uint32_t drawn_info_index_     = 0;     ///< drawnInfoIndex
        uint32_t layout_info_index_    = 0;     ///< layoutInfoIndex
        uint32_t analog_idx_           = 0;     ///< analogIdx
        uint32_t key_idx_              = 0;     ///< keyIdx
        uint32_t input_cmd_            = 0;     ///< inputCmd
        bool     dual_view_flag_       = false; ///< dualViewFlag
        bool     b_button_func_        = false; ///< bButtonFunc
        float    analog_vec_length_max_ = 1.f;  ///< analogVecLengthMax
        bool     is_action_touch_release_ = false; ///< isActionTouchRelease
        bool     play_decide_anime_    = false; ///< playDecideAnime
        uint32_t input_cmd2_           = 0;     ///< inputCmd2
    };

    /// Loaded config data (from m_virtualPadLayoutInfoList, etc.).
    std::vector<LayoutInfo> layout_infos_;
    std::vector<DrawnInfo>  drawn_infos_;
    std::vector<ButtonInfo> button_infos_;

    /// Decalage courant du stick (normalise -1..1).
    glm::vec2 stick_offset_{0.f, 0.f};
    /// Pad actif (affiche et fonctionnel) ?
    bool active_ = false;
    /// Opacite du pad.
    float opacity_ = 0.7f;

    void init() override;
    void update(float dt) override;
    void draw() override;

    /// Active ou desactive le pad virtuel.
    void set_active(bool active);
    /// Charge la config depuis virtual_pad_button_config RDBN.
    void load_config(const std::vector<LayoutInfo>& layouts,
                     const std::vector<DrawnInfo>& drawns,
                     const std::vector<ButtonInfo>& buttons);

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Adaptation du curseur au contexte (game::MenuCursorReflectSituationComponent).
/// Change le style du curseur selon la situation (combat, exploration, menu).
struct MenuCursorReflectSituationComponent : CMenuComponentBase {
    static constexpr std::string_view CLASS_NAME = "MenuCursorReflectSituationComponent";

    /// Type de situation : 0=menu, 1=exploration, 2=combat, 3=dialogue.
    uint32_t situation_type_ = 0;
    /// Style de curseur precedent.
    uint32_t prev_cursor_style_ = 0;
    /// Style de curseur courant.
    uint32_t cursor_style_ = 0;

    void init() override;
    void update(float dt) override;

    /// Met a jour la situation.
    void set_situation(uint32_t situation);

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Reflet du type d'appareil d'entree (game::MenuInputDeviceReflectComponent).
/// Met a jour l'affichage des icones de boutons selon le peripherique.
struct MenuInputDeviceReflectComponent : CMenuComponentBase {
    static constexpr std::string_view CLASS_NAME = "MenuInputDeviceReflectComponent";

    /// Type courant : 0=clavier, 1=Xbox, 2=PS, 3=Switch (gaiji).
    /// Correspond aux 8 sets de polices gaiji : PS4, PS5, Xbox, SteamDeck, Key, NX, Game, Game2.
    uint32_t device_type_ = 0;
    /// Type precedent (pour detecter le changement).
    uint32_t prev_device_type_ = 0;
    /// Changement detecte ce frame ?
    bool changed_this_frame_ = false;

    void init() override;
    void update(float dt) override;

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

/// Primitive 3D simple (game::MenuSimplePrimitiveComponent).
struct MenuSimplePrimitiveComponent : CMenuComponentBase {
    static constexpr std::string_view CLASS_NAME = "MenuSimplePrimitiveComponent";

    /// Type : 0=quad, 1=triangle, 2=circle.
    uint32_t type_ = 0;
    /// Couleur.
    glm::vec4 color_{1.f, 1.f, 1.f, 1.f};
    /// Position.
    glm::vec2 position_{0.f, 0.f};
    /// Taille.
    glm::vec2 size_{50.f, 50.f};

    void init() override;
    void draw() override;

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }
};

} // namespace game
