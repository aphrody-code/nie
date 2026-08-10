#pragma once

/// @file model_import.h
/// Import de modeles GLB vers le format G4MG/G4MD (Level-5).

#include <cstdint>
#include <filesystem>
#include <optional>
#include <vector>

#include "iecode/formats/level5/g4mg.h"

namespace iecode::converters {

/// Options pour l'import GLB -> G4MG.
struct ModelImportOptions {
    bool export_g4md = true;  // Generer aussi le fichier G4MD associe
};

/// Resultat de l'import GLB.
struct ModelImportResult {
    std::vector<uint8_t> g4mg_data;  // G4MG header serialise
    std::vector<uint8_t> g4md_data;  // G4MD avec vertex/index data
};

/// Charge un GLB et le convertit en G4MG + G4MD.
/// @param glb_path chemin du fichier GLB
/// @param options options d'import
/// @return donnees binaires G4MG + G4MD, ou nullopt en cas d'erreur
[[nodiscard]] std::optional<ModelImportResult> import_glb(
    const std::filesystem::path& glb_path,
    const ModelImportOptions& options = {});

/// Pipeline complet : GLB -> G4MG + G4MD fichiers sur disque.
/// @param glb_path chemin du GLB source
/// @param g4mg_path chemin du G4MG de sortie
/// @param g4md_path chemin du G4MD de sortie (vide = meme nom avec .g4md)
/// @return true si l'ecriture a reussi
[[nodiscard]] bool import_glb_to_g4mg(
    const std::filesystem::path& glb_path,
    const std::filesystem::path& g4mg_path,
    const std::filesystem::path& g4md_path = {},
    const ModelImportOptions& options = {});

} // namespace iecode::converters
