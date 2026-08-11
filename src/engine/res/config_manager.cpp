/// @file config_manager.cpp
/// Implementation du ConfigManager — chargement de fichiers cfg.bin depuis le VFS.

#include <iecode/engine/res/config_manager.h>
#include <iecode/formats/level5/cfgbin.h>
#include <iecode/vfs/vfs.h>

#include <spdlog/spdlog.h>

#include <fstream>

namespace lives {

std::unique_ptr<ConfigResource>
ConfigManager::parse_buffer(std::span<const uint8_t> data, const std::string& source_path) {
    // cfgbin_parse() dechiffre automatiquement (XorShift) et auto-detecte T2B/RDBN.
    auto result = iecode::level5::cfgbin_parse(data);
    if (!result.has_value()) {
        spdlog::error("ConfigManager: echec parse cfg.bin '{}'", source_path);
        return nullptr;
    }

    const auto& cfg = result.value();

    auto resource         = std::make_unique<ConfigResource>();
    resource->source_path = source_path;
    resource->is_rdbn     = (cfg.format == iecode::level5::CfgBinFile::Format::RDBN);

    const std::string json_str = iecode::level5::cfgbin_to_json(cfg);
    resource->data = nlohmann::json::parse(json_str, nullptr, false);

    if (resource->data.is_discarded()) {
        spdlog::error("ConfigManager: echec conversion JSON '{}'", source_path);
        return nullptr;
    }

    const char* format_name = resource->is_rdbn ? "RDBN" : "T2B";
    spdlog::info("ConfigManager: parse '{}' (format={}, {} noeuds)",
                 source_path, format_name, cfg.node_count());
    return resource;
}

std::unique_ptr<ConfigResource>
ConfigManager::load_from_file(const std::string& path) {
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file.is_open()) {
        spdlog::error("ConfigManager: impossible d'ouvrir '{}'", path);
        return nullptr;
    }

    const auto file_size = file.tellg();
    if (file_size <= 0) {
        spdlog::error("ConfigManager: fichier vide '{}'", path);
        return nullptr;
    }

    std::vector<uint8_t> buffer(static_cast<size_t>(file_size));
    file.seekg(0);
    file.read(reinterpret_cast<char*>(buffer.data()), file_size);
    if (!file.good()) {
        spdlog::error("ConfigManager: erreur lecture '{}'", path);
        return nullptr;
    }
    file.close();

    return parse_buffer(buffer, path);
}

ResourceId ConfigManager::load_from_vfs(iecode::vfs::Vfs& vfs, const std::string& vfs_path) {
    std::vector<uint8_t> data = vfs.read(vfs_path);
    if (data.empty()) {
        spdlog::error("ConfigManager: VFS read echec '{}'", vfs_path);
        return INVALID_RESOURCE_ID;
    }

    auto res = parse_buffer(data, vfs_path);
    if (!res) {
        return INVALID_RESOURCE_ID;
    }
    return insert_resource(vfs_path, std::move(res));
}

} // namespace lives
