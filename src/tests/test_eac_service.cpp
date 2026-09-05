/// @file test_eac_service.cpp
/// Tests unitaires pour le service de bypass EAC.
///
/// Utilise un repertoire temporaire simulant l'arborescence du jeu
/// pour tester disable/restore/status sans toucher aux vrais fichiers.

#include "iecode/services/eac_service.h"

#include <gtest/gtest.h>

#include <filesystem>
#include <fstream>
#include <string>

namespace fs = std::filesystem;
using namespace iecode::services;

// ── Fixture ────────────────────────────────────────────────────────

class EacServiceTest : public ::testing::Test {
protected:
    fs::path temp_dir_;

    void SetUp() override {
        // Creer un repertoire temporaire unique pour chaque test
        temp_dir_ = fs::temp_directory_path() / "iecode_eac_test";
        fs::remove_all(temp_dir_);
        fs::create_directories(temp_dir_);
    }

    void TearDown() override {
        std::error_code ec;
        fs::remove_all(temp_dir_, ec);
    }

    /// Ecrit un fichier INI dans le repertoire temporaire.
    void write_ini(const std::string& content) {
        std::ofstream f(temp_dir_ / "GameBootstrapper.ini", std::ios::binary);
        f << content;
    }

    /// Lit le contenu d'un fichier.
    [[nodiscard]] std::string read_file(const fs::path& path) const {
        std::ifstream f(path);
        return {std::istreambuf_iterator<char>(f), std::istreambuf_iterator<char>()};
    }

    /// Cree un fichier factice de la taille donnee.
    void create_dummy_file(const fs::path& path, size_t size = 64) {
        std::ofstream f(path, std::ios::binary);
        const std::string data(size, 'X');
        f << data;
    }
};

// ── Tests de base ──────────────────────────────────────────────────

TEST_F(EacServiceTest, StatusOnFreshInstall) {
    // Simuler une installation fraiche avec EAC actif
    write_ini("ApplicationPath=EACLauncher.exe\r\nWorkingDirectory=\r\nWaitForExit=0\r\nNoOperation=0\r\n");
    create_dummy_file(temp_dir_ / "EACLauncher.exe", 1024);

    EacService svc(temp_dir_);
    EXPECT_FALSE(svc.is_eac_disabled());

    const auto status = svc.get_status();
    EXPECT_FALSE(status.ini_modified);
    EXPECT_FALSE(status.launcher_backed_up);
    EXPECT_FALSE(status.launcher_missing);
}

TEST_F(EacServiceTest, DisableEac) {
    // Installation fraiche
    write_ini("ApplicationPath=EACLauncher.exe\r\nWorkingDirectory=\r\nWaitForExit=0\r\nNoOperation=0\r\n");
    create_dummy_file(temp_dir_ / "EACLauncher.exe", 1024);

    EacService svc(temp_dir_);
    EXPECT_TRUE(svc.disable_eac());
    EXPECT_TRUE(svc.is_eac_disabled());

    const auto status = svc.get_status();
    EXPECT_TRUE(status.ini_modified);
    EXPECT_TRUE(status.launcher_backed_up);
    EXPECT_TRUE(status.launcher_missing);

    // Verifier que le backup INI existe
    EXPECT_TRUE(fs::exists(temp_dir_ / "GameBootstrapper.ini.bak"));

    // Verifier que l'INI pointe vers nie.exe
    const auto ini_content = read_file(temp_dir_ / "GameBootstrapper.ini");
    EXPECT_NE(ini_content.find("ApplicationPath=nie.exe"), std::string::npos);

    // Verifier que le launcher a ete renomme
    EXPECT_FALSE(fs::exists(temp_dir_ / "EACLauncher.exe"));
    EXPECT_TRUE(fs::exists(temp_dir_ / "EACLauncher.exe.backup"));
}

TEST_F(EacServiceTest, DisableEacIdempotent) {
    // Deja desactive (pas de launcher, INI modifie)
    write_ini("ApplicationPath=nie.exe\r\nWorkingDirectory=\r\nWaitForExit=0\r\nNoOperation=0\r\n");

    EacService svc(temp_dir_);
    EXPECT_TRUE(svc.disable_eac());
    EXPECT_TRUE(svc.is_eac_disabled());
}

