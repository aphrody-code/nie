#pragma once

/// @file gds_types.h
/// Types de base du systeme GDS (Game Data System) — ~280 classes GDS*Config.
/// Les GDS sont des donnees de configuration statiques lues depuis les fichiers cfg.bin.
/// Elles sont read-only au runtime, contrairement aux CGDD* qui sont mutables.

#include "../../engine/hash/hash_types.h"
#include <cstdint>

namespace game {

/// Langues supportees (<LG> dans les paths VFS UI).
enum class Language : uint8_t { JA = 0, EN = 1, FR = 2, DE = 3, ES = 4, IT = 5, ZH = 6, KO = 7 };

/// Nombre total de langues supportees.
inline constexpr uint8_t LANGUAGE_COUNT = 8;

/// Plate-forme cible (<PF> dans les paths VFS aide).
enum class Platform : uint8_t { Steam = 0, PS5 = 1, NSW = 2 };

/// Element d'un personnage (cycle: Fire > Wood > Earth > Wind > Fire).
enum class Element : uint8_t { Fire = 0, Wood = 1, Earth = 2, Wind = 3, None = 4 };

/// Position terrain.
enum class Position : uint8_t { FW = 0, MF = 1, DF = 2, GK = 3 };

/// Rarete d'un personnage.
enum class Rarity : uint8_t { N = 1, R = 2, SR = 3, SSR = 4, UR = 5 };

/// Tag d'une entree GDS — cle dans le fichier cfg.bin.
template<typename T>
struct GDSEntry {
    lives::hash32 id;   ///< CRC32 de la cle string
    T             data;
};

} // namespace game
