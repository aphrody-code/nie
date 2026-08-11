#pragma once

/// @file render_feature.h
/// Pattern ARenderFeature (inspire d'Overload) adapte au pipeline iecode.
///
/// Une RenderFeature est une extension du CompositeRenderer qui apporte une
/// capacite de rendu (shadow, lighting, post-process, debug draw, ...).
/// Contrairement au RenderFeature legacy (callback simple stocke par DrawPass),
/// ARenderFeature recoit les evenements begin/end frame et peut s'executer sur
/// plusieurs passes via une politique whitelist/blacklist.

#include "draw_pass.h"

#include <cstdint>
#include <unordered_set>

namespace lives::render {

class CompositeRenderer;
struct SceneDescriptor;

/// Politique d'execution d'une feature, identique a Overload.
enum class FeatureExecutionPolicy : uint8_t {
    DEFAULT,        ///< Execute si le pass n'est pas dans la blacklist
    WHITELIST_ONLY, ///< Execute uniquement si le pass est dans la whitelist
    ALWAYS,         ///< Ignore black/whitelist
    NEVER,          ///< Jamais (utile pour features "function only")
    FRAME_EVENTS_ONLY, ///< Seulement on_begin_frame / on_end_frame
};

/// Classe de base d'une feature de rendu (shadow, lighting, post-process...).
///
/// Les sous-classes overrident `on_begin_frame`, `on_end_frame` et `on_render`.
/// Le CompositeRenderer instancie les features via add_feature<T>().
class ARenderFeature {
public:
    virtual ~ARenderFeature() = default;

    ARenderFeature(const ARenderFeature&) = delete;
    ARenderFeature& operator=(const ARenderFeature&) = delete;

    /// True si la politique courante n'est pas NEVER.
    [[nodiscard]] bool is_enabled() const noexcept {
        return policy_ != FeatureExecutionPolicy::NEVER;
    }

    /// True si la feature peut s'executer pour ce pass.
    [[nodiscard]] bool is_enabled_for(DrawPass pass) const noexcept;

    /// Ajoute un pass a la blacklist, retourne *this pour chaining.
    ARenderFeature& except(DrawPass pass);

    /// Ajoute un pass a la whitelist, retourne *this pour chaining.
    ARenderFeature& include(DrawPass pass);

    void set_execution_policy(FeatureExecutionPolicy policy) noexcept { policy_ = policy; }
    [[nodiscard]] FeatureExecutionPolicy execution_policy() const noexcept { return policy_; }

protected:
    explicit ARenderFeature(CompositeRenderer& renderer,
                            FeatureExecutionPolicy policy = FeatureExecutionPolicy::DEFAULT)
        : renderer_(renderer), policy_(policy) {}

    /// Invoque au debut du frame (avant le premier pass).
    /// Pas appele si policy == NEVER.
    virtual void on_begin_frame(const SceneDescriptor& /*scene*/) {}

    /// Invoque a la fin du frame (apres le dernier pass).
    virtual void on_end_frame() {}

    /// Invoque pour chaque pass actif ou la feature est autorisee.
    /// @param pass     Pass courant
    /// @param view_id  Identifiant bgfx du view (0..12)
    /// @param scene    Donnees de scene (cameras, modeles, lumieres)
    virtual void on_render(DrawPass /*pass*/, uint16_t /*view_id*/,
                           const SceneDescriptor& /*scene*/) {}

    CompositeRenderer& renderer_;

private:
    std::unordered_set<DrawPass> blacklist_;
    std::unordered_set<DrawPass> whitelist_;
    FeatureExecutionPolicy policy_ = FeatureExecutionPolicy::DEFAULT;

    friend class CompositeRenderer;
};

/// Classe de base d'un render pass (extension externe d'un slot DrawPass).
///
/// Contrairement aux 13 DrawPass nommes (00_UI_Before..61_PostMenuEndDraw)
/// qui sont fixes par nie.exe, ARenderPass est une etape additionnelle qu'on
/// peut greffer dans un slot existant. Plusieurs passes peuvent partager le
/// meme DrawPass — leur ordre est determine par le `priority` passe a
/// `add_pass`.
class ARenderPass {
public:
    virtual ~ARenderPass() = default;

    ARenderPass(const ARenderPass&) = delete;
    ARenderPass& operator=(const ARenderPass&) = delete;

    void set_enabled(bool enabled) noexcept { enabled_ = enabled; }
    [[nodiscard]] bool is_enabled() const noexcept { return enabled_; }

    [[nodiscard]] DrawPass slot() const noexcept { return slot_; }

protected:
    explicit ARenderPass(CompositeRenderer& renderer, DrawPass slot)
        : renderer_(renderer), slot_(slot) {}

    /// Invoque au debut du frame.
    virtual void on_begin_frame(const SceneDescriptor& /*scene*/) {}

    /// Invoque a la fin du frame.
    virtual void on_end_frame() {}

    /// Rendu effectif. view_id = bgfx ViewId du DrawPass parent.
    virtual void draw(uint16_t view_id, const SceneDescriptor& scene) = 0;

    CompositeRenderer& renderer_;
    DrawPass slot_;
    bool enabled_ = true;

    friend class CompositeRenderer;
};

} // namespace lives::render
