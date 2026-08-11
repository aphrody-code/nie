/// @file test_mod_features.cpp
/// Tests GTest pour les nouvelles fonctionnalites modding :
///   - Resolution de dependances (mod_dependency)
///   - Compatibilite de version (mod_compatibility)
///   - Packaging de mods (mod_packager)

#include <gtest/gtest.h>

#include "iecode/modding/mod_dependency.h"
#include "iecode/modding/mod_compatibility.h"
#include "iecode/modding/mod_packager.h"

#include <filesystem>
#include <fstream>

namespace fs = std::filesystem;
using namespace iecode::modding;

// ═══════════════════════════════════════════════════════════════════════
// SemVer
// ═══════════════════════════════════════════════════════════════════════

TEST(SemVer, ParseBasic) {
    auto v = SemVer::parse("1.2.3");
    EXPECT_EQ(v.major, 1);
    EXPECT_EQ(v.minor, 2);
    EXPECT_EQ(v.patch, 3);
}

TEST(SemVer, ParseMajorOnly) {
    auto v = SemVer::parse("5");
    EXPECT_EQ(v.major, 5);
    EXPECT_EQ(v.minor, 0);
    EXPECT_EQ(v.patch, 0);
}

TEST(SemVer, ParseMajorMinor) {
    auto v = SemVer::parse("2.7");
    EXPECT_EQ(v.major, 2);
    EXPECT_EQ(v.minor, 7);
    EXPECT_EQ(v.patch, 0);
}

TEST(SemVer, ParseWithPrefix) {
    auto v = SemVer::parse("v3.1.4");
    EXPECT_EQ(v.major, 3);
    EXPECT_EQ(v.minor, 1);
    EXPECT_EQ(v.patch, 4);
}

TEST(SemVer, ParseWithSuffix) {
    auto v = SemVer::parse("1.0.0-beta");
    EXPECT_EQ(v.major, 1);
    EXPECT_EQ(v.minor, 0);
    EXPECT_EQ(v.patch, 0);
}

TEST(SemVer, ParseEmpty) {
    auto v = SemVer::parse("");
    EXPECT_EQ(v.major, 0);
    EXPECT_EQ(v.minor, 0);
    EXPECT_EQ(v.patch, 0);
    EXPECT_FALSE(v.valid());
}

TEST(SemVer, Comparison) {
    EXPECT_LT(SemVer::parse("1.0.0"), SemVer::parse("2.0.0"));
    EXPECT_LT(SemVer::parse("1.2.0"), SemVer::parse("1.3.0"));
    EXPECT_LT(SemVer::parse("1.2.3"), SemVer::parse("1.2.4"));
    EXPECT_EQ(SemVer::parse("1.2.3"), SemVer::parse("1.2.3"));
    EXPECT_GT(SemVer::parse("2.0.0"), SemVer::parse("1.9.9"));
}

// ═══════════════════════════════════════════════════════════════════════
// version_in_range
// ═══════════════════════════════════════════════════════════════════════

TEST(VersionInRange, NoConstraints) {
    EXPECT_TRUE(version_in_range("1.0.0", "", ""));
}

TEST(VersionInRange, MinOnly) {
    EXPECT_TRUE(version_in_range("2.0.0", "1.0.0", ""));
    EXPECT_TRUE(version_in_range("1.0.0", "1.0.0", ""));
    EXPECT_FALSE(version_in_range("0.9.0", "1.0.0", ""));
}

TEST(VersionInRange, MaxOnly) {
    EXPECT_TRUE(version_in_range("1.0.0", "", "2.0.0"));
    EXPECT_TRUE(version_in_range("2.0.0", "", "2.0.0"));
    EXPECT_FALSE(version_in_range("3.0.0", "", "2.0.0"));
}

TEST(VersionInRange, BothBounds) {
    EXPECT_TRUE(version_in_range("1.5.0", "1.0.0", "2.0.0"));
    EXPECT_TRUE(version_in_range("1.0.0", "1.0.0", "2.0.0"));
    EXPECT_TRUE(version_in_range("2.0.0", "1.0.0", "2.0.0"));
    EXPECT_FALSE(version_in_range("0.9.0", "1.0.0", "2.0.0"));
    EXPECT_FALSE(version_in_range("2.1.0", "1.0.0", "2.0.0"));
}

