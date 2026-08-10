// Client user-mode C++20 pour iecode_memread.sys.
// Encapsule l'ouverture du device, les IOCTL et la resolution PID par nom.

#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#ifndef WIN32_LEAN_AND_MEAN
#  define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

namespace iecode::driver {

class MemReadClient {
public:
    MemReadClient() = default;
    ~MemReadClient();

    MemReadClient(const MemReadClient&)            = delete;
    MemReadClient& operator=(const MemReadClient&) = delete;
    MemReadClient(MemReadClient&&) noexcept;
    MemReadClient& operator=(MemReadClient&&) noexcept;

    // Ouvre \\.\IecodeMemRead. Retourne false si le driver n'est pas charge.
    [[nodiscard]] bool open();

    void               close() noexcept;
    [[nodiscard]] bool is_open() const noexcept { return device_ != INVALID_HANDLE_VALUE; }

    // Lit `size` bytes a `address` dans le process `pid`.
    // Retourne nullopt en cas d'echec (driver, IOCTL, ou MmCopyVirtualMemory).
    // `size` doit etre <= 4096 (contrainte du driver, METHOD_BUFFERED).
    [[nodiscard]] std::optional<std::vector<uint8_t>>
    read_memory(uint32_t pid, uint64_t address, uint32_t size);

    struct ModuleInfo {
        uint64_t base = 0;
        uint64_t size = 0;
    };

    // Resout module_name -> base/size dans le process cible.
    // module_name est compare case-insensitive au BaseDllName (ex: L"nie.exe").
    [[nodiscard]] std::optional<ModuleInfo>
    get_module_base(uint32_t pid, const std::wstring& module_name);

    // Helper : recherche le premier PID dont le nom correspond.
    // Retourne nullopt si introuvable. N'utilise pas le driver (Toolhelp32).
    [[nodiscard]] static std::optional<uint32_t>
    find_pid(const wchar_t* process_name);

private:
    HANDLE device_ = INVALID_HANDLE_VALUE;
};

} // namespace iecode::driver
