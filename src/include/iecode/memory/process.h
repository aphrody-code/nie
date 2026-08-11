#pragma once

/// @file process.h
/// Gestion de processus externe — attach, lecture/ecriture memoire, pointer chains.
/// Windows uniquement (ReadProcessMemory / WriteProcessMemory).

#ifdef _WIN32

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

// Forward-declare Windows types pour eviter d'inclure <windows.h> dans le header
using HANDLE = void*;

namespace iecode::memory {

/// Informations sur un module charge dans le processus cible.
struct ModuleInfo {
    std::string name;
    uintptr_t   base_address = 0;
    uint32_t    size          = 0;
};

/// Informations sur une region memoire (VirtualQueryEx).
struct MemoryRegion {
    uintptr_t base_address = 0;
    size_t    region_size  = 0;
    uint32_t  protect      = 0;   ///< PAGE_* flags
    uint32_t  state        = 0;   ///< MEM_COMMIT, MEM_FREE, MEM_RESERVE
    uint32_t  type         = 0;   ///< MEM_IMAGE, MEM_MAPPED, MEM_PRIVATE
};

/// Handle RAII vers un processus externe.
///
/// Usage :
/// @code
///   auto proc = ProcessHandle::attach("nie.exe");
///   if (!proc) return;
///   auto value = proc->read<int32_t>(0x141fe6850);
/// @endcode
class ProcessHandle {
public:
    /// Attache au premier processus correspondant au nom d'executable.
    [[nodiscard]] static std::optional<ProcessHandle> attach(std::string_view exe_name);

    /// Attache par PID directement.
    [[nodiscard]] static std::optional<ProcessHandle> attach_pid(uint32_t pid);

    ~ProcessHandle();

    // Move-only
    ProcessHandle(ProcessHandle&& other) noexcept;
    ProcessHandle& operator=(ProcessHandle&& other) noexcept;
    ProcessHandle(const ProcessHandle&) = delete;
    ProcessHandle& operator=(const ProcessHandle&) = delete;

    // ── Lecture ──────────────────────────────────────────────────────

    /// Lit un bloc brut depuis la memoire du processus.
    [[nodiscard]] bool read_bytes(uintptr_t address, void* buffer, size_t size) const;

    /// Lit un type POD depuis la memoire.
    template<typename T>
    [[nodiscard]] std::optional<T> read(uintptr_t address) const {
        static_assert(std::is_trivially_copyable_v<T>);
        T value{};
        if (!read_bytes(address, &value, sizeof(T))) return std::nullopt;
        return value;
    }

    /// Lit un vecteur d'octets.
    [[nodiscard]] std::optional<std::vector<uint8_t>> read_vec(uintptr_t address, size_t size) const;

    /// Lit une chaine C (null-terminated) jusqu'a max_len.
    [[nodiscard]] std::optional<std::string> read_string(uintptr_t address, size_t max_len = 256) const;

    // ── Ecriture ─────────────────────────────────────────────────────

    /// Ecrit un bloc brut dans la memoire du processus.
    bool write_bytes(uintptr_t address, const void* data, size_t size) const;

    /// Ecrit un type POD dans la memoire.
    template<typename T>
    bool write(uintptr_t address, const T& value) const {
        static_assert(std::is_trivially_copyable_v<T>);
        return write_bytes(address, &value, sizeof(T));
    }

    // ── Pointer chain ────────────────────────────────────────────────

    /// Resout une chaine de pointeurs : base → [+off0] → [+off1] → ... → adresse finale.
    /// Retourne nullopt si un maillon est invalide.
    [[nodiscard]] std::optional<uintptr_t> resolve_chain(
        uintptr_t base, std::span<const uintptr_t> offsets) const;

    // ── Modules ──────────────────────────────────────────────────────

    /// Enumere les modules charges dans le processus.
    [[nodiscard]] std::vector<ModuleInfo> enumerate_modules() const;

    /// Trouve un module par nom (case-insensitive).
    [[nodiscard]] std::optional<ModuleInfo> find_module(std::string_view name) const;

    // ── Memory regions ───────────────────────────────────────────────

    /// Enumere les regions memoire committees du processus.
    [[nodiscard]] std::vector<MemoryRegion> enumerate_regions() const;

    /// Enumere uniquement les regions executables (pour AOB scan).
    [[nodiscard]] std::vector<MemoryRegion> enumerate_executable_regions() const;

    // ── Protection ───────────────────────────────────────────────────

    /// Change la protection memoire d'une region. Retourne l'ancienne protection.
    [[nodiscard]] std::optional<uint32_t> set_protection(
        uintptr_t address, size_t size, uint32_t new_protect) const;

    // ── Accesseurs ───────────────────────────────────────────────────

    [[nodiscard]] uintptr_t base_address() const noexcept { return base_address_; }
    [[nodiscard]] uint32_t  pid()          const noexcept { return pid_; }
    [[nodiscard]] bool      is_valid()     const;

private:
    ProcessHandle(HANDLE h, uint32_t pid, uintptr_t base);

    void close() noexcept;

    HANDLE    handle_       = nullptr;
    uint32_t  pid_          = 0;
    uintptr_t base_address_ = 0;
};

} // namespace iecode::memory

#endif // _WIN32
