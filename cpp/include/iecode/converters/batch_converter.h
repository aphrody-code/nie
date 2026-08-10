#pragma once

/// @file batch_converter.h
/// Conversion massive parallele de textures G4TX → PNG/WebP.
///
/// Pipeline optimise pour 10K-100K fichiers :
///   1. Enumeration recursive rapide
///   2. Pool de threads avec work-stealing atomique
///   3. I/O pre-read en batch (minimise les syscalls)
///   4. Decode + encode en parallele sans lock
///   5. Stats en temps reel (atomiques)

#include "iecode/converters/texture_export.h"
#include "iecode/formats/level5/g4tx.h"

#include <atomic>
#include <filesystem>
#include <functional>
#include <string>
#include <vector>

namespace iecode::converters {

/// Statistiques de conversion (thread-safe via atomics).
struct BatchStats {
    std::atomic<size_t> total_files{0};
    std::atomic<size_t> processed{0};
    std::atomic<size_t> succeeded{0};
    std::atomic<size_t> failed{0};
    std::atomic<size_t> skipped{0};
    std::atomic<uint64_t> total_pixels{0};
    std::atomic<uint64_t> total_bytes_in{0};
    std::atomic<uint64_t> total_bytes_out{0};
    std::atomic<uint64_t> elapsed_us{0};  // Rempli a la fin
};

/// Options de conversion batch.
struct BatchOptions {
    ExportFormat format = ExportFormat::PNG;
    int webp_quality = 90;
    bool webp_lossless = false;
    int threads = 0;          // 0 = auto (hardware_concurrency)
    bool recursive = true;
    bool flat_output = false;  // true = tous les fichiers au meme niveau (pas de sous-dossiers)
    bool skip_existing = false; // true = ne pas re-convertir si le fichier existe deja
    bool verbose = false;

    /// Callback de progression (thread-safe). Peut etre null.
    /// Appele apres chaque fichier traite.
    std::function<void(const BatchStats& stats, const std::string& current_file)> on_progress;
};

/// Convertit tous les fichiers G4TX d'un dossier en PNG/WebP/DDS.
///
/// Pipeline :
///   1. Scan recursif → liste de fichiers
///   2. N threads consomment la liste (work-stealing atomique)
///   3. Chaque thread : read → parse → decode → encode → write
///   4. Stats agrégées en temps réel
///
/// @param input_dir dossier contenant les .g4tx
/// @param output_dir dossier de sortie
/// @param options configuration
/// @param stats recoit les statistiques (peut etre partage)
/// @return nombre de fichiers convertis avec succes
size_t batch_convert(const std::filesystem::path& input_dir,
                      const std::filesystem::path& output_dir,
                      const BatchOptions& options,
                      BatchStats& stats);

} // namespace iecode::converters
