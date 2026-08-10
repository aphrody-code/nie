#pragma once

/// @file config_manager.h
/// Gestionnaire de fichiers de configuration cfg.bin pour le moteur Level-5.
/// Charge les fichiers .cfg.bin (T2B ou RDBN) via le parser iecode_core.

#include "resource_manager.h"

#include <nlohmann/json.hpp>

#include <span>
#include <string>

namespace iecode::vfs { class Vfs; }

namespace lives {

/// Ressource de configuration chargee depuis un cfg.bin.
struct ConfigResource {
    nlohmann::json data;        // Donnees parsees en JSON
    std::string source_path;    // Chemin VFS source
    bool is_rdbn = false;       // true = format RDBN moderne, false = T2B legacy
};

/// Alias pour s'aligner sur la nomenclature lives:: de nie.exe.
using CResBinary = ConfigResource;

/// Charge et cache les fichiers de configuration cfg.bin.
/// Thread-safe (lock interne sur le cache).
class ConfigManager final : public ResourceManager<ConfigResource> {
public:
    /// Charge un fichier cfg.bin depuis le VFS (chemin interne).
    [[nodiscard]] ResourceId load_from_vfs(iecode::vfs::Vfs& vfs, const std::string& vfs_path);

protected:
    /// Charge un fichier cfg.bin depuis un fichier (filesystem direct).
    std::unique_ptr<ConfigResource> load_from_file(const std::string& path) override;

private:
    /// Decode un buffer cfg.bin en ConfigResource.
    [[nodiscard]] static std::unique_ptr<ConfigResource>
    parse_buffer(std::span<const uint8_t> data, const std::string& source_path);
};

} // namespace lives
