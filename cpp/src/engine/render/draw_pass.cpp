/// @file draw_pass.cpp
/// Gestion des 13 passes de rendu du moteur Level-5.
/// Reference nie.exe : FUN_140eff080 (pipeline complet).
/// Chaque passe contient une liste de drawcalls triee selon sa politique.

#include "iecode/engine/render/draw_pass.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <string_view>
#include <vector>

namespace lives {

/// Politique de tri d'une passe de rendu.
enum class DrawSortPolicy : uint8_t {
    NONE           = 0, ///< Ordre d'insertion
    FRONT_TO_BACK  = 1, ///< Opaques : minimise le cout en overdraw
    BACK_TO_FRONT  = 2, ///< Transparents : blend correct
    BY_MATERIAL    = 3, ///< UI : minimise les state changes
};

/// Commande de rendu generique enregistree dans une passe.
struct DrawCall {
    uint64_t sort_key  = 0;   ///< Cle de tri (materiau ou ordre d'insertion)
    float    depth     = 0.f; ///< Profondeur en espace camera (pour front/back)
    uint32_t material  = 0;   ///< ID de materiau (shader + textures)
    uint32_t mesh_id   = 0;   ///< ID du mesh a rendre
    void*    user_data = nullptr;
};

/// Passe de rendu D3D11 (lives::CDrawPass).
/// Accumule des drawcalls puis les trie avant soumission au GPU.
class CDrawPass {
public:
    CDrawPass() = default;
    explicit CDrawPass(DrawPass id, DrawSortPolicy policy = DrawSortPolicy::NONE)
        : id_(id), policy_(policy) {}

    /// Retourne le nom textuel de la passe (ex: "60_UI").
    [[nodiscard]] std::string_view name() const noexcept { return draw_pass_name(id_); }

    /// Identifiant de la passe.
    [[nodiscard]] DrawPass id() const noexcept { return id_; }

    /// Nombre de drawcalls en attente.
    [[nodiscard]] std::size_t size() const noexcept { return calls_.size(); }

    /// Ajoute une drawcall a la passe.
    void push(const DrawCall& call) { calls_.push_back(call); }

    /// Vide la passe (appele apres submit).
    void clear() noexcept { calls_.clear(); }

    /// Trie les drawcalls selon la politique de la passe.
    void sort() {
        switch (policy_) {
            case DrawSortPolicy::FRONT_TO_BACK:
                std::sort(calls_.begin(), calls_.end(),
                          [](const DrawCall& a, const DrawCall& b) { return a.depth < b.depth; });
                break;
            case DrawSortPolicy::BACK_TO_FRONT:
                std::sort(calls_.begin(), calls_.end(),
                          [](const DrawCall& a, const DrawCall& b) { return a.depth > b.depth; });
                break;
            case DrawSortPolicy::BY_MATERIAL:
                std::sort(calls_.begin(), calls_.end(),
                          [](const DrawCall& a, const DrawCall& b) { return a.sort_key < b.sort_key; });
                break;
            case DrawSortPolicy::NONE:
            default:
                break;
        }
    }

    [[nodiscard]] const std::vector<DrawCall>& calls() const noexcept { return calls_; }

private:
    DrawPass              id_     = DrawPass::UI_BEFORE;
    DrawSortPolicy        policy_ = DrawSortPolicy::NONE;
    std::vector<DrawCall> calls_;
};

/// Pipeline complet : 13 passes nommees (cf. FUN_140eff080).
class CDrawPassPipeline {
public:
    CDrawPassPipeline() {
        // Politique de tri par defaut identique a nie.exe.
        passes_[static_cast<std::size_t>(DrawPass::UI_BEFORE)]         = CDrawPass{DrawPass::UI_BEFORE,         DrawSortPolicy::BY_MATERIAL};
        passes_[static_cast<std::size_t>(DrawPass::ZERO)]              = CDrawPass{DrawPass::ZERO,              DrawSortPolicy::NONE};
        passes_[static_cast<std::size_t>(DrawPass::MAP_BEFORE)]        = CDrawPass{DrawPass::MAP_BEFORE,        DrawSortPolicy::FRONT_TO_BACK};
        passes_[static_cast<std::size_t>(DrawPass::PROJ_EFFECT)]       = CDrawPass{DrawPass::PROJ_EFFECT,       DrawSortPolicy::BACK_TO_FRONT};
        passes_[static_cast<std::size_t>(DrawPass::CHARA_BEFORE)]      = CDrawPass{DrawPass::CHARA_BEFORE,      DrawSortPolicy::FRONT_TO_BACK};
        passes_[static_cast<std::size_t>(DrawPass::CHARA_AFTER)]       = CDrawPass{DrawPass::CHARA_AFTER,       DrawSortPolicy::FRONT_TO_BACK};
        passes_[static_cast<std::size_t>(DrawPass::MAP_AFTER)]         = CDrawPass{DrawPass::MAP_AFTER,         DrawSortPolicy::FRONT_TO_BACK};
        passes_[static_cast<std::size_t>(DrawPass::EFFECT)]            = CDrawPass{DrawPass::EFFECT,            DrawSortPolicy::BACK_TO_FRONT};
        passes_[static_cast<std::size_t>(DrawPass::POST)]              = CDrawPass{DrawPass::POST,              DrawSortPolicy::NONE};
        passes_[static_cast<std::size_t>(DrawPass::POST_AFTER)]        = CDrawPass{DrawPass::POST_AFTER,        DrawSortPolicy::NONE};
        passes_[static_cast<std::size_t>(DrawPass::PRE_MENU_END_DRAW)] = CDrawPass{DrawPass::PRE_MENU_END_DRAW, DrawSortPolicy::BY_MATERIAL};
        passes_[static_cast<std::size_t>(DrawPass::UI)]                = CDrawPass{DrawPass::UI,                DrawSortPolicy::BY_MATERIAL};
        passes_[static_cast<std::size_t>(DrawPass::POST_MENU_END_DRAW)] = CDrawPass{DrawPass::POST_MENU_END_DRAW, DrawSortPolicy::NONE};
    }

    [[nodiscard]] CDrawPass& get(DrawPass id) noexcept {
        return passes_[static_cast<std::size_t>(id)];
    }

    [[nodiscard]] const CDrawPass& get(DrawPass id) const noexcept {
        return passes_[static_cast<std::size_t>(id)];
    }

    /// Trie toutes les passes puis les vide (a appeler apres soumission GPU).
    void sort_all() {
        for (auto& pass : passes_) pass.sort();
    }

    void clear_all() noexcept {
        for (auto& pass : passes_) pass.clear();
    }

    [[nodiscard]] std::size_t total_calls() const noexcept {
        std::size_t n = 0;
        for (const auto& pass : passes_) n += pass.size();
        return n;
    }

private:
    std::array<CDrawPass, static_cast<std::size_t>(DrawPass::COUNT)> passes_;
};

} // namespace lives