// ═══════════════════════════════════════════════════════════════════════
// check_dependencies
// ═══════════════════════════════════════════════════════════════════════

TEST(ModDependency, NoDependencies) {
    std::vector<ModInfo> mods;

    ModInfo a;
    a.name = "mod_a";
    a.enabled = true;
    mods.push_back(a);

    ModInfo b;
    b.name = "mod_b";
    b.enabled = true;
    mods.push_back(b);

    auto result = check_dependencies(mods);
    EXPECT_TRUE(result.satisfied);
    EXPECT_TRUE(result.missing.empty());
    EXPECT_TRUE(result.circular_dependencies.empty());
    EXPECT_EQ(result.install_order.size(), 2);
}

TEST(ModDependency, SimpleDependency) {
    std::vector<ModInfo> mods;

    ModInfo base;
    base.name = "base_mod";
    base.enabled = true;
    base.metadata.mod_version = "1.0.0";
    mods.push_back(base);

    ModInfo addon;
    addon.name = "addon_mod";
    addon.enabled = true;
    addon.metadata.dependencies.push_back(ModDependency{"base_mod", "", "", false});
    mods.push_back(addon);

    auto result = check_dependencies(mods);
    EXPECT_TRUE(result.satisfied);
    EXPECT_TRUE(result.missing.empty());

    // base_mod doit apparaitre avant addon_mod dans l'ordre
    auto it_base = std::find(result.install_order.begin(),
                             result.install_order.end(), "base_mod");
    auto it_addon = std::find(result.install_order.begin(),
                              result.install_order.end(), "addon_mod");
    ASSERT_NE(it_base, result.install_order.end());
    ASSERT_NE(it_addon, result.install_order.end());
    EXPECT_LT(it_base, it_addon);
}

TEST(ModDependency, MissingDependency) {
    std::vector<ModInfo> mods;

    ModInfo addon;
    addon.name = "addon_mod";
    addon.enabled = true;
    addon.metadata.dependencies.push_back(ModDependency{"missing_mod", "", "", false});
    mods.push_back(addon);

    auto result = check_dependencies(mods);
    EXPECT_FALSE(result.satisfied);
    EXPECT_EQ(result.missing.size(), 1);
}

TEST(ModDependency, OptionalMissingDependency) {
    std::vector<ModInfo> mods;

    ModInfo addon;
    addon.name = "addon_mod";
    addon.enabled = true;
    addon.metadata.dependencies.push_back(ModDependency{"optional_mod", "", "", true});
    mods.push_back(addon);

    auto result = check_dependencies(mods);
    EXPECT_TRUE(result.satisfied);
    EXPECT_TRUE(result.missing.empty());
    EXPECT_EQ(result.optional_missing.size(), 1);
}

TEST(ModDependency, VersionMismatch) {
    std::vector<ModInfo> mods;

    ModInfo base;
    base.name = "base_mod";
    base.enabled = true;
    base.metadata.mod_version = "0.5.0";
    mods.push_back(base);

    ModInfo addon;
    addon.name = "addon_mod";
    addon.enabled = true;
    addon.metadata.dependencies.push_back(
        ModDependency{"base_mod", "1.0.0", "2.0.0", false});
    mods.push_back(addon);

    auto result = check_dependencies(mods);
    EXPECT_FALSE(result.satisfied);
    EXPECT_EQ(result.version_mismatch.size(), 1);
}

TEST(ModDependency, CircularDependency) {
    std::vector<ModInfo> mods;

    ModInfo a;
    a.name = "mod_a";
    a.enabled = true;
    a.metadata.dependencies.push_back(ModDependency{"mod_b", "", "", false});
    mods.push_back(a);

    ModInfo b;
    b.name = "mod_b";
    b.enabled = true;
    b.metadata.dependencies.push_back(ModDependency{"mod_a", "", "", false});
    mods.push_back(b);

    auto result = check_dependencies(mods);
    EXPECT_FALSE(result.satisfied);
    EXPECT_FALSE(result.circular_dependencies.empty());
}

