#pragma once

/// @file gmd_animation.h
/// Animation du moteur Level-5 (lives::gmdCAnimation, gmdCAnimationAsync).
///
/// Layout reverse depuis nie.exe (porting_guide.md, animation_bone_blend.c) :
///   total 0x1C0 bytes
///   +0x000  vftable (CObject)
///   +0x0A0  motion_data_      pointeur vers clip AGI charge depuis VFS
///   +0x168  motion_handle_    packed uint32 (high16=index, low16=generation)
///   +0x1B0  blend_time_       float — -1.0f = pas de blend
///   +0x1B8  dispatch_type_    uint32 — 0=direct, 1=ref, 2=G4MT
///
/// Reference RE : animation_bone_blend.c (FUN_1404ae7e0).

#include "../core/object.h"
#include "iecode/engine/anim/anim_player.h"

#include <glm/glm.hpp>

#include <array>
#include <cstdint>
#include <memory>
#include <span>
#include <string>
#include <string_view>
#include <unordered_map>

namespace iecode::vfs { class Vfs; }

namespace lives {

/// Type de dispatch pour la lookup de motion_data_ (cf. nie.exe @+0x1B8).
enum class GmdAnimDispatch : uint32_t {
    Direct = 0,  ///< Pointeur AGI direct
    Ref    = 1,  ///< Reference indirecte (table de clips)
    G4mt   = 2,  ///< Motion table (G4MT)
};

/// Motion handle packe — 16 bits index + 16 bits generation (anti-stale).
struct MotionHandle {
    uint32_t packed = 0;

    [[nodiscard]] constexpr uint16_t index() const noexcept {
        return static_cast<uint16_t>(packed >> 16);
    }
    [[nodiscard]] constexpr uint16_t generation() const noexcept {
        return static_cast<uint16_t>(packed & 0xFFFFu);
    }
    [[nodiscard]] constexpr bool valid() const noexcept { return packed != 0; }

    static constexpr MotionHandle make(uint16_t idx, uint16_t gen) noexcept {
        return MotionHandle{ (static_cast<uint32_t>(idx) << 16) | gen };
    }
};
static_assert(sizeof(MotionHandle) == 4, "MotionHandle doit etre packe en u32");

/// Animation de base (lives::gmdCAnimation).
/// Tous les objets animes du jeu en heritent. Layout 0x1C0 bytes (cf nie.exe).
struct gmdCAnimation : CObject {
    // ── Etat de lecture ─────────────────────────────────────────────
    float    scale_         = 1.f;    ///< Scale par defaut (identifie dans le RE)
    float    speed_         = 1.f;    ///< Vitesse de lecture (1.0 = vitesse normale)
    float    current_frame_ = 0.f;
    float    total_frames_  = 0.f;
    bool     playing_       = false;
    bool     looping_       = false;

    // ── Donnees de motion (layout nie.exe) ──────────────────────────
    AnimClip*       motion_data_   = nullptr;          ///< @+0x0A0 — clip AGI charge depuis VFS
    std::string     motion_name_;                       ///< Nom du clip courant
    MotionHandle    motion_handle_{};                   ///< @+0x168 — packed u32
    float           blend_time_    = -1.f;              ///< @+0x1B0 — -1.0f = pas de blend
    GmdAnimDispatch dispatch_type_ = GmdAnimDispatch::Direct;  ///< @+0x1B8

    // ── Player squelettique (cross-fade A/B) ───────────────────────
    AnimPlayer  player_;        ///< Slot A (clip principal)
    AnimPlayer  blend_player_;  ///< Slot B (clip cible du cross-fade)
    float       blend_elapsed_ = 0.f;
    float       blend_duration_ = 0.f;
    bool        blending_      = false;

    // ── API haut niveau ────────────────────────────────────────────

    /// Charge un clip depuis le VFS (chemin AGI).
    /// Stocke le clip dans `owned_clip_` et le pointe via `motion_data_`.
    /// @return true si le chargement a reussi
    [[nodiscard]] bool load_clip(iecode::vfs::Vfs& vfs, const std::string& vfs_path);

    /// Demarre la lecture d'un clip deja charge (par nom logique).
    /// Reset le timer et active `playing_`.
    void play(const std::string& clip_name) noexcept;

    /// Cross-fade vers un autre clip charge en `blend_time` secondes.
    /// Si `blend_time <= 0`, switch instantane.
    void blend_to(const std::string& clip_name, float blend_time) noexcept;

    /// Avance le timer interne et tous les players de `dt` secondes.
    /// Resout le cross-fade quand `blend_elapsed_ >= blend_duration_`.
    void tick(float dt) noexcept;

    /// Retourne le tableau de transforms locaux des os, prets pour upload
    /// au cbuffer D3D11 BONE_MATRICES (max 256 os).
    /// La memoire est interne au gmdCAnimation et reste valide jusqu'au
    /// prochain appel a `tick()`.
    [[nodiscard]] std::span<const glm::mat4> get_bone_transforms() const noexcept {
        return { bone_cache_.data(), bone_count_ };
    }

    /// Force le nombre d'os a calculer (typiquement = G4SK::bone_count).
    void set_bone_count(std::size_t count) noexcept;

    [[nodiscard]] bool is_finished() const {
        return !looping_ && current_frame_ >= total_frames_;
    }

    [[nodiscard]] float normalized_time() const {
        if (total_frames_ <= 0.f) return 0.f;
        return current_frame_ / total_frames_;
    }

    [[nodiscard]] std::string_view get_class_name() const override { return "gmdCAnimation"; }

private:
    /// Nombre maximum d'os supporte (matches kMaxBones du SkinnedMesh).
    static constexpr std::size_t kMaxBones = 256;

    /// Storage des clips charges depuis le VFS, indexes par nom.
    std::unordered_map<std::string, std::unique_ptr<AnimClip>> owned_clips_;

    /// Cache des transforms locaux pour `get_bone_transforms()`.
    std::array<glm::mat4, kMaxBones> bone_cache_{};
    std::size_t bone_count_ = 0;
};

/// Animation asynchrone (lives::gmdCAnimationAsync).
/// Charge les donnees d'animation en arriere-plan.
struct gmdCAnimationAsync : gmdCAnimation {
    bool     loading_  = false;
    bool     ready_    = false;

    [[nodiscard]] std::string_view get_class_name() const override { return "gmdCAnimationAsync"; }
};

} // namespace lives
