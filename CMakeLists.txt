cmake_minimum_required(VERSION 3.25)
project(iecode VERSION 1.1.0 LANGUAGES C CXX)

# ── C++ / C standards ─────────────────────────────────────────────
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_C_STANDARD 17)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# ── PIC (requis pour la shared library iecode_ffi / bun:ffi) ───────
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# ── Build options ──────────────────────────────────────────────────
option(IECODE_UNITY_BUILD     "Enable Unity (jumbo) builds for faster compilation" ON)
option(IECODE_LTO             "Enable Link-Time Optimization in Release"           ON)
option(IECODE_CLANG_TIDY      "Enable clang-tidy static analysis"                  OFF)
option(IECODE_CPPCHECK        "Enable cppcheck static analysis"                    OFF)
# v1.1.0 : refactor 54f10b7 ("ne garder que core + WASM + FFI") a laisse iecode_engine
# et iecode_game avec des headers manquants (cli/include/iecode/engine/menu/*).
# Desactives par defaut tant que ces couches ne sont pas re-portees.
option(IECODE_BUILD_ENGINE    "Build iecode_engine (lives:: layer) — needs engine/menu headers"  OFF)
option(IECODE_BUILD_GAME      "Build iecode_game   (game:: layer)  — depends on iecode_engine"   OFF)

# ── ccache (build accelerator) ─────────────────────────────────────
find_program(CCACHE_PROGRAM ccache)
if(CCACHE_PROGRAM AND NOT EMSCRIPTEN)
    message(STATUS "ccache found: ${CCACHE_PROGRAM}")
    set(CMAKE_CXX_COMPILER_LAUNCHER "${CCACHE_PROGRAM}")
    set(CMAKE_C_COMPILER_LAUNCHER   "${CCACHE_PROGRAM}")
endif()

# ── Unity build ────────────────────────────────────────────────────
if(IECODE_UNITY_BUILD)
    set(CMAKE_UNITY_BUILD ON)
    set(CMAKE_UNITY_BUILD_BATCH_SIZE 16)
endif()

# ── LTO / IPO ──────────────────────────────────────────────────────
# Skip LTO entirely for multi-config generators (VS) and Debug builds.
# VS multi-config + check_ipo_supported() causes /O2+/RTC1 conflicts.
if(IECODE_LTO AND CMAKE_BUILD_TYPE AND NOT CMAKE_BUILD_TYPE STREQUAL "Debug")
    include(CheckIPOSupported)
    check_ipo_supported(RESULT IPO_SUPPORTED OUTPUT IPO_OUTPUT)
    if(IPO_SUPPORTED)
        set(CMAKE_INTERPROCEDURAL_OPTIMIZATION ON)
        message(STATUS "LTO/IPO enabled")
    else()
        message(STATUS "LTO/IPO not supported: ${IPO_OUTPUT}")
    endif()
else()
    message(STATUS "LTO/IPO skipped (Debug, multi-config, or IECODE_LTO=OFF)")
endif()

# ── clang-tidy ─────────────────────────────────────────────────────
if(IECODE_CLANG_TIDY)
    find_program(CLANG_TIDY_PROGRAM clang-tidy)
    if(CLANG_TIDY_PROGRAM)
        message(STATUS "clang-tidy found: ${CLANG_TIDY_PROGRAM}")
        set(CMAKE_CXX_CLANG_TIDY
            "${CLANG_TIDY_PROGRAM}"
            "--config-file=${CMAKE_SOURCE_DIR}/.clang-tidy"
            "-p=${CMAKE_BINARY_DIR}"
        )
    else()
        message(WARNING "clang-tidy requested but not found")
    endif()
endif()

# ── cppcheck ───────────────────────────────────────────────────────
if(IECODE_CPPCHECK)
    find_program(CPPCHECK_PROGRAM cppcheck)
    if(CPPCHECK_PROGRAM)
        message(STATUS "cppcheck found: ${CPPCHECK_PROGRAM}")
        set(CMAKE_CXX_CPPCHECK
            "${CPPCHECK_PROGRAM}"
            "--enable=warning,performance,portability"
            "--suppress=missingIncludeSystem"
            "--inline-suppr"
            "--std=c++20"
            "--quiet"
        )
    else()
        message(WARNING "cppcheck requested but not found")
    endif()
