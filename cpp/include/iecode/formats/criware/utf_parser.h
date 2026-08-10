#pragma once

/// @file utf_parser.h
/// Parser de tables @UTF (CRI Universal Table Format).

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <variant>
#include <vector>

namespace iecode::criware {

/// Types de colonnes UTF (mapping CRI Middleware complet).
/// Correspond au format utilise par CRI SDK v2.x+ (IEVR, etc.).
enum class UtfColumnType : uint8_t {
    Byte = 0,       // uint8_t
    SByte = 1,      // int8_t
    UInt16 = 2,     // uint16_t
    Int16 = 3,      // int16_t
    UInt32 = 4,     // uint32_t
    Int32 = 5,      // int32_t
    UInt64 = 6,     // uint64_t
    Int64 = 7,      // int64_t
    Single = 8,     // float (IEEE 754 32-bit)
    Double = 9,     // double (IEEE 754 64-bit)
    String = 10,    // offset u32 dans le string pool
    Data = 11,      // offset u32 + size u32 (vldata)
    Guid = 12,      // GUID (16 octets)
};

/// Valeur d'une cellule UTF.
using UtfValue = std::variant<
    uint8_t,
    uint16_t,
    uint32_t,
    uint64_t,
    float,
    double,
    std::string,
    std::vector<uint8_t>
>;

/// Description d'une colonne UTF.
struct UtfColumn {
    std::string name;
    UtfColumnType type = UtfColumnType::Byte;
    uint8_t flags = 0;
};

/// Ligne d'une table UTF (une valeur par colonne).
struct UtfRow {
    std::vector<UtfValue> values;
};

/// Table UTF complete.
struct UtfTable {
    std::string name;
    std::vector<UtfColumn> columns;
    std::vector<UtfRow> rows;
};

/// Parse une table @UTF depuis un span brut.
[[nodiscard]] std::optional<UtfTable> utf_parse(std::span<const uint8_t> data);

} // namespace iecode::criware
