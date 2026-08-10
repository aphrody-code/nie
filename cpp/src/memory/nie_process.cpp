/// @file nie_process.cpp
/// Implementation de NieProcess — helper haut-niveau pour nie.exe.

#ifdef _WIN32

#include "iecode/memory/nie_addresses.h"

#include <spdlog/spdlog.h>

#include <cstring>

namespace iecode::memory::nie {

// ── NieProcess ───────────────────────────────────────────────────────

NieProcess::NieProcess(ProcessHandle proc)
    : process_(std::move(proc)) {}

std::optional<NieProcess> NieProcess::attach() {
    auto proc = ProcessHandle::attach("nie.exe");
    if (!proc) {
        spdlog::error("nie: impossible d'attacher a nie.exe — le jeu est-il lance ?");
        return std::nullopt;
    }

    spdlog::info("nie: attache a nie.exe PID={} base=0x{:X}",
                 proc->pid(), proc->base_address());
    return NieProcess(std::move(*proc));
}

uintptr_t NieProcess::rebase(uintptr_t static_addr) const noexcept {
    return static_addr - HARDCODED_BASE + process_.base_address();
}

// ── Player ───────────────────────────────────────────────────────────

std::optional<std::vector<uint8_t>> NieProcess::read_player(uint32_t index) const {
    if (index >= MAX_PLAYERS) {
        spdlog::error("nie: index joueur {} hors limites (max={})", index, MAX_PLAYERS);
        return std::nullopt;
    }

    uintptr_t addr = rebase(PLAYER_ARRAY_STATIC) +
                     static_cast<uintptr_t>(index) * PLAYER_STRUCT_SIZE;
    return process_.read_vec(addr, PLAYER_STRUCT_SIZE);
}

// ── Chara stats ──────────────────────────────────────────────────────

std::optional<CharaStats> NieProcess::read_chara_stats(uintptr_t chara_addr) const {
    CharaStats stats;
    if (!process_.read_bytes(chara_addr + chara::KICK, &stats, sizeof(stats))) {
        return std::nullopt;
    }
    return stats;
}

bool NieProcess::write_chara_stats(uintptr_t chara_addr, const CharaStats& stats) const {
    return process_.write_bytes(chara_addr + chara::KICK, &stats, sizeof(stats));
}

// ── Skills ───────────────────────────────────────────────────────────

std::optional<EquippedSkills> NieProcess::read_skills(uintptr_t chara_addr) const {
    EquippedSkills skills{};
    if (!process_.read_bytes(chara_addr + chara::SKILLS, skills.data(),
                             sizeof(uint32_t) * chara::SKILL_SLOT_COUNT)) {
        return std::nullopt;
    }
    return skills;
}

bool NieProcess::write_skill(uintptr_t chara_addr, uint32_t slot, uint32_t skill_id) const {
    if (slot >= chara::SKILL_SLOT_COUNT) {
        spdlog::error("nie: slot de technique {} hors limites (max={})",
                      slot, chara::SKILL_SLOT_COUNT);
        return false;
    }

    uintptr_t addr = chara_addr + chara::SKILLS + static_cast<uintptr_t>(slot) * sizeof(uint32_t);
    return process_.write(addr, skill_id);
}

// ── Level / EXP ──────────────────────────────────────────────────────

std::optional<std::pair<uint32_t, uint32_t>> NieProcess::read_level_exp(
    uintptr_t chara_addr) const {
    auto level = process_.read<uint32_t>(chara_addr + chara::LEVEL);
    auto exp = process_.read<uint32_t>(chara_addr + chara::EXP);
    if (!level || !exp) return std::nullopt;
    return std::pair{*level, *exp};
}

bool NieProcess::write_level_exp(uintptr_t chara_addr, uint32_t level, uint32_t exp) const {
    return process_.write(chara_addr + chara::LEVEL, level) &&
           process_.write(chara_addr + chara::EXP, exp);
}

// ── AOB helpers ──────────────────────────────────────────────────────

std::optional<uintptr_t> NieProcess::find_pattern(std::string_view pattern_str) const {
    auto pattern = AobPattern::from_string(pattern_str);
    if (!pattern) return std::nullopt;

    AobScanner scanner(process_);
    return scanner.find_first(*pattern);
}

std::optional<uintptr_t> NieProcess::resolve_rip_from_aob(
    std::string_view pattern_str, size_t rip_offset, size_t instr_len) const {
    auto addr = find_pattern(pattern_str);
    if (!addr) return std::nullopt;

    AobScanner scanner(process_);
    return scanner.resolve_rip_relative(*addr, rip_offset, instr_len);
}

} // namespace iecode::memory::nie

#endif // _WIN32
