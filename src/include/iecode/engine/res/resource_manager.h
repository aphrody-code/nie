#pragma once

/// @file resource_manager.h
/// Gestionnaire de ressources generique pour le moteur Level-5.
/// Template ResourceManager<T> avec cache par chemin, ref-counting
/// et chargement paresseux. Inspire du pattern AResourceManager<T>.

#include <algorithm>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

#include <spdlog/spdlog.h>

namespace lives {

/// Normalise un chemin VFS : forward-slashes, lexically_normal.
/// Inspire de Overload::AResourceManager (NormalizeKey).
[[nodiscard]] inline std::string normalize_resource_path(std::string_view path) {
    std::string s(path);
    std::replace(s.begin(), s.end(), '\\', '/');
    // lexically_normal collapse "./" et "../" eventuels
    std::filesystem::path p(s);
    s = p.lexically_normal().generic_string();
    return s;
}

/// Identifiant opaque vers une ressource chargee.
using ResourceId = uint64_t;

/// Identifiant invalide / non-assigne.
inline constexpr ResourceId INVALID_RESOURCE_ID = 0;

/// Gestionnaire de ressources generique avec cache et ref-counting.
/// Les classes derivees implementent load_from_file() pour chaque type.
template <typename T>
class ResourceManager {
public:
    ResourceManager() = default;
    virtual ~ResourceManager() noexcept { clear(); }

    // Non-copiable, non-deplacable (mutex)
    ResourceManager(const ResourceManager&)            = delete;
    ResourceManager& operator=(const ResourceManager&) = delete;
    ResourceManager(ResourceManager&&)                 = delete;
    ResourceManager& operator=(ResourceManager&&)      = delete;

    /// Charge une ressource depuis un chemin. Retourne le cache si deja chargee.
    /// Retourne INVALID_RESOURCE_ID en cas d'echec de chargement.
    [[nodiscard]] ResourceId load(const std::string& path) {
        const std::string key = normalize_resource_path(path);

        // Verrou court : check cache uniquement
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (auto it = path_to_id_.find(key); it != path_to_id_.end()) {
                auto& entry = resources_.at(it->second);
                ++entry.ref_count;
                spdlog::debug("ResourceManager: cache hit pour '{}' (ref={})",
                              key, entry.ref_count);
                return it->second;
            }
        }

        // Chargement effectif HORS verrou (peut etre lent: I/O + parse)
        auto resource = load_from_file(key);
        if (!resource) {
            spdlog::error("ResourceManager: echec chargement '{}'", key);
            return INVALID_RESOURCE_ID;
        }

        return insert_resource(key, std::move(resource));
    }

    /// Insere une ressource deja construite dans le cache (utilise par les
    /// specialisations qui chargent via VFS au lieu du filesystem).
    /// Si une entree pour ce chemin existe deja, retourne son ID et incremente
    /// le ref_count (la nouvelle ressource est ignoree).
    [[nodiscard]] ResourceId insert_resource(const std::string& path,
                                             std::unique_ptr<T> resource) {
        if (!resource) {
            return INVALID_RESOURCE_ID;
        }

        const std::string key = normalize_resource_path(path);

        std::lock_guard<std::mutex> lock(mutex_);
        if (auto it = path_to_id_.find(key); it != path_to_id_.end()) {
            auto& entry = resources_.at(it->second);
            ++entry.ref_count;
            return it->second;
        }

        const ResourceId id = next_id_++;
        auto& entry        = resources_[id];
        entry.resource     = std::move(resource);
        entry.path         = key;
        entry.ref_count    = 1;
        entry.last_write   = query_last_write_time(key);
        path_to_id_[key]   = id;

        spdlog::debug("ResourceManager: charge '{}' -> id={}", key, id);
        return id;
    }

    /// Recupere une ressource par son ID. nullptr si non trouvee.
    [[nodiscard]] T* get(ResourceId id) const {
        std::lock_guard<std::mutex> lock(mutex_);
        if (auto it = resources_.find(id); it != resources_.end()) {
            return it->second.resource.get();
        }
        return nullptr;
    }

