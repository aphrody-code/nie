#pragma once

/// @file vfs.h
/// Systeme de fichiers virtuel (VFS) reproduisant le comportement de nie.exe.
///
/// nie.exe charge `data/cpk_list.cfg.bin` au demarrage. Ce fichier est chiffre
/// CRI XOR (cle 0x1717E18E). Apres dechiffrement, c'est un T2B cfg.bin avec
/// ~250k entrees mappant chaque asset vers son CPK (nom MD5).
///
/// Le VFS permet un lookup O(1) : chemin interne -> CPK contenant le fichier.

#include "iecode/formats/criware/cpk_reader.h"

#include <cstdint>
#include <filesystem>
#include <memory>
#include <mutex>
#include <optional>
#include <span>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace iecode::vfs {

/// Entree dans l'index VFS : associe un chemin interne a son CPK et sa taille.
struct VfsEntry {
    std::string internal_path;  ///< directory + filename (ex: "data/common/chr/.../file.g4md")
    std::string cpk_filename;   ///< Nom du CPK MD5 (ex: "e832856918ebb97cb4430f715e6bd525.cpk")
    uint32_t file_size = 0;     ///< Taille du fichier en octets
};

/// Systeme de fichiers virtuel reproduisant le comportement de nie.exe.
/// Thread-safe pour les lectures concurrentes (mutex sur le cache CPK).
class Vfs {
public:
    Vfs() = default;
    ~Vfs();

    Vfs(Vfs&&) noexcept;
    Vfs& operator=(Vfs&&) noexcept;
    Vfs(const Vfs&) = delete;
    Vfs& operator=(const Vfs&) = delete;

    /// Initialise le VFS depuis le repertoire data/ du jeu.
    /// Charge cpk_list.cfg.bin, dechiffre, parse, construit l'index.
    /// @param game_data_dir Chemin vers le dossier "data/" du jeu
    /// @return true si l'initialisation a reussi
    [[nodiscard]] bool init(const std::filesystem::path& game_data_dir);

    /// Initialise le VFS depuis des donnees cfg.bin deja en memoire (pour les tests).
    /// Les donnees doivent etre dechiffrees et parsables.
    /// @param data Donnees cfg.bin brutes (dechiffrees)
    /// @param game_data_dir Racine pour la resolution des CPK (optionnel)
    /// @return true si le parsing a reussi
    [[nodiscard]] bool init_from_data(std::span<const uint8_t> data,
                                      const std::filesystem::path& game_data_dir = {});

    /// Initialise le VFS depuis un dossier data/ extrait sur disque (loose files).
    /// Scan recursif du dossier, index par chemin relatif. Lecture directe depuis
    /// le filesystem, sans CPK.
    /// @param extracted_data_dir Racine du dossier data/ extrait
    /// @return true si l'initialisation a reussi
    [[nodiscard]] bool init_loose(const std::filesystem::path& extracted_data_dir);

    /// Trouve quel CPK contient un asset par chemin complet.
    /// @param internal_path ex: "data/common/chr/_uniform/u11020029/u11020029.g4md"
    /// @return VfsEntry ou nullopt si non trouve
    [[nodiscard]] std::optional<VfsEntry> find(const std::string& internal_path) const;

    /// Trouve quel CPK contient un asset par repertoire + nom de fichier.
    /// @param directory ex: "data/common/chr/_uniform/u11020029/"
    /// @param filename ex: "u11020029.g4md"
    /// @return VfsEntry ou nullopt si non trouve
    [[nodiscard]] std::optional<VfsEntry> find(const std::string& directory,
                                                const std::string& filename) const;

    /// Lit un fichier directement depuis le bon CPK.
    /// Ouvre le CPK lazily (premier acces), dechiffre et extrait.
    /// @param internal_path Chemin interne complet
    /// @return Donnees du fichier, ou vecteur vide en cas d'erreur
    [[nodiscard]] std::vector<uint8_t> read(const std::string& internal_path);

    /// Nombre d'assets indexes
    [[nodiscard]] size_t asset_count() const noexcept;

    /// Nombre de CPK uniques references
    [[nodiscard]] size_t cpk_count() const noexcept;

    /// Liste les assets correspondant a un pattern glob (* et ? supportes).
    /// @param pattern Pattern glob (defaut: "*" = tous les assets)
    [[nodiscard]] std::vector<VfsEntry> list(const std::string& pattern = "*") const;

    /// Liste tous les noms de CPK uniques references dans l'index.
    [[nodiscard]] std::vector<std::string> cpk_list() const;

    /// Ferme tous les handles CPK en cache.
    void shutdown();

private:
    /// Parse les entrees cfg.bin et construit l'index.
    [[nodiscard]] bool build_index(std::span<const uint8_t> data);

    std::filesystem::path game_data_dir_;

    /// Si vrai, le VFS lit directement depuis le filesystem (mode loose files).
    bool loose_files_ = false;

    /// Index principal : internal_path -> VfsEntry (hash map O(1))
    std::unordered_map<std::string, VfsEntry> index_;

    /// Ensemble des CPK uniques references
    std::unordered_set<std::string> cpk_names_;

    /// Cache de CpkReader ouverts (lazy, thread-safe)
    std::unordered_map<std::string, std::unique_ptr<criware::CpkReader>> cpk_cache_;
    mutable std::mutex cpk_cache_mutex_;
};

} // namespace iecode::vfs
