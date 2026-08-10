#pragma once

/// @file pad.h
/// Gamepad du moteur Level-5 (lives::CPad).
/// Layout confirme par analyse nie.c — taille totale 0x1A0.
///
/// Offsets verifies (layout binaire fidele) :
///   +0x00  vftable*
///   +0x08  uint32  buttons_current
///   +0x0C  uint32  buttons_trigger   (~prev & current)
///   +0x10  uint32  buttons_released  (~current & prev)
///   +0x34  uint64  analog_data[0]
///   +0x3C  uint64  analog_data[1]
///   +0x44  uint64  analog_data[2]
///   +0x161 uint8   state_flag (bit0 = connecte)
///   +0x162 char    enabled
///   +0x165 char    override_flag
///   +0x170 code*   callback_ptr
///   +0x178 int64   callback_arg1
///   +0x180 int64   callback_arg2
///   +0x188 int64   callback_arg3
///   +0x190 uint32  button_mask_trigger (0x8000000)
///   +0x194 uint32  button_mask_hold    (0x10000000)
///
/// Signature callback :
///   callback(self + 0x170, &buttons_current, &analog_data, 6)

#include <array>
#include <cstddef>
#include <cstdint>
#include <string_view>

namespace lives {

/// Boutons de pad (masque de bits).
enum class PadButton : uint32_t {
    NONE       = 0,
    A          = 1u << 0,
    B          = 1u << 1,
    X          = 1u << 2,
    Y          = 1u << 3,
    L1         = 1u << 4,
    R1         = 1u << 5,
    L2         = 1u << 6,
    R2         = 1u << 7,
    START      = 1u << 8,
    SELECT     = 1u << 9,
    L3         = 1u << 10,
    R3         = 1u << 11,
    DPAD_UP    = 1u << 12,
    DPAD_DOWN  = 1u << 13,
    DPAD_LEFT  = 1u << 14,
    DPAD_RIGHT = 1u << 15,
};

/// Signature du callback installe dans CPad (+0x170).
/// Appele avec : (self_plus_0x170, &buttons_current, &analog_data[0], 6)
using PadCallback = void (*)(void* ctx, const uint32_t* buttons_current,
                             const uint64_t* analog_data, int count);

/// Gamepad (lives::CPad). Taille binaire exacte : 0x1A0.
/// N'herite PAS de CObject — layout flat pour respecter les offsets nie.exe.
/// La vftable est implicite (premier membre virtuel) et occupe +0x00..+0x07.
/// Les champs `reserved_*` sont du padding explicite pour atteindre les
/// offsets documentes dans nie.c (verifies par static_assert plus bas).
/// `#pragma pack(1)` est necessaire car analog_data_0_ (uint64) est a
/// l'offset 0x34 qui n'est pas 8-aligne.
#pragma pack(push, 1)
struct CPad {
    // +0x00 : vftable implicite (vftable ptr pose par le compilateur)
    virtual ~CPad() noexcept = default;

    // +0x08 : etat des boutons
    uint32_t buttons_current_  = 0;  ///< +0x08 — boutons appuyes cette frame
    uint32_t buttons_trigger_  = 0;  ///< +0x0C — ~prev & current (edge press)
    uint32_t buttons_released_ = 0;  ///< +0x10 — ~current & prev (edge release)

    // +0x14..+0x33 : padding / etat interne non documente (32 bytes)
    std::array<uint8_t, 0x20> reserved_0x14_{};

    // +0x34..+0x4B : 3 axes analogiques 64-bit (encodage interne engine)
    uint64_t analog_data_0_ = 0;  ///< +0x34
    uint64_t analog_data_1_ = 0;  ///< +0x3C
    uint64_t analog_data_2_ = 0;  ///< +0x44

    // +0x4C..+0x160 : padding interne (282 bytes)
    std::array<uint8_t, 0x115> reserved_0x4c_{};

    uint8_t state_flag_    = 0;  ///< +0x161 — bit0 = connecte
    char    enabled_       = 0;  ///< +0x162
    uint8_t reserved_0x163 = 0;  ///< +0x163
    uint8_t reserved_0x164 = 0;  ///< +0x164
    char    override_flag_ = 0;  ///< +0x165