TEST_F(EacServiceTest, RestoreEac) {
    // D'abord desactiver
    write_ini("ApplicationPath=EACLauncher.exe\r\nWorkingDirectory=\r\nWaitForExit=0\r\nNoOperation=0\r\n");
    create_dummy_file(temp_dir_ / "EACLauncher.exe", 1024);

    EacService svc(temp_dir_);
    EXPECT_TRUE(svc.disable_eac());
    EXPECT_TRUE(svc.is_eac_disabled());

    // Puis restaurer
    EXPECT_TRUE(svc.restore_eac());
    EXPECT_FALSE(svc.is_eac_disabled());

    const auto status = svc.get_status();
    EXPECT_FALSE(status.ini_modified);
    EXPECT_FALSE(status.launcher_backed_up);
    EXPECT_FALSE(status.launcher_missing);

    // Verifier que le launcher est de retour
    EXPECT_TRUE(fs::exists(temp_dir_ / "EACLauncher.exe"));
    EXPECT_FALSE(fs::exists(temp_dir_ / "EACLauncher.exe.backup"));

    // Verifier que le backup INI a ete supprime
    EXPECT_FALSE(fs::exists(temp_dir_ / "GameBootstrapper.ini.bak"));
}

TEST_F(EacServiceTest, RestoreWithoutBackup) {
    // Etat desactive manuellement sans backup
    write_ini("ApplicationPath=nie.exe\r\nWorkingDirectory=\r\nWaitForExit=0\r\nNoOperation=0\r\n");

    EacService svc(temp_dir_);
    EXPECT_TRUE(svc.is_eac_disabled());

    // Restaurer devrait modifier l'INI directement
    EXPECT_TRUE(svc.restore_eac());
    EXPECT_FALSE(svc.is_eac_disabled());

    const auto ini_content = read_file(temp_dir_ / "GameBootstrapper.ini");
    EXPECT_NE(ini_content.find("ApplicationPath=EACLauncher.exe"), std::string::npos);
}

TEST_F(EacServiceTest, DisableWithLauncherAlreadyBackedUp) {
    // Launcher deja backup (ancien disable partiel)
    write_ini("ApplicationPath=EACLauncher.exe\r\nWorkingDirectory=\r\nWaitForExit=0\r\nNoOperation=0\r\n");
    create_dummy_file(temp_dir_ / "EACLauncher.exe", 1024);
    create_dummy_file(temp_dir_ / "EACLauncher.exe.backup", 2048);

    EacService svc(temp_dir_);
    EXPECT_TRUE(svc.disable_eac());

    // Le launcher doit etre supprime, pas renomme (backup existe deja)
    EXPECT_FALSE(fs::exists(temp_dir_ / "EACLauncher.exe"));
    EXPECT_TRUE(fs::exists(temp_dir_ / "EACLauncher.exe.backup"));
}

TEST_F(EacServiceTest, InvalidGameDir) {
    EacService svc(fs::temp_directory_path() / "nonexistent_dir_12345");
    EXPECT_FALSE(svc.disable_eac());
    EXPECT_FALSE(svc.restore_eac());
}

TEST_F(EacServiceTest, StatusDetectsBackupOnly) {
    // INI normal mais backup du launcher existe (etat incoherent)
    write_ini("ApplicationPath=EACLauncher.exe\r\nWorkingDirectory=\r\nWaitForExit=0\r\nNoOperation=0\r\n");
    create_dummy_file(temp_dir_ / "EACLauncher.exe.backup", 1024);

    EacService svc(temp_dir_);
    // is_eac_disabled devrait detecter le backup
    EXPECT_TRUE(svc.is_eac_disabled());

    const auto status = svc.get_status();
    EXPECT_FALSE(status.ini_modified);      // INI pas modifie
    EXPECT_TRUE(status.launcher_backed_up); // Mais backup existe
}

TEST_F(EacServiceTest, IniPreservesKeyOrder) {
    write_ini("ApplicationPath=EACLauncher.exe\r\nWorkingDirectory=\r\nWaitForExit=0\r\nNoOperation=0\r\n");
    create_dummy_file(temp_dir_ / "EACLauncher.exe", 1024);

    EacService svc(temp_dir_);
    EXPECT_TRUE(svc.disable_eac());

    // Verifier que les cles sont dans le bon ordre
    const auto content = read_file(temp_dir_ / "GameBootstrapper.ini");
    const auto pos_app = content.find("ApplicationPath=");
    const auto pos_work = content.find("WorkingDirectory=");
    const auto pos_wait = content.find("WaitForExit=");
    const auto pos_noop = content.find("NoOperation=");

    EXPECT_NE(pos_app, std::string::npos);
    EXPECT_NE(pos_work, std::string::npos);
    EXPECT_NE(pos_wait, std::string::npos);
    EXPECT_NE(pos_noop, std::string::npos);

    // Ordre : ApplicationPath < WorkingDirectory < WaitForExit < NoOperation
    EXPECT_LT(pos_app, pos_work);
    EXPECT_LT(pos_work, pos_wait);
    EXPECT_LT(pos_wait, pos_noop);
}

TEST_F(EacServiceTest, GameDirAccessor) {
    EacService svc(temp_dir_);
    EXPECT_EQ(svc.game_dir(), temp_dir_);
}
