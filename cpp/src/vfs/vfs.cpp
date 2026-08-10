/// @file vfs.cpp
/// Implementation du VFS (Virtual File System) pour nie.exe.
///
/// Reproduit le comportement de nie.exe au chargement :
/// 1. Lit data/cpk_list.cfg.bin
/// 2. Dechiffre avec CRI XOR key 0x1717E18E
/// 3. Parse le T2B cfg.bin (~250k entrees)
/// 4. Construit un index O(1) chemin -> CPK

#include "iecode/vfs/vfs.h"

#include "iecode/crypto/cri_crypto.h"
#include "iecode/formats/criware/cpk_reader.h"
#include "iecode/formats/level5/cfgbin.h"

#include <fmt/format.h>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <fstream>

namespace iecode::vfs {

namespace {

/// Cle CRI XOR utilisee par nie.exe pour chiffrer cpk_list.cfg.bin
constexpr uint32_t CRI_XOR_KEY = 0x1717E18E;

/// Chemin relatif de cpk_list.cfg.bin dans le dossier data/
constexpr const char* CPK_LIST_PATH = "cpk_list.cfg.bin";

/// Lit un fichier binaire complet.
[[nodiscard]] std::vector<uint8_t> read_file(const std::filesystem::path& path) {
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file) return {};
    const auto size = file.tellg();
    if (size <= 0) return {};
    std::vector<uint8_t> data(static_cast<size_t>(size));
    file.seekg(0);
    file.read(reinterpret_cast<char*>(data.data()), size);
    return data;
}

/// Matching glob simple (supporte * et ?).
[[nodiscard]] bool glob_match(std::string_view pattern, std::string_view text) {
    size_t pi = 0;
    size_t ti = 0;
    size_t star_pi = std::string_view::npos;
    size_t star_ti = 0;

    while (ti < text.size()) {
        if (pi < pattern.size() && (pattern[pi] == '?' || pattern[pi] == text[ti])) {
            ++pi;
            ++ti;
        } else if (pi < pattern.size() && pattern[pi] == '*') {
            star_pi = pi;
            star_ti = ti;
            ++pi;
        } else if (star_pi != std::string_view::npos) {
            pi = star_pi + 1;
            ++star_ti;
            ti = star_ti;
        } else {
            return false;
        }
    }

    while (pi < pattern.size() && pattern[pi] == '*') ++pi;
    return pi == pattern.size();
}

} // namespace

Vfs::~Vfs() {
    shutdown();
}

Vfs::Vfs(Vfs&& other) noexcept
    : game_data_dir_(std::move(other.game_data_dir_))
    , loose_files_(other.loose_files_)
    , index_(std::move(other.index_))
    , cpk_names_(std::move(other.cpk_names_))
    , cpk_cache_(std::move(other.cpk_cache_)) {
    // Le mutex n'est pas deplacable — on en cree un nouveau (l'ancien n'est
    // plus utilise apres le move).
}

Vfs& Vfs::operator=(Vfs&& other) noexcept {
    if (this != &other) {
        shutdown();
        game_data_dir_ = std::move(other.game_data_dir_);
        loose_files_ = other.loose_files_;
        index_ = std::move(other.index_);
        cpk_names_ = std::move(other.cpk_names_);
        cpk_cache_ = std::move(other.cpk_cache_);
        // Le mutex reste frais — pas de move.
    }
    return *this;
}

bool Vfs::init(const std::filesystem::path& game_data_dir) {
    game_data_dir_ = game_data_dir;

    // Lire cpk_list.cfg.bin
    const auto cpk_list_path = game_data_dir / CPK_LIST_PATH;
    spdlog::info("VFS: chargement de {}", cpk_list_path.string());

    auto data = read_file(cpk_list_path);
    if (data.empty()) {
        spdlog::error("VFS: impossible de lire {}", cpk_list_path.string());
        return false;
    }

    spdlog::debug("VFS: {} octets lus, dechiffrement CRI XOR...", data.size());

    // Dechiffrer avec CRI XOR key
    crypto::cri_decrypt(std::span<uint8_t>(data), CRI_XOR_KEY);

    return build_index(std::span<const uint8_t>(data));
}

