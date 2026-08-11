#pragma once

/// @file gds_table.h
/// Table generique GDS — chargement depuis le VFS via ConfigManager.
/// Fournit un acces O(log N) par chara_id apres tri, et un span sur toutes
/// les lignes pour iteration. Ne stocke que des donnees read-only.

#include "iecode/engine/res/config_manager.h"
#include "iecode/vfs/vfs.h"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <cstdint>
#include <functional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace game {

/// Table generique de configurations GDS.
///
/// Chaque type T doit fournir :
///   - `static constexpr std::string_view CFG_KEY` — cle racine dans le JSON
///   - un champ entier `chara_id` (ou rebindable via `id_getter`)
///
/// Le parsing d'une entree JSON unique est delegue a un foncteur fourni a
/// `load()`. Cela permet de reutiliser les fonctions `parse_*` existantes
/// dans `cli/src/game/gds/`.
template <typename T>
class GDSTable {
public:
    /// Type du foncteur de parsing : json -> optional<T>.
    using ParseFn = std::function<std::optional<T>(const nlohmann::json&)>;

    /// Charge la table depuis un fichier cfg.bin via le VFS.
    /// @param vfs       Systeme de fichiers virtuel deja initialise
    /// @param vfs_path  Chemin VFS du cfg.bin (ex: "common/chara/chara_param.cfg.bin")
    /// @param parser    Foncteur appele pour chaque entree JSON
    /// @return true si au moins une ligne a ete chargee
    [[nodiscard]] bool load(iecode::vfs::Vfs& vfs,
                            std::string_view vfs_path,
                            const ParseFn& parser)
    {
        rows_.clear();

        const std::string path(vfs_path);
        lives::ConfigManager cm;
        const auto id = cm.load_from_vfs(vfs, path);
        if (id == lives::INVALID_RESOURCE_ID) {
            spdlog::error("GDSTable<{}>::load: echec ConfigManager '{}'",
                          T::CFG_KEY, path);
            return false;
        }

        const auto* res = cm.get(id);
        if (res == nullptr) {
            return false;
        }

        const auto key = std::string(T::CFG_KEY);
        if (!res->data.contains(key)) {
            spdlog::warn("GDSTable<{}>::load: cle '{}' absente dans '{}'",
                         T::CFG_KEY, key, path);
            return false;
        }

        const auto& entries = res->data[key];
        if (!entries.is_array()) {
            spdlog::warn("GDSTable<{}>::load: '{}' n'est pas un tableau",
                         T::CFG_KEY, key);
            return false;
        }

        rows_.reserve(entries.size());
        for (const auto& entry : entries) {
            if (auto row = parser(entry)) {
                rows_.push_back(std::move(*row));
            }
        }

        // Tri par chara_id pour permettre find_by_id() en O(log N).
        std::sort(rows_.begin(), rows_.end(),
                  [](const T& a, const T& b) { return a.chara_id < b.chara_id; });

        spdlog::info("GDSTable<{}>::load: {} lignes chargees depuis '{}'",
                     T::CFG_KEY, rows_.size(), path);
        return !rows_.empty();
    }

    /// Recherche binaire par chara_id (table triee par load()).
    [[nodiscard]] const T* find_by_id(uint32_t id) const noexcept {
        const auto it = std::lower_bound(
            rows_.begin(), rows_.end(), id,
            [](const T& row, uint32_t v) { return row.chara_id < v; });
        if (it == rows_.end() || it->chara_id != id) {
            return nullptr;
        }
        return &(*it);
    }

    /// Vue read-only sur toutes les lignes.
    [[nodiscard]] std::span<const T> all() const noexcept {
        return std::span<const T>(rows_);
    }

    /// Nombre de lignes chargees.
    [[nodiscard]] size_t size() const noexcept { return rows_.size(); }

    /// True si aucune ligne n'a ete chargee.
    [[nodiscard]] bool empty() const noexcept { return rows_.empty(); }

    /// Vide la table (utilise pour rechargement explicite).
    void clear() noexcept { rows_.clear(); }

    /// Initialise la table directement depuis un vecteur deja construit.
    /// Usage : tests unitaires, deserialisation manuelle. Trie par chara_id.
    void assign(std::vector<T> rows) {
        rows_ = std::move(rows);
        std::sort(rows_.begin(), rows_.end(),
                  [](const T& a, const T& b) { return a.chara_id < b.chara_id; });
    }

private:
    std::vector<T> rows_;
};

} // namespace game
