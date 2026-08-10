#pragma once

/**
 * @file bridge.h
 * Wrappers C++ pour les fonctions decompiless de nie.exe.
 *
 * Ce fichier declare les fonctions bridge qui encapsulent le pseudo-C
 * Ghidra en interfaces C++ propres. Ajouter une declaration ici chaque
 * fois qu'une fonction decompiless est identifiee et wrappee.
 */

#include "nie_types.h"
#include "nie_parser.h"

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace iecode::decomp {

// ── Mapping adresse → nom RTTI ─────────────────────────────────────

/// Correspondance entre une adresse FUN_14* et un nom RTTI connu.
struct RttiMapping {
    std::string address;      // ex: "FUN_140001000"
    std::string rtti_class;   // ex: "game::CCharaController"
    std::string method_name;  // ex: "update" (optionnel)
};

/// Registre de mappings adresse → RTTI.
/// Charge les mappings connus et permet l'ajout dynamique.
class RttiRegistry {
public:
    /// Charge les mappings connus du jeu (hardcodes).
    void load_known_mappings();

    /// Ajoute un mapping.
    void add_mapping(const std::string& address,
                     const std::string& rtti_class,
                     const std::string& method_name = "");

    /// Recherche un mapping par adresse (ex: "FUN_140c39f90").
    [[nodiscard]] std::optional<RttiMapping> find_by_address(
        const std::string& address) const;

    /// Recherche tous les mappings d'une classe RTTI.
    [[nodiscard]] std::vector<RttiMapping> find_by_class(
        const std::string& rtti_class) const;

    /// Nombre de mappings enregistres.
    [[nodiscard]] size_t size() const { return mappings_.size(); }

private:
    std::unordered_map<std::string, RttiMapping> mappings_;
};

// ── Extraction du corps d'une fonction ─────────────────────────────

/// Recupere le corps d'une fonction depuis le fichier nie.c.
/// @param nie_path Chemin vers nie.c
/// @param func Fonction dont on veut extraire le body
/// @return Le code source complet de la fonction, ou nullopt si echec
[[nodiscard]] std::optional<std::string> extract_function_body(
    const std::string& nie_path,
    const NieFunction& func);

// ── Wrappers de fonctions decompiless ──────────────────────────────

// Les implementations sont ajoutees au fur et a mesure du RE.

} // namespace iecode::decomp