bool Vfs::init_loose(const std::filesystem::path& extracted_data_dir) {
    namespace fs = std::filesystem;

    std::error_code ec;
    if (!fs::exists(extracted_data_dir, ec) || !fs::is_directory(extracted_data_dir, ec)) {
        spdlog::error("VFS (loose): repertoire introuvable: {}",
                      extracted_data_dir.string());
        return false;
    }

    loose_files_ = true;
    game_data_dir_ = extracted_data_dir;
    index_.clear();
    cpk_names_.clear();

    size_t total = 0;
    for (auto it = fs::recursive_directory_iterator(
             extracted_data_dir, fs::directory_options::skip_permission_denied, ec);
         !ec && it != fs::recursive_directory_iterator();
         it.increment(ec)) {
        if (ec) break;
        if (!it->is_regular_file(ec)) continue;

        // Construire le chemin relatif et normaliser en forward slashes
        auto rel = fs::relative(it->path(), extracted_data_dir, ec);
        if (ec) continue;

        std::string internal_path = rel.generic_string();
        if (internal_path.empty()) continue;

        const auto file_size = static_cast<uint32_t>(it->file_size(ec));
        if (ec) continue;

        VfsEntry entry{
            .internal_path = internal_path,
            .cpk_filename = "",
            .file_size = file_size,
        };
        index_.emplace(std::move(internal_path), std::move(entry));
        ++total;
    }

    spdlog::info("VFS (loose): {} fichiers indexes depuis {}",
                 total, extracted_data_dir.string());
    return total > 0;
}

bool Vfs::init_from_data(std::span<const uint8_t> data,
                          const std::filesystem::path& game_data_dir) {
    game_data_dir_ = game_data_dir;
    return build_index(data);
}

bool Vfs::build_index(std::span<const uint8_t> data) {
    // Parser le cfg.bin (auto-detecte T2B/RDBN, dechiffre XorShift si necessaire)
    auto cfg = level5::cfgbin_parse(data);
    if (!cfg) {
        spdlog::error("VFS: echec du parsing cfg.bin");
        return false;
    }

    if (cfg->format != level5::CfgBinFile::Format::T2B) {
        spdlog::error("VFS: cpk_list.cfg.bin n'est pas au format T2B");
        return false;
    }

    // Structure attendue :
    // entries[0] = racine "CPK_ITEM_BEGIN_0" (ou similaire)
    //   children[N] = chaque asset
    //     variables[0] = directory (String)
    //     variables[1] = filename (String)
    //     variables[2] = pack_dir (String) — toujours "data/packs/"
    //     variables[3] = cpk_hash (String) — nom MD5 du CPK
    //     variables[4] = size (Int)

    size_t total_entries = 0;

    // Parcourir toutes les entrees racines (il peut y en avoir plusieurs)
    for (const auto& root_entry : cfg->entries) {
        // Parcourir les enfants de chaque entree racine
        for (const auto& child : root_entry.children) {
            if (child.variables.size() < 5) {
                spdlog::debug("VFS: entree avec {} variables (attendu 5), ignoree",
                              child.variables.size());
                continue;
            }

            // Extraire directory (variable 0, String)
            const auto* dir_ptr = std::get_if<std::string>(&child.variables[0].value);
            if (!dir_ptr) continue;

            // Extraire filename (variable 1, String)
            const auto* name_ptr = std::get_if<std::string>(&child.variables[1].value);
            if (!name_ptr) continue;

            // Extraire cpk_hash (variable 3, String)
            const auto* cpk_ptr = std::get_if<std::string>(&child.variables[3].value);
            if (!cpk_ptr) continue;

            // Extraire size (variable 4, Int)
            uint32_t file_size = 0;
            if (const auto* size_ptr = std::get_if<int32_t>(&child.variables[4].value)) {
                file_size = static_cast<uint32_t>(*size_ptr);
            }

            // Construire le chemin interne = directory + filename
            std::string internal_path = *dir_ptr + *name_ptr;

            VfsEntry entry{
                .internal_path = internal_path,
                .cpk_filename = *cpk_ptr,
                .file_size = file_size,
            };

            cpk_names_.insert(*cpk_ptr);
            index_.emplace(std::move(internal_path), std::move(entry));
            ++total_entries;
        }
    }

    spdlog::info("VFS: {} assets indexes dans {} CPK uniques",
                 total_entries, cpk_names_.size());

    return total_entries > 0;
}

std::optional<VfsEntry> Vfs::find(const std::string& internal_path) const {
    auto it = index_.find(internal_path);
    if (it == index_.end()) {
        return std::nullopt;
    }
    return it->second;
}

std::optional<VfsEntry> Vfs::find(const std::string& directory,
                                    const std::string& filename) const {
    return find(directory + filename);
}

