/// @file mouse.cpp
/// Polling de la souris (lives::CMouse, CMouseVirtualInput).
/// Utilise GetCursorPos + GetAsyncKeyState sous Windows, stub ailleurs.

#include "iecode/engine/input/mouse.h"

#if defined(_WIN32)
#  ifndef WIN32_LEAN_AND_MEAN
#    define WIN32_LEAN_AND_MEAN
#  endif
#  include <windows.h>
#endif

namespace lives {

/// Echantillonne la position absolue du curseur et l'etat des boutons.
/// La position est en pixels ecran, le delta est calcule frame-a-frame.
void mouse_poll(CMouse& mouse) noexcept {
    mouse.buttons_previous_ = mouse.buttons_current_;

#if defined(_WIN32)
    POINT pt{};
    if (GetCursorPos(&pt) != 0) {
        const float nx = static_cast<float>(pt.x);
        const float ny = static_cast<float>(pt.y);
        mouse.delta_x_ = nx - mouse.pos_x_;
        mouse.delta_y_ = ny - mouse.pos_y_;
        mouse.pos_x_   = nx;
        mouse.pos_y_   = ny;
    } else {
        mouse.delta_x_ = 0.f;
        mouse.delta_y_ = 0.f;
    }

    uint32_t b = 0;
    if ((static_cast<uint16_t>(GetAsyncKeyState(VK_LBUTTON))  & 0x8000U) != 0U) b |= static_cast<uint32_t>(MouseButton::LEFT);
    if ((static_cast<uint16_t>(GetAsyncKeyState(VK_RBUTTON))  & 0x8000U) != 0U) b |= static_cast<uint32_t>(MouseButton::RIGHT);
    if ((static_cast<uint16_t>(GetAsyncKeyState(VK_MBUTTON))  & 0x8000U) != 0U) b |= static_cast<uint32_t>(MouseButton::MIDDLE);
    if ((static_cast<uint16_t>(GetAsyncKeyState(VK_XBUTTON1)) & 0x8000U) != 0U) b |= static_cast<uint32_t>(MouseButton::X1);
    if ((static_cast<uint16_t>(GetAsyncKeyState(VK_XBUTTON2)) & 0x8000U) != 0U) b |= static_cast<uint32_t>(MouseButton::X2);
    mouse.buttons_current_ = b;
#else
    mouse.delta_x_         = 0.f;
    mouse.delta_y_         = 0.f;
    mouse.buttons_current_ = 0;
#endif

    // Le scroll est mis a jour via mouse_set_scroll depuis la boucle d'evenements.
}

/// Applique un delta de roulette (propage depuis WM_MOUSEWHEEL).
void mouse_set_scroll(CMouse& mouse, float delta) noexcept {
    mouse.scroll_ = delta;
}

/// Remet le delta de roulette a zero a la fin de la frame.
void mouse_reset_scroll(CMouse& mouse) noexcept {
    mouse.scroll_ = 0.f;
}

} // namespace lives
