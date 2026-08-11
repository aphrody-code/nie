#pragma once

/// @file tar_zstd.h
/// Streaming reader for `.tar.zst` archives — explore et extrait sans
/// jamais materialiser le tar decompresse complet sur disque.
///
/// Architecture :
///   ┌────────────┐    ┌─────────────────┐    ┌───────────────┐
///   │ file (.zst)│ → │ ZstdInputStream │ → │ TarZstdReader │
///   └────────────┘    └─────────────────┘    └───────────────┘
///                                                  ↓
///                                          for_each_entry(cb)
///                                          read_one(path)
///                                          extract(predicate, sink)
///
/// Index sidecar (`.tar.zst.idx`) :
///   - Construit en un passage complet (build_index)
///   - Mappe chaque entry → (decompressed_offset, size, mode, mtime)
///   - Stats globales cachees dans le header (file_count, total_bytes, ...)
///   - Hashmap interne path → index pour lookup O(1) apres `index.rehash()`
///   - L'extraction reste sequentielle (zstd standard n'est pas seekable)
///
/// Robustesse :
///   - Validation checksum tar header (refuse les blocs corrompus)
///   - Support PAX extended (paths > 100 chars sans GNU LongName)
///   - Support GNU LongName / LongLink
///   - Path traversal protection (extract ignore '..' et chemins absolus)

#include "iecode/io/zstd_stream.h"

#include <cstdint>
#include <filesystem>
#include <functional>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace iecode::archive {

/// Type d'entree TAR (POSIX ustar typeflag).
enum class TarEntryType : std::uint8_t {
    File         = 0,  ///< '0' ou '\0' — fichier regulier
    Hardlink     = 1,  ///< '1'
    Symlink      = 2,  ///< '2'
    CharDevice   = 3,  ///< '3'
    BlockDevice  = 4,  ///< '4'
    Directory    = 5,  ///< '5'
    Fifo         = 6,  ///< '6'
    LongName     = 'L',///< 'L' — GNU long name (extension)
    LongLink     = 'K',///< 'K' — GNU long link
    PaxHeader    = 'x',///< 'x' / 'g' — PAX extended headers
    PaxGlobal    = 'g',
    Unknown      = 0xFF,
};

/// Metadata d'une entree TAR.
struct TarEntry {
    std::string  name;
    std::string  link_name;
    std::uint64_t size = 0;          ///< Taille du payload (octets)
    std::uint64_t decomp_offset = 0; ///< Offset decompresse au debut du payload
    std::uint32_t mode = 0;
    std::uint64_t mtime = 0;
    std::uint32_t uid = 0;
    std::uint32_t gid = 0;
    TarEntryType  type = TarEntryType::Unknown;
};

/// Statistiques pre-calculees d'une archive (cachees dans le header de l'index).
struct TarStats {
    std::uint64_t file_count        = 0;
    std::uint64_t dir_count         = 0;
    std::uint64_t link_count        = 0;
    std::uint64_t total_uncompressed = 0;
    std::uint64_t largest_bytes     = 0;
    std::string   largest_name;
};

/// Resultat d'une operation list/index.
struct TarIndex {
    std::filesystem::path archive_path;
    std::uint64_t archive_size = 0;
    std::uint64_t archive_mtime = 0;
    TarStats stats;
    std::vector<TarEntry> entries;

    /// Hashmap (name → index dans entries) — opt-in via rehash().
    /// Pas serialise : reconstruit a partir de entries au load.
    std::unordered_map<std::string, std::uint64_t> by_name;

    /// (Re)construit la hashmap by_name. O(N) en taille de l'index.
    void rehash();

    /// @return Pointeur vers l'entry, ou nullptr si absent.
    [[nodiscard]] const TarEntry* find(std::string_view name) const noexcept;
};

/// Reader streaming pour `.tar.zst`.
///
/// Toutes les operations sont sequentielles : ouvrent le fichier, decompressent
/// les frames zstd a la volee, parsent les headers tar (ustar / GNU LongName / PAX).
/// Pour des acces repetes, construire un index et l'utiliser pour borner les
/// scans (early-exit dans extract).
class TarZstdReader {
public:
    explicit TarZstdReader(const std::filesystem::path& archive_path);

    [[nodiscard]] bool ok() const noexcept { return ok_; }
    [[nodiscard]] const std::string& error() const noexcept { return error_; }
    [[nodiscard]] const std::filesystem::path& path() const noexcept { return path_; }

    /// Sink pour `read_payload_streaming` — appele plusieurs fois avec des chunks.
    /// Retourne true pour continuer, false pour annuler.
    using ChunkSink = std::function<bool(std::span<const std::uint8_t>)>;

    /// Streaming iteration : appelle `on_entry` pour chaque entree.
    /// `on_entry` retourne :
    ///   - true  : continuer (lit & saute le payload pour passer au suivant)
    ///   - false : arret immediat
    /// Le callback peut consommer le payload via `read_payload` (parametre
    /// optionnel). S'il ne le consomme pas, le reader saute automatiquement.
    using EntryCallback = std::function<bool(const TarEntry& entry,
                                             std::function<bool(std::span<std::uint8_t>)> read_payload)>;

