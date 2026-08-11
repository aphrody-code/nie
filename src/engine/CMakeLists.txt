# ── iecode_engine static library (lives:: engine layer) ────────────
add_library(iecode_engine STATIC)

file(GLOB_RECURSE ENGINE_SOURCES CONFIGURE_DEPENDS
    ${CMAKE_CURRENT_SOURCE_DIR}/*.cpp
)
if(ENGINE_SOURCES)
    target_sources(iecode_engine PRIVATE ${ENGINE_SOURCES})
endif()

target_include_directories(iecode_engine PUBLIC
    ${PROJECT_SOURCE_DIR}/src/include
)

target_link_libraries(iecode_engine PUBLIC
    iecode_core
    fmt::fmt
    spdlog::spdlog
    nlohmann_json::nlohmann_json
    glm::glm
    sol2::sol2
    unofficial::lua::lua
)

# Backend physique Bullet3 (remplace PhysX 3.4 de nie.exe).
# Le port vcpkg de bullet3 expose les cibles BulletDynamics/BulletCollision/LinearMath
# avec les headers dans ${BULLET_INCLUDE_DIRS}.
if(TARGET BulletDynamics AND TARGET BulletCollision AND TARGET LinearMath)
    target_link_libraries(iecode_engine PUBLIC BulletDynamics BulletCollision LinearMath)
elseif(BULLET_LIBRARIES)
    target_link_libraries(iecode_engine PUBLIC ${BULLET_LIBRARIES})
endif()
if(BULLET_INCLUDE_DIRS)
    target_include_directories(iecode_engine PUBLIC ${BULLET_INCLUDE_DIRS})
endif()

target_compile_definitions(iecode_engine PUBLIC
    IECODE_HAS_ENGINE=1
    NIE_BASE_ADDR=0x140000000ULL
)

# Backend audio XAudio2 (Windows). xaudio2.h est dans le Windows SDK — pas de vcpkg.
# ole32 fournit CoInitializeEx. xaudio2_9.lib est la version moderne.
# d3d11/dxgi pour les ResourceManagers (TextureManager, ModelManager).
if(WIN32)
    target_link_libraries(iecode_engine PRIVATE xaudio2 ole32 d3d11 dxgi)
endif()

# lua_bindings.cpp utilise des templates sol2 lourds qui entrent en
# conflit avec d'autres TU dans un batch Unity (sol::var_wrapper / MSVC).
# De plus, le nombre de sections generees depasse la limite COFF sans /bigobj.
set_source_files_properties(
    ${CMAKE_CURRENT_SOURCE_DIR}/lua_bindings.cpp
    PROPERTIES
        SKIP_UNITY_BUILD_INCLUSION ON
        COMPILE_FLAGS "$<$<CXX_COMPILER_ID:MSVC>:/bigobj>"
)

# audio_engine.cpp inclut <windows.h> + <xaudio2.h> qui polluent le
# namespace global (macros NEAR, FAR, min, max...). Exclu du Unity
# build pour ne pas casser les autres TU (bgfx, glm, etc.).
set_source_files_properties(
    ${CMAKE_CURRENT_SOURCE_DIR}/sound/audio_engine.cpp
    PROPERTIES
        SKIP_UNITY_BUILD_INCLUSION ON
)

if(IECODE_UNITY_BUILD)
    set_target_properties(iecode_engine PROPERTIES UNITY_BUILD ON)
endif()
