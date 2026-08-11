/// @file shader_library.cpp
/// Bibliotheque de shaders indexee par CRC32 (lives::CShaderLibrary).
/// Cache avec ref-counting. Reference nie.exe : FUN_1404cfa90 (shader loader).

#include "iecode/engine/render/shader_library.h"

#include "iecode/crypto/crc32.h"

#include <atomic>
#include <mutex>
#include <string>
#include <string_view>
#include <unordered_map>

namespace lives {

/// Entree de cache d'un shader charge.
struct ShaderEntry {
    std::string               name;
    std::atomic<uint32_t>     ref_count{0};
    bool                      loaded = false;
    // Un vrai backend remplirait ici le ID3D11VertexShader/PixelShader/etc.
    void*                     gpu_handle = nullptr;
};

/// Implementation par defaut de IShaderLibrary : cache CRC32 thread-safe.
class CShaderLibrary final : public IShaderLibrary {
public:
    bool load_shader(hash32 name_hash) override {
        std::lock_guard lock(mutex_);
        auto it = entries_.find(name_hash.value);
        if (it != entries_.end()) {
            ++it->second.ref_count;
            return it->second.loaded;
        }
        // Creation d'une entree vide — le backend GPU remplira gpu_handle.
        auto& entry = entries_[name_hash.value];
        entry.ref_count = 1;
        entry.loaded    = true;
        return true;
    }

    void unload_shader(hash32 name_hash) override {
        std::lock_guard lock(mutex_);
        auto it = entries_.find(name_hash.value);
        if (it == entries_.end()) return;
        if (it->second.ref_count.fetch_sub(1) == 1) {
            // Dernier utilisateur : liberation.
            entries_.erase(it);
        }
    }

    [[nodiscard]] bool is_loaded(hash32 name_hash) const override {
        std::lock_guard lock(mutex_);
        auto it = entries_.find(name_hash.value);
        return it != entries_.end() && it->second.loaded;
    }

    /// Charge un shader par nom textuel (calcule le CRC32 puis delegue).
    bool load_shader_by_name(std::string_view name) {
        const uint32_t hash = iecode::crypto::crc32_compute(name);
        return load_shader(hash32{hash});
    }

    [[nodiscard]] std::size_t size() const {
        std::lock_guard lock(mutex_);
        return entries_.size();
    }

private:
    mutable std::mutex                        mutex_;
    std::unordered_map<uint32_t, ShaderEntry> entries_;
};

/// Retourne l'instance globale de la bibliotheque de shaders.
[[nodiscard]] IShaderLibrary& shader_library() {
    static CShaderLibrary instance;
    return instance;
}

} // namespace lives
