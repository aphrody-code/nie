#include "iecode/viola/pack.h"

#include "iecode/formats/level5/cfgbin.h"
#include "iecode/crypto/xorshift.h"
#include "iecode/types.h"

#include <algorithm>
#include <atomic>
#include <cstring>
#include <fmt/format.h>
#include <fstream>
#include <spdlog/spdlog.h>
#include <thread>
#include <unordered_map>

namespace iecode::viola {

namespace {

// ── Helpers (prefixe viola_pack_ pour unity build) ─────────────────

/// Lit un fichier complet en memoire.
[[nodiscard]] std::vector<uint8_t> viola_pack_read_file(const std::filesystem::path& path) {
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file.is_open()) return {};

    const auto size = file.tellg();
    if (size <= 0) return {};

    file.seekg(0);
    std::vector<uint8_t> buf(static_cast<size_t>(size));
    file.read(reinterpret_cast<char*>(buf.data()), size);
    return buf;
}

/// Ecrit un buffer dans un fichier (cree les dossiers parents si necessaire).
bool viola_pack_write_file(const std::filesystem::path& path,
                            std::span<const uint8_t> data) {
    std::error_code ec;
    std::filesystem::create_directories(path.parent_path(), ec);
    if (ec) {
        spdlog::error("viola_pack: impossible de creer le dossier '{}': {}",
                       path.parent_path().string(), ec.message());
        return false;
    }

    std::ofstream file(path, std::ios::binary);
    if (!file.is_open()) {
        spdlog::error("viola_pack: impossible d'ecrire '{}'", path.string());
        return false;
    }

    file.write(reinterpret_cast<const char*>(data.data()),
               static_cast<std::streamsize>(data.size()));
    return file.good();
}

/// Enumere recursivement les fichiers d'un dossier avec chemins relatifs normalises.
/// Retourne des paires (chemin absolu, chemin relatif avec '/').
[[nodiscard]] std::vector<std::pair<std::filesystem::path, std::string>>
viola_pack_enumerate_files(const std::filesystem::path& dir) {
    std::vector<std::pair<std::filesystem::path, std::string>> result;
    std::error_code ec;

    for (const auto& entry : std::filesystem::recursive_directory_iterator(dir, ec)) {
        if (!entry.is_regular_file()) continue;

        auto rel = std::filesystem::relative(entry.path(), dir, ec);
        if (ec) continue;

        // Normaliser les separateurs en '/'
        std::string rel_str = rel.generic_string();
        result.emplace_back(entry.path(), std::move(rel_str));
    }

    return result;
}

/// Seuil pour detecter si le cfg.bin est chiffre.
/// Le premier uint32 LE d'un cfg.bin non chiffre est le nombre d'entrees,
/// qui est normalement petit. Si > 10M, c'est probablement chiffre.
constexpr uint32_t VIOLA_PACK_ENCRYPT_THRESHOLD = 10'000'000;

/// Seed par defaut pour le re-chiffrement XorShift.
constexpr uint32_t VIOLA_PACK_DEFAULT_SEED = 0x1717E18E;

} // namespace

