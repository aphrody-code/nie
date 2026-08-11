/// @file archive_cmd.cpp
/// Commande CLI 'archive' — exploration streaming des archives .tar.zst.
///
/// Sous-commandes :
///   iecode archive list    <file.tar.zst> [--filter pat] [--limit N] [--use-index] [--table]
///   iecode archive info    <file.tar.zst> [--use-index]
///   iecode archive cat     <file.tar.zst> <inner_path>          (streaming stdout)
///   iecode archive read    <file.tar.zst> <inner_path> -o <out> (streaming write)
///   iecode archive extract <file.tar.zst> -o <dir> [--filter pat]
///   iecode archive grep    <file.tar.zst> <pattern> [--filter pat] [--max N]
///   iecode archive index   <file.tar.zst> [--no-progress]
///
/// Implementation :
///   - Streaming zstd → tar parsing → callback par entree.
///   - Aucune materialisation du tar decompresse : 60 GB possible sur 8 GB de RAM.
///   - Index sidecar `.idx` (header avec stats cachees + entries).
///   - cat/read en streaming chunked : zero allocation > 1 MB.
///   - grep avec boyer_moore_searcher, support cross-chunk.

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/archive/tar_zstd.h"

#include <CLI/CLI.hpp>
#include <fmt/format.h>
#include <spdlog/spdlog.h>

#include <chrono>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <optional>
#include <string>
#include <unordered_set>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

namespace {

[[nodiscard]] json entry_to_json(const archive::TarEntry& e) {
    return json{
        {"name", e.name},
        {"size", e.size},
        {"type", std::string(archive::type_name(e.type))},
        {"mode", e.mode},
        {"mtime", e.mtime},
        {"offset", e.decomp_offset},
    };
}

/// Charge l'index sidecar si dispo+coherent, sinon construit + sauve.
[[nodiscard]] std::optional<archive::TarIndex> load_or_build_index(
    const fs::path& path, bool quiet = false) {
    if (auto cached = archive::TarZstdReader::load_index(path)) {
        if (!quiet) {
            spdlog::info("archive: index sidecar charge ({} entrees)", cached->entries.size());
        }
        return cached;
    }
    if (!quiet) spdlog::info("archive: aucun index — scan complet en cours...");
    archive::TarZstdReader reader(path);
    if (!reader.ok()) return std::nullopt;
    auto idx = reader.build_index();
    if (!idx) return std::nullopt;
    if (!archive::TarZstdReader::save_index(*idx)) {
        spdlog::warn("archive: impossible d'ecrire l'index sidecar");
    }
    return idx;
}

[[nodiscard]] bool ensure_input(const fs::path& path) {
    if (!fs::exists(path) || !fs::is_regular_file(path)) {
        emit_error(fmt::format("fichier introuvable : '{}'", path.string()));
        return false;
    }
    return true;
}

/// Format human-readable bytes (KB/MB/GB).
[[nodiscard]] std::string fmt_bytes(std::uint64_t n) {
    constexpr std::array<const char*, 5> units{"B", "KB", "MB", "GB", "TB"};
    double v = static_cast<double>(n);
    std::size_t u = 0;
    while (v >= 1024.0 && u + 1 < units.size()) { v /= 1024.0; ++u; }
    return fmt::format("{:.1f} {}", v, units[u]);
}

} // namespace

// ── list ──────────────────────────────────────────────────────────