    /// Recupere une ressource par son chemin. nullptr si non chargee.
    [[nodiscard]] T* get_by_path(const std::string& path) const {
        const std::string key = normalize_resource_path(path);
        std::lock_guard<std::mutex> lock(mutex_);
        if (auto it = path_to_id_.find(key); it != path_to_id_.end()) {
            if (auto rit = resources_.find(it->second); rit != resources_.end()) {
                return rit->second.resource.get();
            }
        }
        return nullptr;
    }

    /// Decharge une ressource (decremente le ref count, libere si 0).
    void unload(ResourceId id) {
        std::lock_guard<std::mutex> lock(mutex_);
        auto it = resources_.find(id);
        if (it == resources_.end()) {
            return;
        }

        auto& entry = it->second;
        if (entry.ref_count > 0) {
            --entry.ref_count;
        }

        if (entry.ref_count == 0) {
            spdlog::debug("ResourceManager: liberation '{}' (id={})",
                          entry.path, id);
            path_to_id_.erase(entry.path);
            resources_.erase(it);
        }
    }

    /// Decharge toutes les ressources sans conditions.
    void clear() {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!resources_.empty()) {
            spdlog::debug("ResourceManager: clear {} ressources", resources_.size());
        }
        resources_.clear();
        path_to_id_.clear();
    }

    /// Nombre de ressources actuellement chargees.
    [[nodiscard]] size_t count() const noexcept {
        std::lock_guard<std::mutex> lock(mutex_);
        return resources_.size();
    }

    /// Decharge une ressource par chemin VFS.
    void unload_by_path(const std::string& path) {
        const std::string key = normalize_resource_path(path);
        std::lock_guard<std::mutex> lock(mutex_);
        if (auto it = path_to_id_.find(key); it != path_to_id_.end()) {
            const ResourceId id = it->second;
            spdlog::debug("ResourceManager: unload_by_path '{}' (id={})", key, id);
            path_to_id_.erase(it);
            resources_.erase(id);
        }
    }

    /// Recharge une ressource par ID. Conserve l'ID et le ref_count.
    /// Retourne true en cas de succes.
    bool reload(ResourceId id) {
        std::string path;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            auto it = resources_.find(id);
            if (it == resources_.end()) {
                return false;
            }
            path = it->second.path;
        }

        // Rechargement HORS verrou (I/O potentiellement lent)
        auto fresh = load_from_file(path);
        if (!fresh) {
            spdlog::error("ResourceManager: reload echec '{}'", path);
            return false;
        }

        std::lock_guard<std::mutex> lock(mutex_);
        auto it = resources_.find(id);
        if (it == resources_.end()) {
            return false;
        }
        it->second.resource   = std::move(fresh);
        it->second.last_write = query_last_write_time(path);
        spdlog::info("ResourceManager: reload '{}' (id={})", path, id);
        return true;
    }

    /// Recharge une ressource par chemin VFS. Retourne true en cas de succes.
    bool reload(const std::string& path) {
        const std::string key = normalize_resource_path(path);
        ResourceId id = INVALID_RESOURCE_ID;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (auto it = path_to_id_.find(key); it != path_to_id_.end()) {
                id = it->second;
            }
        }
        if (id == INVALID_RESOURCE_ID) {
            return false;
        }
        return reload(id);
    }

    /// Recharge toutes les ressources dont le fichier source a ete modifie
    /// depuis le dernier chargement. Retourne le nombre de ressources rechargees.
    /// Workflow modding : appeler depuis l'editeur apres edition externe.
    size_t reload_all_modified() {
        // Snapshot des (id, path, last_write) pour eviter de tenir le verrou
        // pendant les I/O.
        std::vector<std::tuple<ResourceId, std::string, std::filesystem::file_time_type>> snapshot;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            snapshot.reserve(resources_.size());
            for (const auto& [id, entry] : resources_) {
                snapshot.emplace_back(id, entry.path, entry.last_write);
            }
        }

        size_t reloaded = 0;
        for (const auto& [id, path, prev_time] : snapshot) {
            const auto current = query_last_write_time(path);
            if (current == std::filesystem::file_time_type{}) {
                continue; // fichier inexistant (VFS-only) : ignore
            }
            if (current > prev_time) {
                if (reload(id)) {
                    ++reloaded;
                }
            }
        }

        if (reloaded > 0) {
            spdlog::info("ResourceManager: reload_all_modified -> {} ressources", reloaded);
        }
        return reloaded;
    }

    /// Recharge inconditionnellement toutes les ressources cachees.
    /// Utile apres swap d'un mod (workflow modding).
    size_t reload_all() {
        std::vector<ResourceId> ids;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            ids.reserve(resources_.size());
            for (const auto& [id, _] : resources_) {
                ids.push_back(id);
            }
        }
        size_t ok = 0;
        for (ResourceId id : ids) {
            if (reload(id)) {
                ++ok;
            }
        }
        spdlog::info("ResourceManager: reload_all -> {}/{} ressources", ok, ids.size());
        return ok;
    }

    /// Deplace une ressource vers un nouveau chemin (rename). Inspire de
    /// Overload::AResourceManager::MoveResource.
    bool move_resource(const std::string& previous_path, const std::string& new_path) {
        const std::string from = normalize_resource_path(previous_path);
        const std::string to   = normalize_resource_path(new_path);

        std::lock_guard<std::mutex> lock(mutex_);
        auto src_it = path_to_id_.find(from);
        if (src_it == path_to_id_.end() || path_to_id_.contains(to)) {
            return false;
        }
        const ResourceId id = src_it->second;
        path_to_id_.erase(src_it);
        path_to_id_[to] = id;
        if (auto rit = resources_.find(id); rit != resources_.end()) {
            rit->second.path = to;
        }
        return true;
    }

    /// Teste si une ressource est chargee par chemin.
    [[nodiscard]] bool contains(const std::string& path) const {
        std::lock_guard<std::mutex> lock(mutex_);
        return path_to_id_.contains(normalize_resource_path(path));
    }

    /// Teste si une ressource est chargee par ID.
    [[nodiscard]] bool contains(ResourceId id) const {
        std::lock_guard<std::mutex> lock(mutex_);
        return resources_.contains(id);
    }

    /// Recupere le ref-count d'une ressource. 0 si non trouvee.
    [[nodiscard]] uint32_t ref_count(ResourceId id) const {
        std::lock_guard<std::mutex> lock(mutex_);
        if (auto it = resources_.find(id); it != resources_.end()) {
            return it->second.ref_count;
        }
        return 0;
    }

    // ── Iteration ──────────────────────────────────────────────────

    /// Iterateur (const) sur les entries internes.
    using const_iterator = typename std::unordered_map<ResourceId, struct Entry>::const_iterator;

    [[nodiscard]] auto begin() const { return resources_.begin(); }
    [[nodiscard]] auto end() const { return resources_.end(); }

    /// Applique une fonction a chaque ressource chargee.
    void for_each(const std::function<void(ResourceId, const T&)>& fn) const {
        std::lock_guard<std::mutex> lock(mutex_);
        for (const auto& [id, entry] : resources_) {
            fn(id, *entry.resource);
        }
    }

