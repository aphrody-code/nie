/// @file pad.cpp
/// Polling des gamepads (lives::CPad).
/// Utilise XInput 1.4 sous Windows, stub ailleurs.
/// Le layout binaire de CPad (0x1A0) est fidele a nie.exe :
///   +0x08 buttons_current, +0x0C buttons_trigger, +0x10 buttons_released
///   +0x34..+0x4B : 3 axes analogiques 64-bit (encodage engine)
///   +0x161 state_flag (bit0 = connecte)

#include "iecode/engine/input/pad.h"

#include <algorithm>
#include <cstring>

#if defined(_WIN32)
#  ifndef WIN32_LEAN_AND_MEAN
#    define WIN32_LEAN_AND_MEAN
#  endif
#  include <windows.h>
#  include <xinput.h>
#  pragma comment(lib, "Xinput.lib")
#endif

namespace lives {

namespace {

#if defined(_WIN32)
// Traduit les boutons XInput en bitmask PadButton.
[[nodiscard]] uint32_t translate_buttons(WORD xi, BYTE lt, BYTE rt) noexcept {
    uint32_t b = 0;
    if (xi & XINPUT_GAMEPAD_A)              b |= static_cast<uint32_t>(PadButton::A);
    if (xi & XINPUT_GAMEPAD_B)              b |= static_cast<uint32_t>(PadButton::B);
    if (xi & XINPUT_GAMEPAD_X)              b |= static_cast<uint32_t>(PadButton::X);
    if (xi & XINPUT_GAMEPAD_Y)              b |= static_cast<uint32_t>(PadButton::Y);
    if (xi & XINPUT_GAMEPAD_LEFT_SHOULDER)  b |= static_cast<uint32_t>(PadButton::L1);
    if (xi & XINPUT_GAMEPAD_RIGHT_SHOULDER) b |= static_cast<uint32_t>(PadButton::R1);
    if (xi & XINPUT_GAMEPAD_START)          b |= static_cast<uint32_t>(PadButton::START);
    if (xi & XINPUT_GAMEPAD_BACK)           b |= static_cast<uint32_t>(PadButton::SELECT);
    if (xi & XINPUT_GAMEPAD_LEFT_THUMB)     b |= static_cast<uint32_t>(PadButton::L3);
    if (xi & XINPUT_GAMEPAD_RIGHT_THUMB)    b |= static_cast<uint32_t>(PadButton::R3);
    if (xi & XINPUT_GAMEPAD_DPAD_UP)        b |= static_cast<uint32_t>(PadButton::DPAD_UP);
    if (xi & XINPUT_GAMEPAD_DPAD_DOWN)      b |= static_cast<uint32_t>(PadButton::DPAD_DOWN);
    if (xi & XINPUT_GAMEPAD_DPAD_LEFT)      b |= static_cast<uint32_t>(PadButton::DPAD_LEFT);
    if (xi & XINPUT_GAMEPAD_DPAD_RIGHT)     b |= static_cast<uint32_t>(PadButton::DPAD_RIGHT);
    if (lt > XINPUT_GAMEPAD_TRIGGER_THRESHOLD) b |= static_cast<uint32_t>(PadButton::L2);
    if (rt > XINPUT_GAMEPAD_TRIGGER_THRESHOLD) b |= static_cast<uint32_t>(PadButton::R2);
    return b;
}

// Encode deux axes -1..1 dans un uint64 (half-float-like : deux float 32).
[[nodiscard]] uint64_t encode_analog(float x, float y) noexcept {
    uint32_t xi = 0;
    uint32_t yi = 0;
    std::memcpy(&xi, &x, sizeof(xi));
    std::memcpy(&yi, &y, sizeof(yi));
    return (static_cast<uint64_t>(yi) << 32) | xi;
}

[[nodiscard]] float normalize_axis(SHORT raw, SHORT deadzone) noexcept {
    const float v = static_cast<float>(raw);
    const float abs_v = v < 0.f ? -v : v;
    if (abs_v < static_cast<float>(deadzone)) return 0.f;
    const float sign = v < 0.f ? -1.f : 1.f;
    const float mag  = (abs_v - static_cast<float>(deadzone))
                       / (32767.f - static_cast<float>(deadzone));
    return sign * std::clamp(mag, 0.f, 1.f);
}
#endif

} // namespace

/// Interroge un pad via XInput et met a jour son etat.
/// Calcule buttons_trigger et buttons_released a partir de l'etat precedent.
/// @return true si le pad est connecte.
bool pad_poll(CPad& pad, uint32_t index) noexcept {
    const uint32_t previous = pad.buttons_current_;

#if defined(_WIN32)
    XINPUT_STATE state{};
    const DWORD  res = XInputGetState(index, &state);
    if (res != ERROR_SUCCESS) {
        pad.state_flag_       &= ~uint8_t{0x01U}; // deconnecte
        pad.buttons_current_   = 0;
        pad.buttons_trigger_   = 0;
        pad.buttons_released_  = previous; // dernier etat avant deconnexion
        pad.analog_data_0_     = 0;
        pad.analog_data_1_     = 0;
        pad.analog_data_2_     = 0;
        return false;
    }

    pad.state_flag_ |= uint8_t{0x01U}; // bit0 = connecte
    pad.buttons_current_ = translate_buttons(
        state.Gamepad.wButtons, state.Gamepad.bLeftTrigger, state.Gamepad.bRightTrigger);
    pad.buttons_trigger_  = ~previous & pad.buttons_current_;
    pad.buttons_released_ = ~pad.buttons_current_ & previous;

    // Axes normalises -1..1 empaquetes dans 3 slots 64-bit.
    const float lx = normalize_axis(state.Gamepad.sThumbLX, XINPUT_GAMEPAD_LEFT_THUMB_DEADZONE);
    const float ly = normalize_axis(state.Gamepad.sThumbLY, XINPUT_GAMEPAD_LEFT_THUMB_DEADZONE);
    const float rx = normalize_axis(state.Gamepad.sThumbRX, XINPUT_GAMEPAD_RIGHT_THUMB_DEADZONE);
    const float ry = normalize_axis(state.Gamepad.sThumbRY, XINPUT_GAMEPAD_RIGHT_THUMB_DEADZONE);
    const float trig_l = static_cast<float>(state.Gamepad.bLeftTrigger)  / 255.f;
    const float trig_r = static_cast<float>(state.Gamepad.bRightTrigger) / 255.f;

    pad.analog_data_0_ = encode_analog(lx, ly);
    pad.analog_data_1_ = encode_analog(rx, ry);
    pad.analog_data_2_ = encode_analog(trig_l, trig_r);

    // Callback de notification (si installe) : recoit les etats bruts.
    if (pad.callback_ptr_ != nullptr) {
        const uint64_t analog[3] = {pad.analog_data_0_, pad.analog_data_1_, pad.analog_data_2_};
        pad.callback_ptr_(&pad.callback_arg1_, &pad.buttons_current_, analog, 6);
    }
    return true;
#else
    (void)index;
    pad.state_flag_       &= ~uint8_t{0x01U};
    pad.buttons_current_   = 0;
    pad.buttons_trigger_   = 0;
    pad.buttons_released_  = previous;
    pad.analog_data_0_     = 0;
    pad.analog_data_1_     = 0;
    pad.analog_data_2_     = 0;
    return false;
#endif
}

/// Met a jour tous les pads d'un CPadArray.
void pad_array_poll(CPadArray& array) noexcept {
    for (uint32_t i = 0; i < MAX_PAD_COUNT; ++i) {
        pad_poll(array.pads_[i], i);
    }
}

/// Applique une vibration au pad `index`. Magnitudes dans [0,1].
bool pad_set_rumble(uint32_t index, float left_motor, float right_motor) noexcept {
#if defined(_WIN32)
    XINPUT_VIBRATION vib{};
    vib.wLeftMotorSpeed  = static_cast<WORD>(std::clamp(left_motor, 0.f, 1.f) * 65535.f);
    vib.wRightMotorSpeed = static_cast<WORD>(std::clamp(right_motor, 0.f, 1.f) * 65535.f);
    return XInputSetState(index, &vib) == ERROR_SUCCESS;
#else
    (void)index; (void)left_motor; (void)right_motor;
    return false;
#endif
}

} // namespace lives