static void cmd_archive_list(const std::string& input,
                             const std::string& filter,
                             std::uint32_t limit,
                             bool use_index,
                             bool table) {
    const fs::path path(input);
    if (!ensure_input(path)) return;

    auto t0 = std::chrono::steady_clock::now();

    std::vector<archive::TarEntry> entries;
    std::uint64_t total_bytes = 0;

    if (use_index) {
        auto idx = load_or_build_index(path);
        if (!idx) { emit_error("echec chargement/construction de l'index"); return; }
        for (auto& e : idx->entries) {
            if (e.type != archive::TarEntryType::File) continue;
            if (!filter.empty() && !glob_match(filter, e.name)) continue;
            total_bytes += e.size;
            entries.push_back(std::move(e));
        }
    } else {
        archive::TarZstdReader reader(path);
        if (!reader.ok()) { emit_error(reader.error()); return; }

        (void)reader.for_each_entry([&](const archive::TarEntry& e, auto /*read_payload*/) {
            if (e.type != archive::TarEntryType::File) return true;
            if (!filter.empty() && !glob_match(filter, e.name)) return true;
            total_bytes += e.size;
            entries.push_back(e);
            return entries.size() < limit;
        });
    }

    auto t1 = std::chrono::steady_clock::now();
    const auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

    const std::size_t shown = std::min<std::size_t>(limit, entries.size());

    if (table) {
        // Format texte plain (humain)
        fmt::print("{:>12}  {:<60}\n", "size", "name");
        fmt::print("{:>12}  {:<60}\n", "------------", "------");
        for (std::size_t i = 0; i < shown; ++i) {
            fmt::print("{:>12}  {}\n", fmt_bytes(entries[i].size), entries[i].name);
        }
        fmt::print("\n{} entries, {} (showing {})\n",
                   entries.size(), fmt_bytes(total_bytes), shown);
        return;
    }

    auto items = json::array();
    for (std::size_t i = 0; i < shown; ++i) {
        items.push_back(entry_to_json(entries[i]));
    }

    emit(json{
        {"ok", true},
        {"archive", path.filename().string()},
        {"matched", entries.size()},
        {"shown", shown},
        {"limit", limit},
        {"total_bytes", total_bytes},
        {"used_index", use_index},
        {"elapsed_ms", elapsed_ms},
        {"entries", std::move(items)},
    });
}

// ── info ──────────────────────────────────────────────────────────

static void cmd_archive_info(const std::string& input, bool use_index) {
    const fs::path path(input);
    if (!ensure_input(path)) return;

    auto t0 = std::chrono::steady_clock::now();

    archive::TarStats stats;

    if (use_index) {
        auto idx = load_or_build_index(path);
        if (!idx) { emit_error("echec chargement/construction de l'index"); return; }
        stats = idx->stats;
    } else {
        archive::TarZstdReader reader(path);
        if (!reader.ok()) { emit_error(reader.error()); return; }
        (void)reader.for_each_entry([&](const archive::TarEntry& e, auto) {
            switch (e.type) {
                case archive::TarEntryType::File:
                    ++stats.file_count;
                    stats.total_uncompressed += e.size;
                    if (e.size > stats.largest_bytes) {
                        stats.largest_bytes = e.size;
                        stats.largest_name = e.name;
                    }
                    break;
                case archive::TarEntryType::Directory: ++stats.dir_count; break;
                case archive::TarEntryType::Symlink:
                case archive::TarEntryType::Hardlink:  ++stats.link_count; break;
                default: break;
            }
            return true;
        });
    }

    auto t1 = std::chrono::steady_clock::now();
    const auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

    std::error_code ec;
    const auto compressed_size = fs::file_size(path, ec);

    emit(json{
        {"ok", true},
        {"archive", path.filename().string()},
        {"compressed_size", compressed_size},
        {"file_count", stats.file_count},
        {"dir_count", stats.dir_count},
        {"link_count", stats.link_count},
        {"total_uncompressed", stats.total_uncompressed},
        {"compression_ratio",
            stats.total_uncompressed
                ? static_cast<double>(compressed_size) / static_cast<double>(stats.total_uncompressed)
                : 0.0},
        {"largest_entry", stats.largest_name},
        {"largest_bytes", stats.largest_bytes},
        {"used_index", use_index},
        {"elapsed_ms", elapsed_ms},
    });
}

// ── cat / read (streaming) ────────────────────────────────────────

