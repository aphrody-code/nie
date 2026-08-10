/**
 * @file nie_types.h
 * Structures packed issues du reverse engineering de nie.exe.
 *
 * Ces structs correspondent aux layouts memoire observes dans le
 * decompile Ghidra. Les offsets et tailles sont confirmes par
 * l'analyse des fonctions decompiless et les classes RTTI.
 */

#ifndef IECODE_DECOMP_NIE_TYPES_H
#define IECODE_DECOMP_NIE_TYPES_H

#include <stdint.h>

#pragma pack(push, 1)

/**
 * Donnees d'un joueur (GDSCharaBase / GDSCharaParam).
 * Layout observe dans les fonctions de serialisation cfg.bin.
 */
struct PlayerData {
    uint32_t player_id;
    uint32_t name_hash;
    int16_t  stats[8];      /* kick, guard, catch, body, control, speed, stamina, luck */
    uint8_t  position;
    uint8_t  element;
    uint8_t  rarity;
    uint8_t  level;
    uint32_t passive_skill_ids[5];
};

/**
 * Competence passive (GDSPassiveSkillConfig).
 */
struct PassiveSkillInfo {
    uint32_t skill_hash;
    uint32_t name_hash;
    int32_t  reserved[2];
    int32_t  build_type;
    int32_t  reserved2;
};

/**
 * Header de sauvegarde (CGDDHeaderData / RpgSaveData2).
 * Observe dans rpg_savedata.c (FUN_1400babb0).
 */
struct SaveDataHeader {
    uint32_t magic;
    uint32_t version;
    uint32_t checksum;
    uint32_t data_size;
};

/**
 * Personnage de soccer en match.
 * Stride de 0x570 (1392 octets) confirme dans soccer_match_state_machine.c.
 * Max 58 joueurs (0x3A) simultanes.
 */
struct SoccerCharaData {
    uint8_t  pad[0x570];
};

/**
 * Header RDBN (magic "RDBNP", 5 octets).
 * Conteneur de configuration moderne Level-5.
 */
struct RdbnHeader {
    char     magic[5];      /* "RDBNP" */
    uint8_t  pad[3];
    uint32_t section_count;
    uint32_t data_size;
};

/**
 * Entree de texture G4TX.
 * Layout observe dans g4tx_loader.c.
 */
struct G4txEntry {
    uint32_t name_offset;
    uint16_t width;
    uint16_t height;
    uint8_t  format;
    uint8_t  mip_count;
    uint8_t  pad[2];
    uint32_t data_offset;
    uint32_t data_size;
};

/**
 * Header de section G4PK.
 * Archive de packages Level-5.
 */
struct G4pkSectionHeader {
    uint32_t magic;         /* "G4PK" big-endian + '@' */
    uint32_t version;
    uint32_t entry_count;
    uint32_t data_offset;
};

/**
 * Donnees d'equipe en match.
 * Stride de 0x1028 confirme dans soccer_match_state_machine.c.
 */
struct SoccerTeamData {
    uint8_t  pad[0x1028];
};

#pragma pack(pop)

#endif /* IECODE_DECOMP_NIE_TYPES_H */
