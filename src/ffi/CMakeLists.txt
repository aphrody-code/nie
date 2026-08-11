# ── iecode_ffi shared library (bun:ffi) ──────────────────────────────
# ffi.cpp utilise majoritairement iecode_core (vfs, cpk, level5, criware,
# crypto, compression, modding, gamedata, services). Trois blocs minoritaires
# touchent les couches engine/game :
#   - ligne 33      : #include "iecode/engine/anim/anim_player.h"
#   - lignes 2840-2949 : iecode_game_* (#include "iecode/game/ievr_game.h")
#   - lignes 3120-3307 : iecode_anim_*/iecode_model_* (lives::AnimClip + AnimPlayer)
#
# Le refactor 54f10b7 a desactive iecode_engine + iecode_game car des headers
# menu/* manquent dans certains *autres* TUs. Mais anim_player.cpp + ievr_game.cpp
# sont auto-suffisants — on les compose directement dans iecode_ffi sans builder
# les targets static iecode_engine / iecode_game complets.
add_library(iecode_ffi SHARED
    ffi.cpp
    ${CMAKE_SOURCE_DIR}/src/engine/anim/anim_player.cpp
    ${CMAKE_SOURCE_DIR}/src/game/ievr_game.cpp
)

target_include_directories(iecode_ffi PRIVATE
    ${CMAKE_SOURCE_DIR}/src/include
)

target_link_libraries(iecode_ffi PRIVATE
    iecode_core
    fmt::fmt
    spdlog::spdlog
    nlohmann_json::nlohmann_json
    glm::glm
)

target_compile_definitions(iecode_ffi PRIVATE
    IECODE_SHARED
    IECODE_BUILDING
    IECODE_HAS_ENGINE=1
    NIE_BASE_ADDR=0x140000000ULL
)

set_target_properties(iecode_ffi PROPERTIES
    OUTPUT_NAME "iecode"
    POSITION_INDEPENDENT_CODE ON
    UNITY_BUILD OFF
)

# ── iecode_py — module Python nanobind ───────────────────────────────
# Genere un module natif Python (.pyd / .so) nomme "iecode".
# Necessite nanobind (vcpkg) et Python Development.Module.
# nanobind exige que find_package(Python) soit appele AVANT find_package(nanobind).
# Si nanobind ou Python est absent, le target est silencieusement ignore.
find_package(Python COMPONENTS Interpreter Development.Module QUIET)
if(Python_FOUND)
    find_package(nanobind CONFIG QUIET)
endif()
if(nanobind_FOUND AND Python_FOUND)
    nanobind_add_module(iecode_py NB_STATIC bindings.cpp)
    target_link_libraries(iecode_py PRIVATE iecode_core)
    target_include_directories(iecode_py PRIVATE
        ${CMAKE_SOURCE_DIR}/src/include
    )
    set_target_properties(iecode_py PROPERTIES
        OUTPUT_NAME "iecode"
        UNITY_BUILD OFF
        PDB_NAME "iecode_py"
    )
    # Pas de clang-tidy sur le code genere nanobind
    set_target_properties(iecode_py PROPERTIES CXX_CLANG_TIDY "")
    message(STATUS "iecode_py: nanobind Python module enabled (Python ${Python_VERSION})")
else()
    if(NOT nanobind_FOUND)
        message(STATUS "iecode_py: nanobind not found, skipping Python module")
    endif()
    if(NOT Python_FOUND)
        message(STATUS "iecode_py: Python Development.Module not found, skipping")
    endif()
endif()