endif()

# ── Compiler warnings ──────────────────────────────────────────────
include(cmake/CompilerWarnings.cmake)

# ── SIMD detection ─────────────────────────────────────────────────
include(cmake/SIMDDetect.cmake)

# ── Platform definitions ──────────────────────────────────────────
# Windows 10+ (0x0A00) — couvre Windows 11 via le meme SDK
# Active les APIs modernes : SetThreadDescription, PrefetchVirtualMemory, etc.
if(WIN32)
    add_compile_definitions(
        _WIN32_WINNT=0x0A00
        WINVER=0x0A00
        WIN32_LEAN_AND_MEAN
        NOMINMAX
        UNICODE
        _UNICODE
        _CRT_SECURE_NO_WARNINGS
    )
endif()

# ── MSVC multi-config fixes ────────────────────────────────────────
if(MSVC)
    # Linker optimisations (Release only via generator expression)
    add_link_options(
        $<$<NOT:$<CONFIG:Debug>>:/OPT:REF>
        $<$<NOT:$<CONFIG:Debug>>:/OPT:ICF>
    )
    # Force Debug to use /Od (not /O2) — prevents /O2+/RTC1 conflict
    string(REPLACE "/O2" "/Od" CMAKE_CXX_FLAGS_DEBUG "${CMAKE_CXX_FLAGS_DEBUG}")
    string(REPLACE "/O2" "/Od" CMAKE_C_FLAGS_DEBUG   "${CMAKE_C_FLAGS_DEBUG}")
    add_compile_options($<$<CONFIG:Debug>:/Od>)
endif()

# ── vcpkg packages (core — always required) ───────────────────────
if(NOT EMSCRIPTEN)
    find_package(CLI11          CONFIG REQUIRED)
endif()
find_package(nlohmann_json  CONFIG REQUIRED)
find_package(fmt            CONFIG REQUIRED)
find_package(spdlog         CONFIG REQUIRED)
if(NOT EMSCRIPTEN)
    find_package(GTest          CONFIG REQUIRED)
endif()

# ── vcpkg packages (converters) ───────────────────────────────────
if(NOT EMSCRIPTEN)
# tinygltf is header-only and ships no cmake config — create an INTERFACE target
find_path(TINYGLTF_INCLUDE_DIR "tiny_gltf.h")
if(TINYGLTF_INCLUDE_DIR)
    add_library(tinygltf::tinygltf INTERFACE IMPORTED)
    target_include_directories(tinygltf::tinygltf INTERFACE "${TINYGLTF_INCLUDE_DIR}")
    set(tinygltf_FOUND TRUE)
    message(STATUS "tinygltf found: ${TINYGLTF_INCLUDE_DIR}")
else()
    message(FATAL_ERROR "tinygltf not found — install via vcpkg (vcpkg install tinygltf)")
endif()
endif()
if(NOT EMSCRIPTEN)
    find_package(directxtex  CONFIG REQUIRED)
endif()
find_package(glm         CONFIG REQUIRED)
if(NOT EMSCRIPTEN)
    find_package(assimp      CONFIG REQUIRED)
endif()

# ── vcpkg packages (render / scripting) ───────────────────────────
if(NOT EMSCRIPTEN)
    find_package(bgfx  CONFIG REQUIRED)
endif()
# Bullet3 — backend physique (remplace PhysX 3.4 de nie.exe)
if(NOT EMSCRIPTEN)
    find_package(Bullet CONFIG REQUIRED)
endif()
if(NOT EMSCRIPTEN)
    find_package(sol2  CONFIG REQUIRED)
endif()
if(NOT EMSCRIPTEN)
    find_package(unofficial-lua CONFIG REQUIRED)
endif()

# ── Image encoding ─────────────────────────────────────────────────
if(NOT EMSCRIPTEN)
    find_package(WebP CONFIG REQUIRED)
endif()

