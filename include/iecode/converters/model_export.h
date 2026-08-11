#pragma once

/// @file model_export.h
/// Export de modeles G4MG vers GLB (glTF binary).

#include <filesystem>
#include "iecode/formats/level5/g4mg.h"

namespace iecode::converters {

/// Exporte un modele G4MG en fichier GLB.
/// @return true si l'export a reussi
[[nodiscard]] bool export_glb(const level5::G4mgFile& model,
                               const std::filesystem::path& output_path);

} // namespace iecode::converters
