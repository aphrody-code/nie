#pragma once

/// @file gamedata/config_parser.h
/// Utilitaires de parsing pour les ConfigNode (cfg.bin entries format).
/// Port depuis inagle/src/core/config-parser.ts (186 lignes).
///
/// Fournit les helpers pour extraire des valeurs typees depuis les
/// arbres CfgEntry et les listes RDBN.

#include "iecode/formats/level5/cfgbin.h"

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace iecode::gamedata {

// ── Helpers d'extraction de variables (format entries/T2B) ──────────

/// Parse une variable Int depuis un CfgEntry.
[[nodiscard]] int32_t parse_int_var(const level5::CfgVariable& v);

/// Parse une variable Float.
[[nodiscard]] float parse_float_var(const level5::CfgVariable& v);

/// Parse une variable String.
[[nodiscard]] const std::string& parse_string_var(const level5::CfgVariable& v);

/// Convertit un entier signe en hex "0xABCD1234".
[[nodiscard]] std::string to_hex(int32_t value);

/// Convertit un entier non-signe en hex "0xABCD1234".
[[nodiscard]] std::string to_hex(uint32_t value);

/// Parse un hex "0xABCD1234" en entier signe.
[[nodiscard]] int32_t from_hex(const std::string& hex);

// ── Traversee de l'arbre CfgEntry ───────────────────────────────────

/// Cherche tous les noeuds dont le nom commence par le prefixe donne.
/// Traverse recursivement les enfants.
[[nodiscard]] std::vector<const level5::CfgEntry*> find_nodes_by_prefix(
    const std::vector<level5::CfgEntry>& entries,
    const std::string& prefix);

/// Cherche le premier noeud dont le nom commence par le prefixe.
[[nodiscard]] const level5::CfgEntry* find_first_node(
    const std::vector<level5::CfgEntry>& entries,
    const std::string& prefix);

/// Visite tous les noeuds recursivement.
void visit_nodes(const std::vector<level5::CfgEntry>& entries,
                  const std::function<void(const level5::CfgEntry&)>& visitor);

// ── Helpers RDBN (format lists) ─────────────────────────────────────

/// Cherche une liste RDBN par nom.
[[nodiscard]] const level5::RdbnList* find_list(
    const level5::CfgBinFile& cfg,
    const std::string& name);

/// Extrait une valeur int depuis un champ RDBN.
[[nodiscard]] int32_t rdbn_int(const level5::RdbnField& f);

/// Extrait une valeur float depuis un champ RDBN.
[[nodiscard]] float rdbn_float(const level5::RdbnField& f);

/// Extrait une valeur string/hash depuis un champ RDBN.
[[nodiscard]] std::string rdbn_string(const level5::RdbnField& f);

/// Extrait une valeur bool depuis un champ RDBN.
[[nodiscard]] bool rdbn_bool(const level5::RdbnField& f);

/// Cherche un champ par nom dans une entree RDBN.
[[nodiscard]] const level5::RdbnField* find_field(
    const level5::RdbnEntry& entry,
    const std::string& name);

} // namespace iecode::gamedata