protected:
    /// Fonction de chargement a specialiser par type de ressource.
    /// Retourne nullptr si le chargement echoue.
    virtual std::unique_ptr<T> load_from_file(const std::string& path) = 0;

    /// Marque une ressource comme rechargee (met a jour le timestamp).
    /// A appeler par une classe derivee apres avoir manuellement modifie le
    /// contenu d'une ressource VFS sans repasser par reload().
    void touch(ResourceId id) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (auto it = resources_.find(id); it != resources_.end()) {
            it->second.last_write = query_last_write_time(it->second.path);
        }
    }

private:
    /// Recupere le last_write_time d'un chemin filesystem. Retourne
    /// `file_time_type{}` (epoch) si le fichier n'existe pas (cas VFS-only).
    [[nodiscard]] static std::filesystem::file_time_type
    query_last_write_time(const std::string& path) noexcept {
        std::error_code ec;
        const auto t = std::filesystem::last_write_time(path, ec);
        if (ec) {
            return std::filesystem::file_time_type{};
        }
        return t;
    }

    /// Entree dans le cache de ressources.
    struct Entry {
        std::unique_ptr<T> resource;
        std::string path;
        uint32_t ref_count = 1;
        std::filesystem::file_time_type last_write{};
    };

    std::unordered_map<ResourceId, Entry> resources_;
    std::unordered_map<std::string, ResourceId> path_to_id_;
    ResourceId next_id_ = 1;
    mutable std::mutex mutex_;
};

} // namespace lives
