/// @file test_archive.cpp
/// Tests GTest pour iecode::archive (TarZstdReader, ZstdInputStream, index sidecar).
///
/// Ces tests construisent une mini archive tar.zst en memoire/temp,
/// puis valident le streaming, le roundtrip d'index, le grep, etc.

#include <gtest/gtest.h>

#include "iecode/archive/tar_zstd.h"
#include "iecode/io/zstd_stream.h"

#include <zstd.h>

#include <array>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <random>
#include <string>
#include <vector>

namespace fs = std::filesystem;
using namespace iecode::archive;

// ═══════════════════════════════════════════════════════════════════
// Helpers : construction d'un .tar.zst de test
// ═══════════════════════════════════════════════════════════════════

namespace {

constexpr std::size_t k_block = 512;

/// Ecrit un header tar ustar pour un fichier regulier.
void write_tar_header(std::vector<std::uint8_t>& out,
                      const std::string& name,
                      std::uint64_t size) {
    std::array<std::uint8_t, k_block> hdr{};

    // Nom (max 100, sinon il faudrait LongName)
    const auto name_len = std::min(name.size(), std::size_t(99));
    std::memcpy(hdr.data(), name.data(), name_len);

    std::memcpy(hdr.data() + 100, "0000644", 7);
    std::memcpy(hdr.data() + 108, "0000000", 7);
    std::memcpy(hdr.data() + 116, "0000000", 7);

    char buf[13];
    std::snprintf(buf, sizeof(buf), "%011llo", (unsigned long long)size);
    std::memcpy(hdr.data() + 124, buf, 11);

    std::snprintf(buf, sizeof(buf), "%011llo", 1700000000ULL);
    std::memcpy(hdr.data() + 136, buf, 11);

    std::memset(hdr.data() + 148, ' ', 8);   // checksum placeholder
    hdr[156] = '0';                           // typeflag = regular file
    std::memcpy(hdr.data() + 257, "ustar\0" "00", 8);

    std::uint32_t chk = 0;
    for (auto b : hdr) chk += b;
    std::snprintf(buf, sizeof(buf), "%06o", chk);
    std::memcpy(hdr.data() + 148, buf, 6);
    hdr[148 + 6] = 0;
    hdr[148 + 7] = ' ';

    out.insert(out.end(), hdr.begin(), hdr.end());
}

/// Ecrit un fichier complet (header + payload + padding) dans le buffer tar.
void tar_add_file(std::vector<std::uint8_t>& out,
                  const std::string& name,
                  std::span<const std::uint8_t> data) {
    write_tar_header(out, name, data.size());
    out.insert(out.end(), data.begin(), data.end());
    const auto pad = (k_block - (data.size() % k_block)) % k_block;
    out.insert(out.end(), pad, std::uint8_t(0));
}

/// Termine une archive tar (deux blocs zero).
void tar_finalize(std::vector<std::uint8_t>& out) {
    out.insert(out.end(), 2 * k_block, std::uint8_t(0));
}

/// Compresse un buffer en .zst (frame complet).
std::vector<std::uint8_t> zstd_compress(std::span<const std::uint8_t> input) {
    const std::size_t bound = ZSTD_compressBound(input.size());
    std::vector<std::uint8_t> out(bound);
    const auto n = ZSTD_compress(out.data(), out.size(),
                                 input.data(), input.size(), 3);
    out.resize(n);
    return out;
}

/// Cree un fichier .tar.zst dans un dossier temporaire et retourne le chemin.
fs::path make_test_archive(const std::vector<std::pair<std::string, std::vector<std::uint8_t>>>& files) {
    std::vector<std::uint8_t> tar;
    for (const auto& [name, data] : files) {
        tar_add_file(tar, name, data);
    }
    tar_finalize(tar);

    auto compressed = zstd_compress(tar);

    static std::atomic<int> counter{0};
    const auto path = fs::temp_directory_path()
        / fs::path(std::string("iecode_archive_test_") +
                   std::to_string(counter.fetch_add(1)) + ".tar.zst");

    std::ofstream f(path, std::ios::binary | std::ios::trunc);
    f.write(reinterpret_cast<const char*>(compressed.data()),
            static_cast<std::streamsize>(compressed.size()));
    f.close();

    return path;
}

/// RAII pour cleanup d'un fichier temp.
struct TempArchive {
    fs::path path;
    explicit TempArchive(fs::path p) : path(std::move(p)) {}
    ~TempArchive() {
        std::error_code ec;
        fs::remove(path, ec);
        fs::remove(fs::path(path).concat(".idx"), ec);
    }
};

/// Helper : convertit une string_view en vector<uint8_t>.
std::vector<std::uint8_t> bytes(std::string_view s) {
    return {reinterpret_cast<const std::uint8_t*>(s.data()),
            reinterpret_cast<const std::uint8_t*>(s.data()) + s.size()};
}

} // namespace

