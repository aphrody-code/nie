#pragma once

/// @file dll_loader.h
/// Helpers partages pour chargement dynamique de DLLs Steam.
/// Utilise par steam_api.cpp et encrypted_ticket.cpp.

#include <spdlog/spdlog.h>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace iecode::steam::detail {

inline void* load_dll(const char* name) {
#ifdef _WIN32
    return static_cast<void*>(LoadLibraryA(name));
#else
    return dlopen(name, RTLD_NOW | RTLD_LOCAL);
#endif
}

inline void free_dll(void* handle) {
    if (!handle) return;
#ifdef _WIN32
    FreeLibrary(static_cast<HMODULE>(handle));
#else
    dlclose(handle);
#endif
}

inline void* get_sym(void* handle, const char* name) {
#ifdef _WIN32
    return reinterpret_cast<void*>(
        GetProcAddress(static_cast<HMODULE>(handle), name));
#else
    return dlsym(handle, name);
#endif
}

/// Charge un symbole et le cast vers le type fonction attendu.
template<typename F>
bool load_fn(void* lib, const char* sym_name, F& out) {
    out = reinterpret_cast<F>(get_sym(lib, sym_name));
    if (!out) {
        spdlog::trace("steam: symbole '{}' non trouve", sym_name);
    }
    return out != nullptr;
}

} // namespace iecode::steam::detail
