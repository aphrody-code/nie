#pragma once

/// @file nie_addresses.h
/// Carte memoire runtime de nie.exe (v5.00.24.00).
/// Offsets dans les structures en memoire, AOB patterns pour localisation dynamique.
///
/// IMPORTANT : ces adresses sont valides pour nie.exe Steam base 0x140000000.
/// En runtime, soustraire la base hardcodee et ajouter la base reelle (ASLR).

#ifdef _WIN32

#include "process.h"
#include "aob_scanner.h"

#include <array>
#include <cstdint>
#include <optional>
#include <string_view>

namespace iecode::memory::nie {

// ── Base du module ───────────────────────────────────────────────────

/// Base address hardcodee de nie.exe (PE ImageBase).
inline constexpr uintptr_t HARDCODED_BASE = 0x140000000ULL;

// ── Player array (match soccer) ──────────────────────────────────────

/// Adresse statique du tableau de joueurs (DAT_141fe6850).
inline constexpr uintptr_t PLAYER_ARRAY_STATIC = 0x141fe6850ULL;

/// Taille d'une structure Player en memoire.
inline constexpr size_t PLAYER_STRUCT_SIZE = 0x540;

/// Nombre max de joueurs dans le tableau (11 par equipe × 2).
inline constexpr size_t MAX_PLAYERS = 22;

/// Offsets dans la structure Player.
namespace player {
    inline constexpr uintptr_t VTABLE      = 0x00;
    inline constexpr uintptr_t STATE_FLAGS = 0x94;
    // TODO: Position (Vector3), animations, etc — a decouvrir par AOB/debug
}

// ── CGDDChara (donnees runtime personnage) ───────────────────────────

/// Offsets dans la structure CGDDChara.
/// Deduits du header gdd_chara.h + RTTI nie.exe.
namespace chara {
    inline constexpr uintptr_t CHARA_ID  = 0x00;
    inline constexpr uintptr_t LEVEL     = 0x04;
    inline constexpr uintptr_t EXP       = 0x08;
    inline constexpr uintptr_t KICK      = 0x0C;
    inline constexpr uintptr_t GUARD     = 0x0E;
    inline constexpr uintptr_t CATCH     = 0x10;
    inline constexpr uintptr_t BODY      = 0x12;
    inline constexpr uintptr_t CONTROL   = 0x14;
    inline constexpr uintptr_t SPEED     = 0x16;
    inline constexpr uintptr_t STAMINA   = 0x18;
    inline constexpr uintptr_t LUCK      = 0x1A;
    inline constexpr uintptr_t SKILLS    = 0x1C;  ///< uint32_t[6] — technique IDs
    inline constexpr uintptr_t COSTUME   = 0x34;

    /// Nombre de slots de techniques equipeees.
    inline constexpr size_t SKILL_SLOT_COUNT = 6;

    /// Nombre de stats de base (kick → luck).
    inline constexpr size_t STAT_COUNT = 8;
}

// ── AOB Patterns pour localisation dynamique ─────────────────────────

/// Patterns de signature pour trouver des structures en runtime.
/// Format : hex bytes, "??" = wildcard.
namespace aob {
    /// Pattern pour localiser le gestionnaire du tableau de joueurs.
    /// LEA rcx, [rip+??] ; CALL ?? ; MOV rax, [rbp+...]
    inline constexpr std::string_view PLAYER_ARRAY_MGR =
        "48 8D 0D ?? ?? ?? ?? E8 ?? ?? ?? ?? 48 8B 45";

    /// Pattern pour localiser la collection de personnages (CGDDCharaCollection).
    /// MOV rax, [rip+??] ; TEST rax, rax ; JZ ?? ; MOV rcx, [rax+...]
    inline constexpr std::string_view CHARA_COLLECTION =
        "48 8B 05 ?? ?? ?? ?? 48 85 C0 74 ?? 48 8B 48";

    /// Pattern pour localiser le GameDataSystem (GDS manager).
    inline constexpr std::string_view GDS_MANAGER =
        "48 89 05 ?? ?? ?? ?? 48 8B C8 E8 ?? ?? ?? ?? 48 8B 0D";

    /// Pattern pour localiser le Lua state global.
    inline constexpr std::string_view LUA_STATE =
        "48 8B 0D ?? ?? ?? ?? 48 85 C9 74 ?? E8 ?? ?? ?? ?? 48 8B D8";
}

// ── Stats runtime ────────────────────────────────────────────────────

/// Structure miroir des 8 stats de base d'un personnage.
struct CharaStats {
    int16_t kick    = 0;
    int16_t guard   = 0;
    int16_t catch_  = 0;
    int16_t body    = 0;
    int16_t control = 0;
    int16_t speed   = 0;
    int16_t stamina = 0;
    int16_t luck    = 0;
};

static_assert(sizeof(CharaStats) == 16, "CharaStats doit faire 16 bytes (8 × int16)");

/// Les 6 techniques equipees d'un personnage.
using EquippedSkills = std::array<uint32_t, chara::SKILL_SLOT_COUNT>;

// ── Helper haut-niveau ───────────────────────────────────────────────

/// Contexte de connexion a nie.exe — resout les adresses dynamiques.
class NieProcess {
public:
    /// Attache a nie.exe et resout les adresses de base.
    [[nodiscard]] static std::optional<NieProcess> attach();

    /// Adresse rebasee (ASLR) : static_addr - HARDCODED_BASE + runtime_base.
    [[nodiscard]] uintptr_t rebase(uintptr_t static_addr) const noexcept;

    /// Lit le Player[index] (0..21).
    [[nodiscard]] std::optional<std::vector<uint8_t>> read_player(uint32_t index) const;

    /// Lit les stats d'un personnage a l'adresse donnee.
    [[nodiscard]] std::optional<CharaStats> read_chara_stats(uintptr_t chara_addr) const;

    /// Ecrit les stats d'un personnage.
    bool write_chara_stats(uintptr_t chara_addr, const CharaStats& stats) const;

    /// Lit les techniques equipees.
    [[nodiscard]] std::optional<EquippedSkills> read_skills(uintptr_t chara_addr) const;

    /// Ecrit une technique dans un slot (0..5).
    bool write_skill(uintptr_t chara_addr, uint32_t slot, uint32_t skill_id) const;

    /// Lit le level + exp.
    [[nodiscard]] std::optional<std::pair<uint32_t, uint32_t>> read_level_exp(
        uintptr_t chara_addr) const;

    /// Ecrit le level + exp.
    bool write_level_exp(uintptr_t chara_addr, uint32_t level, uint32_t exp) const;

    /// Trouve une adresse par AOB pattern (dans le module principal).
    [[nodiscard]] std::optional<uintptr_t> find_pattern(std::string_view pattern) const;

    /// Resout un pointeur RIP-relatif depuis un resultat AOB.
    [[nodiscard]] std::optional<uintptr_t> resolve_rip_from_aob(
        std::string_view pattern, size_t rip_offset, size_t instr_len) const;

    /// Acces au ProcessHandle sous-jacent.
    [[nodiscard]] const ProcessHandle& process() const noexcept { return process_; }

private:
    explicit NieProcess(ProcessHandle proc);

    ProcessHandle process_;
};

} // namespace iecode::memory::nie

#endif // _WIN32