// ═══════════════════════════════════════════════════════════════════
// validate_tar_checksum
// ═══════════════════════════════════════════════════════════════════

TEST(TarChecksum, ValidUstarHeader) {
    std::vector<std::uint8_t> tar;
    write_tar_header(tar, "test.txt", 100);
    ASSERT_EQ(tar.size(), k_block);

    std::array<std::uint8_t, k_block> block{};
    std::copy(tar.begin(), tar.end(), block.begin());
    EXPECT_TRUE(validate_tar_checksum(block));
}

TEST(TarChecksum, CorruptedHeaderFails) {
    std::vector<std::uint8_t> tar;
    write_tar_header(tar, "test.txt", 100);
    tar[10] = 0xFF;  // corrompt le nom

    std::array<std::uint8_t, k_block> block{};
    std::copy(tar.begin(), tar.end(), block.begin());
    EXPECT_FALSE(validate_tar_checksum(block));
}

// ═══════════════════════════════════════════════════════════════════
// TarZstdReader::for_each_entry
// ═══════════════════════════════════════════════════════════════════

TEST(TarZstdReader, ListSimpleArchive) {
    TempArchive arch(make_test_archive({
        {"hello.txt",     bytes("hello world")},
        {"data/foo.bin",  bytes("\x01\x02\x03\x04")},
        {"data/bar.json", bytes("{\"k\":1}")},
    }));

    TarZstdReader reader(arch.path);
    ASSERT_TRUE(reader.ok()) << reader.error();

    std::vector<std::string> names;
    std::vector<std::uint64_t> sizes;
    const bool ok = reader.for_each_entry([&](const TarEntry& e, auto) {
        names.push_back(e.name);
        sizes.push_back(e.size);
        return true;
    });

    EXPECT_TRUE(ok);
    ASSERT_EQ(names.size(), 3u);
    EXPECT_EQ(names[0], "hello.txt");
    EXPECT_EQ(sizes[0], 11u);
    EXPECT_EQ(names[1], "data/foo.bin");
    EXPECT_EQ(sizes[1], 4u);
    EXPECT_EQ(names[2], "data/bar.json");
}

TEST(TarZstdReader, EarlyExitFromCallback) {
    TempArchive arch(make_test_archive({
        {"a", bytes("a")},
        {"b", bytes("b")},
        {"c", bytes("c")},
    }));

    TarZstdReader reader(arch.path);
    int count = 0;
    (void)reader.for_each_entry([&](const TarEntry&, auto) {
        ++count;
        return count < 2;  // stop apres avoir vu 2 entries
    });
    EXPECT_EQ(count, 2);
}

// ═══════════════════════════════════════════════════════════════════
// TarZstdReader::read_one
// ═══════════════════════════════════════════════════════════════════

TEST(TarZstdReader, ReadOneRoundtrip) {
    const std::string payload = "The quick brown fox jumps over the lazy dog";
    TempArchive arch(make_test_archive({
        {"first.txt",  bytes("first")},
        {"target.txt", bytes(payload)},
        {"third.txt",  bytes("third")},
    }));

    TarZstdReader reader(arch.path);
    auto data = reader.read_one("target.txt");
    ASSERT_TRUE(data.has_value());
    ASSERT_EQ(data->size(), payload.size());
    EXPECT_EQ(std::string(data->begin(), data->end()), payload);
}

TEST(TarZstdReader, ReadOneMissing) {
    TempArchive arch(make_test_archive({
        {"a", bytes("a")},
    }));
    TarZstdReader reader(arch.path);
    auto data = reader.read_one("nonexistent");
    EXPECT_FALSE(data.has_value());
}

TEST(TarZstdReader, ReadOnePrefilterIndexEarlyExit) {
    TempArchive arch(make_test_archive({
        {"a", bytes("hello")},
    }));
    TarZstdReader reader(arch.path);

    auto idx = reader.build_index();
    ASSERT_TRUE(idx.has_value());

    // Reset reader pour re-stream (build_index a consomme le stream)
    TarZstdReader reader2(arch.path);
    // Avec prefilter, un fichier absent retourne immediatement nullopt
    EXPECT_FALSE(reader2.read_one("zzz", &*idx).has_value());
    // Un fichier present est trouve
    auto data = reader2.read_one("a", &*idx);
    ASSERT_TRUE(data.has_value());
    EXPECT_EQ(std::string(data->begin(), data->end()), "hello");
}