PackResult cpk_update_file_list(
    const std::filesystem::path& cpk_list_path,
    const std::filesystem::path& mod_dir,
    const std::filesystem::path& output_dir,
    Platform platform) {

    PackResult result;

    // --- Lire le cpk_list.cfg.bin ---
    auto file_data = viola_pack_read_file(cpk_list_path);
    if (file_data.empty()) {
        result.error = fmt::format("Impossible de lire '{}'", cpk_list_path.string());
        spdlog::error("viola_pack: {}", result.error);
        return result;
    }

    spdlog::info("viola_pack: lu {} octets depuis '{}'", file_data.size(), cpk_list_path.string());

    // --- Detecter et dechiffrer si necessaire ---
    bool was_encrypted = false;
    uint32_t original_seed = 0;
    if (file_data.size() >= 4) {
        uint32_t header_val;
        std::memcpy(&header_val, file_data.data(), 4);
        if (header_val > VIOLA_PACK_ENCRYPT_THRESHOLD) {
            was_encrypted = true;
            // Extraire la seed avant dechiffrement
            if (file_data.size() >= 4) {
                std::memcpy(&original_seed, file_data.data() + file_data.size() - 4, 4);
            }
            spdlog::info("viola_pack: cfg.bin chiffre detecte, dechiffrement...");
            iecode::crypto::xorshift_decrypt(file_data);
        }
    }

    // --- Parser le cfg.bin ---
    auto cfg_opt = iecode::level5::cfgbin_parse(file_data);
    if (!cfg_opt) {
        result.error = "Echec du parsing de cpk_list.cfg.bin";
        spdlog::error("viola_pack: {}", result.error);
        return result;
    }

    auto& cfg = *cfg_opt;

    // Seul le format T2B est supporte pour cpk_list (le jeu utilise T2B)
    if (cfg.format != iecode::level5::CfgBinFile::Format::T2B) {
        result.error = "cpk_list.cfg.bin au format RDBN non supporte (attendu T2B)";
        spdlog::error("viola_pack: {}", result.error);
        return result;
    }

    if (cfg.entries.empty() || cfg.entries[0].children.empty()) {
        result.error = "cpk_list.cfg.bin: structure invalide (pas d'entrees)";
        spdlog::error("viola_pack: {}", result.error);
        return result;
    }

    auto& root = cfg.entries[0];
    auto& items = root.children;

    // --- Construire un index des fichiers existants ---
    // Structure des variables T2B dans cpk_list :
    //   [0] = dir (string, ex: "data/200_icon/")
    //   [1] = name (string, ex: "file.g4tx")
    //   [2] = cpk_dir (string)
    //   [3] = cpk_name (string)
    //   [4] = size (int)
    std::unordered_map<std::string, size_t> existing_files;
    for (size_t i = 0; i < items.size(); ++i) {
        if (items[i].variables.size() < 5) continue;

        const auto* dir_val = std::get_if<std::string>(&items[i].variables[0].value);
        const auto* name_val = std::get_if<std::string>(&items[i].variables[1].value);
        if (!dir_val || !name_val) continue;

        std::string full_path = *dir_val + *name_val;
        existing_files[full_path] = i;
    }

    spdlog::info("viola_pack: {} entrees existantes dans cpk_list", existing_files.size());

    // --- Enumerer les fichiers du mod ---
    auto mod_files = viola_pack_enumerate_files(mod_dir);

    for (const auto& [abs_path, rel_path] : mod_files) {
        // Ignorer le cpk_list.cfg.bin lui-meme
        if (rel_path.ends_with("cpk_list.cfg.bin")) continue;

        // Taille du fichier mod
        std::error_code ec;
        const auto file_size = std::filesystem::file_size(abs_path, ec);
        if (ec) continue;

        const int32_t size_val = static_cast<int32_t>(file_size);

        auto it = existing_files.find(rel_path);
        if (it != existing_files.end()) {
            // --- Mettre a jour une entree existante ---
            auto& entry = items[it->second];
            if (entry.variables.size() >= 5) {
                // Effacer cpk_dir et cpk_name (mode loose file)
                entry.variables[2].value = std::string{};
                entry.variables[3].value = std::string{};
                // Mettre a jour la taille
                entry.variables[4].value = size_val;
                ++result.files_updated;
                spdlog::debug("viola_pack: [maj] {}", rel_path);
            }
        } else {
            // --- Ajouter une nouvelle entree ---
            // Cloner la derniere entree comme template
            if (items.empty()) continue;

            iecode::level5::CfgEntry new_entry = items.back();

            // Extraire dir et filename
            auto last_slash = rel_path.rfind('/');
            std::string dir_name;
            std::string file_name;
            if (last_slash != std::string::npos) {
                dir_name = rel_path.substr(0, last_slash + 1);  // inclure le '/'
                file_name = rel_path.substr(last_slash + 1);
            } else {
                file_name = rel_path;
            }

            if (new_entry.variables.size() >= 5) {
                new_entry.variables[0].value = dir_name;
                new_entry.variables[1].value = file_name;
                new_entry.variables[2].value = std::string{};  // pas de CPK
                new_entry.variables[3].value = std::string{};  // pas de CPK
                new_entry.variables[4].value = size_val;
            }

            items.push_back(std::move(new_entry));
            ++result.files_added;
            spdlog::debug("viola_pack: [ajout] {}", rel_path);
        }
    }

    // Mettre a jour le compteur dans l'entree racine
    if (!root.variables.empty()) {
        root.variables[0].value = static_cast<int32_t>(items.size());
    }

    result.total_entries = items.size();

    spdlog::info("viola_pack: {} maj, {} ajouts, {} entrees totales",
                  result.files_updated, result.files_added, result.total_entries);

    // --- Re-serialiser le cfg.bin en binaire T2B ---
    auto saved_bytes = iecode::level5::cfgbin_write(cfg);
    if (saved_bytes.empty()) {
        result.error = "Echec de la serialisation T2B";
        spdlog::error("viola_pack: {}", result.error);
        return result;
    }

    // --- Re-chiffrer si le fichier original etait chiffre ---
    if (was_encrypted) {
        spdlog::info("viola_pack: re-chiffrement avec seed 0x{:08X}...", VIOLA_PACK_DEFAULT_SEED);
        // Ajouter 8 octets pour checksum + seed si pas deja presents
        // Le format chiffre attend checksum(4) + seed(4) a la fin
        saved_bytes.resize(saved_bytes.size() + 8, 0);
        iecode::crypto::xorshift_encrypt(saved_bytes, VIOLA_PACK_DEFAULT_SEED);
    }

    // --- Determiner le chemin de sortie ---
    std::filesystem::path out_base = output_dir.empty() ? mod_dir.parent_path() : output_dir;
    std::filesystem::path dest_root;
    std::filesystem::path config_out;

    switch (platform) {
        case Platform::Switch:
            dest_root = out_base / "romfs";
            config_out = dest_root / "data" / "cpk_list.cfg.bin";
            break;
        case Platform::PC:
        default:
            dest_root = out_base;
            config_out = dest_root / "data" / "cpk_list.cfg.bin";
            break;
    }

    // --- Ecrire le cpk_list.cfg.bin ---
    if (!viola_pack_write_file(config_out, saved_bytes)) {
        result.error = fmt::format("Echec d'ecriture de '{}'", config_out.string());
        spdlog::error("viola_pack: {}", result.error);
        return result;
    }

    spdlog::info("viola_pack: config ecrite dans '{}'", config_out.string());

    // --- Copier les fichiers du mod vers la sortie ---
    spdlog::info("viola_pack: copie des fichiers...");

    // Filtrer les fichiers (exclure cpk_list.cfg.bin)
    std::vector<std::pair<std::filesystem::path, std::string>> files_to_copy;
    for (const auto& [abs_path, rel_path] : mod_files) {
        if (rel_path.ends_with("cpk_list.cfg.bin")) continue;
        files_to_copy.emplace_back(abs_path, rel_path);
    }

    // Creer les dossiers uniques d'abord
    {
        std::unordered_map<std::string, bool> dirs_created;
        for (const auto& [_, rel_path] : files_to_copy) {
            auto dest = dest_root / rel_path;
            auto parent = dest.parent_path().string();
            if (!dirs_created.contains(parent)) {
                std::error_code ec;
                std::filesystem::create_directories(dest.parent_path(), ec);
                dirs_created[parent] = true;
            }
        }
    }

    // Copier en parallele
    std::atomic<size_t> copied_count{0};
    const int num_threads = std::max(1,
        static_cast<int>(std::thread::hardware_concurrency()));
    std::atomic<size_t> next_idx{0};

    auto copy_worker = [&]() {
        while (true) {
            const size_t idx = next_idx.fetch_add(1, std::memory_order_relaxed);
            if (idx >= files_to_copy.size()) break;

            const auto& [abs_path, rel_path] = files_to_copy[idx];
            auto dest = dest_root / rel_path;

            std::error_code ec;
            std::filesystem::copy_file(abs_path, dest,
                std::filesystem::copy_options::overwrite_existing, ec);
            if (!ec) {
                copied_count.fetch_add(1, std::memory_order_relaxed);
            } else {
                spdlog::warn("viola_pack: erreur copie '{}': {}",
                              rel_path, ec.message());
            }
        }
    };

    if (files_to_copy.size() <= 1 || num_threads <= 1) {
        copy_worker();
    } else {
        const int effective_threads = std::min(num_threads,
            static_cast<int>(files_to_copy.size()));
        std::vector<std::thread> threads;
        threads.reserve(static_cast<size_t>(effective_threads));
        for (int i = 0; i < effective_threads; ++i) {
            threads.emplace_back(copy_worker);
        }
        for (auto& t : threads) {
            t.join();
        }
    }

    spdlog::info("viola_pack: {} fichiers copies vers '{}'",
                  copied_count.load(std::memory_order_relaxed), dest_root.string());

    result.success = true;
    return result;
}

} // namespace iecode::viola