static void cmd_archive_read_streaming(const std::string& input,
                                       const std::string& inner_path,
                                       const std::string& output_path) {
    const fs::path path(input);
    if (!ensure_input(path)) return;

    archive::TarZstdReader reader(path);
    if (!reader.ok()) { emit_error(reader.error()); return; }

    // Si un index est dispo, on prefiltre pour eviter de scanner 60GB pour rien.
    auto cached_index = archive::TarZstdReader::load_index(path);
    const archive::TarIndex* idx_ptr = cached_index ? &*cached_index : nullptr;

    std::uint64_t bytes_written = 0;

    if (output_path == "-") {
        const bool ok = reader.read_one_to(
            inner_path,
            [&](std::span<const std::uint8_t> chunk) {
                std::fwrite(chunk.data(), 1, chunk.size(), stdout);
                bytes_written += chunk.size();
                return true;
            },
            1u << 20,
            idx_ptr);
        std::fflush(stdout);
        if (!ok) {
            // Sortie binaire — on n'emet pas de JSON sur stdout.
            spdlog::error("archive: entree introuvable ou stream tronque: '{}'", inner_path);
        }
        return;
    }

    std::ofstream out(output_path, std::ios::binary | std::ios::trunc);
    if (!out) {
        emit_error(fmt::format("ecriture impossible: '{}'", output_path));
        return;
    }

    const bool ok = reader.read_one_to(
        inner_path,
        [&](std::span<const std::uint8_t> chunk) {
            out.write(reinterpret_cast<const char*>(chunk.data()),
                      static_cast<std::streamsize>(chunk.size()));
            bytes_written += chunk.size();
            return out.good();
        },
        1u << 20,
        idx_ptr);

    if (!ok) {
        emit_error(fmt::format("entree introuvable ou ecriture echouee: '{}'", inner_path));
        return;
    }

    emit(json{
        {"ok", true},
        {"path", inner_path},
        {"output", output_path},
        {"size", bytes_written},
    });
}

// ── extract ───────────────────────────────────────────────────────

static void cmd_archive_extract(const std::string& input,
                                const std::string& output_dir,
                                const std::string& filter,
                                const std::string& include_from) {
    const fs::path path(input);
    if (!ensure_input(path)) return;

    archive::TarZstdReader reader(path);
    if (!reader.ok()) { emit_error(reader.error()); return; }

    auto t0 = std::chrono::steady_clock::now();

    // include-from : un path exact par ligne. Lignes vides + '#' ignorees.
    std::unordered_set<std::string> include_set;
    if (!include_from.empty()) {
        std::ifstream f(include_from);
        if (!f) {
            emit_error(fmt::format("include-from introuvable: '{}'", include_from));
            return;
        }
        std::string line;
        while (std::getline(f, line)) {
            // strip CR (CRLF Windows)
            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (line.empty() || line[0] == '#') continue;
            include_set.insert(std::move(line));
        }
        if (include_set.empty()) {
            emit_error("include-from est vide");
            return;
        }
    }

    archive::TarZstdReader::ExtractPredicate pred;
    if (!include_set.empty() && !filter.empty()) {
        pred = [&include_set, &filter](const archive::TarEntry& e) {
            return include_set.contains(e.name) || glob_match(filter, e.name);
        };
    } else if (!include_set.empty()) {
        pred = [&include_set](const archive::TarEntry& e) {
            return include_set.contains(e.name);
        };
    } else if (!filter.empty()) {
        pred = [&filter](const archive::TarEntry& e) {
            return glob_match(filter, e.name);
        };
    }

    const auto written = reader.extract(fs::path(output_dir), pred);

    auto t1 = std::chrono::steady_clock::now();
    const auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

    if (written < 0) {
        emit_error(reader.error().empty() ? "extraction echouee" : reader.error());
        return;
    }

    emit(json{
        {"ok", true},
        {"archive", path.filename().string()},
        {"output", output_dir},
        {"extracted", written},
        {"filter", filter},
        {"include_from", include_from},
        {"include_count", include_set.size()},
        {"elapsed_ms", elapsed_ms},
    });
}

