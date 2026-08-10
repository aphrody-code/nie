/// Tests d'integration des librairies vendorisees (mio, xxhash, concurrentqueue)
/// Verifie que les headers compilent et que les APIs de base fonctionnent.

#include <gtest/gtest.h>

// xxHash : mode header-only (doit etre defini AVANT l'include)
#define XXH_INLINE_ALL
#include "xxhash.h"

#include "mio.hpp"

#include "concurrentqueue.h"

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

// ── xxHash : hashing ultra-rapide ──────────────────────────────────────

TEST(VendorXxHash, Xxh3_64bitsBasic) {
    const std::string data = "123456789";
    const auto hash = XXH3_64bits(data.data(), data.size());

    // Valeur de reference stable pour xxh3_64bits("123456789")
    EXPECT_NE(hash, 0u);

    // Meme entree -> meme hash (determinisme)
    const auto hash2 = XXH3_64bits(data.data(), data.size());
    EXPECT_EQ(hash, hash2);
}

TEST(VendorXxHash, Xxh3_64bitsEmpty) {
    const auto hash = XXH3_64bits("", 0);
    // Un buffer vide produit un hash non-nul (propriete xxh3)
    EXPECT_NE(hash, 0u);
}

TEST(VendorXxHash, Xxh3_64bitsDifferentInputsDifferentHashes) {
    const std::string a = "Inazuma Eleven";
    const std::string b = "Victory Road";

    const auto ha = XXH3_64bits(a.data(), a.size());
    const auto hb = XXH3_64bits(b.data(), b.size());

    EXPECT_NE(ha, hb);
}

TEST(VendorXxHash, Xxh3_128bitsBasic) {
    const std::string data = "test128";
    const auto hash = XXH3_128bits(data.data(), data.size());
    EXPECT_NE(hash.low64, 0u);
    // 128 bits : les deux moities doivent etre remplies pour la plupart des entrees
    EXPECT_NE(hash.high64, 0u);
}

// ── concurrentqueue : MPMC lock-free ───────────────────────────────────

TEST(VendorConcurrentQueue, BasicPushPop) {
    moodycamel::ConcurrentQueue<int> queue;

    EXPECT_TRUE(queue.enqueue(42));
    EXPECT_TRUE(queue.enqueue(99));

    int value = 0;
    EXPECT_TRUE(queue.try_dequeue(value));
    EXPECT_EQ(value, 42);

    EXPECT_TRUE(queue.try_dequeue(value));
    EXPECT_EQ(value, 99);

    // La queue est vide maintenant
    EXPECT_FALSE(queue.try_dequeue(value));
}

TEST(VendorConcurrentQueue, BulkEnqueueDequeue) {
    moodycamel::ConcurrentQueue<int> queue;

    // Enqueue en bulk
    const std::vector<int> items = {1, 2, 3, 4, 5};
    EXPECT_TRUE(queue.enqueue_bulk(items.begin(), items.size()));

    // Dequeue en bulk
    std::vector<int> out(5);
    const auto count = queue.try_dequeue_bulk(out.begin(), out.size());
    EXPECT_EQ(count, 5u);
    EXPECT_EQ(out, items);
}

TEST(VendorConcurrentQueue, SizeEstimate) {
    moodycamel::ConcurrentQueue<std::string> queue;

    queue.enqueue("alpha");
    queue.enqueue("beta");
    queue.enqueue("gamma");

    // size_approx est une estimation (lock-free), mais pour un single thread c'est exact
    EXPECT_EQ(queue.size_approx(), 3u);

    std::string tmp;
    queue.try_dequeue(tmp);
    EXPECT_EQ(queue.size_approx(), 2u);
}
