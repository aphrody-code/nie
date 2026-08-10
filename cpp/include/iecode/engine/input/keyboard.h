#pragma once

/// @file keyboard.h
/// Clavier du moteur Level-5 (lives::CKeyboard, CKeyboardWin).

#include "../core/object.h"
#include <array>
#include <cstdint>
#include <string_view>

namespace lives {

/// Nombre maximum de touches trackees.
inline constexpr uint32_t MAX_KEY_COUNT = 256;

/// Clavier de base (lives::CKeyboard).
struct CKeyboard : CObject {
    std::array<bool, MAX_KEY_COUNT> keys_current_{};
    std::array<bool, MAX_KEY_COUNT> keys_previous_{};

    /// Verifie si une touche est appuyee.
    [[nodiscard]] bool is_key_down(uint32_t key_code) const {
        if (key_code >= MAX_KEY_COUNT) return false;
        return keys_current_[key_code];
    }

    /// Verifie si une touche vient d'etre appuyee (trigger).
    [[nodiscard]] bool is_key_triggered(uint32_t key_code) const {
        if (key_code >= MAX_KEY_COUNT) return false;
        return keys_current_[key_code] && !keys_previous_[key_code];
    }

    /// Verifie si une touche vient d'etre relachee.
    [[nodiscard]] bool is_key_released(uint32_t key_code) const {
        if (key_code >= MAX_KEY_COUNT) return false;
        return !keys_current_[key_code] && keys_previous_[key_code];
    }

    [[nodiscard]] std::string_view get_class_name() const override { return "CKeyboard"; }
};

/// Specialisation Windows (lives::CKeyboardWin).
/// Utilise les virtual key codes de WinAPI.
struct CKeyboardWin : CKeyboard {
    [[nodiscard]] std::string_view get_class_name() const override { return "CKeyboardWin"; }
};

} // namespace lives