// ── grep ──────────────────────────────────────────────────────────

static void cmd_archive_grep(const std::string& input,
                             const std::string& pattern,
                             const std::string& filter,
                             std::uint32_t max_hits,
                             std::uint32_t preview_bytes) {
    const fs::path path(input);
    if (!ensure_input(path)) return;
    if (pattern.empty()) {
        emit_error("pattern vide");
        return;
    }

    archive::TarZstdReader reader(path);
    if (!reader.ok()) { emit_error(reader.error()); return; }

    auto t0 = std::chrono::steady_clock::now();

    archive::TarZstdReader::ExtractPredicate pred;
    if (!filter.empty()) {
        pred = [&filter](const archive::TarEntry& e) {
            return glob_match(filter, e.name);
        };
    }

    auto hits = reader.grep(pattern, pred, max_hits, preview_bytes);

    auto t1 = std::chrono::steady_clock::now();
    const auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

    auto items = json::array();
    for (const auto& h : hits) {
        items.push_back(json{
            {"name", h.entry_name},
            {"offset", h.offset_in_entry},
            {"preview", h.preview},
        });
    }

    emit(json{
        {"ok", true},
        {"archive", path.filename().string()},
        {"pattern", pattern},
        {"filter", filter},
        {"hits", static_cast<std::uint64_t>(hits.size())},
        {"max_hits", max_hits},
        {"elapsed_ms", elapsed_ms},
        {"results", std::move(items)},
    });
}

// ── index ─────────────────────────────────────────────────────────

static void cmd_archive_index(const std::string& input, bool show_progress) {
    const fs::path path(input);
    if (!ensure_input(path)) return;

    auto t0 = std::chrono::steady_clock::now();

    archive::TarZstdReader reader(path);
    if (!reader.ok()) { emit_error(reader.error()); return; }

    archive::TarZstdReader::ProgressCallback progress;
    if (show_progress) {
        progress = [&](std::uint64_t bytes, std::uint64_t entries) {
            spdlog::info("archive: indexation... {} / {} entrees",
                         fmt_bytes(bytes), entries);
        };
    }

    auto idx = reader.build_index(progress);
    if (!idx) { emit_error(reader.error()); return; }

    if (!archive::TarZstdReader::save_index(*idx)) {
        emit_error("ecriture index sidecar echouee");
        return;
    }

    auto t1 = std::chrono::steady_clock::now();
    const auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

    std::error_code ec;
    const auto idx_size = fs::file_size(fs::path(path).concat(".idx"), ec);

    emit(json{
        {"ok", true},
        {"archive", path.filename().string()},
        {"index_path", fs::path(path).concat(".idx").string()},
        {"index_size", idx_size},
        {"entries", idx->entries.size()},
        {"file_count", idx->stats.file_count},
        {"total_uncompressed", idx->stats.total_uncompressed},
        {"archive_size", idx->archive_size},
        {"elapsed_ms", elapsed_ms},
    });
}

// ── Registration ──────────────────────────────────────────────────

