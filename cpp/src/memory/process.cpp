/// @file process.cpp
/// Implementation de ProcessHandle — attach, lecture/ecriture memoire, pointer chains.

#ifdef _WIN32

#include "iecode/memory/process.h"

#include <spdlog/spdlog.h>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <tlhelp32.h>

#include <algorithm>
#include <cctype>

namespace iecode::memory {

// ── Helpers internes ─────────────────────────────────────────────────

namespace {

/// Comparaison de chaines case-insensitive (ASCII).
bool iequals(std::string_view a, std::string_view b) noexcept {
    if (a.size() != b.size()) return false;
    for (size_t i = 0; i < a.size(); ++i) {
        if (std::tolower(static_cast<unsigned char>(a[i])) !=
            std::tolower(static_cast<unsigned char>(b[i])))
            return false;
    }
    return true;
}

/// Trouve le PID d'un processus par nom d'executable.
std::optional<uint32_t> find_pid_by_name(std::string_view exe_name) {
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) {
        spdlog::error("memory: CreateToolhelp32Snapshot echec (err={})", GetLastError());
        return std::nullopt;
    }

    PROCESSENTRY32W pe{};
    pe.dwSize = sizeof(pe);

    if (!Process32FirstW(snap, &pe)) {
        CloseHandle(snap);
        return std::nullopt;
    }

    do {
        // Convertir wchar_t en string pour comparaison
        char name_buf[MAX_PATH]{};
        WideCharToMultiByte(CP_UTF8, 0, pe.szExeFile, -1, name_buf,
                            sizeof(name_buf), nullptr, nullptr);
        if (iequals(name_buf, exe_name)) {
            uint32_t pid = pe.th32ProcessID;
            CloseHandle(snap);
            spdlog::info("memory: processus '{}' trouve (PID={})", exe_name, pid);
            return pid;
        }
    } while (Process32NextW(snap, &pe));

    CloseHandle(snap);
    spdlog::warn("memory: processus '{}' non trouve", exe_name);
    return std::nullopt;
}

/// Recupere l'adresse de base du module principal d'un processus.
std::optional<uintptr_t> get_module_base(uint32_t pid, std::string_view module_name) {
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid);
    if (snap == INVALID_HANDLE_VALUE) {
        spdlog::error("memory: CreateToolhelp32Snapshot(MODULE) echec (err={})", GetLastError());
        return std::nullopt;
    }

    MODULEENTRY32W me{};
    me.dwSize = sizeof(me);

    if (!Module32FirstW(snap, &me)) {
        CloseHandle(snap);
        return std::nullopt;
    }

    do {
        char name_buf[MAX_PATH]{};
        WideCharToMultiByte(CP_UTF8, 0, me.szModule, -1, name_buf,
                            sizeof(name_buf), nullptr, nullptr);
        if (iequals(name_buf, module_name)) {
            auto base = reinterpret_cast<uintptr_t>(me.modBaseAddr);
            CloseHandle(snap);
            spdlog::info("memory: module '{}' base=0x{:X} size={}",
                         module_name, base, me.modBaseSize);
            return base;
        }
    } while (Module32NextW(snap, &me));

    CloseHandle(snap);
    spdlog::warn("memory: module '{}' non trouve dans PID={}", module_name, pid);
    return std::nullopt;
}

} // namespace

// ── ProcessHandle ────────────────────────────────────────────────────

ProcessHandle::ProcessHandle(HANDLE h, uint32_t pid, uintptr_t base)
    : handle_(h), pid_(pid), base_address_(base) {}

ProcessHandle::~ProcessHandle() {
    close();
}

ProcessHandle::ProcessHandle(ProcessHandle&& other) noexcept
    : handle_(other.handle_)
    , pid_(other.pid_)
    , base_address_(other.base_address_) {
    other.handle_ = nullptr;
    other.pid_ = 0;
    other.base_address_ = 0;
}