    [[nodiscard]] bool for_each_entry(const EntryCallback& on_entry);

    /// Lit le payload de l'entree courante en chunks (memoire bornee).
    /// A appeler depuis un EntryCallback uniquement.
    [[nodiscard]] bool read_payload_streaming(const TarEntry& entry,
                                              const ChunkSink& sink,
                                              std::size_t chunk_size = 1u << 20);

    /// Construit l'index complet en un passage. O(N) sur la taille decompressee.
    /// Si `progress` est fourni, il est appele tous les `progress_every_bytes`
    /// avec (bytes_read_decompressed, entries_seen).
    using ProgressCallback = std::function<void(std::uint64_t bytes, std::uint64_t entries)>;

    [[nodiscard]] std::optional<TarIndex> build_index(
        const ProgressCallback& progress = {},
        std::uint64_t progress_every_bytes = 256ull << 20);

    /// Charge un index sidecar (.tar.zst.idx) si present et coherent.
    /// @return nullopt si absent / corrompu / desync (mtime ou size different).
    [[nodiscard]] static std::optional<TarIndex> load_index(
        const std::filesystem::path& archive_path);

    /// Sauvegarde un index dans `<archive>.idx`.
    [[nodiscard]] static bool save_index(const TarIndex& index);

    /// Lit le contenu d'une entree (premier match du nom). O(N) — re-stream.
    /// Si `prefilter_index` est fourni, retourne nullopt immediatement si le
    /// nom n'est pas dans l'index (evite un scan complet de 60GB pour un miss).
    [[nodiscard]] std::optional<std::vector<std::uint8_t>> read_one(
        std::string_view inner_path,
        const TarIndex* prefilter_index = nullptr);

    /// Streaming version : lit l'entree par chunks vers un sink (stdout, fichier).
    /// Aucune allocation > chunk_size. Compatible avec entries de plusieurs GB.
    [[nodiscard]] bool read_one_to(std::string_view inner_path,
                                   const ChunkSink& sink,
                                   std::size_t chunk_size = 1u << 20,
                                   const TarIndex* prefilter_index = nullptr);

    /// Extrait toutes les entrees matchant `predicate` vers `output_dir`.
    /// L'arborescence interne est preservee.
    /// @return Nombre de fichiers ecrits (-1 en cas d'erreur de stream).
    using ExtractPredicate = std::function<bool(const TarEntry&)>;

    [[nodiscard]] std::int64_t extract(const std::filesystem::path& output_dir,
                                       const ExtractPredicate& predicate);

    /// Recherche un pattern dans le contenu de toutes les entrees matchant le filtre.
    /// Utilise std::boyer_moore_searcher pour O(N+M) par entry.
    struct GrepHit {
        std::string entry_name;
        std::uint64_t offset_in_entry = 0;
        std::string preview;  ///< Quelques bytes autour du match (lisible).
    };

    [[nodiscard]] std::vector<GrepHit> grep(
        std::string_view needle,
        const ExtractPredicate& filter,
        std::size_t max_hits = 100,
        std::size_t preview_bytes = 32);

private:
    /// Lit un header tar (512 bytes) depuis le stream. @return type d'entree
    /// ou nullopt si EOF (deux blocs zero rencontres).
    [[nodiscard]] std::optional<TarEntry> read_header();

    /// Parse un header PAX et applique les overrides (path=, linkpath=, size=)
    /// sur l'entree suivante.
    [[nodiscard]] bool consume_pax_header(std::uint64_t pax_size);

    /// Saute le payload + padding 512 d'une entree.
    [[nodiscard]] bool skip_payload(const TarEntry& entry);

    std::filesystem::path path_;
    io::ZstdInputStream stream_;
    bool ok_ = false;
    std::string error_;

    // GNU LongName state (header type 'L' fournit le nom complet du suivant)
    std::string pending_long_name_;
    std::string pending_long_link_;
    // PAX state (header type 'x' fournit des overrides pour le suivant)
    std::string pending_pax_path_;
    std::string pending_pax_linkpath_;
    std::optional<std::uint64_t> pending_pax_size_;

    // Etat partage entre `for_each_entry` et `read_payload_streaming` :
    // marque le payload courant comme consomme pour que la boucle parente
    // ne le saute pas une seconde fois.
    bool payload_consumed_ = false;
};

/// Helper : conversion typeflag char → TarEntryType.
[[nodiscard]] TarEntryType typeflag_from_char(char c) noexcept;

/// Helper : nom court d'un type d'entree.
[[nodiscard]] std::string_view type_name(TarEntryType t) noexcept;

/// Helper : valide le checksum d'un header tar (512 bytes).
/// Le checksum est la somme non-signee des 512 bytes, le champ checksum
/// (offset 148, 8 bytes) etant compte comme 8 espaces.
[[nodiscard]] bool validate_tar_checksum(std::span<const std::uint8_t, 512> block) noexcept;

} // namespace iecode::archive
