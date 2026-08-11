#pragma once

/// @file cfgbin.h
/// Parser de fichiers cfg.bin (configuration Level-5).
/// Supporte deux formats : T2B (legacy, footer 01 74 32 62) et RDBN (moderne).
/// Dechiffrement automatique via XorShift si necessaire.

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <unordered_map>
#include <variant>
#include <vector>

namespace iecode::level5 {

// ── Types T2B (format classique Level-5) ──────────────────────────────

/// Type d'une variable dans une entree cfg.bin (packed 2-bit).
enum class CfgVarType : uint8_t {
    String  = 0,
    Int     = 1,
    Float   = 2,
    Unknown = 3,
};

/// Valeur d'une variable cfg.bin.
using CfgVarValue = std::variant<std::string, int32_t, float, std::monostate>;

/// Variable (champ) d'une entree cfg.bin.
struct CfgVariable {
    CfgVarType type = CfgVarType::Unknown;
    CfgVarValue value;
    std::string name; // optionnel (resolu via key table)
};

/// Entree dans l'arbre cfg.bin. Chaque entree a un nom (resolu via CRC32),
/// des variables typees, et potentiellement des enfants (hierarchie BEG/END).
struct CfgEntry {
    std::string name;
    uint32_t crc32 = 0;
    bool end_terminator = false;
    std::vector<CfgVariable> variables;
    std::vector<CfgEntry> children;
};

// ── Types RDBN (format moderne Level-5 / IEVR) ───────────────────────

/// Type d'un champ RDBN.
enum class RdbnFieldType : int16_t {
    AbilityData = 0,
    EnhanceData = 1,
    StatusRate  = 2,
    Bool        = 3,
    Byte        = 4,
    Short       = 5,
    Int         = 6,
    ActType     = 9,
    Flag        = 10,
    Float       = 13,
    Hash        = 15,
    Rates       = 18,      // 4x float
    Position    = 19,      // 4x float
    Condition   = 20,      // string reference or uint32
    ShortTuple  = 21,      // 2x short
};

/// Valeur d'un champ RDBN (polymorphe).
using RdbnValue = std::variant<
    bool,                           // Bool
    uint8_t,                        // Byte
    int16_t,                        // Short, ActType
    int32_t,                        // Int, Flag
    float,                          // Float
    std::string,                    // Hash ("0x..."), Condition (string)
    std::vector<float>,             // Rates (4), Position (4)
    std::vector<int16_t>,           // ShortTuple (2)
    std::vector<uint8_t>            // Fallback (hex blob)
>;

/// Champ d'une entree RDBN.
struct RdbnField {
    std::string name;
    uint32_t name_hash = 0;
    RdbnFieldType type = RdbnFieldType::Int;
    RdbnValue value;
};

/// Entree RDBN (une ligne dans une liste/table).
struct RdbnEntry {
    std::vector<RdbnField> fields;
};

/// Liste/table RDBN (correspond a un "root entry" dans le header RDBN).
struct RdbnList {
    std::string name;
    uint32_t name_hash = 0;
    std::vector<RdbnEntry> entries;
};

// ── CfgBinFile (resultat unifie) ──────────────────────────────────────

/// Fichier cfg.bin parse. Contient soit des entries T2B, soit des lists RDBN.
struct CfgBinFile {
    enum class Format { T2B, RDBN } format = Format::T2B;

    // T2B
    std::vector<CfgEntry> entries;
    std::unordered_map<uint32_t, std::string> key_table;

    // RDBN
    std::vector<RdbnList> lists;

    /// Nombre total de noeuds/entrees.
    [[nodiscard]] size_t node_count() const noexcept;
};

// ── Backward compatibility aliases ────────────────────────────────────

/// Ancien nom — utiliser CfgBinFile.
using CfgBin = CfgBinFile;

/// Ancien type — utiliser CfgEntry.
using CfgNode = CfgEntry;

/// Ancien type — utiliser CfgVarValue.
using CfgValue = CfgVarValue;

// ── API ───────────────────────────────────────────────────────────────

/// Parse un fichier cfg.bin (dechiffre XorShift si necessaire, auto-detecte T2B/RDBN).
[[nodiscard]] std::optional<CfgBinFile> cfgbin_parse(std::span<const uint8_t> data);

/// Serialise un CfgBinFile en JSON lisible.
[[nodiscard]] std::string cfgbin_to_json(const CfgBinFile& cfg);

/// Serialise un CfgBinFile en binaire (format original Level-5).
/// Dispatche automatiquement vers cfgbin_write_t2b() ou cfgbin_write_rdbn() selon le format.
/// Retourne un vecteur vide en cas d'erreur.
[[nodiscard]] std::vector<uint8_t> cfgbin_write(const CfgBinFile& cfg);

/// Serialise un CfgBinFile RDBN en binaire (format moderne Level-5 / IEVR).
/// Reconstruit le header RDBN (0x50 bytes), les tables de types/champs/racines,
/// la string table (hashes + offsets), les valeurs et les chaines.
/// Retourne un vecteur vide si le format n'est pas RDBN ou en cas d'erreur.
[[nodiscard]] std::vector<uint8_t> cfgbin_write_rdbn(const CfgBinFile& cfg);

// ── API — CRUD sur entrees T2B ──────────────────────────────────

/// Ajoute une entree enfant a un parent. Le CRC32 du nom est calcule automatiquement.
/// Retourne une reference a l'entree ajoutee.
CfgEntry& cfgbin_add_entry(CfgEntry& parent, std::string_view name);

/// Supprime la premiere entree enfant dont le nom de base correspond (sans suffixe _N).
/// Retourne true si une entree a ete supprimee.
bool cfgbin_remove_entry(CfgEntry& parent, std::string_view name);

/// Cherche une entree enfant par nom (comparaison sur le nom de base, sans suffixe _N).
/// Si recursive est true, cherche dans toute la sous-arborescence.
CfgEntry* cfgbin_find_entry(CfgEntry& parent, std::string_view name, bool recursive = false);
const CfgEntry* cfgbin_find_entry(const CfgEntry& parent, std::string_view name, bool recursive = false);

// ── API — CRUD sur variables (champs) d'une entree T2B ─────────

/// Ajoute une variable (champ) a une entree.
void cfgbin_add_field(CfgEntry& entry, std::string_view name, CfgVarType type, CfgVarValue value);

/// Supprime une variable par index. Retourne true si l'index etait valide.
bool cfgbin_remove_field(CfgEntry& entry, size_t field_index);

/// Modifie la valeur d'une variable existante par nom.
/// Retourne true si le champ a ete trouve et mis a jour.
bool cfgbin_set_field(CfgEntry& entry, std::string_view name, CfgVarValue value);

/// Cherche une variable par nom dans une entree.
/// Retourne nullptr si non trouvee.
CfgVarValue* cfgbin_find_field(CfgEntry& entry, std::string_view name);
const CfgVarValue* cfgbin_find_field(const CfgEntry& entry, std::string_view name);

} // namespace iecode::level5
