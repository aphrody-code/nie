/// @file anim_player.cpp
/// Implementation du player d'animation — interpolation TRS et recherche
/// binaire des keyframes.

#include "iecode/engine/anim/anim_player.h"

#include <glm/gtc/matrix_transform.hpp>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <cstddef>

namespace lives {

namespace {

/// Trouve `i` tel que times[i] <= t < times[i+1]. Suppose times non vide et trie.
/// Retourne {i, alpha} ou alpha in [0,1] est le facteur d'interpolation.
struct KeyLookup {
    std::size_t index = 0;
    float alpha = 0.f;
    bool  clamped_end = false;
};

[[nodiscard]] KeyLookup find_key(const std::vector<float>& times, float t) noexcept {
    KeyLookup out{};
    if (times.empty()) return out;
    if (t <= times.front()) {
        out.index = 0;
        out.alpha = 0.f;
        return out;
    }
    if (t >= times.back()) {
        out.index = times.size() - 1;
        out.alpha = 0.f;
        out.clamped_end = true;
        return out;
    }
    // Binary search : premier element > t, puis -1.
    auto it = std::upper_bound(times.begin(), times.end(), t);
    const std::size_t i = static_cast<std::size_t>(it - times.begin()) - 1;
    const float t0 = times[i];
    const float t1 = times[i + 1];
    const float dt = t1 - t0;
    out.index = i;
    out.alpha = dt > 0.f ? (t - t0) / dt : 0.f;
    return out;
}

[[nodiscard]] glm::vec3 sample_vec3(const std::vector<glm::vec3>& values,
                                    const KeyLookup& k,
                                    const glm::vec3& fallback) noexcept {
    if (values.empty()) return fallback;
    if (values.size() == 1 || k.clamped_end) return values[k.index];
    const glm::vec3& a = values[k.index];
    const glm::vec3& b = values[k.index + 1];
    return glm::mix(a, b, k.alpha);
}

[[nodiscard]] glm::quat sample_quat(const std::vector<glm::quat>& values,
                                    const KeyLookup& k) noexcept {
    if (values.empty()) return glm::quat(1.f, 0.f, 0.f, 0.f);
    if (values.size() == 1 || k.clamped_end) return values[k.index];
    const glm::quat& a = values[k.index];
    const glm::quat& b = values[k.index + 1];
    return glm::slerp(a, b, k.alpha);
}

} // namespace

// ── AnimClip ────────────────────────────────────────────────────────

std::optional<AnimClip> AnimClip::from_g4ra(const iecode::level5::G4raFile& ra) {
    // Le format interne de keyframes d'une entree G4RA d'animation n'est pas
    // encore reverse. On retourne nullopt ici — l'API est presente pour permettre
    // l'integration de ce parser quand il sera disponible.
    // En attendant, un AnimClip peut etre construit manuellement (tests/editeur).
    if (ra.entries.empty()) {
        spdlog::debug("AnimClip::from_g4ra: archive vide");
    }
    return std::nullopt;
}

std::optional<AnimClip> AnimClip::from_agi(const iecode::level5::AgiFile& agi) {
    // Le format detaille des keyframes AGI (offsets des tracks par bone) n'est
    // pas encore entierement reverse. En attendant, on construit un clip avec
    // la duree reelle lue dans le header et un nombre de tracks correspondant
    // a `agi.track_count`. Chaque track contient une keyframe identite a t=0
    // — l'animation est alors un "T-pose" qui dure `duration` secondes.
    AnimClip clip;
    clip.duration = agi.duration > 0.f ? agi.duration : 1.f;
    clip.fps = agi.frame_count > 0 && agi.duration > 0.f
                   ? static_cast<float>(agi.frame_count) / agi.duration
                   : 30.f;

    if (agi.track_count == 0) {
        spdlog::debug("AnimClip::from_agi: aucun track (clip vide, duration={:.2f}s)",
                      clip.duration);
        return clip;
    }

    clip.tracks.reserve(agi.track_count);
    for (uint32_t i = 0; i < agi.track_count; ++i) {
        AnimTrack track;
        track.bone_index = i;
        track.times.push_back(0.f);
        track.positions.emplace_back(0.f, 0.f, 0.f);
        track.rotations.emplace_back(1.f, 0.f, 0.f, 0.f);  // identite (w,x,y,z)
        track.scales.emplace_back(1.f, 1.f, 1.f);
        clip.tracks.push_back(std::move(track));
    }

    spdlog::info("AnimClip::from_agi: clip stub cree (duration={:.2f}s, {} tracks)",
                 clip.duration, clip.tracks.size());
    return clip;
}

// ── AnimPlayer ──────────────────────────────────────────────────────

void AnimPlayer::set_clip(const AnimClip* clip) noexcept {
    clip_ = clip;
    time_ = 0.f;
}

void AnimPlayer::update(float dt) noexcept {
    if (clip_ == nullptr || clip_->duration <= 0.f) {
        time_ = 0.f;
        return;
    }
    time_ += dt;
    if (loop_) {
        // Modulo float — tolere les gros dt et les temps negatifs.
        const float d = clip_->duration;
        time_ = std::fmod(time_, d);
        if (time_ < 0.f) time_ += d;
    } else {
        if (time_ > clip_->duration) time_ = clip_->duration;
        if (time_ < 0.f) time_ = 0.f;
    }
}

bool AnimPlayer::is_done() const noexcept {
    if (clip_ == nullptr) return true;
    if (loop_) return false;
    return time_ >= clip_->duration;
}

glm::mat4 AnimPlayer::get_bone_transform(uint32_t bone_index) const noexcept {
    if (clip_ == nullptr) return glm::mat4(1.f);

    // Recherche lineaire — OK pour < 256 tracks. Pour plus, utiliser
    // un tableau indexe par bone_index.
    const AnimTrack* track = nullptr;
    for (const auto& t : clip_->tracks) {
        if (t.bone_index == bone_index) {
            track = &t;
            break;
        }
    }
    if (track == nullptr) return glm::mat4(1.f);

    const KeyLookup k = find_key(track->times, time_);
    const glm::vec3 pos = sample_vec3(track->positions, k, glm::vec3(0.f));
    const glm::quat rot = sample_quat(track->rotations, k);
    const glm::vec3 scl = sample_vec3(track->scales, k, glm::vec3(1.f));

    glm::mat4 m = glm::translate(glm::mat4(1.f), pos);
    m *= glm::mat4_cast(rot);
    m = glm::scale(m, scl);
    return m;
}

void AnimPlayer::get_bone_transforms(std::span<glm::mat4> out) const noexcept {
    for (std::size_t i = 0; i < out.size(); ++i) {
        out[i] = get_bone_transform(static_cast<uint32_t>(i));
    }
}

} // namespace lives
