/// @file test_resource_manager.cpp
/// Tests unitaires pour ResourceManager<T>, TextureManager, ModelManager, ConfigManager.

#include <iecode/engine/res/config_manager.h>
#include <iecode/engine/res/model_manager.h>
#include <iecode/engine/res/resource_manager.h>
#include <iecode/engine/res/texture_manager.h>

#include <gtest/gtest.h>

#include <memory>
#include <string>

namespace {

// ── Ressource de test simple ─────────────────────────────────────────

struct DummyResource {
    int value = 0;
    std::string name;
};

/// Manager de test avec chargement deterministe (sans fichier).
class DummyManager : public lives::ResourceManager<DummyResource> {
public:
    bool fail_next_load = false;
    int load_count      = 0;

protected:
    std::unique_ptr<DummyResource> load_from_file(const std::string& path) override {
        ++load_count;
        if (fail_next_load) {
            return nullptr;
        }
        auto res  = std::make_unique<DummyResource>();
        res->value = static_cast<int>(path.size());
        res->name  = path;
        return res;
    }
};

// ── Tests ResourceManager<T> generique ───────────────────────────────

TEST(ResourceManager, LoadReturnsValidId) {
    DummyManager mgr;
    auto id = mgr.load("test/resource.bin");
    EXPECT_NE(id, lives::INVALID_RESOURCE_ID);
    EXPECT_EQ(mgr.count(), 1u);
}

TEST(ResourceManager, LoadCachesOnSamePath) {
    DummyManager mgr;
    auto id1 = mgr.load("test/same.bin");
    auto id2 = mgr.load("test/same.bin");

    // Meme ID retourne, un seul chargement effectif
    EXPECT_EQ(id1, id2);
    EXPECT_EQ(mgr.count(), 1u);
    EXPECT_EQ(mgr.load_count, 1);

    // Ref count incremente
    EXPECT_EQ(mgr.ref_count(id1), 2u);
}

TEST(ResourceManager, LoadDifferentPathsCreatesDifferentEntries) {
    DummyManager mgr;
    auto id1 = mgr.load("path/a.bin");
    auto id2 = mgr.load("path/b.bin");

    EXPECT_NE(id1, id2);
    EXPECT_EQ(mgr.count(), 2u);
    EXPECT_EQ(mgr.load_count, 2);
}

TEST(ResourceManager, LoadFailureReturnsInvalidId) {
    DummyManager mgr;
    mgr.fail_next_load = true;
    auto id = mgr.load("fail/resource.bin");

    EXPECT_EQ(id, lives::INVALID_RESOURCE_ID);
    EXPECT_EQ(mgr.count(), 0u);
}

TEST(ResourceManager, GetReturnsResourceByIdOrNull) {
    DummyManager mgr;
    auto id = mgr.load("test/get.bin");

    auto* res = mgr.get(id);
    ASSERT_NE(res, nullptr);
    EXPECT_EQ(res->name, "test/get.bin");

    // ID inexistant retourne nullptr
    EXPECT_EQ(mgr.get(9999), nullptr);
}

TEST(ResourceManager, GetByPathReturnsResourceOrNull) {
    DummyManager mgr;
    (void)mgr.load("test/bypath.bin");

    auto* res = mgr.get_by_path("test/bypath.bin");
    ASSERT_NE(res, nullptr);
    EXPECT_EQ(res->name, "test/bypath.bin");

    // Chemin non charge retourne nullptr
    EXPECT_EQ(mgr.get_by_path("nonexistent.bin"), nullptr);
}

TEST(ResourceManager, UnloadDecrementsRefCount) {
    DummyManager mgr;
    auto id = mgr.load("test/unload.bin");
    (void)mgr.load("test/unload.bin"); // ref_count = 2

    EXPECT_EQ(mgr.ref_count(id), 2u);

    mgr.unload(id);
    EXPECT_EQ(mgr.ref_count(id), 1u);
    EXPECT_EQ(mgr.count(), 1u); // Pas encore libere

    mgr.unload(id);
    EXPECT_EQ(mgr.count(), 0u); // Libere a ref_count 0
    EXPECT_EQ(mgr.get(id), nullptr);
}

TEST(ResourceManager, UnloadInvalidIdIsNoOp) {
    DummyManager mgr;
    mgr.unload(42); // Ne doit pas crasher
    EXPECT_EQ(mgr.count(), 0u);
}

TEST(ResourceManager, ClearReleasesAllResources) {
    DummyManager mgr;
    (void)mgr.load("a.bin");
    (void)mgr.load("b.bin");
    (void)mgr.load("c.bin");
    EXPECT_EQ(mgr.count(), 3u);

    mgr.clear();
    EXPECT_EQ(mgr.count(), 0u);
}

TEST(ResourceManager, ContainsByPathAndId) {
    DummyManager mgr;
    auto id = mgr.load("test/contains.bin");

    EXPECT_TRUE(mgr.contains("test/contains.bin"));
    EXPECT_TRUE(mgr.contains(id));
    EXPECT_FALSE(mgr.contains("other.bin"));
    EXPECT_FALSE(mgr.contains(lives::INVALID_RESOURCE_ID));
}

TEST(ResourceManager, ForEachVisitsAllResources) {
    DummyManager mgr;
    (void)mgr.load("a.bin");
    (void)mgr.load("b.bin");

    int visited = 0;
    mgr.for_each([&](lives::ResourceId /*id*/, const DummyResource& /*res*/) {
        ++visited;
    });
    EXPECT_EQ(visited, 2);
}

TEST(ResourceManager, IteratorWorks) {
    DummyManager mgr;
    (void)mgr.load("x.bin");
    (void)mgr.load("y.bin");

    size_t count = 0;
    for ([[maybe_unused]] auto it = mgr.begin(); it != mgr.end(); ++it) {
        ++count;
    }
    EXPECT_EQ(count, 2u);
}

// ── Tests Overload-style : normalisation, reload, hot-reload, move ───

TEST(ResourceManager, NormalizePathBackslashesAndDots) {
    using lives::normalize_resource_path;
    EXPECT_EQ(normalize_resource_path("a\\b\\c.bin"), "a/b/c.bin");
    EXPECT_EQ(normalize_resource_path("a/./b/../c.bin"), "a/c.bin");
    EXPECT_EQ(normalize_resource_path("data\\common/chr\\file.g4tx"),
              "data/common/chr/file.g4tx");
}

TEST(ResourceManager, LoadNormalizesPathForCacheLookup) {
    DummyManager mgr;
    auto id1 = mgr.load("data\\common/file.bin");
    auto id2 = mgr.load("data/common/./file.bin");

    // Les deux chemins doivent resoudre vers la meme entree
    EXPECT_EQ(id1, id2);
    EXPECT_EQ(mgr.count(), 1u);
    EXPECT_EQ(mgr.load_count, 1);
    EXPECT_TRUE(mgr.contains("data/common/file.bin"));
    EXPECT_TRUE(mgr.contains("data\\common\\file.bin"));
}

TEST(ResourceManager, ReloadByIdReplacesResourceContent) {
    DummyManager mgr;
    auto id = mgr.load("test/reload.bin");
    auto* before = mgr.get(id);
    ASSERT_NE(before, nullptr);

    EXPECT_TRUE(mgr.reload(id));
    EXPECT_EQ(mgr.load_count, 2);

    auto* after = mgr.get(id);
    ASSERT_NE(after, nullptr);
    EXPECT_EQ(after->name, "test/reload.bin");
    // Meme ID conserve
    EXPECT_TRUE(mgr.contains(id));
}

TEST(ResourceManager, ReloadByPathConservesId) {
    DummyManager mgr;
    auto id = mgr.load("test/path_reload.bin");
    EXPECT_TRUE(mgr.reload(std::string("test\\path_reload.bin")));
    EXPECT_TRUE(mgr.contains(id));
}

TEST(ResourceManager, ReloadInvalidIdReturnsFalse) {
    DummyManager mgr;
    EXPECT_FALSE(mgr.reload(lives::ResourceId{42}));
}

TEST(ResourceManager, ReloadFailureKeepsOriginalResource) {
    DummyManager mgr;
    auto id = mgr.load("test/reload_fail.bin");
    ASSERT_NE(mgr.get(id), nullptr);

    mgr.fail_next_load = true;
    EXPECT_FALSE(mgr.reload(id));

    // La ressource originale est preservee
    EXPECT_NE(mgr.get(id), nullptr);
    EXPECT_TRUE(mgr.contains(id));
}

TEST(ResourceManager, ReloadAllRereadAllResources) {
    DummyManager mgr;
    (void)mgr.load("a.bin");
    (void)mgr.load("b.bin");
    (void)mgr.load("c.bin");
    EXPECT_EQ(mgr.load_count, 3);

    EXPECT_EQ(mgr.reload_all(), 3u);
    EXPECT_EQ(mgr.load_count, 6);
    EXPECT_EQ(mgr.count(), 3u);
}

TEST(ResourceManager, ReloadAllModifiedSkipsUnchangedFiles) {
    DummyManager mgr;
    (void)mgr.load("vfs/only.bin");
    // Aucun fichier sur disque -> query_last_write_time renvoie epoch
    // -> reload_all_modified ignore les VFS-only et ne recharge rien.
    EXPECT_EQ(mgr.reload_all_modified(), 0u);
}

TEST(ResourceManager, UnloadByPathRemovesEntry) {
    DummyManager mgr;
    (void)mgr.load("test/unload_path.bin");
    EXPECT_EQ(mgr.count(), 1u);

    mgr.unload_by_path("test\\unload_path.bin");
    EXPECT_EQ(mgr.count(), 0u);
    EXPECT_FALSE(mgr.contains("test/unload_path.bin"));
}

TEST(ResourceManager, MoveResourceRenamesPath) {
    DummyManager mgr;
    auto id = mgr.load("old/path.bin");

    EXPECT_TRUE(mgr.move_resource("old/path.bin", "new/path.bin"));
    EXPECT_FALSE(mgr.contains("old/path.bin"));
    EXPECT_TRUE(mgr.contains("new/path.bin"));
    EXPECT_TRUE(mgr.contains(id));
}

TEST(ResourceManager, MoveResourceFailsOnConflict) {
    DummyManager mgr;
    (void)mgr.load("a.bin");
    (void)mgr.load("b.bin");

    // Cible existe deja -> echec
    EXPECT_FALSE(mgr.move_resource("a.bin", "b.bin"));
    EXPECT_TRUE(mgr.contains("a.bin"));
    EXPECT_TRUE(mgr.contains("b.bin"));
}

TEST(ResourceManager, MoveResourceFailsForUnknownSource) {
    DummyManager mgr;
    EXPECT_FALSE(mgr.move_resource("ghost.bin", "x.bin"));
}

// ── Tests des managers concrets (sans fichier — echec attendu) ───────

TEST(TextureManager, LoadNonExistentFileReturnsInvalid) {
    lives::TextureManager mgr;
    auto id = mgr.load("nonexistent_texture.g4tx");
    EXPECT_EQ(id, lives::INVALID_RESOURCE_ID);
    EXPECT_EQ(mgr.count(), 0u);
}

TEST(ModelManager, LoadNonExistentFileReturnsInvalid) {
    lives::ModelManager mgr;
    auto id = mgr.load("nonexistent_model.g4mg");
    EXPECT_EQ(id, lives::INVALID_RESOURCE_ID);
    EXPECT_EQ(mgr.count(), 0u);
}

TEST(ConfigManager, LoadNonExistentFileReturnsInvalid) {
    lives::ConfigManager mgr;
    auto id = mgr.load("nonexistent_config.cfg.bin");
    EXPECT_EQ(id, lives::INVALID_RESOURCE_ID);
    EXPECT_EQ(mgr.count(), 0u);
}

// ── Test d'instanciation des types de ressources ─────────────────────

TEST(TextureResource, DefaultConstruction) {
    lives::TextureResource tex;
    EXPECT_EQ(tex.width, 0u);
    EXPECT_EQ(tex.height, 0u);
    EXPECT_EQ(tex.format, 0u);
    EXPECT_EQ(tex.mip_count, 1u);
    EXPECT_TRUE(tex.pixel_data.empty());
    EXPECT_TRUE(tex.source_path.empty());
}

TEST(ModelResource, DefaultConstruction) {
    lives::ModelResource mdl;
    EXPECT_EQ(mdl.vertex_count, 0u);
    EXPECT_EQ(mdl.index_count, 0u);
    EXPECT_EQ(mdl.submesh_count, 0u);
    EXPECT_EQ(mdl.version, 0u);
    EXPECT_FALSE(mdl.is_big_endian);
}

TEST(ConfigResource, DefaultConstruction) {
    lives::ConfigResource cfg;
    EXPECT_TRUE(cfg.data.is_null());
    EXPECT_TRUE(cfg.source_path.empty());
    EXPECT_FALSE(cfg.is_rdbn);
}

} // namespace
