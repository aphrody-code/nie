#include "iecode/game/save/save_container.h"

#include <array>

namespace iecode::game {

namespace {

// Magic CSystemSaveData (RE nie.c FUN_140d43de0) :
//   bytes 0-1 : version 0x01 0x01
//   bytes 8-11 : frame rate cap 0x3C 0x00 0x00 0x00 (= 60)
// Le payload post-dechiffrement est un dump struct brut (memcpy direct),
// pas un container G4PK/T2B.
constexpr std::array<uint8_t, 2> SYSTEM_SAVE_VERSION = {0x01, 0x01};

[[nodiscard]] bool starts_with_system_magic(std::span<const uint8_t> buf) {
    return buf.size() >= 12
        && buf[0] == SYSTEM_SAVE_VERSION[0]
        && buf[1] == SYSTEM_SAVE_VERSION[1]
        && buf[8]  == 0x3C
        && buf[9]  == 0x00
        && buf[10] == 0x00
        && buf[11] == 0x00;
}

} // namespace

std::optional<std::vector<uint8_t>>
extract_data_bin(std::span<const uint8_t> decrypted_container) {
    if (decrypted_container.empty()) {
        return std::nullopt;
    }

    // Le format post-AES est un dump struct brut (CSystemSaveData ~1 MB,
    // ou USERDATALIVE ~12 MB). On retourne le buffer tel quel — c'est
    // deja le "data.bin" logique.
    // Magic attendu pour SYSTEMLIVE : 01 01 xx xx xx xx xx xx 3C 00 00 00
    // Si les premiers bytes ne correspondent pas, le dechiffrement a
    // probablement echoue (mauvaise cle ou IV incorrect).
    (void)starts_with_system_magic; // utilisee dans save_editor pour validation

    return std::vector<uint8_t>(decrypted_container.begin(),
                                decrypted_container.end());
}

} // namespace iecode::game
