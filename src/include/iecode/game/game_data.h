#pragma once

/// @file game_data.h
/// Structures de donnees du jeu (joueurs, equipes, etc.).

#include <array>
#include <cstdint>
#include <string>

namespace iecode::game {

/// Donnees d'un joueur (GDSCharaBase / GDSCharaParam).
struct PlayerData {
    uint32_t player_id = 0;
    uint32_t name_hash = 0;
    std::array<int16_t, 8> stats = {};  // kick, guard, catch, body, control, speed, stamina, luck
    uint8_t position = 0;
    uint8_t element = 0;
    uint8_t rarity = 0;
    uint8_t level = 1;
    std::array<uint32_t, 5> passive_skill_ids = {};
};

/// Position d'un joueur sur le terrain.
enum class PlayerPosition : uint8_t {
    FW = 0,   // Attaquant
    MF = 1,   // Milieu
    DF = 2,   // Defenseur
    GK = 3,   // Gardien
};

/// Element d'un joueur.
enum class PlayerElement : uint8_t {
    Fire  = 0,
    Wind  = 1,
    Earth = 2,
    Wood  = 3,
};

} // namespace iecode::game