# ── HTTP server (cpp-httplib) ─────────────────────────────────────
if(NOT EMSCRIPTEN)
    find_package(httplib CONFIG REQUIRED)
endif()

# ── Compression (zlib — transitive dep, toujours disponible) ──────
if(NOT EMSCRIPTEN)
    find_package(ZLIB REQUIRED)
endif()

# ── Database (optional — Supabase push) ───────────────────────────
if(NOT EMSCRIPTEN)
    find_package(libpqxx CONFIG QUIET)
endif()
if(libpqxx_FOUND)
    message(STATUS "libpqxx found — Supabase push enabled")
else()
    message(STATUS "libpqxx not found — Supabase push disabled")
endif()

# ── RE / analysis libs (vcpkg) ─────────────────────────────────────
if(NOT EMSCRIPTEN)
    find_package(capstone    CONFIG REQUIRED)
endif()
find_package(unofficial-tree-sitter CONFIG QUIET)

# tree-sitter-c grammar (FetchContent — not in vcpkg)
include(FetchContent)
if(NOT unofficial-tree-sitter_FOUND)
    FetchContent_Declare(
        tree_sitter
        GIT_REPOSITORY https://github.com/tree-sitter/tree-sitter.git
        GIT_TAG        v0.24.7
        GIT_SHALLOW    TRUE
    )
    FetchContent_MakeAvailable(tree_sitter)
endif()

FetchContent_Declare(
    tree_sitter_c
    GIT_REPOSITORY https://github.com/tree-sitter/tree-sitter-c.git
    GIT_TAG        v0.23.5
    GIT_SHALLOW    TRUE
)
# Populate uniquement (pas MakeAvailable) pour eviter le custom command
# `tree-sitter generate` du CMakeLists.txt amont qui echoue sans le CLI.
FetchContent_Populate(tree_sitter_c)

# Build tree-sitter-c as a static lib
add_library(tree_sitter_c_parser STATIC
    ${tree_sitter_c_SOURCE_DIR}/src/parser.c
)
target_include_directories(tree_sitter_c_parser PUBLIC
    ${tree_sitter_c_SOURCE_DIR}/src
)
if(unofficial-tree-sitter_FOUND)
    target_link_libraries(tree_sitter_c_parser PUBLIC unofficial::tree-sitter::tree-sitter)
else()
    target_link_libraries(tree_sitter_c_parser PUBLIC tree-sitter)
    target_include_directories(tree_sitter_c_parser PUBLIC
        ${tree_sitter_SOURCE_DIR}/lib/include
    )
endif()

# Exclude tree-sitter from clang-tidy / unity build / LTO
set_target_properties(tree_sitter_c_parser PROPERTIES
    CXX_CLANG_TIDY ""
    UNITY_BUILD OFF
    INTERPROCEDURAL_OPTIMIZATION OFF
)
# Fix MSVC multi-config: remove /O2 from Debug to avoid /O2+/RTC1 conflict
if(MSVC)
    target_compile_options(tree_sitter_c_parser PRIVATE
        $<$<CONFIG:Debug>:/Od>
    )
endif()

# tree-sitter-lua grammar (FetchContent — analyse statique scripts Lua decompiles)
FetchContent_Declare(
    tree_sitter_lua
    GIT_REPOSITORY https://github.com/MunifTanjim/tree-sitter-lua.git
    GIT_TAG        v0.0.19
    GIT_SHALLOW    TRUE
)
FetchContent_Populate(tree_sitter_lua)

add_library(tree_sitter_lua_parser STATIC
    ${tree_sitter_lua_SOURCE_DIR}/src/parser.c
)
# tree-sitter-lua possede un scanner.c pour les litteraux
if(EXISTS ${tree_sitter_lua_SOURCE_DIR}/src/scanner.c)
    target_sources(tree_sitter_lua_parser PRIVATE
        ${tree_sitter_lua_SOURCE_DIR}/src/scanner.c
    )
endif()
target_include_directories(tree_sitter_lua_parser PUBLIC
    ${tree_sitter_lua_SOURCE_DIR}/src
)
if(unofficial-tree-sitter_FOUND)
    target_link_libraries(tree_sitter_lua_parser PUBLIC unofficial::tree-sitter::tree-sitter)
