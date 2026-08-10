#pragma once

/// @file dump.h
/// Extraction massive de fichiers CPK (Viola dump).
///
/// Scanne un dossier pour trouver des fichiers .cpk, les extrait tous
/// en parallele avec un pool de threads configurable.
///
/// Equivalent C++ de Viola.Core.Dump.Logic.CDump (C#).

#include <atomic>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <string>

namespace iecode::viola {

/// Statistiques d'extraction (thread-safe via atomics).
struct DumpStats {
    std::atomic<size_t> cpk_found{0};       // CPK trouves
    std::atomic<size_t> cpk_processed{0};   // CPK traites
    std::atomic<size_t> cpk_failed{0};      // CPK en erreur
    std::atomic<size_t> files_extracted{0}; // Fichiers individuels extraits
    std::atomic<uint64_t> bytes_written{0}; // Octets ecrits
};

/// Options d'extraction batch.
struct DumpOptions {
    uint32_t key = 0;           // Cle CRI XOR (0 = pas de dechiffrement)
    int threads = 0;            // 0 = auto (hardware_concurrency - 1, min 1)
    bool recursive = true;      // Scanner recursivement le dossier

    /// Callback de progression (thread-safe). Peut etre null.
    std::function<void(const DumpStats& stats, const std::string& current_cpk)> on_progress;
};

/// Extrait tous les fichiers CPK d'un dossier.
///
/// Pipeline :
///   1. Scan du dossier pour trouver les *.cpk
///   2. N threads traitent les CPK en parallele
///   3. Chaque CPK : open -> list -> extract chaque fichier -> write
///   4. Stats agrégées en temps reel
///
/// @param cpk_dir     dossier contenant les .cpk
/// @param output_dir  dossier de sortie (structure preservee)
/// @param options     configuration (cle, threads, etc.)
/// @param stats       recoit les statistiques (partage entre threads)
/// @return nombre total de fichiers extraits
size_t batch_extract(const std::filesystem::path& cpk_dir,
                     const std::filesystem::path& output_dir,
                     const DumpOptions& options,
                     DumpStats& stats);

} // namespace iecode::viola
