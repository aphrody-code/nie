/// @file tar_zstd.cpp
/// Implementation de TarZstdReader : streaming sur fichier .tar.zst.

#include "iecode/archive/tar_zstd.h"

#include <spdlog/spdlog.h>

#include <algorithm>
#include <array>
#include <charconv>
#include <cstring>
#include <fstream>
#include <functional>

namespace fs = std::filesystem;

namespace iecode::archive {

namespace {

constexpr std::size_t k_block_size = 512;
constexpr std::array<char, 6> k_ustar_magic{'u','s','t','a','r',' '};
constexpr std::array<char, 6> k_posix_magic{'u','s','t','a','r','\0'};

constexpr std::uint32_t k_idx_magic   = 0x53'5A'45'49u;  // "IEZS"
constexpr std::uint32_t k_idx_version = 2u;              // v2 : ajoute TarStats

/// Parse un champ octal a longueur fixe (style tar : zero-padded, optionally
/// terminated by space or NUL).
template <typename T>
[[nodiscard]] T parse_octal(std::span<const std::uint8_t> field) noexcept {
    T value = 0;
    for (auto b : field) {
        if (b == ' ' || b == '\0') {
            if (value != 0) break;
            continue;
        }
        if (b < '0' || b > '7') break;
        value = (value << 3) + static_cast<T>(b - '0');
    }
    return value;
}

[[nodiscard]] std::string trim_nul(std::string_view raw) {
    const auto end = raw.find('\0');
    return std::string(end == std::string_view::npos ? raw : raw.substr(0, end));
}

[[nodiscard]] bool block_is_zero(const std::uint8_t* p) noexcept {
    for (std::size_t i = 0; i < k_block_size; ++i) {
        if (p[i] != 0) return false;
    }
    return true;
}

/// Calcule la taille avec padding 512.
[[nodiscard]] std::uint64_t padded_size(std::uint64_t size) noexcept {
    const std::uint64_t rem = size % k_block_size;
    return rem == 0 ? size : size + (k_block_size - rem);
}

/// Path traversal protection : refuse les noms contenant "..", absolus, ou vides.
[[nodiscard]] bool is_safe_relative(const fs::path& rel) noexcept {
    if (rel.is_absolute() || rel.empty()) return false;
    for (const auto& part : rel) {
        const auto& s = part.native();
        if (s == fs::path("..").native()) return false;
    }
    return true;
}

} // namespace

// ── Helpers publics ────────────────────────────────────────────────

TarEntryType typeflag_from_char(char c) noexcept {
    switch (c) {
        case '\0': case '0': return TarEntryType::File;
        case '1':            return TarEntryType::Hardlink;
        case '2':            return TarEntryType::Symlink;
        case '3':            return TarEntryType::CharDevice;
        case '4':            return TarEntryType::BlockDevice;
        case '5':            return TarEntryType::Directory;
        case '6':            return TarEntryType::Fifo;
        case 'L':            return TarEntryType::LongName;
        case 'K':            return TarEntryType::LongLink;
        case 'x':            return TarEntryType::PaxHeader;
        case 'g':            return TarEntryType::PaxGlobal;
        default:             return TarEntryType::Unknown;
    }
}

std::string_view type_name(TarEntryType t) noexcept {
    switch (t) {
        case TarEntryType::File:        return "file";
        case TarEntryType::Hardlink:    return "hardlink";
        case TarEntryType::Symlink:     return "symlink";
        case TarEntryType::CharDevice:  return "chardev";
        case TarEntryType::BlockDevice: return "blockdev";
        case TarEntryType::Directory:   return "dir";
        case TarEntryType::Fifo:        return "fifo";
        case TarEntryType::LongName:    return "gnu-long-name";
        case TarEntryType::LongLink:    return "gnu-long-link";
        case TarEntryType::PaxHeader:   return "pax-header";
        case TarEntryType::PaxGlobal:   return "pax-global";
        default:                        return "unknown";
    }
}

bool validate_tar_checksum(std::span<const std::uint8_t, 512> block) noexcept {
    // Le champ checksum est offset 148, 8 bytes. Doit etre traite comme 8 espaces.
    std::uint32_t signed_sum = 0;     // somme byte-par-byte non-signee (legacy ustar)
    std::int32_t  signed_alt  = 0;    // somme signee (rare mais existe)
    for (std::size_t i = 0; i < k_block_size; ++i) {
        std::uint8_t b = (i >= 148 && i < 156) ? std::uint8_t(' ') : block[i];
        signed_sum += b;
        signed_alt += static_cast<std::int8_t>(b);
    }
    const auto stored = parse_octal<std::uint32_t>({block.data() + 148, 8});
    return stored == signed_sum ||
           stored == static_cast<std::uint32_t>(signed_alt);
}

// ── TarIndex ───────────────────────────────────────────────────────

void TarIndex::rehash() {
    by_name.clear();
    by_name.reserve(entries.size() * 2);
    for (std::uint64_t i = 0; i < entries.size(); ++i) {
        by_name.emplace(entries[i].name, i);
    }
}

const TarEntry* TarIndex::find(std::string_view name) const noexcept {
    auto it = by_name.find(std::string(name));
    if (it == by_name.end()) return nullptr;
    return &entries[it->second];
}

// ── TarZstdReader ──────────────────────────────────────────────────

TarZstdReader::TarZstdReader(const fs::path& archive_path)
    : path_(archive_path),
      stream_(archive_path) {
    if (!stream_.ok()) {
        ok_ = false;
        error_ = stream_.error();
        return;
    }
    ok_ = true;
}

bool TarZstdReader::consume_pax_header(std::uint64_t pax_size) {
    // Format PAX : sequences de "<len> <key>=<value>\n", len inclut sa propre taille.
    std::vector<std::uint8_t> buf(pax_size);
    if (!stream_.read_exact(buf)) {
        ok_ = false; error_ = "stream tronque (PAX payload)"; return false;
    }
    const auto pad = padded_size(pax_size) - pax_size;
    if (pad && !stream_.skip(pad)) return false;

    // Parsing simple : on extrait les cles utiles uniquement.
    std::string_view sv(reinterpret_cast<const char*>(buf.data()), buf.size());
    std::size_t pos = 0;
    while (pos < sv.size()) {
        // <len> est un nombre decimal suivi d'un espace
        std::size_t sp = sv.find(' ', pos);
        if (sp == std::string_view::npos) break;
        std::uint64_t entry_len = 0;
        auto [ptr, ec] = std::from_chars(sv.data() + pos, sv.data() + sp,
                                          entry_len);
        (void)ptr;
        if (ec != std::errc{} || entry_len == 0 || pos + entry_len > sv.size()) {
            break;
        }
        // record entier : "<len> key=value\n"
        const std::string_view record = sv.substr(pos, entry_len);
        // Apres le premier espace, on a "key=value\n"
        const std::size_t eq = record.find('=', sp - pos);
        if (eq != std::string_view::npos) {
            const std::string_view key   = record.substr(sp - pos + 1, eq - (sp - pos + 1));
            // value se termine au '\n' final
            const std::size_t val_end = record.size() > 0 && record.back() == '\n'
                                          ? record.size() - 1 : record.size();
            const std::string_view value = record.substr(eq + 1, val_end - (eq + 1));
            if (key == "path") {
                pending_pax_path_.assign(value);
            } else if (key == "linkpath") {
                pending_pax_linkpath_.assign(value);
            } else if (key == "size") {
                std::uint64_t v = 0;
                std::from_chars(value.data(), value.data() + value.size(), v);
                pending_pax_size_ = v;
            }
        }
        pos += entry_len;
    }
    return true;
}

std::optional<TarEntry> TarZstdReader::read_header() {
    std::array<std::uint8_t, k_block_size> block{};

    if (!stream_.read_exact(block)) {
        if (stream_.eof()) return std::nullopt;
        ok_ = false;
        error_ = "stream tronque (header)";
        return std::nullopt;
    }

    if (block_is_zero(block.data())) {
        // Premier bloc zero : peut-etre EOF (deux blocs zero terminent l'archive).
        std::array<std::uint8_t, k_block_size> next{};
        if (!stream_.read_exact(next) || block_is_zero(next.data())) {
            return std::nullopt;
        }
        return std::nullopt;
    }

    // Validation checksum — refuse les headers corrompus.
    if (!validate_tar_checksum(block)) {
        ok_ = false;
        error_ = "checksum tar invalide";
        return std::nullopt;
    }

    TarEntry entry;
    entry.decomp_offset = stream_.decompressed_offset();

    const std::string_view name_field(reinterpret_cast<const char*>(block.data()), 100);
    const std::string_view prefix_field(reinterpret_cast<const char*>(block.data() + 345), 155);
    const std::string_view link_field(reinterpret_cast<const char*>(block.data() + 157), 100);

    entry.mode  = parse_octal<std::uint32_t>({block.data() + 100, 8});
    entry.uid   = parse_octal<std::uint32_t>({block.data() + 108, 8});
    entry.gid   = parse_octal<std::uint32_t>({block.data() + 116, 8});
    entry.size  = parse_octal<std::uint64_t>({block.data() + 124, 12});
    entry.mtime = parse_octal<std::uint64_t>({block.data() + 136, 12});

    const char typeflag = static_cast<char>(block[156]);
    entry.type = typeflag_from_char(typeflag);

    const std::span<const std::uint8_t, 6> magic{block.data() + 257, 6};
    const bool is_ustar =
        std::equal(magic.begin(), magic.end(), k_ustar_magic.begin()) ||
        std::equal(magic.begin(), magic.end(), k_posix_magic.begin());

    // Resoudre le nom : priorite PAX > GNU LongName > ustar prefix+name
    if (!pending_pax_path_.empty()) {
        entry.name = std::move(pending_pax_path_);
        pending_pax_path_.clear();
    } else if (!pending_long_name_.empty()) {
        entry.name = std::move(pending_long_name_);
        pending_long_name_.clear();
    } else if (is_ustar) {
        const std::string prefix = trim_nul(prefix_field);
        const std::string base   = trim_nul(name_field);
        entry.name = prefix.empty() ? base : (prefix + "/" + base);
    } else {
        entry.name = trim_nul(name_field);
    }

    if (!pending_pax_linkpath_.empty()) {
        entry.link_name = std::move(pending_pax_linkpath_);
        pending_pax_linkpath_.clear();
    } else if (!pending_long_link_.empty()) {
        entry.link_name = std::move(pending_long_link_);
        pending_long_link_.clear();
    } else {
        entry.link_name = trim_nul(link_field);
    }

    if (pending_pax_size_) {
        entry.size = *pending_pax_size_;
        pending_pax_size_.reset();
    }

    return entry;
}

bool TarZstdReader::skip_payload(const TarEntry& entry) {
    return stream_.skip(padded_size(entry.size));
}

bool TarZstdReader::read_payload_streaming(const TarEntry& entry,
                                           const ChunkSink& sink,
                                           std::size_t chunk_size) {
    if (chunk_size == 0) chunk_size = 1u << 20;
    // Marque le payload comme consomme — empeche `for_each_entry` de double-skip.
    payload_consumed_ = true;

    std::vector<std::uint8_t> buf(chunk_size);
    std::uint64_t remaining = entry.size;
    while (remaining > 0) {
        const std::size_t n = static_cast<std::size_t>(
            std::min<std::uint64_t>(remaining, chunk_size));
        std::span<std::uint8_t> slice(buf.data(), n);
        if (!stream_.read_exact(slice)) {
            ok_ = false; error_ = "stream tronque (payload)"; return false;
        }
        if (!sink({slice.data(), n})) {
            // L'utilisateur annule — il faut quand meme skip le reste pour
            // que le stream pointe sur le prochain header.
            const std::uint64_t left = remaining - n;
            const std::uint64_t pad  = padded_size(entry.size) - entry.size;
            if (left + pad > 0 && !stream_.skip(left + pad)) return false;
            return false;
        }
        remaining -= n;
    }
    const std::uint64_t pad = padded_size(entry.size) - entry.size;
    if (pad && !stream_.skip(pad)) return false;
    return true;
}

bool TarZstdReader::for_each_entry(const EntryCallback& on_entry) {
    if (!ok_) return false;

    while (auto entry = read_header()) {
        // Headers d'extension : consommes silencieusement, on boucle.
        if (entry->type == TarEntryType::LongName) {
            std::vector<std::uint8_t> buf(entry->size);
            if (!stream_.read_exact(buf)) {
                ok_ = false; error_ = "stream tronque (LongName payload)"; return false;
            }
            const auto pad = padded_size(entry->size) - entry->size;
            if (pad && !stream_.skip(pad)) return false;
            pending_long_name_ = trim_nul(
                std::string_view(reinterpret_cast<const char*>(buf.data()), buf.size()));
            continue;
        }
        if (entry->type == TarEntryType::LongLink) {
            std::vector<std::uint8_t> buf(entry->size);
            if (!stream_.read_exact(buf)) {
                ok_ = false; error_ = "stream tronque (LongLink payload)"; return false;
            }
            const auto pad = padded_size(entry->size) - entry->size;
            if (pad && !stream_.skip(pad)) return false;
            pending_long_link_ = trim_nul(
                std::string_view(reinterpret_cast<const char*>(buf.data()), buf.size()));
            continue;
        }
        if (entry->type == TarEntryType::PaxHeader) {
            if (!consume_pax_header(entry->size)) return false;
            continue;
        }
        if (entry->type == TarEntryType::PaxGlobal) {
            // PAX global : on ignore (apply only to subsequent entries).
            if (!skip_payload(*entry)) return false;
            continue;
        }

        // Reset l'etat de consommation pour cette entry. Le flag est
        // partage avec `read_payload_streaming` : si l'utilisateur l'invoque
        // directement, le flag passe a true et le double-skip est evite.
        payload_consumed_ = false;

        auto reader = [&](std::span<std::uint8_t> dst) -> bool {
            if (payload_consumed_) return false;
            payload_consumed_ = true;
            const auto n = stream_.read(dst);
            const std::uint64_t remaining = entry->size - n;
            const std::uint64_t pad = padded_size(entry->size) - entry->size;
            if (n != dst.size() || remaining + pad > 0) {
                if (!stream_.skip(remaining + pad)) return false;
            }
            return true;
        };

        const bool keep_going = on_entry(*entry, reader);

        if (!payload_consumed_) {
            if (!skip_payload(*entry)) return false;
        }

        if (!keep_going) break;
    }

    return ok_;
}

std::optional<TarIndex> TarZstdReader::build_index(
    const ProgressCallback& progress,
    std::uint64_t progress_every_bytes) {
    if (!ok_) return std::nullopt;

    TarIndex idx;
    idx.archive_path = path_;
    std::error_code ec;
    idx.archive_size = fs::file_size(path_, ec);
    if (ec) {
        ok_ = false;
        error_ = "impossible de lire la taille du fichier";
        return std::nullopt;
    }
    auto ftime = fs::last_write_time(path_, ec);
    if (!ec) {
        idx.archive_mtime = static_cast<std::uint64_t>(
            ftime.time_since_epoch().count());
    }

    std::uint64_t last_progress_at = 0;

    const bool ok = for_each_entry([&](const TarEntry& e, auto /*reader*/) {
        // Stats globales
        switch (e.type) {
            case TarEntryType::File:
                ++idx.stats.file_count;
                idx.stats.total_uncompressed += e.size;
                if (e.size > idx.stats.largest_bytes) {
                    idx.stats.largest_bytes = e.size;
                    idx.stats.largest_name  = e.name;
                }
                break;
            case TarEntryType::Directory: ++idx.stats.dir_count; break;
            case TarEntryType::Symlink:
            case TarEntryType::Hardlink:  ++idx.stats.link_count; break;
            default: break;
        }

        idx.entries.push_back(e);

        if (progress) {
            const auto cur = stream_.decompressed_offset();
            if (cur - last_progress_at >= progress_every_bytes) {
                last_progress_at = cur;
                progress(cur, idx.entries.size());
            }
        }
        return true;
    });

    if (!ok) return std::nullopt;
    if (progress) progress(stream_.decompressed_offset(), idx.entries.size());
    idx.rehash();
    return idx;
}

std::optional<TarIndex> TarZstdReader::load_index(const fs::path& archive_path) {
    const auto idx_path = fs::path(archive_path).concat(".idx");
    std::ifstream f(idx_path, std::ios::binary);
    if (!f) return std::nullopt;

    auto read_u32 = [&]() -> std::uint32_t {
        std::array<std::uint8_t, 4> b{};
        f.read(reinterpret_cast<char*>(b.data()), 4);
        if (f.gcount() != 4) return 0;
        return std::uint32_t(b[0]) | (std::uint32_t(b[1]) << 8) |
               (std::uint32_t(b[2]) << 16) | (std::uint32_t(b[3]) << 24);
    };
    auto read_u64 = [&]() -> std::uint64_t {
        std::array<std::uint8_t, 8> b{};
        f.read(reinterpret_cast<char*>(b.data()), 8);
        if (f.gcount() != 8) return 0;
        std::uint64_t v = 0;
        for (int i = 0; i < 8; ++i) v |= std::uint64_t(b[i]) << (i * 8);
        return v;
    };
    auto read_u16 = [&]() -> std::uint16_t {
        std::array<std::uint8_t, 2> b{};
        f.read(reinterpret_cast<char*>(b.data()), 2);
        if (f.gcount() != 2) return 0;
        return std::uint16_t(b[0]) | std::uint16_t(b[1] << 8);
    };
    auto read_str = [&](std::uint32_t n) -> std::string {
        std::string s(n, '\0');
        f.read(s.data(), n);
        if (static_cast<std::uint32_t>(f.gcount()) != n) return {};
        return s;
    };

    if (read_u32() != k_idx_magic) return std::nullopt;
    const auto version = read_u32();
    if (version != k_idx_version) return std::nullopt;

    TarIndex idx;
    idx.archive_path = archive_path;
    idx.archive_size = read_u64();
    idx.archive_mtime = read_u64();

    // Stats v2 : header inclus avant les entries
    idx.stats.file_count         = read_u64();
    idx.stats.dir_count          = read_u64();
    idx.stats.link_count         = read_u64();
    idx.stats.total_uncompressed = read_u64();
    idx.stats.largest_bytes      = read_u64();
    idx.stats.largest_name       = read_str(read_u16());

    const auto count = read_u64();

    std::error_code ec;
    const auto current_size = fs::file_size(archive_path, ec);
    if (ec || current_size != idx.archive_size) return std::nullopt;

    idx.entries.reserve(count);
    for (std::uint64_t i = 0; i < count; ++i) {
        TarEntry e;
        e.size          = read_u64();
        e.decomp_offset = read_u64();
        e.mtime         = read_u64();
        e.mode          = read_u32();
        e.uid           = read_u32();
        e.gid           = read_u32();
        e.type          = static_cast<TarEntryType>(read_u32() & 0xFF);
        e.name          = read_str(read_u16());
        e.link_name     = read_str(read_u16());
        if (!f) return std::nullopt;
        idx.entries.push_back(std::move(e));
    }

    idx.rehash();
    return idx;
}

bool TarZstdReader::save_index(const TarIndex& index) {
    const auto idx_path = fs::path(index.archive_path).concat(".idx");
    std::ofstream f(idx_path, std::ios::binary | std::ios::trunc);
    if (!f) return false;

    auto write_u32 = [&](std::uint32_t v) {
        const std::array<std::uint8_t, 4> b{
            std::uint8_t(v), std::uint8_t(v >> 8),
            std::uint8_t(v >> 16), std::uint8_t(v >> 24)};
        f.write(reinterpret_cast<const char*>(b.data()), 4);
    };
    auto write_u64 = [&](std::uint64_t v) {
        std::array<std::uint8_t, 8> b{};
        for (int i = 0; i < 8; ++i) b[i] = std::uint8_t(v >> (i * 8));
        f.write(reinterpret_cast<const char*>(b.data()), 8);
    };
    auto write_u16 = [&](std::uint16_t v) {
        const std::array<std::uint8_t, 2> b{std::uint8_t(v), std::uint8_t(v >> 8)};
        f.write(reinterpret_cast<const char*>(b.data()), 2);
    };
    auto write_str = [&](std::string_view s) {
        const auto n = static_cast<std::uint16_t>(std::min<std::size_t>(s.size(), 0xFFFF));
        write_u16(n);
        f.write(s.data(), n);
    };

    write_u32(k_idx_magic);
    write_u32(k_idx_version);
    write_u64(index.archive_size);
    write_u64(index.archive_mtime);

    // Stats v2
    write_u64(index.stats.file_count);
    write_u64(index.stats.dir_count);
    write_u64(index.stats.link_count);
    write_u64(index.stats.total_uncompressed);
    write_u64(index.stats.largest_bytes);
    write_str(index.stats.largest_name);

    write_u64(index.entries.size());

    for (const auto& e : index.entries) {
        write_u64(e.size);
        write_u64(e.decomp_offset);
        write_u64(e.mtime);
        write_u32(e.mode);
        write_u32(e.uid);
        write_u32(e.gid);
        write_u32(static_cast<std::uint32_t>(e.type));
        write_str(e.name);
        write_str(e.link_name);
    }

    return f.good();
}

std::optional<std::vector<std::uint8_t>> TarZstdReader::read_one(
    std::string_view inner_path,
    const TarIndex* prefilter_index) {
    if (!ok_) return std::nullopt;

    if (prefilter_index && prefilter_index->find(inner_path) == nullptr) {
        return std::nullopt;
    }

    std::optional<std::vector<std::uint8_t>> result;

    (void)for_each_entry([&](const TarEntry& entry, auto read_payload) {
        if (entry.name != inner_path) return true;
        std::vector<std::uint8_t> buf(entry.size);
        if (!read_payload(buf)) return false;
        result = std::move(buf);
        return false; // stop
    });

    return result;
}

bool TarZstdReader::read_one_to(std::string_view inner_path,
                                const ChunkSink& sink,
                                std::size_t chunk_size,
                                const TarIndex* prefilter_index) {
    if (!ok_) return false;

    if (prefilter_index && prefilter_index->find(inner_path) == nullptr) {
        return false;
    }

    bool found = false;

    (void)for_each_entry([&](const TarEntry& entry, auto /*read_payload*/) {
        if (entry.name != inner_path) return true;
        // On utilise read_payload_streaming directement pour bypasser la
        // semantique "consume tout d'un coup" du callback synchrone.
        found = read_payload_streaming(entry, sink, chunk_size);
        return false;
    });

    return found;
}

std::int64_t TarZstdReader::extract(const fs::path& output_dir,
                                    const ExtractPredicate& predicate) {
    if (!ok_) return -1;

    std::error_code ec;
    fs::create_directories(output_dir, ec);

    std::int64_t written = 0;
    bool stream_error = false;

    (void)for_each_entry([&](const TarEntry& entry, auto /*read_payload*/) {
        if (entry.type != TarEntryType::File) return true;
        if (predicate && !predicate(entry)) return true;

        const fs::path rel = fs::path(entry.name).lexically_normal();
        if (!is_safe_relative(rel)) {
            spdlog::warn("archive: nom suspect ignore: '{}'", entry.name);
            return true;
        }
        const fs::path out_path = output_dir / rel;
        std::error_code ec2;
        fs::create_directories(out_path.parent_path(), ec2);

        std::ofstream out(out_path, std::ios::binary | std::ios::trunc);
        if (!out) {
            spdlog::warn("archive: ecriture impossible: '{}'", out_path.string());
            return true;  // skip — ne consomme pas le payload, sera saute
        }

        // Streaming write : pas de buffer en RAM pour les gros fichiers
        const bool sink_ok = read_payload_streaming(
            entry,
            [&](std::span<const std::uint8_t> chunk) {
                out.write(reinterpret_cast<const char*>(chunk.data()),
                          static_cast<std::streamsize>(chunk.size()));
                return out.good();
            });

        if (!sink_ok) {
            spdlog::warn("archive: ecriture incomplete: '{}'", out_path.string());
            stream_error = true;
            return false;
        }
        ++written;
        return true;
    });

    if (stream_error) return -1;
    return written;
}

std::vector<TarZstdReader::GrepHit> TarZstdReader::grep(
    std::string_view needle,
    const ExtractPredicate& filter,
    std::size_t max_hits,
    std::size_t preview_bytes) {
    std::vector<GrepHit> hits;
    if (!ok_ || needle.empty()) return hits;

    // boyer_moore_searcher exige que les value_type des deux ranges matchent.
    // On construit le needle en vector<uint8_t> pour s'aligner sur le buffer.
    const std::vector<std::uint8_t> needle_owned(
        reinterpret_cast<const std::uint8_t*>(needle.data()),
        reinterpret_cast<const std::uint8_t*>(needle.data()) + needle.size());
    const std::boyer_moore_searcher searcher(needle_owned.begin(), needle_owned.end());

    (void)for_each_entry([&](const TarEntry& entry, auto /*read_payload*/) {
        if (entry.type != TarEntryType::File) return true;
        if (filter && !filter(entry)) return true;
        if (hits.size() >= max_hits) return false;

        // Lit l'entry en chunks. Pour matcher cross-chunk, on retient les
        // (needle.size() - 1) derniers bytes en debut du chunk suivant.
        std::vector<std::uint8_t> buf;
        buf.reserve(needle_owned.size() * 2);
        std::uint64_t chunk_offset = 0;

        bool entry_done = false;
        const bool ok = read_payload_streaming(
            entry,
            [&](std::span<const std::uint8_t> chunk) {
                if (entry_done) return true;

                buf.insert(buf.end(), chunk.begin(), chunk.end());
                auto it = std::search(buf.begin(), buf.end(), searcher);
                while (it != buf.end()) {
                    GrepHit h;
                    h.entry_name = entry.name;
                    const auto pos = static_cast<std::uint64_t>(it - buf.begin());
                    h.offset_in_entry = chunk_offset - (buf.size() - chunk.size()) + pos;
                    // Preview lisible : on remplace les non-printables par '.'
                    const std::size_t start = pos > preview_bytes ? pos - preview_bytes : 0;
                    const std::size_t end   = std::min(buf.size(), pos + needle_owned.size() + preview_bytes);
                    std::string preview(buf.begin() + start, buf.begin() + end);
                    for (auto& c : preview) {
                        if (static_cast<unsigned char>(c) < 0x20 || c == 0x7F) c = '.';
                    }
                    h.preview = std::move(preview);
                    hits.push_back(std::move(h));
                    if (hits.size() >= max_hits) {
                        entry_done = true;
                        return false;
                    }
                    it = std::search(it + needle_owned.size(), buf.end(), searcher);
                }
                // Garde la fin du buffer pour matcher cross-chunk
                if (buf.size() > needle_owned.size() - 1) {
                    chunk_offset += buf.size() - (needle_owned.size() - 1);
                    buf.erase(buf.begin(),
                              buf.end() - static_cast<std::ptrdiff_t>(needle_owned.size() - 1));
                }
                return true;
            });

        (void)ok;
        return hits.size() < max_hits;
    });

    return hits;
}

} // namespace iecode::archive
