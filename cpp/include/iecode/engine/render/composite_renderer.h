#pragma once

/// @file composite_renderer.h
/// CompositeRenderer iecode — adaptation du pattern Overload pour D3D11/bgfx.
///
/// Wrappe le `RenderPipeline` legacy (13 DrawPass de nie.exe) en y ajoutant :
///  - un registre de RenderFeature indexe par std::type_index
///  - des ARenderPass externes ordonnes par priorite dans chaque slot
///  - les hooks on_begin_frame / on_end_frame / on_render
///  - un SceneDescriptor avec FastAccessComponents
///
/// Les 13 passes nommees de nie.exe (00_UI_Before .. 61_PostMenuEndDraw) sont
/// preservees. Les RenderFeature s'executent au sein de ces passes selon leur
/// politique whitelist/blacklist.

#include "draw_pass.h"
#include "render_feature.h"
#include "render_pipeline.h"
#include "scene_descriptor.h"

#include <concepts>
#include <map>
#include <memory>
#include <type_traits>
#include <typeindex>
#include <unordered_map>
#include <utility>

namespace lives::render {

/// Concept : un type qui derive de ARenderFeature.
template<typename T>
concept RenderFeatureType = std::derived_from<T, ARenderFeature>;

/// Concept : un type qui derive de ARenderPass.
template<typename T>
concept RenderPassType = std::derived_from<T, ARenderPass>;

/// Renderer composite — orchestre features + passes externes au-dessus du
/// pipeline 13 slots de nie.exe.
class CompositeRenderer {
public:
    CompositeRenderer();
    ~CompositeRenderer();

    CompositeRenderer(const CompositeRenderer&) = delete;
    CompositeRenderer& operator=(const CompositeRenderer&) = delete;
    CompositeRenderer(CompositeRenderer&&) noexcept = default;
    CompositeRenderer& operator=(CompositeRenderer&&) noexcept = default;

    /// Initialise le pipeline bgfx (D3D11). Cf. RenderPipeline::initialize.
    [[nodiscard]] bool initialize(uint32_t width, uint32_t height,
                                  void* native_window_handle);

    /// Libere les features, les passes et bgfx.
    void shutdown();

    /// Redimensionne le framebuffer.
    void resize(uint32_t width, uint32_t height);

    /// Execute un frame complet :
    ///   1. on_begin_frame() sur chaque feature et chaque pass
    ///   2. pour chaque DrawPass (00..61) :
    ///        a. bgfx::touch(view_id)
    ///        b. on_render() sur chaque feature autorisee
    ///        c. draw() sur chaque ARenderPass externe (ordonne par priorite)
    ///        d. legacy RenderFeature callbacks (compat ascendante)
    ///   3. on_end_frame() sur chaque feature et chaque pass
    ///
    /// La SceneDescriptor doit etre valide (camera principale + dimensions).
    void render(const SceneDescriptor& scene);

    /// Soumet le frame a bgfx.
    [[nodiscard]] uint32_t submit_frame();

    // ── Features (indexees par std::type_index) ─────────────────────

    /// Ajoute une feature de type T (instanciee avec args). Retourne la ref.
    /// @pre Aucune feature de ce type ne doit deja exister.
    template<RenderFeatureType T, typename... Args>
    T& add_feature(Args&&... args) {
        const auto type_id = std::type_index(typeid(T));
        // Cast intermediaire pour eviter de devoir friend chaque feature.
        auto feature = std::unique_ptr<T>(new T(*this, std::forward<Args>(args)...));
        T& ref = *feature;
        features_.emplace(type_id, std::move(feature));
        return ref;
    }

    /// Retourne la feature de type T (assertion si absente).
    template<RenderFeatureType T>
    [[nodiscard]] T& get_feature() const {
        const auto it = features_.find(std::type_index(typeid(T)));
        return *static_cast<T*>(it->second.get()); // UB si absente — usage interne
    }

    /// True si une feature de type T est enregistree.
    template<RenderFeatureType T>
    [[nodiscard]] bool has_feature() const noexcept {
        return features_.contains(std::type_index(typeid(T)));
    }

    /// Supprime la feature de type T. Retourne true si elle existait.
    template<RenderFeatureType T>
    bool remove_feature() {
        return features_.erase(std::type_index(typeid(T))) > 0;
    }

    // ── ARenderPass externes (multimap ordonne par priorite) ─────────

    /// Ajoute un ARenderPass de type T dans le slot DrawPass correspondant.
    /// @param order  Ordre dans le slot (les valeurs plus petites passent en premier)
    /// @param args   Forwardes au constructeur de T (apres le CompositeRenderer&)
    template<RenderPassType T, typename... Args>
    T& add_pass(uint32_t order, Args&&... args) {
        auto pass = std::unique_ptr<T>(new T(*this, std::forward<Args>(args)...));
        T& ref = *pass;
        passes_.emplace(order, std::move(pass));
        return ref;
    }

    // ── Acces au pipeline legacy ────────────────────────────────────

    /// Acces direct au RenderPipeline 13 slots (pour les `funcLua*` legacy).
    [[nodiscard]] RenderPipeline& pipeline() noexcept { return pipeline_; }
    [[nodiscard]] const RenderPipeline& pipeline() const noexcept { return pipeline_; }

    [[nodiscard]] bool is_initialized() const noexcept { return pipeline_.is_initialized(); }
    [[nodiscard]] uint32_t width() const noexcept { return pipeline_.width(); }
    [[nodiscard]] uint32_t height() const noexcept { return pipeline_.height(); }
    [[nodiscard]] uint64_t frame_index() const noexcept { return frame_index_; }

private:
    /// Pipeline 13 slots Level-5 (bgfx D3D11).
    RenderPipeline pipeline_;

    /// Features indexees par type — analogue a Overload.
    std::unordered_map<std::type_index, std::unique_ptr<ARenderFeature>> features_;

    /// Passes externes ordonnees par priorite (multimap = doublons autorises).
    std::multimap<uint32_t, std::unique_ptr<ARenderPass>> passes_;

    /// Compteur global de frames (utile pour les features stateful).
    uint64_t frame_index_ = 0;
};

} // namespace lives::render
