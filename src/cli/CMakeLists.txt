# ── iecode CLI executable ────────────────────────────────────────────
add_executable(iecode_cli)

file(GLOB_RECURSE CLI_SOURCES CONFIGURE_DEPENDS
    ${CMAKE_CURRENT_SOURCE_DIR}/*.cpp
)
# v1.1.0: certaines commandes dependent de iecode_engine / iecode_game
# (desactives par defaut suite au refactor 54f10b7). On filtre leurs sources
# et on ajoute les defines IECODE_HAS_* pour conditionner l'enregistrement.
if(NOT IECODE_BUILD_GAME)
    list(FILTER CLI_SOURCES EXCLUDE REGEX ".*/passive_cmd\\.cpp$")
endif()
if(NOT IECODE_BUILD_ENGINE)
    list(FILTER CLI_SOURCES EXCLUDE REGEX ".*/render_cmd\\.cpp$")
endif()
target_sources(iecode_cli PRIVATE ${CLI_SOURCES})

if(IECODE_BUILD_ENGINE)
    target_compile_definitions(iecode_cli PRIVATE IECODE_HAS_ENGINE)
endif()
if(IECODE_BUILD_GAME)
    target_compile_definitions(iecode_cli PRIVATE IECODE_HAS_GAME)
endif()

target_link_libraries(iecode_cli PRIVATE
    iecode_core
    iecode_decomp
    CLI11::CLI11
    fmt::fmt
    spdlog::spdlog
    httplib::httplib
)
if(TARGET iecode_engine)
    target_link_libraries(iecode_cli PRIVATE iecode_engine)
endif()
if(TARGET iecode_game)
    target_link_libraries(iecode_cli PRIVATE iecode_game)
endif()

set_target_properties(iecode_cli PROPERTIES
    OUTPUT_NAME "iecode"
)
