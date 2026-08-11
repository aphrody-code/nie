# ── iecode_tests ─────────────────────────────────────────────────────
enable_testing()

file(GLOB TEST_SOURCES CONFIGURE_DEPENDS
    ${CMAKE_CURRENT_SOURCE_DIR}/*.cpp
)

# Filter out tests that reference deleted header trees from the v1.1.0 refactor.
# The 'editor' and 'engine/render/passes/gizmo' headers were removed by commit 54f10b7,
# and the 'engine/menu/*' tree was never committed — these tests are dead until ported.
list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_composite_renderer\\.cpp$")  # gizmo_pass
list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_font_loader\\.cpp$")          # editor/font_loader
list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_project\\.cpp$")              # editor/project

# Tests qui consomment iecode_engine (lives::* — ECS, anim, render, lua bridges)
if(NOT IECODE_BUILD_ENGINE)
    list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_menu_system\\.cpp$")           # engine/menu/*
    list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_render_2d\\.cpp$")             # engine/menu/menu_layer
    list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_render_pipeline\\.cpp$")       # lives::RenderPipeline
    list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_physics\\.cpp$")               # engine/physics/* + bullet
    list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_anim_player\\.cpp$")           # lives::AnimPlayer
    list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_ecs\\.cpp$")                   # lives::ecs::*
    list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_ecs_scene\\.cpp$")             # lives::ecs::Scene
    list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_func_lua_bridges\\.cpp$")      # iecode::engine::register_func_lua_bridges
    list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_gmd_obj_model\\.cpp$")         # lives::gmdCObjModelComponent
    list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_resource_manager\\.cpp$")      # engine resource mgr
    list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_scene_manager\\.cpp$")         # engine scene mgr
    list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_service_locator_event\\.cpp$") # engine service locator
endif()

# Tests qui consomment iecode_game (game::CChara*, iecode::game::IevrGame, npc, soccer)
if(NOT IECODE_BUILD_GAME)
    list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_menu_paths\\.cpp$")            # game/ui/menu_minimap
    list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_chara\\.cpp$")                 # game::CChara*
    list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_npc\\.cpp$")                   # game/npc
    list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_ievr_game\\.cpp$")             # iecode::game::IevrGame
    list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_soccer\\.cpp$")                # game/soccer
    list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_scene_soccer\\.cpp$")          # game/scene_soccer
    list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_nie_parser\\.cpp$")            # game::nie deps
    list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_rpg_battle\\.cpp$")            # iecode/game/rpg/*
    list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_save_crypto\\.cpp$")           # iecode/game/save/save_crypto
    list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_gdd\\.cpp$")                   # iecode/game/gdd/*
    list(FILTER TEST_SOURCES EXCLUDE REGEX ".*/test_gds\\.cpp$")                   # iecode/game/gds/*
endif()

if(TEST_SOURCES)
    add_executable(iecode_tests ${TEST_SOURCES})
    target_link_libraries(iecode_tests PRIVATE
        iecode_core
        iecode_decomp
        GTest::gtest
        GTest::gtest_main
    )
    # test_archive.cpp utilise ZSTD_compress directement pour generer
    # des archives in-memory. iecode_core l'expose deja en PUBLIC mais
    # ce double link est explicite pour clarte.
    if(TARGET zstd::libzstd_shared)
        target_link_libraries(iecode_tests PRIVATE zstd::libzstd_shared)
    elseif(TARGET zstd::libzstd_static)
        target_link_libraries(iecode_tests PRIVATE zstd::libzstd_static)
    endif()
    if(TARGET iecode_engine)
        target_link_libraries(iecode_tests PRIVATE iecode_engine)
    endif()
    if(TARGET iecode_game)
        target_link_libraries(iecode_tests PRIVATE iecode_game)
    endif()

    # x3daudio.lib n'est plus livre par les Windows SDK recents
    # (les symboles sont dans xaudio2_9.lib). Le pragma comment dans
    # <x3daudio.h> reference encore l'ancienne lib — on la retire.
    if(MSVC)
        target_link_options(iecode_tests PRIVATE /NODEFAULTLIB:x3daudio.lib)
    endif()

    include(GoogleTest)
    gtest_discover_tests(iecode_tests)
endif()
