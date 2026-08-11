# ── iecode_decomp static library (C + bridge C++) ───────────────────
add_library(iecode_decomp STATIC)

# Decompiled C functions (drop .c files into functions/)
file(GLOB DECOMP_C_SOURCES CONFIGURE_DEPENDS
    ${CMAKE_CURRENT_SOURCE_DIR}/functions/*.c
)

# Bridge C++ wrappers
file(GLOB DECOMP_CXX_SOURCES CONFIGURE_DEPENDS
    ${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp
)

target_sources(iecode_decomp PRIVATE
    ${DECOMP_C_SOURCES}
    ${DECOMP_CXX_SOURCES}
)

target_include_directories(iecode_decomp PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_link_libraries(iecode_decomp PUBLIC
    iecode_core
    iecode_third_party
    nlohmann_json::nlohmann_json
    fmt::fmt
    spdlog::spdlog
)

# C files: compiled as C17, not C++
set_source_files_properties(${DECOMP_C_SOURCES} PROPERTIES LANGUAGE C)