// ═══════════════════════════════════════════════════════════════════
// TarZstdReader::read_one_to (streaming)
// ═══════════════════════════════════════════════════════════════════

TEST(TarZstdReader, ReadOneToStreamingChunks) {
    // Payload de 5 MB pour declencher plusieurs chunks de 1 MB
    std::vector<std::uint8_t> payload(5 * 1024 * 1024);
    std::mt19937 rng(42);
    for (auto& b : payload) b = static_cast<std::uint8_t>(rng() & 0xFF);

    TempArchive arch(make_test_archive({
        {"big.bin", payload},
    }));

    TarZstdReader reader(arch.path);
    std::vector<std::uint8_t> reconstructed;
    int chunk_count = 0;
    const bool ok = reader.read_one_to(
        "big.bin",
        [&](std::span<const std::uint8_t> chunk) {
            reconstructed.insert(reconstructed.end(), chunk.begin(), chunk.end());
            ++chunk_count;
            return true;
        });

    EXPECT_TRUE(ok);
    EXPECT_GE(chunk_count, 2);  // doit etre chunk-e
    ASSERT_EQ(reconstructed.size(), payload.size());
    EXPECT_EQ(reconstructed, payload);
}

// ═══════════════════════════════════════════════════════════════════
// build_index + load_index roundtrip
// ═══════════════════════════════════════════════════════════════════

TEST(TarZstdReader, IndexRoundtrip) {
    TempArchive arch(make_test_archive({
        {"f1.txt", bytes("aaa")},
        {"d/f2.bin", std::vector<std::uint8_t>(1000, 0x42)},
        {"d/f3.bin", std::vector<std::uint8_t>(2000, 0x43)},
    }));

    {
        TarZstdReader reader(arch.path);
        auto idx = reader.build_index();
        ASSERT_TRUE(idx.has_value());
        EXPECT_EQ(idx->stats.file_count, 3u);
        EXPECT_EQ(idx->stats.total_uncompressed, 3u + 1000 + 2000);
        EXPECT_EQ(idx->stats.largest_bytes, 2000u);
        EXPECT_EQ(idx->stats.largest_name, "d/f3.bin");
        EXPECT_TRUE(TarZstdReader::save_index(*idx));
    }

    // Recharge depuis disque
    auto loaded = TarZstdReader::load_index(arch.path);
    ASSERT_TRUE(loaded.has_value());
    EXPECT_EQ(loaded->entries.size(), 3u);
    EXPECT_EQ(loaded->stats.file_count, 3u);
    EXPECT_EQ(loaded->stats.total_uncompressed, 3003u);
    EXPECT_EQ(loaded->stats.largest_name, "d/f3.bin");

    // by_name hashmap fonctionne
    auto* found = loaded->find("d/f2.bin");
    ASSERT_NE(found, nullptr);
    EXPECT_EQ(found->size, 1000u);
    EXPECT_EQ(loaded->find("absent"), nullptr);
}

TEST(TarZstdReader, IndexInvalidatedOnSizeChange) {
    TempArchive arch(make_test_archive({
        {"a", bytes("aaa")},
    }));

    {
        TarZstdReader reader(arch.path);
        auto idx = reader.build_index();
        ASSERT_TRUE(idx.has_value());
        EXPECT_TRUE(TarZstdReader::save_index(*idx));
    }

    // Modifie la taille du fichier .tar.zst (truncate)
    {
        std::ofstream f(arch.path, std::ios::binary | std::ios::app);
        const char extra[] = {0, 0, 0, 0};
        f.write(extra, 4);
    }

    // L'index doit etre invalide
    auto loaded = TarZstdReader::load_index(arch.path);
    EXPECT_FALSE(loaded.has_value());
}

// ═══════════════════════════════════════════════════════════════════
// extract
// ═══════════════════════════════════════════════════════════════════

TEST(TarZstdReader, ExtractAllToTemp) {
    TempArchive arch(make_test_archive({
        {"a/b/c.txt", bytes("nested")},
        {"top.txt",   bytes("top-level")},
    }));

    const auto out_dir = fs::temp_directory_path() / "iecode_archive_test_extract";
    std::error_code ec;
    fs::remove_all(out_dir, ec);

    {
        TarZstdReader reader(arch.path);
        const auto written = reader.extract(out_dir, {});
        EXPECT_EQ(written, 2);
    }

    EXPECT_TRUE(fs::exists(out_dir / "a/b/c.txt"));
    EXPECT_TRUE(fs::exists(out_dir / "top.txt"));

    {
        std::ifstream f(out_dir / "a/b/c.txt", std::ios::binary);
        std::string content((std::istreambuf_iterator<char>(f)),
                             std::istreambuf_iterator<char>());
        EXPECT_EQ(content, "nested");
    }

    fs::remove_all(out_dir, ec);
}