TEST(ModDependency, ResolveInstallOrder) {
    std::vector<ModInfo> mods;

    ModInfo c;
    c.name = "mod_c";
    c.enabled = true;
    c.metadata.dependencies.push_back(ModDependency{"mod_b", "", "", false});
    mods.push_back(c);

    ModInfo b;
    b.name = "mod_b";
    b.enabled = true;
    b.metadata.dependencies.push_back(ModDependency{"mod_a", "", "", false});
    mods.push_back(b);

    ModInfo a;
    a.name = "mod_a";
    a.enabled = true;
    mods.push_back(a);

    auto ordered = resolve_install_order(mods);
    ASSERT_EQ(ordered.size(), 3);
    EXPECT_EQ(ordered[0].name, "mod_a");
    EXPECT_EQ(ordered[1].name, "mod_b");
    EXPECT_EQ(ordered[2].name, "mod_c");
}

TEST(ModDependency, ResolveCircularReturnsEmpty) {
    std::vector<ModInfo> mods;

    ModInfo a;
    a.name = "mod_a";
    a.enabled = true;
    a.metadata.dependencies.push_back(ModDependency{"mod_b", "", "", false});
    mods.push_back(a);

    ModInfo b;
    b.name = "mod_b";
    b.enabled = true;
    b.metadata.dependencies.push_back(ModDependency{"mod_a", "", "", false});
    mods.push_back(b);

    auto ordered = resolve_install_order(mods);
    EXPECT_TRUE(ordered.empty());
}

// ═══════════════════════════════════════════════════════════════════════
// check_compatibility
// ═══════════════════════════════════════════════════════════════════════

TEST(ModCompatibility, NoConstraint) {
    std::vector<ModInfo> mods;
    ModInfo m;
    m.name = "my_mod";
    m.enabled = true;
    // game_version vide = pas de contrainte
    mods.push_back(m);

    auto results = check_compatibility(mods, "5.00.24.00");
    ASSERT_EQ(results.size(), 1);
    EXPECT_TRUE(results[0].compatible);
}

TEST(ModCompatibility, ExactMatch) {
    std::vector<ModInfo> mods;
    ModInfo m;
    m.name = "my_mod";
    m.enabled = true;
    m.metadata.game_version = "5.00.24.00";
    mods.push_back(m);

    auto results = check_compatibility(mods, "5.00.24.00");
    ASSERT_EQ(results.size(), 1);
    EXPECT_TRUE(results[0].compatible);
}

TEST(ModCompatibility, ExactMismatch) {
    std::vector<ModInfo> mods;
    ModInfo m;
    m.name = "my_mod";
    m.enabled = true;
    m.metadata.game_version = "4.00.20.00";
    mods.push_back(m);

    auto results = check_compatibility(mods, "5.00.24.00");
    ASSERT_EQ(results.size(), 1);
    EXPECT_FALSE(results[0].compatible);
}

TEST(ModCompatibility, WildcardMatch) {
    std::vector<ModInfo> mods;
    ModInfo m;
    m.name = "my_mod";
    m.enabled = true;
    m.metadata.game_version = "5.x";
    mods.push_back(m);

    auto results = check_compatibility(mods, "5.00.24.00");
    ASSERT_EQ(results.size(), 1);
    EXPECT_TRUE(results[0].compatible);
}

TEST(ModCompatibility, WildcardMismatch) {
    std::vector<ModInfo> mods;
    ModInfo m;
    m.name = "my_mod";
    m.enabled = true;
    m.metadata.game_version = "4.x";
    mods.push_back(m);

    auto results = check_compatibility(mods, "5.00.24.00");
    ASSERT_EQ(results.size(), 1);
    EXPECT_FALSE(results[0].compatible);
}

TEST(ModCompatibility, OperatorGte) {
    std::vector<ModInfo> mods;
    ModInfo m;
    m.name = "my_mod";
    m.enabled = true;
    m.metadata.game_version = ">=5.00.0.00";
    mods.push_back(m);

    auto results = check_compatibility(mods, "5.00.24.00");
    ASSERT_EQ(results.size(), 1);
    EXPECT_TRUE(results[0].compatible);
}

TEST(ModCompatibility, OperatorGteFail) {
    std::vector<ModInfo> mods;
    ModInfo m;
    m.name = "my_mod";
    m.enabled = true;
    m.metadata.game_version = ">=6.00.0.00";
    mods.push_back(m);

    auto results = check_compatibility(mods, "5.00.24.00");
    ASSERT_EQ(results.size(), 1);
    EXPECT_FALSE(results[0].compatible);
}

