/// @file test_steam_cloud.cpp
/// Tests unitaires pour l'API Steam Cloud (ISteamRemoteStorage).
///
/// Ces tests verifient que l'API Cloud fonctionne correctement quand
/// Steam n'est pas disponible (retours par defaut, pas de crash).
/// Les tests avec Steam actif ne peuvent tourner qu'en environnement
/// de developpement avec Steam lance.

#include "iecode/steam/steam_api.h"

#include <gtest/gtest.h>

using namespace iecode::steam;

// ── Tests des structures ────────────────────────────────────────────

TEST(SteamCloud, CloudQuotaDefaults) {
    CloudQuota quota;
    EXPECT_EQ(quota.total, 0u);
    EXPECT_EQ(quota.available, 0u);
}

TEST(SteamCloud, CloudFileInfoDefaults) {
    CloudFileInfo info;
    EXPECT_TRUE(info.name.empty());
    EXPECT_EQ(info.size, 0);
}

TEST(SteamCloud, CloudFileInfoDesignatedInit) {
    CloudFileInfo info{.name = "save.dat", .size = 1024};
    EXPECT_EQ(info.name, "save.dat");
    EXPECT_EQ(info.size, 1024);
}

// ── Tests sans Steam (init echoue = pas de DLL) ────────────────────

TEST(SteamCloud, InitFailsWithoutSteam) {
    // Sans Steam lance / DLL absente, init retourne nullopt
    auto ctx = SteamContext::init();
    // On ne peut pas garantir que Steam est absent en CI,
    // mais on verifie que l'appel ne crashe pas
    if (!ctx) {
        SUCCEED();  // Comportement attendu en CI
    } else {
        // Si Steam est present, verifier que les methodes Cloud
        // retournent des valeurs coherentes
        EXPECT_GE(ctx->get_cloud_file_count(), 0);

        auto quota = ctx->get_cloud_quota();
        // Le quota total est soit 0 (echec) soit > 0 (valide)
        if (quota.total > 0) {
            EXPECT_GE(quota.available, 0u);
            EXPECT_LE(quota.available, quota.total);
        }
    }
}

TEST(SteamCloud, CloudMethodsSafeWithSteam) {
    auto ctx = SteamContext::init();
    if (!ctx) {
        GTEST_SKIP() << "Steam non disponible — test ignore";
    }

    // Enumeration des fichiers Cloud
    int count = ctx->get_cloud_file_count();
    EXPECT_GE(count, 0);

    for (int i = 0; i < count && i < 5; ++i) {
        auto info = ctx->get_cloud_file_info(i);
        EXPECT_FALSE(info.name.empty());
        EXPECT_GT(info.size, 0);
    }

    // Fichier inexistant
    EXPECT_FALSE(ctx->cloud_file_exists("__iecode_test_nonexistent_file__.bin"));
    EXPECT_EQ(ctx->cloud_file_size("__iecode_test_nonexistent_file__.bin"), 0);
    EXPECT_EQ(ctx->cloud_file_timestamp("__iecode_test_nonexistent_file__.bin"), 0);
    EXPECT_FALSE(ctx->cloud_file_persisted("__iecode_test_nonexistent_file__.bin"));

    auto data = ctx->cloud_read("__iecode_test_nonexistent_file__.bin");
    EXPECT_FALSE(data.has_value());
}

TEST(SteamCloud, CloudWriteReadDeleteRoundtrip) {
    auto ctx = SteamContext::init();
    if (!ctx) {
        GTEST_SKIP() << "Steam non disponible — test ignore";
    }
    if (!ctx->is_cloud_enabled_for_app()) {
        GTEST_SKIP() << "Cloud desactive pour cette app — test ignore";
    }

    // Ecrire un fichier test
    const std::string test_name = "__iecode_unit_test__.bin";
    const std::vector<uint8_t> test_data = {0xDE, 0xAD, 0xBE, 0xEF, 0x42};
    auto span = std::span<const uint8_t>(test_data);

    bool written = ctx->cloud_write(test_name, span);
    ASSERT_TRUE(written) << "Echec ecriture Cloud";

    // Verifier existence
    EXPECT_TRUE(ctx->cloud_file_exists(test_name));
    EXPECT_EQ(ctx->cloud_file_size(test_name), static_cast<int>(test_data.size()));

    // Relire
    auto read_data = ctx->cloud_read(test_name);
    ASSERT_TRUE(read_data.has_value());
    EXPECT_EQ(*read_data, test_data);

    // Supprimer
    bool deleted = ctx->cloud_delete(test_name);
    EXPECT_TRUE(deleted);
    EXPECT_FALSE(ctx->cloud_file_exists(test_name));
}
