#pragma once

/// @file mod_packager.h
/// Packaging de mods en archives ZIP pour distribution.

#include "iecode/modding/mod_info.h"

#include <filesystem>
#include <string>
#include <vector>

namespace iecode::modding {

/// Options de packaging d'un mod.
struct PackageOptions {
    std::filesystem::path mod_dir;       // dossier source du mod
    std::filesystem::path output_path;   // chemin du .zip en sortie
    bool include_readme = true;          // inclure README si present
    bool validate = true;                // valider la structure avant packaging
};

/// Resultat du packaging.
struct PackageResult {
    bool success = false;
    std::filesystem::path output_path;
    size_t files_packaged = 0;
    size_t total_size_bytes = 0;
    std::string error;
};

/// Resultat de validation d'un mod.
struct ValidationResult {
    bool valid = true;
    std::vector<std::string> errors;     // problemes bloquants
    std::vector<std::string> warnings;   // problemes non-bloquants
};

/// Package un mod dans une archive ZIP distribuable.
///
/// Le ZIP contient :
///   - mod_data.json (racine)
///   - data/ (contenu du mod)
///   - README.md ou README.txt si present et include_readme=true
///
/// @param options  options de packaging
/// @return resultat avec chemin du ZIP, nombre de fichiers, taille totale
[[nodiscard]] PackageResult package_mod(const PackageOptions& options);

/// Valide la structure d'un dossier de mod.
///
/// Verificiations :
///   - mod_data.json existe et est un JSON valide
///   - Le dossier data/ existe et contient au moins un fichier
///   - Les champs obligatoires (name, author) sont presents
///   - La version du mod est au format semver si presente
///
/// @param mod_dir  dossier racine du mod
/// @return resultat de validation avec erreurs et avertissements
[[nodiscard]] ValidationResult validate_mod_structure(
    const std::filesystem::path& mod_dir);

/// Genere un template mod_data.json et la structure de dossier pour un nouveau mod.
///
/// Cree :
///   - <dir>/mod_data.json avec les champs pre-remplis
///   - <dir>/data/ (dossier vide)
///
/// @param dir       dossier cible
/// @param mod_name  nom du mod
/// @param author    nom de l'auteur
/// @return true si la creation a reussi
bool create_mod_template(
    const std::filesystem::path& dir,
    const std::string& mod_name,
    const std::string& author);

} // namespace iecode::modding
