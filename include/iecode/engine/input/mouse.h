#pragma once

/// @file mouse.h
/// Souris du moteur Level-5 (lives::CMouse, CMouseVirtualInput).

#include "../core/object.h"
#include <cstdint>
#include <string_view>

namespace lives {

/// Boutons de souris (masque de bits).
enum class MouseButton : uint32_t {
    NONE   = 0,
    LEFT   = 1u << 0,
    RIGHT  = 1u << 1,
    MIDDLE = 1u << 2,
    X1     = 1u << 3,
    X2     = 1u << 4,
};

/// Souris (lives::CMouse).
struct CMouse : CObject {
    float    pos_x_      = 0.f;
    float    pos_y_      = 0.f;
    float    delta_x_    = 0.f;
    float    delta_y_    = 0.f;
    float    scroll_     = 0.f;
    uint32_t buttons_current_  = 0;
    uint32_t buttons_previous_ = 0;
    bool     visible_ = true;

    [[nodiscard]] bool is_button_down(MouseButton btn) const {
        return (buttons_current_ & static_cast<uint32_t>(btn)) != 0;
    }

    [[nodiscard]] bool is_button_clicked(MouseButton btn) const {
        auto b = static_cast<uint32_t>(btn);
        return (buttons_current_ & b) != 0 && (buttons_previous_ & b) == 0;
    }

    [[nodiscard]] std::string_view get_class_name() const override { return "CMouse"; }
};

/// Entree souris virtuelle (lives::CMouseVirtualInput).
/// Utilisee pour les ecrans tactiles et le pad virtuel.
struct CMouseVirtualInput : CMouse {
    bool is_touch_ = false;

    [[nodiscard]] std::string_view get_class_name() const override { return "CMouseVirtualInput"; }
};

} // namespace lives