TEST(ModCompatibility, DisabledModSkipped) {
    std::vector<ModInfo> mods;
    ModInfo m;
    m.name = "disabled_mod";
    m.enabled = false;
    m.metadata.game_version = "1.0.0";
    mods.push_back(m);

    auto results = check_compatibility(mods, "5.00.24.00");
    EXPECT_TRUE(results.empty());
}

// ═══════════════════════════════════════════════════════════════════════
// validate_mod_structure & create_mod_template
// ═══════════════════════════════════════════════════════════════════════

class ModPackagerTest : public ::testing::Test {
protected:
    fs::path test_dir_;

    void SetUp() override {
        test_dir_ = fs::temp_directory_path() / "iecode_test_mod_packager";
        fs::remove_all(test_dir_);
        fs::create_directories(test_dir_);
    }

    void TearDown() override {
        std::error_code ec;
        fs::remove_all(test_dir_, ec);
    }
};

TEST_F(ModPackagerTest, ValidateEmptyDir) {
    auto empty_dir = test_dir_ / "empty";
    fs::create_directories(empty_dir);

    auto result = validate_mod_structure(empty_dir);
    EXPECT_FALSE(result.valid);
    EXPECT_FALSE(result.errors.empty());
}

TEST_F(ModPackagerTest, ValidateNonexistent) {
    auto result = validate_mod_structure(test_dir_ / "nonexistent");
    EXPECT_FALSE(result.valid);
}

TEST_F(ModPackagerTest, CreateTemplate) {
    auto mod_dir = test_dir_ / "test_mod";

    bool ok = create_mod_template(mod_dir, "Test Mod", "TestAuthor");
    EXPECT_TRUE(ok);

    EXPECT_TRUE(fs::exists(mod_dir / "mod_data.json"));
    EXPECT_TRUE(fs::is_directory(mod_dir / "data"));

    // Valider le template cree
    auto result = validate_mod_structure(mod_dir);
    // Le template cree un data/ vide => warning mais pas d'erreur sur mod_data.json
    // Note: data/ est vide => warning
    EXPECT_TRUE(fs::exists(mod_dir / "mod_data.json"));
}

TEST_F(ModPackagerTest, ValidateValidMod) {
    auto mod_dir = test_dir_ / "valid_mod";
    create_mod_template(mod_dir, "Valid Mod", "Author");

    // Ajouter un fichier dans data/
    auto data_file = mod_dir / "data" / "test.txt";
    std::ofstream(data_file) << "test content";

    auto result = validate_mod_structure(mod_dir);
    EXPECT_TRUE(result.valid);
    EXPECT_TRUE(result.errors.empty());
}

TEST_F(ModPackagerTest, PackageMod) {
    auto mod_dir = test_dir_ / "packaged_mod";
    create_mod_template(mod_dir, "Packaged Mod", "Author");

    // Ajouter des fichiers dans data/
    auto data_file = mod_dir / "data" / "test.bin";
    std::ofstream(data_file, std::ios::binary) << "binary content here";

    auto sub_dir = mod_dir / "data" / "subdir";
    fs::create_directories(sub_dir);
    std::ofstream(sub_dir / "nested.txt") << "nested file";

    // Empaqueter
    PackageOptions opts;
    opts.mod_dir = mod_dir;
    opts.output_path = test_dir_ / "packaged_mod.zip";
    opts.validate = true;
    opts.include_readme = true;

    auto result = package_mod(opts);
    EXPECT_TRUE(result.success);
    EXPECT_TRUE(fs::exists(result.output_path));
    EXPECT_GE(result.files_packaged, 3);  // mod_data.json + test.bin + nested.txt
    EXPECT_GT(result.total_size_bytes, 0);

    // Verifier que le ZIP est un fichier non vide
    auto zip_size = fs::file_size(result.output_path);
    EXPECT_GT(zip_size, 50);  // Un ZIP minimal fait au moins ~50 octets
}

TEST_F(ModPackagerTest, PackageInvalidMod) {
    auto mod_dir = test_dir_ / "invalid_mod";
    fs::create_directories(mod_dir);
    // Pas de mod_data.json, pas de data/

    PackageOptions opts;
    opts.mod_dir = mod_dir;
    opts.output_path = test_dir_ / "invalid.zip";
    opts.validate = true;

    auto result = package_mod(opts);
    EXPECT_FALSE(result.success);
    EXPECT_FALSE(result.error.empty());
}