    // +0x166..+0x16F : padding (10 bytes)
    std::array<uint8_t, 0x0A> reserved_0x166_{};

    PadCallback callback_ptr_  = nullptr;  ///< +0x170
    int64_t     callback_arg1_ = 0;        ///< +0x178
    int64_t     callback_arg2_ = 0;        ///< +0x180
    int64_t     callback_arg3_ = 0;        ///< +0x188

    uint32_t button_mask_trigger_ = 0x08000000U;  ///< +0x190
    uint32_t button_mask_hold_    = 0x10000000U;  ///< +0x194

    // +0x198..+0x19F : tail padding
    std::array<uint8_t, 0x08> reserved_0x198_{};

    /// Connecte si bit 0 de state_flag est arme.
    [[nodiscard]] bool is_connected() const { return (state_flag_ & 0x01U) != 0; }

    /// Verifie si un bouton est appuye.
    [[nodiscard]] bool is_pressed(PadButton btn) const {
        return (buttons_current_ & static_cast<uint32_t>(btn)) != 0;
    }

    /// Verifie si un bouton vient d'etre appuye (edge).
    [[nodiscard]] bool is_triggered(PadButton btn) const {
        return (buttons_trigger_ & static_cast<uint32_t>(btn)) != 0;
    }

    /// Verifie si un bouton vient d'etre relache.
    [[nodiscard]] bool is_released(PadButton btn) const {
        return (buttons_released_ & static_cast<uint32_t>(btn)) != 0;
    }

    [[nodiscard]] virtual std::string_view get_class_name() const { return "CPad"; }
};
#pragma pack(pop)

// Verifications de layout binaire (fidelite avec nie.exe).
static_assert(offsetof(CPad, buttons_current_)   == 0x08, "CPad::buttons_current must be at +0x08");
static_assert(offsetof(CPad, buttons_trigger_)   == 0x0C, "CPad::buttons_trigger must be at +0x0C");
static_assert(offsetof(CPad, buttons_released_)  == 0x10, "CPad::buttons_released must be at +0x10");
static_assert(offsetof(CPad, analog_data_0_)     == 0x34, "CPad::analog_data[0] must be at +0x34");
static_assert(offsetof(CPad, analog_data_1_)     == 0x3C, "CPad::analog_data[1] must be at +0x3C");
static_assert(offsetof(CPad, analog_data_2_)     == 0x44, "CPad::analog_data[2] must be at +0x44");
static_assert(offsetof(CPad, state_flag_)        == 0x161, "CPad::state_flag must be at +0x161");
static_assert(offsetof(CPad, enabled_)           == 0x162, "CPad::enabled must be at +0x162");
static_assert(offsetof(CPad, override_flag_)     == 0x165, "CPad::override_flag must be at +0x165");
static_assert(offsetof(CPad, callback_ptr_)      == 0x170, "CPad::callback_ptr must be at +0x170");
static_assert(offsetof(CPad, callback_arg1_)     == 0x178, "CPad::callback_arg1 must be at +0x178");
static_assert(offsetof(CPad, callback_arg2_)     == 0x180, "CPad::callback_arg2 must be at +0x180");
static_assert(offsetof(CPad, callback_arg3_)     == 0x188, "CPad::callback_arg3 must be at +0x188");
static_assert(offsetof(CPad, button_mask_trigger_) == 0x190, "CPad::button_mask_trigger must be at +0x190");
static_assert(offsetof(CPad, button_mask_hold_)    == 0x194, "CPad::button_mask_hold must be at +0x194");
static_assert(sizeof(CPad) == 0x1A0, "CPad size must be exactly 0x1A0 (416 bytes)");

/// Nombre maximum de pads simultanes.
inline constexpr uint32_t MAX_PAD_COUNT = 4;

/// Tableau de pads (lives::CPadArray).
struct CPadArray {
    std::array<CPad, MAX_PAD_COUNT> pads_;

    [[nodiscard]] virtual std::string_view get_class_name() const { return "CPadArray"; }
    virtual ~CPadArray() noexcept = default;
};

} // namespace lives
