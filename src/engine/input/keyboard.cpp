/// @file keyboard.cpp
/// Polling du clavier (lives::CKeyboard, CKeyboardWin).
/// Utilise GetAsyncKeyState sous Windows, stub ailleurs.

#include "iecode/engine/input/keyboard.h"

#if defined(_WIN32)
#  ifndef WIN32_LEAN_AND_MEAN
#    define WIN32_LEAN_AND_MEAN
#  endif
#  include <windows.h>
#endif

namespace lives {

/// Copie l'etat courant dans l'etat precedent, puis echantillonne le nouvel etat.
/// Sous Windows utilise GetAsyncKeyState (bit 0x8000 = touche enfoncee).
void keyboard_poll(CKeyboard& kb) noexcept {
    kb.keys_previous_ = kb.keys_current_;

#if defined(_WIN32)
    for (uint32_t vk = 0; vk < MAX_KEY_COUNT; ++vk) {
        const SHORT s      = GetAsyncKeyState(static_cast<int>(vk));
        kb.keys_current_[vk] = (static_cast<uint16_t>(s) & 0x8000U) != 0U;
    }
#else
    // Stub : aucune touche hors Windows.
    kb.keys_current_.fill(false);
#endif
}

} // namespace lives
