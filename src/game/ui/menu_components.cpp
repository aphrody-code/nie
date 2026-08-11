/// @file menu_components.cpp
/// Implementation des composants de menu game::.
/// Composants visuels, systeme, entree, etc.

#include "iecode/game/ui/menu_components.h"

#include <spdlog/spdlog.h>
#include <algorithm>
#include <cmath>

namespace game {

// ============================================================================
// CMenuIconSwapComponent
// ============================================================================

void CMenuIconSwapComponent::init() {
    CMenuComponentBase::init();
    current_icon_id_ = default_icon_id_;
    icon_state_ = 0;
    spdlog::debug("CMenuIconSwapComponent::init — default={}, focused={}, selected={}",
                  default_icon_id_, focused_icon_id_, selected_icon_id_);
}

void CMenuIconSwapComponent::update(float dt) {
    (void)dt;
    // Determine l'icone en fonction de l'etat courant.
    uint32_t target_id = default_icon_id_;
    switch (icon_state_) {
        case 1: target_id = focused_icon_id_;  break;
        case 2: target_id = selected_icon_id_; break;
        default: break;
    }
    if (current_icon_id_ != target_id) {
        current_icon_id_ = target_id;
        spdlog::trace("CMenuIconSwapComponent — swap icon to {}", current_icon_id_);
    }
}

// ============================================================================
// CMenuCreatePrimitiveComponent
// ============================================================================

void CMenuCreatePrimitiveComponent::init() {
    CMenuComponentBase::init();
    created_ = false;
    spdlog::debug("CMenuCreatePrimitiveComponent::init — type={}", primitive_type_);
}

void CMenuCreatePrimitiveComponent::draw() {
    if (!created_) return;
    // TODO: port du rendu de primitive via le systeme de rendu menu.
    // nie.exe utilise CMenuRender pour soumettre les primitives.
}

void CMenuCreatePrimitiveComponent::cleanup() {
    created_ = false;
    CMenuComponentBase::cleanup();
}

// ============================================================================
// CMenuCharaModelComponent
// ============================================================================

void CMenuCharaModelComponent::init() {
    CMenuComponentBase::init();
    model_loaded_ = false;
    spdlog::debug("CMenuCharaModelComponent::init");
}

void CMenuCharaModelComponent::update(float dt) {
    if (!model_loaded_) return;
    // TODO: FUN_140fb0560 — mise a jour du modele de personnage dans le menu.
    // Met a jour l'animation du modele.
    (void)dt;
}

void CMenuCharaModelComponent::draw() {
    if (!model_loaded_) return;
    // TODO: rendu du modele 3D via le pipeline de rendu menu.
    // nie.exe utilise la pass 20_CharaBefore ou 25_CharaAfter.
}

void CMenuCharaModelComponent::cleanup() {
    model_loaded_ = false;
    chara_id_ = 0;
    CMenuComponentBase::cleanup();
}

void CMenuCharaModelComponent::load_chara_model(uint32_t chara_id) {
    // TODO: FUN_140fb0560 — charge le modele depuis
    // #/menu/200_icon/10_icon_chr/face/%s.g4tx pour l'icone
    // et le G4MG/G4MD/G4SK pour le modele 3D.
    chara_id_ = chara_id;
    model_loaded_ = true;
    spdlog::debug("CMenuCharaModelComponent::load_chara_model — chara_id={}", chara_id);
}

// ============================================================================
// CMenuEffectAttachComponent
// ============================================================================

void CMenuEffectAttachComponent::init() {
    CMenuComponentBase::init();
    playing_ = false;
    spdlog::debug("CMenuEffectAttachComponent::init — effect_id={}", effect_id_);
}

void CMenuEffectAttachComponent::update(float dt) {
    if (!playing_) return;
    // TODO: mise a jour de l'effet VFX attache.
    (void)dt;
}

void CMenuEffectAttachComponent::cleanup() {
    stop();
    CMenuComponentBase::cleanup();
}

void CMenuEffectAttachComponent::play() {
    playing_ = true;
    spdlog::trace("CMenuEffectAttachComponent::play — effect_id={}", effect_id_);
}

void CMenuEffectAttachComponent::stop() {
    playing_ = false;
}

// ============================================================================
// CMenuCtrlTextComponent
// ============================================================================

void CMenuCtrlTextComponent::init() {
    CMenuComponentBase::init();
    reset();
    spdlog::debug("CMenuCtrlTextComponent::init");
}

void CMenuCtrlTextComponent::update(float dt) {
    if (complete_) return;

    switch (mode_) {
        case 0: // Immediat.
            visible_chars_ = static_cast<uint32_t>(full_text_.size());
            complete_ = true;
            break;

        case 1: { // Typewriter.
            char_timer_ += dt;
            const float interval = (chars_per_second_ > 0.f) ? (1.f / chars_per_second_) : 0.f;
            while (char_timer_ >= interval && visible_chars_ < full_text_.size()) {
                visible_chars_++;
                char_timer_ -= interval;
            }
            if (visible_chars_ >= full_text_.size()) {
                complete_ = true;
            }
            break;
        }

        case 2: { // Fade in.
            const float fade_speed = 2.f; // Opacite complete en 0.5s.
            opacity_ += dt * fade_speed;
            if (opacity_ >= 1.f) {
                opacity_ = 1.f;
                complete_ = true;
            }
            visible_chars_ = static_cast<uint32_t>(full_text_.size());
            break;
        }

        default:
            complete_ = true;
            break;
    }
}

void CMenuCtrlTextComponent::start(const std::string& text, uint32_t mode) {
    full_text_ = text;
    mode_ = mode;
    reset();
    if (mode == 0) {
        visible_chars_ = static_cast<uint32_t>(full_text_.size());
        complete_ = true;
    }
}

void CMenuCtrlTextComponent::skip() {
    visible_chars_ = static_cast<uint32_t>(full_text_.size());
    opacity_ = 1.f;
    complete_ = true;
}

void CMenuCtrlTextComponent::reset() {
    visible_chars_ = 0;
    char_timer_ = 0.f;
    opacity_ = (mode_ == 2) ? 0.f : 1.f;
    complete_ = false;
}

// ============================================================================
// CMenuChangeMaterialColor
// ============================================================================

void CMenuChangeMaterialColor::init() {
    CMenuComponentBase::init();
    transitioning_ = false;
    spdlog::debug("CMenuChangeMaterialColor::init");
}

void CMenuChangeMaterialColor::update(float dt) {
    if (!transitioning_) return;

    timer_ += dt;
    float t = (duration_ > 0.f) ? (timer_ / duration_) : 1.f;
    if (t >= 1.f) {
        t = 1.f;
        transitioning_ = false;
    }
    // Interpolation lineaire entre les deux couleurs.
    current_color_ = from_color_ + (to_color_ - from_color_) * t;
}

void CMenuChangeMaterialColor::start_transition(const glm::vec4& from,
                                                  const glm::vec4& to,
                                                  float duration) {
    from_color_ = from;
    to_color_ = to;
    current_color_ = from;
    duration_ = duration;
    timer_ = 0.f;
    transitioning_ = true;
}

// ============================================================================
// CMenuFocusDeactiveMouse
// ============================================================================

void CMenuFocusDeactiveMouse::init() {
    CMenuComponentBase::init();
    mouse_deactivated_ = false;
    last_focus_state_ = false;
    spdlog::debug("CMenuFocusDeactiveMouse::init");
}

void CMenuFocusDeactiveMouse::update(float dt) {
    (void)dt;
    // TODO: Lire l'etat de focus depuis le parent CMenuObject.
    // Si le focus a change, activer/desactiver la souris.
    // nie.exe : verifie le flag de focus et appelle le InputManager.
}

// ============================================================================
// CMenuDropItemComponent
// ============================================================================

void CMenuDropItemComponent::init() {
    CMenuComponentBase::init();
    finished_ = false;
    progress_ = 0.f;
    spdlog::debug("CMenuDropItemComponent::init");
}

void CMenuDropItemComponent::update(float dt) {
    if (finished_) return;

    progress_ += dt / duration_;
    if (progress_ >= 1.f) {
        progress_ = 1.f;
        finished_ = true;
    }
}

void CMenuDropItemComponent::draw() {
    if (finished_) return;
    // Calcul de la position avec une parabole pour le rebond.
    const float t = progress_;
    const float x = start_pos_.x + (end_pos_.x - start_pos_.x) * t;
    // Parabole : monte puis descend. Max a t=0.5.
    const float arc = -4.f * bounce_height_ * (t * t - t);
    const float y = start_pos_.y + (end_pos_.y - start_pos_.y) * t - arc;
    // TODO: rendu de l'icone de l'objet a la position (x, y).
    (void)x;
    (void)y;
}

void CMenuDropItemComponent::start_drop(uint32_t item_id,
                                          const glm::vec2& from,
                                          const glm::vec2& to) {
    item_id_ = item_id;
    start_pos_ = from;
    end_pos_ = to;
    progress_ = 0.f;
    finished_ = false;
    spdlog::debug("CMenuDropItemComponent::start_drop — item_id={}", item_id);
}

// ============================================================================
// CMenuLoopTimeComponent
// ============================================================================

void CMenuLoopTimeComponent::init() {
    CMenuComponentBase::init();
    reset();
    spdlog::debug("CMenuLoopTimeComponent::init — duration={:.2f}s", loop_duration_);
}

void CMenuLoopTimeComponent::update(float dt) {
    if (paused_) return;
    if (loop_duration_ <= 0.f) return;

    current_time_ += dt;
    while (current_time_ >= loop_duration_) {
        current_time_ -= loop_duration_;
        loop_count_++;
    }
    progress_ = current_time_ / loop_duration_;
}

void CMenuLoopTimeComponent::reset() {
    current_time_ = 0.f;
    progress_ = 0.f;
    loop_count_ = 0;
    paused_ = false;
}

// ============================================================================
// CMenuMapComponent
// ============================================================================

void CMenuMapComponent::init() {
    CMenuComponentBase::init();
    texture_loaded_ = false;
    spdlog::debug("CMenuMapComponent::init");
}

void CMenuMapComponent::update(float dt) {
    (void)dt;
    // TODO: mise a jour du zoom et de la rotation.
}

void CMenuMapComponent::draw() {
    if (!texture_loaded_) return;
    // TODO: FUN_141079750 — rendu de la carte avec la position du joueur.
}

void CMenuMapComponent::cleanup() {
    texture_loaded_ = false;
    map_id_.clear();
    CMenuComponentBase::cleanup();
}

void CMenuMapComponent::load_map(const std::string& map_id) {
    // TODO: charge la texture depuis #/menu/210_minimap/%s/mmp_%s_00.g4tx.
    map_id_ = map_id;
    texture_loaded_ = true;
    spdlog::debug("CMenuMapComponent::load_map — map_id={}", map_id);
}

void CMenuMapComponent::set_player_position(const glm::vec2& pos) {
    player_pos_ = pos;
}

// ============================================================================
// CMenuSimpleMoveLocator
// ============================================================================

void CMenuSimpleMoveLocator::init() {
    CMenuComponentBase::init();
    moving_ = false;
    spdlog::debug("CMenuSimpleMoveLocator::init");
}

void CMenuSimpleMoveLocator::update(float dt) {
    if (!moving_) return;

    timer_ += dt;
    float t = (duration_ > 0.f) ? (timer_ / duration_) : 1.f;
    if (t >= 1.f) {
        t = 1.f;
        moving_ = false;
    }
    // Interpolation lineaire.
    // TODO: appliquer la position interpolee au parent CMenuObject.
    (void)t;
}

void CMenuSimpleMoveLocator::move_to(const glm::vec2& from,
                                       const glm::vec2& to,
                                       float duration) {
    from_pos_ = from;
    to_pos_ = to;
    duration_ = duration;
    timer_ = 0.f;
    moving_ = true;
}

// ============================================================================
// CMenuEventOnePictureFilter
// ============================================================================

void CMenuEventOnePictureFilter::init() {
    CMenuComponentBase::init();
    active_ = false;
    spdlog::debug("CMenuEventOnePictureFilter::init");
}

void CMenuEventOnePictureFilter::update(float dt) {
    (void)dt;
    // Pas d'animation — le filtre est statique.
}

void CMenuEventOnePictureFilter::draw() {
    if (!active_) return;
    // TODO: rendu post-process du filtre (sepia, monochrome, etc.).
}

// ============================================================================
// MenuTextLongCtrlComponent
// ============================================================================

void MenuTextLongCtrlComponent::init() {
    CMenuComponentBase::init();
    scroll_offset_ = 0.f;
    current_page_ = 0;
    spdlog::debug("MenuTextLongCtrlComponent::init");
}

void MenuTextLongCtrlComponent::update(float dt) {
    (void)dt;
    // Le defilement est pilote par les entrees (scroll_up/scroll_down).
}

void MenuTextLongCtrlComponent::draw() {
    // TODO: rendu du texte avec l'offset de defilement courant.
}

void MenuTextLongCtrlComponent::set_text(const std::string& text) {
    full_text_ = text;
    scroll_offset_ = 0.f;
    current_page_ = 0;
    // Estimation de la hauteur du contenu (16 pixels par ligne).
    const auto line_count = static_cast<float>(
        std::count(full_text_.begin(), full_text_.end(), '\n') + 1);
    content_height_ = line_count * 16.f;
    if (pagination_mode_ && viewport_height_ > 0.f) {
        total_pages_ = static_cast<uint32_t>(
            std::ceil(content_height_ / viewport_height_));
        if (total_pages_ == 0) total_pages_ = 1;
    }
    spdlog::trace("MenuTextLongCtrlComponent::set_text — {} lignes, {} pages",
                  static_cast<int>(line_count), total_pages_);
}

void MenuTextLongCtrlComponent::scroll_up(float amount) {
    scroll_offset_ -= amount;
    if (scroll_offset_ < 0.f) scroll_offset_ = 0.f;
}

void MenuTextLongCtrlComponent::scroll_down(float amount) {
    scroll_offset_ += amount;
    const float max_offset = content_height_ - viewport_height_;
    if (max_offset > 0.f && scroll_offset_ > max_offset) {
        scroll_offset_ = max_offset;
    }
}

void MenuTextLongCtrlComponent::next_page() {
    if (current_page_ + 1 < total_pages_) {
        current_page_++;
        scroll_offset_ = static_cast<float>(current_page_) * viewport_height_;
    }
}

void MenuTextLongCtrlComponent::prev_page() {
    if (current_page_ > 0) {
        current_page_--;
        scroll_offset_ = static_cast<float>(current_page_) * viewport_height_;
    }
}

bool MenuTextLongCtrlComponent::is_at_end() const {
    if (pagination_mode_) {
        return current_page_ + 1 >= total_pages_;
    }
    const float max_offset = content_height_ - viewport_height_;
    return max_offset <= 0.f || scroll_offset_ >= max_offset - 0.5f;
}

// ============================================================================
// MenuButtonGuideSystemComponent
// ============================================================================

void MenuButtonGuideSystemComponent::init() {
    CMenuComponentBase::init();
    entries_.clear();
    visible_ = true;
    spdlog::debug("MenuButtonGuideSystemComponent::init");
}

void MenuButtonGuideSystemComponent::update(float dt) {
    (void)dt;
    // TODO: mise a jour des icones selon le type d'appareil d'entree.
}

void MenuButtonGuideSystemComponent::draw() {
    if (!visible_) return;
    // TODO: rendu des guides de boutons en bas de l'ecran.
}

void MenuButtonGuideSystemComponent::set_guide(uint32_t button_id,
                                                 const std::string& label) {
    // Cherche si le button_id existe deja.
    for (auto& entry : entries_) {
        if (entry.button_id_ == button_id) {
            entry.label_ = label;
            entry.visible_ = true;
            return;
        }
    }
    entries_.push_back({.button_id_ = button_id, .label_ = label, .visible_ = true});
}

void MenuButtonGuideSystemComponent::remove_guide(uint32_t button_id) {
    entries_.erase(
        std::remove_if(entries_.begin(), entries_.end(),
                       [button_id](const GuideEntry& e) {
                           return e.button_id_ == button_id;
                       }),
        entries_.end());
}

void MenuButtonGuideSystemComponent::clear() {
    entries_.clear();
}

// ============================================================================
// MenuButtonGuideManageComponent
// ============================================================================

void MenuButtonGuideManageComponent::init() {
    CMenuComponentBase::init();
    guide_stack_.clear();
    active_guide_ = nullptr;
    spdlog::debug("MenuButtonGuideManageComponent::init");
}

void MenuButtonGuideManageComponent::update(float dt) {
    if (active_guide_) {
        active_guide_->update(dt);
    }
}

void MenuButtonGuideManageComponent::push_guide(MenuButtonGuideSystemComponent* guide) {
    if (!guide) return;
    guide_stack_.push_back(guide);
    active_guide_ = guide;
    spdlog::trace("MenuButtonGuideManageComponent::push_guide — stack size={}",
                  guide_stack_.size());
}

void MenuButtonGuideManageComponent::pop_guide() {
    if (guide_stack_.empty()) return;
    guide_stack_.pop_back();
    active_guide_ = guide_stack_.empty() ? nullptr : guide_stack_.back();
    spdlog::trace("MenuButtonGuideManageComponent::pop_guide — stack size={}",
                  guide_stack_.size());
}

// ============================================================================
// MenuVirtualPadComponent
// ============================================================================

void MenuVirtualPadComponent::init() {
    CMenuComponentBase::init();
    active_ = false;
    stick_offset_ = {0.f, 0.f};
    spdlog::debug("MenuVirtualPadComponent::init");
}

void MenuVirtualPadComponent::update(float dt) {
    (void)dt;
    if (!active_) return;
    // TODO: FUN_1401326f0 — lire les entrees tactiles et calculer stick_offset_.
    // Normaliser stick_offset_ dans le rayon touch_radius_.
}

void MenuVirtualPadComponent::draw() {
    if (!active_) return;
    // TODO: rendu du pad virtuel (cercle de fond + indicateur de stick).
}

void MenuVirtualPadComponent::set_active(bool active) {
    active_ = active;
    if (!active) {
        stick_offset_ = {0.f, 0.f};
    }
}

// ============================================================================
// MenuCursorReflectSituationComponent
// ============================================================================

void MenuCursorReflectSituationComponent::init() {
    CMenuComponentBase::init();
    situation_type_ = 0;
    cursor_style_ = 0;
    prev_cursor_style_ = 0;
    spdlog::debug("MenuCursorReflectSituationComponent::init");
}

void MenuCursorReflectSituationComponent::update(float dt) {
    (void)dt;
    // Determine le style de curseur selon la situation.
    prev_cursor_style_ = cursor_style_;
    cursor_style_ = situation_type_; // Mappage direct pour l'instant.
    // TODO: mappage reel depuis les tables de configuration.
}

void MenuCursorReflectSituationComponent::set_situation(uint32_t situation) {
    situation_type_ = situation;
    spdlog::trace("MenuCursorReflectSituationComponent — situation={}", situation);
}

// ============================================================================
// MenuInputDeviceReflectComponent
// ============================================================================

void MenuInputDeviceReflectComponent::init() {
    CMenuComponentBase::init();
    device_type_ = 0;
    prev_device_type_ = 0;
    changed_this_frame_ = false;
    spdlog::debug("MenuInputDeviceReflectComponent::init");
}

void MenuInputDeviceReflectComponent::update(float dt) {
    (void)dt;
    // TODO: detecter le type d'appareil d'entree courant (CPad, CKeyboard, CMouse).
    // Correspond aux sets gaiji : PS4=0, PS5=1, Xbox=2, SteamDeck=3, Key=4, NX=5.
    prev_device_type_ = device_type_;
    // device_type_ = ... ; // Lecture depuis le InputManager.
    changed_this_frame_ = (device_type_ != prev_device_type_);
}

// ============================================================================
// MenuSimplePrimitiveComponent
// ============================================================================

void MenuSimplePrimitiveComponent::init() {
    CMenuComponentBase::init();
    spdlog::debug("MenuSimplePrimitiveComponent::init — type={}", type_);
}

void MenuSimplePrimitiveComponent::draw() {
    // TODO: rendu de la primitive via CMenuRender.
}

} // namespace game