else()
    target_link_libraries(tree_sitter_lua_parser PUBLIC tree-sitter)
    target_include_directories(tree_sitter_lua_parser PUBLIC
        ${tree_sitter_SOURCE_DIR}/lib/include
    )
endif()
set_target_properties(tree_sitter_lua_parser PROPERTIES
    CXX_CLANG_TIDY ""
    UNITY_BUILD OFF
    INTERPROCEDURAL_OPTIMIZATION OFF
)
if(MSVC)
    target_compile_options(tree_sitter_lua_parser PRIVATE
        $<$<CONFIG:Debug>:/Od>
    )
endif()
if(CMAKE_C_COMPILER_ID MATCHES "Clang|GNU")
    target_compile_options(tree_sitter_lua_parser PRIVATE -w)
endif()

# ── Rizin (system install — not in vcpkg, use pkg-config) ─────────
find_package(PkgConfig QUIET)
if(PkgConfig_FOUND)
    pkg_check_modules(RIZIN IMPORTED_TARGET rz_core rz_analysis rz_bin rz_asm rz_io)
endif()
if(RIZIN_FOUND)
    message(STATUS "Rizin found: ${RIZIN_VERSION}")
    add_library(rizin::rizin ALIAS PkgConfig::RIZIN)
else()
    message(STATUS "Rizin not found — rz_* analysis features disabled. Install with: winget install rizin")
endif()

# ── Vendored third_party ───────────────────────────────────────────
add_subdirectory(third_party)

# ── Project targets ────────────────────────────────────────────────
add_subdirectory(src)
if(IECODE_BUILD_ENGINE)
    add_subdirectory(src/engine)
endif()
if(IECODE_BUILD_GAME)
    if(NOT IECODE_BUILD_ENGINE)
        message(FATAL_ERROR "IECODE_BUILD_GAME=ON requires IECODE_BUILD_ENGINE=ON")
    endif()
    add_subdirectory(src/game)
endif()
add_subdirectory(decomp)
if(NOT EMSCRIPTEN)
    add_subdirectory(cli)
    add_subdirectory(tests)
endif()
add_subdirectory(ffi)

# ── Summary ────────────────────────────────────────────────────────
message(STATUS "")
message(STATUS "  iecode-cli ${PROJECT_VERSION}")
message(STATUS "  ──────────────────────────────")
message(STATUS "  C++ standard:   ${CMAKE_CXX_STANDARD}")
message(STATUS "  Build type:     ${CMAKE_BUILD_TYPE}")
message(STATUS "  Unity build:    ${IECODE_UNITY_BUILD}")
message(STATUS "  LTO:            ${CMAKE_INTERPROCEDURAL_OPTIMIZATION}")
message(STATUS "  ccache:         ${CCACHE_PROGRAM}")
message(STATUS "  clang-tidy:     ${IECODE_CLANG_TIDY}")
message(STATUS "  cppcheck:       ${IECODE_CPPCHECK}")
message(STATUS "  SIMD:           ${IECODE_SIMD_FLAGS}")
message(STATUS "  SSE4.2 CRC32:   ${IECODE_HAS_SSE42}")
message(STATUS "  AVX2:           ${IECODE_HAS_AVX2}")
message(STATUS "  iecode_engine:  ${IECODE_BUILD_ENGINE} (lives:: layer)")
message(STATUS "  iecode_game:    ${IECODE_BUILD_GAME} (game:: layer)")
message(STATUS "  tinygltf:       ${TINYGLTF_INCLUDE_DIR}")
message(STATUS "  directxtex:     ${directxtex_FOUND}")
message(STATUS "  assimp:         ${assimp_FOUND}")
message(STATUS "  bgfx:           ${bgfx_FOUND}")
message(STATUS "  sol2:           ${sol2_FOUND}")
message(STATUS "  Rizin:          ${RIZIN_FOUND}")
message(STATUS "  Platform:       ${CMAKE_SYSTEM_NAME} ${CMAKE_SYSTEM_VERSION}")
message(STATUS "")
