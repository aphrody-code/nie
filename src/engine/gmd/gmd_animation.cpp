/// @file gmd_animation.cpp
/// Implementation de gmdCAnimation et gmdCAnimationAsync.
/// Classe de base pour tous les objets animes du jeu (scale=1.0f par defaut).
/// Reference RE : animation_bone_blend.c (FUN_1404ae7e0).

#include "iecode/engine/gmd/gmd_animation.h"

#include "iecode/formats/level5/agi.h"
#include "iecode/vfs/vfs.h"

#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/quaternion.hpp>
#include <spdlog/spdlog.h>

#include <cmath>

#include <algorithm>
#include <utility>

namespace lives {

// ── Chargement / lecture ────────────────────────────────────────────

bool gmdCAnimation::load_clip(iecode::vfs::Vfs& vfs, const std::string& vfs_path) {
    auto bytes = vfs.read(vfs_path);
    if (bytes.empty()) {
        spdlog::error("gmdCAnimation::load_clip: lecture VFS vide pour '{}'", vfs_path);
        return false;
    }

    auto agi = iecode::level5::agi_parse(bytes);
    if (!agi.has_value()) {
        spdlog::error("gmdCAnimation::load_clip: parse AGI echoue pour '{}'", vfs_path);
        return false;
    }

    auto clip_opt = AnimClip::from_agi(*agi);
    if (!clip_opt.has_value()) {
        spdlog::error("gmdCAnimation::load_clip: conversion AnimClip echouee pour '{}'", vfs_path);
        return false;
    }

    auto clip_ptr = std::make_unique<AnimClip>(std::move(*clip_opt));

    // Indexe par chemin VFS (= nom logique du clip)
    auto [it, inserted] = owned_clips_.insert_or_assign(vfs_path, std::move(clip_ptr));
    motion_data_   = it->second.get();
    motion_name_   = vfs_path;
    total_frames_  = motion_data_->duration * motion_data_->fps;
    dispatch_type_ = GmdAnimDispatch::Direct;

    spdlog::info("gmdCAnimation::load_clip: '{}' ({} tracks, {:.2f}s)",
                 vfs_path, motion_data_->tracks.size(), motion_data_->duration);
    return true;
}

void gmdCAnimation::play(const std::string& clip_name) noexcept {
    auto it = owned_clips_.find(clip_name);
    if (it == owned_clips_.end()) {
        spdlog::warn("gmdCAnimation::play: clip '{}' inconnu (load_clip d'abord)", clip_name);
        return;
    }

    motion_data_   = it->second.get();
    motion_name_   = clip_name;
    current_frame_ = 0.f;
    playing_       = true;
    blending_      = false;
    blend_time_    = -1.f;

    player_.set_clip(motion_data_);
    player_.set_loop(looping_);
    player_.reset();
}

void gmdCAnimation::blend_to(const std::string& clip_name, float blend_time) noexcept {
    auto it = owned_clips_.find(clip_name);
    if (it == owned_clips_.end()) {
        spdlog::warn("gmdCAnimation::blend_to: clip '{}' inconnu", clip_name);
        return;
    }

    if (blend_time <= 0.f || motion_data_ == nullptr) {
        // Switch instantane
        play(clip_name);
        return;
    }

    blend_player_.set_clip(it->second.get());
    blend_player_.set_loop(looping_);
    blend_player_.reset();

    blend_duration_ = blend_time;
    blend_elapsed_  = 0.f;
    blend_time_     = blend_time;
    blending_       = true;
    motion_name_    = clip_name;
}

void gmdCAnimation::tick(float dt) noexcept {
    if (!playing_) return;

    const float scaled_dt = dt * speed_;

    // Avance les players actifs
    player_.update(scaled_dt);
    if (blending_) {
        blend_player_.update(scaled_dt);
        blend_elapsed_ += scaled_dt;

        if (blend_elapsed_ >= blend_duration_) {
            // Fin du cross-fade : promote slot B en slot A
            // (copie du player B dans A — on perd le clip original A)
            const AnimClip* new_clip = blend_player_.clip();
            blending_      = false;
            blend_duration_ = 0.f;
            blend_elapsed_  = 0.f;
            blend_time_     = -1.f;

            player_.set_clip(new_clip);
            player_.set_loop(looping_);
            // On reprend au temps deja avance dans le slot B
            // (set_clip reset a 0 — c'est acceptable pour notre simplification)
            motion_data_ = const_cast<AnimClip*>(new_clip);
        }
    }

    // Met a jour current_frame_ (en frames, pour l'API legacy is_finished())
    if (motion_data_ != nullptr && motion_data_->fps > 0.f) {
        current_frame_ = player_.time() * motion_data_->fps;
    }

    // Recalcule le cache de transforms locales
    if (bone_count_ > 0) {
        const std::span<glm::mat4> out{ bone_cache_.data(), bone_count_ };

        if (blending_ && blend_duration_ > 0.f) {
            // Cross-fade TRS bone par bone :
            // 1. decompose chaque matrice affine en (translation, rotation, scale)
            // 2. lerp pour les vec3, slerp pour les quaternions
            // 3. recompose la matrice resultante
            // Decomposition manuelle (matrices affines uniquement — pas de skew
            // ni de perspective : on evite glm/gtx/matrix_decompose qui require
            // GLM_ENABLE_EXPERIMENTAL et casse les unity builds).
            auto decompose_affine = [](const glm::mat4& m,
                                       glm::vec3& t,
                                       glm::quat& r,
                                       glm::vec3& s) noexcept {
                t = glm::vec3(m[3]);
                glm::vec3 col0(m[0]);
                glm::vec3 col1(m[1]);
                glm::vec3 col2(m[2]);
                s.x = glm::length(col0);
                s.y = glm::length(col1);
                s.z = glm::length(col2);
                if (s.x > 1e-6f) col0 /= s.x;
                if (s.y > 1e-6f) col1 /= s.y;
                if (s.z > 1e-6f) col2 /= s.z;
                glm::mat3 rot_mat(col0, col1, col2);
                r = glm::quat_cast(rot_mat);
            };

            const float a = std::clamp(blend_elapsed_ / blend_duration_, 0.f, 1.f);
            for (std::size_t i = 0; i < bone_count_; ++i) {
                const glm::mat4 ma = player_.get_bone_transform(static_cast<uint32_t>(i));
                const glm::mat4 mb = blend_player_.get_bone_transform(static_cast<uint32_t>(i));

                glm::vec3 ta, sa;  glm::quat ra;
                glm::vec3 tb, sb;  glm::quat rb;
                decompose_affine(ma, ta, ra, sa);
                decompose_affine(mb, tb, rb, sb);

                const glm::vec3 t = glm::mix(ta, tb, a);
                const glm::quat r = glm::slerp(ra, rb, a);
                const glm::vec3 s = glm::mix(sa, sb, a);

                out[i] = glm::translate(glm::mat4(1.f), t)
                       * glm::mat4_cast(r)
                       * glm::scale(glm::mat4(1.f), s);
            }
        } else {
            player_.get_bone_transforms(out);
        }
    }
}

void gmdCAnimation::set_bone_count(std::size_t count) noexcept {
    bone_count_ = std::min(count, kMaxBones);
    // Identite par defaut
    for (std::size_t i = 0; i < bone_count_; ++i) {
        bone_cache_[i] = glm::mat4(1.f);
    }
}

} // namespace lives