std::vector<uint8_t> Vfs::read(const std::string& internal_path) {
    // Mode loose files : lecture directe depuis le filesystem
    if (loose_files_) {
        const auto disk_path = game_data_dir_ / internal_path;
        auto data = read_file(disk_path);
        if (data.empty()) {
            spdlog::error("VFS (loose): impossible de lire {}", disk_path.string());
            return {};
        }
        spdlog::debug("VFS: lu {} ({} octets) depuis disque",
                      internal_path, data.size());
        return data;
    }

    // Trouver l'entree dans l'index
    auto entry_opt = find(internal_path);
    if (!entry_opt) {
        spdlog::error("VFS: asset non trouve: {}", internal_path);
        return {};
    }

    const auto& entry = *entry_opt;

    // Ouvrir ou recuperer le CpkReader depuis le cache (thread-safe)
    criware::CpkReader* reader = nullptr;
    {
        std::lock_guard lock(cpk_cache_mutex_);

        auto cache_it = cpk_cache_.find(entry.cpk_filename);
        if (cache_it != cpk_cache_.end()) {
            reader = cache_it->second.get();
        } else {
            // Ouvrir le CPK (lazy)
            auto cpk_path = game_data_dir_ / "packs" / entry.cpk_filename;
            auto new_reader = std::make_unique<criware::CpkReader>();

            if (!new_reader->open(cpk_path)) {
                spdlog::error("VFS: impossible d'ouvrir le CPK: {}",
                              cpk_path.string());
                return {};
            }

            spdlog::debug("VFS: CPK ouvert: {} ({} fichiers)",
                          entry.cpk_filename, new_reader->count());

            reader = new_reader.get();
            cpk_cache_.emplace(entry.cpk_filename, std::move(new_reader));
        }
    }

    // Chercher le fichier dans le CPK
    // Le chemin dans le CPK utilise directory + filename
    // On doit retrouver l'entree CPK correspondante
    const auto& cpk_entries = reader->list();

    for (const auto& cpk_entry : cpk_entries) {
        // Construire le chemin complet du CPK entry
        std::string cpk_full_path;
        if (!cpk_entry.directory.empty()) {
            cpk_full_path = cpk_entry.directory + "/" + cpk_entry.filename;
        } else {
            cpk_full_path = cpk_entry.filename;
        }

        // Comparer avec le chemin interne (peut etre relatif dans le CPK)
        // Le chemin interne commence par "data/..." mais dans le CPK il peut
        // etre relatif. On compare par suffixe.
        if (internal_path == cpk_full_path ||
            internal_path.ends_with(cpk_full_path) ||
            cpk_full_path.ends_with(entry.cpk_filename)) {
            // Mieux : comparer filename directement
        }

        // Strategie : matcher par filename si le directory correspond
        // Le CPK peut stocker les fichiers avec des chemins differents
        if (cpk_entry.filename == internal_path.substr(
                internal_path.rfind('/') + 1)) {
            // Verifier aussi le directory si possible
            auto result = reader->extract(cpk_entry);
            if (!result.empty()) {
                spdlog::debug("VFS: lu {} ({} octets) depuis {}",
                              internal_path, result.size(), entry.cpk_filename);
                return result;
            }
        }
    }

    spdlog::error("VFS: fichier non trouve dans le CPK {}: {}",
                  entry.cpk_filename, internal_path);
    return {};
}

size_t Vfs::asset_count() const noexcept {
    return index_.size();
}

size_t Vfs::cpk_count() const noexcept {
    return cpk_names_.size();
}

std::vector<VfsEntry> Vfs::list(const std::string& pattern) const {
    std::vector<VfsEntry> result;

    if (pattern == "*") {
        // Optimisation : tout retourner sans filtrage
        result.reserve(index_.size());
        for (const auto& [path, entry] : index_) {
            result.push_back(entry);
        }
    } else {
        for (const auto& [path, entry] : index_) {
            if (glob_match(pattern, path)) {
                result.push_back(entry);
            }
        }
    }

    // Trier par chemin pour un affichage stable
    std::sort(result.begin(), result.end(),
              [](const VfsEntry& a, const VfsEntry& b) {
                  return a.internal_path < b.internal_path;
              });

    return result;
}

std::vector<std::string> Vfs::cpk_list() const {
    std::vector<std::string> result(cpk_names_.begin(), cpk_names_.end());
    std::sort(result.begin(), result.end());
    return result;
}

void Vfs::shutdown() {
    std::lock_guard lock(cpk_cache_mutex_);
    cpk_cache_.clear();
    spdlog::debug("VFS: tous les handles CPK fermes");
}

} // namespace iecode::vfs
