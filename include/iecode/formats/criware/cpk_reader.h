#pragma once

/// @file cpk_reader.h
/// Lecteur d'archives CPK (CRI Package).
/// Utilise memory-mapped I/O (mio) pour un acces zero-copy aux donnees.

#include <cstdint>
#include <filesystem>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace iecode::criware {

/// Entree d'un fichier dans une archive CPK.
struct CpkEntry {
    std::string filename;
    std::string directory;
    uint64_t offset = 0;
    uint64_t size = 0;
    uint64_t extract_size = 0;
    bool is_compressed = false;
    bool is_encrypted = false;
};

/// Lecteur d'archives CPK.
/// Utilise memory-mapped I/O pour eviter de copier le fichier en memoire.
/// Le mapping est maintenu ouvert tant que le reader existe.
class CpkReader {
public:
    CpkReader();
    ~CpkReader();

    // Move-only (le mapping n'est pas copiable)
    CpkReader(CpkReader&& other) noexcept;
    CpkReader& operator=(CpkReader&& other) noexcept;
    CpkReader(const CpkReader&) = delete;
    CpkReader& operator=(const CpkReader&) = delete;

    /// Ouvre un fichier CPK. Retourne false en cas d'erreur.
    [[nodiscard]] bool open(const std::filesystem::path& path);

    /// Ouvre un CPK depuis des donnees en memoire. Retourne false en cas d'erreur.
    /// Les donnees sont copiees dans le reader (le span n'a pas besoin de rester valide).
    [[nodiscard]] bool open_from_data(std::span<const uint8_t> data);

    /// Liste tous les fichiers contenus dans l'archive.
    [[nodiscard]] const std::vector<CpkEntry>& list() const noexcept { return entries_; }

    /// Extrait le contenu d'une entree. Retourne un vecteur vide en cas d'erreur.
    [[nodiscard]] std::vector<uint8_t> extract(const CpkEntry& entry) const;

    /// Nombre de fichiers dans l'archive.
    [[nodiscard]] size_t count() const noexcept { return entries_.size(); }

    /// Retourne un span sur les donnees brutes du fichier mappe.
    [[nodiscard]] std::span<const uint8_t> mapped_data() const noexcept;

    /// Indique si le fichier CPK est chiffre CRI XOR (file-level).
    [[nodiscard]] bool is_encrypted() const noexcept { return is_file_encrypted_; }

private:
    /// Logique commune de parsing apres chargement des donnees.
    [[nodiscard]] bool parse_internal();

    /// Lit une region du fichier, la dechiffrant si necessaire.
    /// Permet le streaming decrypt : seule la region demandee est copiee et dechiffree.
    [[nodiscard]] std::vector<uint8_t> read_region(size_t offset, size_t size) const;

    std::filesystem::path path_;
    std::vector<CpkEntry> entries_;

    // Pimpl pour isoler mio.hpp des headers publics
    struct MappedFile;
    std::unique_ptr<MappedFile> mapped_file_;

    // Fallback : donnees lues en memoire (quand le mmap echoue ou open_from_data)
    std::vector<uint8_t> file_data_;

    // Streaming decrypt : le mmap reste ouvert, on dechiffre par region
    bool is_file_encrypted_ = false;
    uint32_t file_key_ = 0;
};

} // namespace iecode::criware
