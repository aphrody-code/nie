/// Tests d'integration de la librairie vendorisee `mio` (memory-mapped I/O).
/// Verifie que le header compile et que les APIs de base fonctionnent — mio porte la lecture
/// des archives CPK (`formats/criware/cpk_reader.cpp`), une regression de mapping y serait muette.

#include <gtest/gtest.h>

#include "mio.hpp"

#include <cstdint>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

// ── mio : memory-mapped I/O ────────────────────────────────────────────

TEST(VendorMio, MmapReadonlyFile) {
    // Creer un fichier temporaire
    const std::string path = testing::TempDir() + "/mio_test.bin";
    const std::string content = "iecode mio test data 2024";

    {
        std::ofstream ofs(path, std::ios::binary);
        ASSERT_TRUE(ofs.is_open());
        ofs.write(content.data(), static_cast<std::streamsize>(content.size()));
    }

    // Ouvrir en mmap readonly via map() (pas d'exceptions)
    mio::mmap_source mmap;
    std::error_code ec;
    mmap.map(path, 0, mio::map_entire_file, ec);
    ASSERT_FALSE(ec) << "mmap failed: " << ec.message();
    ASSERT_EQ(mmap.size(), content.size());
    EXPECT_TRUE(mmap.is_open());
    EXPECT_TRUE(mmap.is_mapped());

    // Verifier le contenu
    const std::string mapped(mmap.data(), mmap.size());
    EXPECT_EQ(mapped, content);

    // Nettoyage
    mmap.unmap();
    std::remove(path.c_str());
}

TEST(VendorMio, EmptyMmapHandledGracefully) {
    // Un chemin inexistant doit retourner une erreur, pas crasher
    mio::mmap_source mmap;
    std::error_code ec;
    mmap.map("/tmp/nonexistent_mio_test_42.bin", 0, mio::map_entire_file, ec);
    EXPECT_TRUE(ec);
    EXPECT_FALSE(mmap.is_open());
}
