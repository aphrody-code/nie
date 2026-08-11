# ── iecode_core static library ───────────────────────────────────────
add_library(iecode_core STATIC)

# Gather sources
file(GLOB_RECURSE CORE_SOURCES CONFIGURE_DEPENDS
    ${CMAKE_CURRENT_SOURCE_DIR}/*.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/*.c
)

# Exclure les sources compilees dans leurs propres targets
list(FILTER CORE_SOURCES EXCLUDE REGEX ".*/engine/.*")
list(FILTER CORE_SOURCES EXCLUDE REGEX ".*/game/.*")
# Depuis le regroupement de l'arbre C++ sous src/ (2026-08-11), le GLOB_RECURSE
# ci-dessus voit AUSSI les sous-arbres qui ont leur propre target : cli/ (a un
# `main()`), tests/ (GTest), ffi/ (shared lib), decomp/ (voie B de la forge),
# driver/ (hors build principal). Sans ces filtres, iecode_core embarquerait
# plusieurs `main()` et toute la suite de tests.
list(FILTER CORE_SOURCES EXCLUDE REGEX ".*/src/cli/.*")
list(FILTER CORE_SOURCES EXCLUDE REGEX ".*/src/tests/.*")
list(FILTER CORE_SOURCES EXCLUDE REGEX ".*/src/decomp/.*")
list(FILTER CORE_SOURCES EXCLUDE REGEX ".*/src/driver/.*")
list(FILTER CORE_SOURCES EXCLUDE REGEX ".*/src/include/.*")
# iecode_export_app_optimized.cpp est un EXECUTABLE standalone (cf. CMakeLists.app_export.txt)
# qui possede son propre `int main()` — il ne doit pas etre dans la lib iecode_core.
list(FILTER CORE_SOURCES EXCLUDE REGEX ".*/iecode_export_app[a-z_]*\\.cpp$")


target_sources(iecode_core PRIVATE ${CORE_SOURCES})

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
    target_compile_options(iecode_core PRIVATE 
        -Wno-missing-designated-field-initializers
        -Wno-missing-field-initializers
    )
endif()

# tinygltf définit TINYGLTF_IMPLEMENTATION dans model_export.cpp, et la
# section impl de tiny_gltf.h est hors include-guard (lignes 1640-8756).
# Dans un Unity build, l'inclusion de deux TU incluant tiny_gltf.h provoque
# des redéfinitions. On exclut ces deux fichiers du batch Unity.
set_source_files_properties(
    ${CMAKE_CURRENT_SOURCE_DIR}/converters/model_export.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/converters/model_import.cpp
    PROPERTIES SKIP_UNITY_BUILD_INCLUSION ON
)

# steam_api.cpp et encrypted_ticket.cpp partagent des helpers identiques
# (load_dll, free_dll, get_sym, load_fn) dans des namespaces anonymes
# distincts — le Unity build les fusionne et provoque des redefinitions.
set_source_files_properties(
    ${CMAKE_CURRENT_SOURCE_DIR}/steam/encrypted_ticket.cpp
    PROPERTIES SKIP_UNITY_BUILD_INCLUSION ON
)

# gamebanana.cpp et update_checker.cpp incluent httplib.h (header lourd)
# qui ne supporte pas l'inclusion multiple dans un meme TU Unity.
set_source_files_properties(
    ${CMAKE_CURRENT_SOURCE_DIR}/modding/gamebanana.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/modding/update_checker.cpp
    PROPERTIES SKIP_UNITY_BUILD_INCLUSION ON
)

target_include_directories(iecode_core PUBLIC
    ${PROJECT_SOURCE_DIR}/src/include
)

target_link_libraries(iecode_core PUBLIC
    fmt::fmt
    spdlog::spdlog
    nlohmann_json::nlohmann_json
    # capstone::capstone
    tree_sitter_c_parser
    tree_sitter_lua_parser
    iecode_third_party
)

# tinygltf — GLB export
target_link_libraries(iecode_core PUBLIC tinygltf::tinygltf)
target_compile_definitions(iecode_core PUBLIC IECODE_HAS_TINYGLTF=1)

# DirectXTex — BCn texture decode/encode
target_link_libraries(iecode_core PUBLIC Microsoft::DirectXTex)
target_compile_definitions(iecode_core PUBLIC IECODE_HAS_DIRECTXTEX=1)

# WebP — WebP export
target_link_libraries(iecode_core PUBLIC WebP::webp)
target_compile_definitions(iecode_core PUBLIC IECODE_HAS_WEBP=1)

# zlib — decompression Level-5 methode #5
target_link_libraries(iecode_core PUBLIC ZLIB::ZLIB)

# zstd — compression export pipeline (iecode_export_app_optimized.cpp)
find_package(zstd CONFIG REQUIRED)
if(TARGET zstd::libzstd_shared)
    target_link_libraries(iecode_core PUBLIC zstd::libzstd_shared)
elseif(TARGET zstd::libzstd_static)
    target_link_libraries(iecode_core PUBLIC zstd::libzstd_static)
else()
    target_link_libraries(iecode_core PUBLIC zstd::libzstd)
endif()

# cpp-httplib + OpenSSL — client HTTPS pour GameBanana API et update checker
find_package(OpenSSL REQUIRED)
target_link_libraries(iecode_core PUBLIC httplib::httplib OpenSSL::SSL OpenSSL::Crypto)
target_compile_definitions(iecode_core PUBLIC CPPHTTPLIB_OPENSSL_SUPPORT)

# Render / scripting deps
target_link_libraries(iecode_core PUBLIC glm::glm)
target_compile_definitions(iecode_core PUBLIC IECODE_HAS_GLM=1)

target_link_libraries(iecode_core PUBLIC
    assimp::assimp
    bgfx::bgfx
    sol2::sol2
)
target_compile_definitions(iecode_core PUBLIC
    IECODE_HAS_ASSIMP=1
    IECODE_HAS_BGFX=1
    IECODE_HAS_SOL2=1
)

# libpqxx (optional — PostgreSQL / Supabase push)
if(libpqxx_FOUND)
    target_link_libraries(iecode_core PRIVATE libpqxx::pqxx)
    target_compile_definitions(iecode_core PUBLIC IECODE_HAS_PQXX=1)
endif()

# Rizin (optional — validate include paths)
if(RIZIN_FOUND)
    set(_rizin_ok TRUE)
    get_target_property(_rizin_incs PkgConfig::RIZIN INTERFACE_INCLUDE_DIRECTORIES)
    if(_rizin_incs)
        foreach(_d IN LISTS _rizin_incs)
            if(NOT EXISTS "${_d}")
                set(_rizin_ok FALSE)
                break()
            endif()
        endforeach()
    endif()
    if(_rizin_ok)
        target_link_libraries(iecode_core PUBLIC PkgConfig::RIZIN)
        target_compile_definitions(iecode_core PUBLIC IECODE_HAS_RIZIN=1)
    endif()
endif()

# SIMD flags pour les hot paths crypto/compression
if(IECODE_SIMD_FLAGS)
    # Appliquer comme chaine separee par espaces (Ninja/MSVC)
    separate_arguments(SIMD_FLAGS_LIST NATIVE_COMMAND "${IECODE_SIMD_FLAGS}")
    target_compile_options(iecode_core PRIVATE ${SIMD_FLAGS_LIST})
endif()

# CRC32 hardware via SSE4.2 intrinseques (_mm_crc32_u8/u64)
if(IECODE_HAS_SSE42)
    target_compile_definitions(iecode_core PUBLIC IECODE_HAS_SSE42=1)
endif()

# AVX2 pour les boucles SIMD (XOR bulk, pattern search)
if(IECODE_HAS_AVX2)
    target_compile_definitions(iecode_core PUBLIC IECODE_HAS_AVX2=1)
endif()