TEST(TarZstdReader, ExtractWithFilter) {
    TempArchive arch(make_test_archive({
        {"keep.txt",  bytes("yes")},
        {"skip.bin",  bytes("no")},
        {"keep2.txt", bytes("yes2")},
    }));

    const auto out_dir = fs::temp_directory_path() / "iecode_archive_test_filter";
    std::error_code ec;
    fs::remove_all(out_dir, ec);

    {
        TarZstdReader reader(arch.path);
        const auto written = reader.extract(out_dir, [](const TarEntry& e) {
            return e.name.size() > 4 &&
                   e.name.compare(e.name.size() - 4, 4, ".txt") == 0;
        });
        EXPECT_EQ(written, 2);
    }
    EXPECT_TRUE(fs::exists(out_dir / "keep.txt"));
    EXPECT_TRUE(fs::exists(out_dir / "keep2.txt"));
    EXPECT_FALSE(fs::exists(out_dir / "skip.bin"));

    fs::remove_all(out_dir, ec);
}

// ═══════════════════════════════════════════════════════════════════
// grep
// ═══════════════════════════════════════════════════════════════════

TEST(TarZstdReader, GrepFindsLiteralPattern) {
    TempArchive arch(make_test_archive({
        {"a.txt", bytes("hello world, finding NEEDLE in haystack")},
        {"b.txt", bytes("nothing here")},
        {"c.txt", bytes("another NEEDLE and NEEDLE")},
    }));

    TarZstdReader reader(arch.path);
    auto hits = reader.grep("NEEDLE", {}, 100, 8);
    ASSERT_EQ(hits.size(), 3u);  // a:1 + c:2
    EXPECT_EQ(hits[0].entry_name, "a.txt");
    EXPECT_EQ(hits[1].entry_name, "c.txt");
    EXPECT_EQ(hits[2].entry_name, "c.txt");
}

TEST(TarZstdReader, GrepRespectsMaxHits) {
    TempArchive arch(make_test_archive({
        {"a.txt", bytes("X X X X X X X X X X")},
    }));

    TarZstdReader reader(arch.path);
    auto hits = reader.grep("X", {}, 3, 4);
    EXPECT_EQ(hits.size(), 3u);
}

// ═══════════════════════════════════════════════════════════════════
// ZstdInputStream
// ═══════════════════════════════════════════════════════════════════

TEST(ZstdInputStream, RoundtripSmallBuffer) {
    const std::string source = "Hello, zstd streaming world!";
    auto compressed = zstd_compress(bytes(source));

    const auto path = fs::temp_directory_path() / "iecode_zstd_test.zst";
    {
        std::ofstream f(path, std::ios::binary | std::ios::trunc);
        f.write(reinterpret_cast<const char*>(compressed.data()),
                static_cast<std::streamsize>(compressed.size()));
    }

    {
        iecode::io::ZstdInputStream stream(path);
        ASSERT_TRUE(stream.ok());

        std::vector<std::uint8_t> out(source.size());
        EXPECT_TRUE(stream.read_exact(out));
        EXPECT_EQ(std::string(out.begin(), out.end()), source);
        EXPECT_EQ(stream.decompressed_offset(), source.size());
    }

    std::error_code ec;
    fs::remove(path, ec);
}

TEST(ZstdInputStream, SkipAdvancesDecompressedOffset) {
    std::vector<std::uint8_t> source(10000);
    for (std::size_t i = 0; i < source.size(); ++i) {
        source[i] = static_cast<std::uint8_t>(i & 0xFF);
    }
    auto compressed = zstd_compress(source);

    const auto path = fs::temp_directory_path() / "iecode_zstd_skip_test.zst";
    {
        std::ofstream f(path, std::ios::binary | std::ios::trunc);
        f.write(reinterpret_cast<const char*>(compressed.data()),
                static_cast<std::streamsize>(compressed.size()));
    }

    {
        iecode::io::ZstdInputStream stream(path);
        EXPECT_TRUE(stream.skip(5000));
        EXPECT_EQ(stream.decompressed_offset(), 5000u);

        std::array<std::uint8_t, 10> buf{};
        EXPECT_TRUE(stream.read_exact(buf));
        EXPECT_EQ(buf[0], static_cast<std::uint8_t>(5000 & 0xFF));
        EXPECT_EQ(buf[1], static_cast<std::uint8_t>(5001 & 0xFF));
    }

    std::error_code ec;
    fs::remove(path, ec);
}
