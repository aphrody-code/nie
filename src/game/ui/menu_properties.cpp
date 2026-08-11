/// @file menu_properties.cpp
/// Implementation des proprietes de menu game::.
/// Donnees attachees aux objets menu avec getters/setters.

#include "iecode/game/ui/menu_properties.h"

#include <spdlog/spdlog.h>
#include <algorithm>

namespace game {

// ============================================================================
// CMenuCaptionInfoProperty
// ============================================================================

void CMenuCaptionInfoProperty::set_content(const std::string& title_key,
                                             const std::string& body_key) {
    title_key_ = title_key;
    body_key_ = body_key;
    // TODO: resoudre les cles de localisation via le systeme de texte.
    title_text_ = title_key; // Placeholder — sera remplace par le texte localise.
    body_text_ = body_key;
    mark_dirty();
    spdlog::trace("CMenuCaptionInfoProperty::set_content — title='{}', body='{}'",
                  title_key, body_key);
}

void CMenuCaptionInfoProperty::update(float dt) {
    if (!visible_ && !locked_) {
        timer_ += dt;
        if (timer_ >= show_delay_) {
            // TODO: verifier que le curseur est toujours sur l'element parent.
            // Pour l'instant, on n'affiche pas automatiquement.
        }
    }
}

void CMenuCaptionInfoProperty::show() {
    visible_ = true;
    timer_ = 0.f;
    spdlog::trace("CMenuCaptionInfoProperty::show — title='{}'", title_key_);
}

void CMenuCaptionInfoProperty::hide() {
    visible_ = false;
    timer_ = 0.f;
}

// ============================================================================
// CMenuTextPlateUpdateProperty
// ============================================================================

void CMenuTextPlateUpdateProperty::set_text(uint32_t plate_id, const std::string& key) {
    plate_id_ = plate_id;
    text_key_ = key;
    format_args_.clear();
    needs_update_ = true;
    mark_dirty();
}

void CMenuTextPlateUpdateProperty::set_text_formatted(uint32_t plate_id,
                                                        const std::string& key,
                                                        const std::vector<std::string>& args) {
    plate_id_ = plate_id;
    text_key_ = key;
    format_args_ = args;
    needs_update_ = true;
    mark_dirty();
}

bool CMenuTextPlateUpdateProperty::consume_update() {
    if (needs_update_) {
        needs_update_ = false;
        return true;
    }
    return false;
}

// ============================================================================
// CMenuSoundCmdProperty
// ============================================================================

void CMenuSoundCmdProperty::play_select() {
    if (!enabled_) return;
    // TODO: FUN_140c39dc0 — jouer le son via CriAtomEx.
    // Le systeme audio utilise des cue sheet IDs.
    spdlog::trace("CMenuSoundCmdProperty::play_select — id={}", select_sound_id_);
}

void CMenuSoundCmdProperty::play_confirm() {
    if (!enabled_) return;
    spdlog::trace("CMenuSoundCmdProperty::play_confirm — id={}", confirm_sound_id_);
}

void CMenuSoundCmdProperty::play_cancel() {
    if (!enabled_) return;
    spdlog::trace("CMenuSoundCmdProperty::play_cancel — id={}", cancel_sound_id_);
}

void CMenuSoundCmdProperty::play_error() {
    if (!enabled_) return;
    spdlog::trace("CMenuSoundCmdProperty::play_error — id={}", error_sound_id_);
}

// ============================================================================
// CMenuCharaMaskProperty
// ============================================================================

void CMenuCharaMaskProperty::apply_mask(uint32_t chara_id, uint32_t mask_type) {
    chara_id_ = chara_id;
    mask_type_ = mask_type;
    active_ = true;
    mark_dirty();
    spdlog::trace("CMenuCharaMaskProperty::apply_mask — chara={}, type={}", chara_id, mask_type);
}

void CMenuCharaMaskProperty::clear_mask() {
    active_ = false;
    mask_type_ = 0;
    mark_dirty();
}

// ============================================================================
// MenuButtonGuideInfoProperty
// ============================================================================

void MenuButtonGuideInfoProperty::add_entry(uint32_t button_id,
                                              const std::string& action_key,
                                              uint32_t priority) {
    // Verifie si le button_id existe deja.
    for (auto& entry : entries_) {
        if (entry.button_id == button_id) {
            entry.action_key = action_key;
            entry.priority = priority;
            entry.visible = true;
            mark_dirty();
            return;
        }
    }
    entries_.push_back({button_id, action_key, priority, true});
    mark_dirty();
}

void MenuButtonGuideInfoProperty::remove_entry(uint32_t button_id) {
    entries_.erase(
        std::remove_if(entries_.begin(), entries_.end(),
                       [button_id](const Entry& e) {
                           return e.button_id == button_id;
                       }),
        entries_.end());
    mark_dirty();
}

void MenuButtonGuideInfoProperty::clear() {
    entries_.clear();
    mark_dirty();
}

void MenuButtonGuideInfoProperty::sort_by_priority() {
    std::sort(entries_.begin(), entries_.end(),
              [](const Entry& a, const Entry& b) {
                  return a.priority < b.priority;
              });
}

} // namespace game