ProcessHandle& ProcessHandle::operator=(ProcessHandle&& other) noexcept {
    if (this != &other) {
        close();
        handle_ = other.handle_;
        pid_ = other.pid_;
        base_address_ = other.base_address_;
        other.handle_ = nullptr;
        other.pid_ = 0;
        other.base_address_ = 0;
    }
    return *this;
}

void ProcessHandle::close() noexcept {
    if (handle_ && handle_ != INVALID_HANDLE_VALUE) {
        CloseHandle(handle_);
        handle_ = nullptr;
    }
}

std::optional<ProcessHandle> ProcessHandle::attach(std::string_view exe_name) {
    auto pid = find_pid_by_name(exe_name);
    if (!pid) return std::nullopt;

    return attach_pid(*pid);
}

std::optional<ProcessHandle> ProcessHandle::attach_pid(uint32_t pid) {
    HANDLE h = OpenProcess(PROCESS_VM_READ | PROCESS_VM_WRITE | PROCESS_VM_OPERATION |
                           PROCESS_QUERY_INFORMATION, FALSE, pid);
    if (!h || h == INVALID_HANDLE_VALUE) {
        spdlog::error("memory: OpenProcess echec pour PID={} (err={})", pid, GetLastError());
        return std::nullopt;
    }

    // Trouver le module principal (premier module = exe)
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE, pid);
    uintptr_t base = 0;
    if (snap != INVALID_HANDLE_VALUE) {
        MODULEENTRY32W me{};
        me.dwSize = sizeof(me);
        if (Module32FirstW(snap, &me)) {
            base = reinterpret_cast<uintptr_t>(me.modBaseAddr);
        }
        CloseHandle(snap);
    }

    spdlog::info("memory: attache au PID={} base=0x{:X}", pid, base);
    return ProcessHandle(h, pid, base);
}

bool ProcessHandle::is_valid() const {
    if (!handle_ || handle_ == INVALID_HANDLE_VALUE) return false;
    DWORD exit_code = 0;
    if (!GetExitCodeProcess(handle_, &exit_code)) return false;
    return exit_code == STILL_ACTIVE;
}

// ── Lecture ──────────────────────────────────────────────────────────

bool ProcessHandle::read_bytes(uintptr_t address, void* buffer, size_t size) const {
    SIZE_T bytes_read = 0;
    BOOL ok = ReadProcessMemory(handle_, reinterpret_cast<LPCVOID>(address),
                                buffer, size, &bytes_read);
    if (!ok || bytes_read != size) {
        spdlog::trace("memory: ReadProcessMemory echec addr=0x{:X} size={} (err={})",
                      address, size, GetLastError());
        return false;
    }
    return true;
}

std::optional<std::vector<uint8_t>> ProcessHandle::read_vec(uintptr_t address, size_t size) const {
    std::vector<uint8_t> buf(size);
    if (!read_bytes(address, buf.data(), size)) return std::nullopt;
    return buf;
}

std::optional<std::string> ProcessHandle::read_string(uintptr_t address, size_t max_len) const {
    std::string buf(max_len, '\0');
    if (!read_bytes(address, buf.data(), max_len)) return std::nullopt;
    // Tronquer au premier null
    auto pos = buf.find('\0');
    if (pos != std::string::npos) buf.resize(pos);
    return buf;
}

// ── Ecriture ─────────────────────────────────────────────────────────

bool ProcessHandle::write_bytes(uintptr_t address, const void* data, size_t size) const {
    SIZE_T bytes_written = 0;
    BOOL ok = WriteProcessMemory(handle_, reinterpret_cast<LPVOID>(address),
                                 data, size, &bytes_written);
    if (!ok || bytes_written != size) {
        spdlog::warn("memory: WriteProcessMemory echec addr=0x{:X} size={} (err={})",
                     address, size, GetLastError());
        return false;
    }
    return true;
}

// ── Pointer chain ────────────────────────────────────────────────────