void register_archive_command(CLI::App& app) {
    auto* root = app.add_subcommand("archive",
        "Explorer les archives .tar.zst en streaming (sans extraction)");
    root->require_subcommand(1);

    // ── archive list ───────────────────────────────────────────────
    {
        auto* sub = root->add_subcommand("list",
            "Liste les entrees d'une archive .tar.zst");
        static std::string input;
        static std::string filter;
        static std::uint32_t limit = 1000;
        static bool use_index = false;
        static bool table = false;
        sub->add_option("input", input, "Archive .tar.zst")->required();
        sub->add_option("--filter", filter, "Pattern glob sur le nom (ex: *.cpk)");
        sub->add_option("-l,--limit", limit, "Nombre max d'entrees affichees")->default_val(1000);
        sub->add_flag("--use-index", use_index,
            "Utiliser/construire l'index sidecar .idx (rapide en re-acces)");
        sub->add_flag("--table", table, "Sortie tabulaire texte (au lieu de JSON)");
        sub->callback([]() { cmd_archive_list(input, filter, limit, use_index, table); });
    }

    // ── archive info ───────────────────────────────────────────────
    {
        auto* sub = root->add_subcommand("info",
            "Statistiques globales d'une archive .tar.zst");
        static std::string input;
        static bool use_index = false;
        sub->add_option("input", input, "Archive .tar.zst")->required();
        sub->add_flag("--use-index", use_index,
            "Utiliser/construire l'index sidecar .idx (instantane si .idx present)");
        sub->callback([]() { cmd_archive_info(input, use_index); });
    }

    // ── archive cat ────────────────────────────────────────────────
    {
        auto* sub = root->add_subcommand("cat",
            "Ecrit le contenu d'une entree sur stdout (streaming binaire)");
        static std::string input;
        static std::string inner;
        sub->add_option("input", input, "Archive .tar.zst")->required();
        sub->add_option("path", inner, "Chemin interne dans l'archive")->required();
        sub->callback([]() { cmd_archive_read_streaming(input, inner, "-"); });
    }

    // ── archive read ───────────────────────────────────────────────
    {
        auto* sub = root->add_subcommand("read",
            "Extrait une entree unique vers un fichier (streaming)");
        static std::string input;
        static std::string inner;
        static std::string output;
        sub->add_option("input", input, "Archive .tar.zst")->required();
        sub->add_option("path", inner, "Chemin interne dans l'archive")->required();
        sub->add_option("-o,--output", output, "Fichier de sortie")->required();
        sub->callback([]() { cmd_archive_read_streaming(input, inner, output); });
    }

    // ── archive extract ────────────────────────────────────────────
    {
        auto* sub = root->add_subcommand("extract",
            "Extrait l'archive (ou un sous-ensemble par filtre) vers un dossier");
        static std::string input;
        static std::string output;
        static std::string filter;
        static std::string include_from;
        sub->add_option("input", input, "Archive .tar.zst")->required();
        sub->add_option("-o,--output", output, "Dossier de sortie")->required();
        sub->add_option("--filter", filter, "Pattern glob (ex: *.g4tx)");
        sub->add_option("--include-from", include_from,
            "Fichier liste (un path exact par ligne, # = commentaire)");
        sub->callback([]() { cmd_archive_extract(input, output, filter, include_from); });
    }

    // ── archive grep ───────────────────────────────────────────────
    {
        auto* sub = root->add_subcommand("grep",
            "Recherche un pattern litteral dans le contenu des entrees");
        static std::string input;
        static std::string pattern;
        static std::string filter;
        static std::uint32_t max_hits = 100;
        static std::uint32_t preview_bytes = 32;
        sub->add_option("input", input, "Archive .tar.zst")->required();
        sub->add_option("pattern", pattern, "Sequence de bytes a rechercher")->required();
        sub->add_option("--filter", filter, "Glob sur le nom (ex: *.json)");
        sub->add_option("--max", max_hits, "Nombre max de hits")->default_val(100);
        sub->add_option("--preview", preview_bytes,
                         "Bytes de preview autour du match")->default_val(32);
        sub->callback([]() { cmd_archive_grep(input, pattern, filter, max_hits, preview_bytes); });
    }

    // ── archive index ──────────────────────────────────────────────
    {
        auto* sub = root->add_subcommand("index",
            "Force la construction de l'index sidecar <archive>.idx");
        static std::string input;
        static bool no_progress = false;
        sub->add_option("input", input, "Archive .tar.zst")->required();
        sub->add_flag("--no-progress", no_progress, "Desactive le log de progression");
        sub->callback([]() { cmd_archive_index(input, !no_progress); });
    }
}

} // namespace iecode::cli
