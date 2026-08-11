# ── iecode_game static library (game:: logic layer) ────────────────
add_library(iecode_game STATIC)

file(GLOB_RECURSE GAME_SOURCES CONFIGURE_DEPENDS
    ${CMAKE_CURRENT_SOURCE_DIR}/*.cpp
)
if(GAME_SOURCES)
    target_sources(iecode_game PRIVATE ${GAME_SOURCES})
endif()

target_include_directories(iecode_game PUBLIC
    ${PROJECT_SOURCE_DIR}/include
)

target_link_libraries(iecode_game PUBLIC
    iecode_engine
    iecode_core
    fmt::fmt
    spdlog::spdlog
    nlohmann_json::nlohmann_json
    glm::glm
    sol2::sol2
)

target_compile_definitions(iecode_game PUBLIC
    IECODE_HAS_GAME=1
)

# Windows CNG (bcrypt) pour AES-128-CBC des fichiers save (save_crypto.cpp)
if(WIN32)
    target_link_libraries(iecode_game PRIVATE bcrypt)
endif()

if(IECODE_UNITY_BUILD)
    set_target_properties(iecode_game PROPERTIES UNITY_BUILD ON)
endif()