std::optional<uintptr_t> ProcessHandle::resolve_chain(
    uintptr_t base, std::span<const uintptr_t> offsets) const {
    uintptr_t addr = base;

    for (size_t i = 0; i < offsets.size(); ++i) {
        // Lire le pointeur a l'adresse courante (sauf pour le dernier offset)
        if (i < offsets.size() - 1) {
            auto ptr = read<uintptr_t>(addr + offsets[i]);
            if (!ptr) {
                spdlog::trace("memory: resolve_chain echec au maillon {} (addr=0x{:X}+0x{:X})",
                              i, addr, offsets[i]);
                return std::nullopt;
            }
            addr = *ptr;
        } else {
            // Dernier offset : juste l'ajouter
            addr += offsets[i];
        }
    }
    return addr;
}

// ── Modules ──────────────────────────────────────────────────────────

std::vector<ModuleInfo> ProcessHandle::enumerate_modules() const {
    std::vector<ModuleInfo> modules;

    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid_);
    if (snap == INVALID_HANDLE_VALUE) return modules;

    MODULEENTRY32W me{};
    me.dwSize = sizeof(me);

    if (Module32FirstW(snap, &me)) {
        do {
            char name_buf[MAX_PATH]{};
            WideCharToMultiByte(CP_UTF8, 0, me.szModule, -1, name_buf,
                                sizeof(name_buf), nullptr, nullptr);
            modules.push_back({
                .name = name_buf,
                .base_address = reinterpret_cast<uintptr_t>(me.modBaseAddr),
                .size = me.modBaseSize,
            });
        } while (Module32NextW(snap, &me));
    }

    CloseHandle(snap);
    return modules;
}

std::optional<ModuleInfo> ProcessHandle::find_module(std::string_view name) const {
    auto modules = enumerate_modules();
    for (auto& m : modules) {
        if (iequals(m.name, name)) return m;
    }
    return std::nullopt;
}

// ── Memory regions ───────────────────────────────────────────────────

std::vector<MemoryRegion> ProcessHandle::enumerate_regions() const {
    std::vector<MemoryRegion> regions;
    MEMORY_BASIC_INFORMATION mbi{};
    uintptr_t addr = 0;

    while (VirtualQueryEx(handle_, reinterpret_cast<LPCVOID>(addr), &mbi, sizeof(mbi))) {
        if (mbi.State == MEM_COMMIT) {
            regions.push_back({
                .base_address = reinterpret_cast<uintptr_t>(mbi.BaseAddress),
                .region_size  = mbi.RegionSize,
                .protect      = mbi.Protect,
                .state        = mbi.State,
                .type         = mbi.Type,
            });
        }
        addr = reinterpret_cast<uintptr_t>(mbi.BaseAddress) + mbi.RegionSize;
        if (addr < reinterpret_cast<uintptr_t>(mbi.BaseAddress)) break; // Overflow guard
    }
    return regions;
}

std::vector<MemoryRegion> ProcessHandle::enumerate_executable_regions() const {
    auto all = enumerate_regions();
    std::vector<MemoryRegion> exec;
    exec.reserve(all.size() / 4);  // Heuristique : ~25% sont executables

    for (auto& r : all) {
        if (r.protect & (PAGE_EXECUTE | PAGE_EXECUTE_READ |
                         PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY)) {
            exec.push_back(r);
        }
    }
    return exec;
}

// ── Protection ───────────────────────────────────────────────────────

std::optional<uint32_t> ProcessHandle::set_protection(
    uintptr_t address, size_t size, uint32_t new_protect) const {
    DWORD old_protect = 0;
    BOOL ok = VirtualProtectEx(handle_, reinterpret_cast<LPVOID>(address),
                               size, new_protect, &old_protect);
    if (!ok) {
        spdlog::warn("memory: VirtualProtectEx echec addr=0x{:X} (err={})",
                     address, GetLastError());
        return std::nullopt;
    }
    return old_protect;
}

} // namespace iecode::memory

#endif // _WIN32
