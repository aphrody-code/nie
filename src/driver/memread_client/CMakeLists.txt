# Bibliotheque statique : client user-mode pour iecode_memread.sys.
# Peut etre link depuis les outils iecode qui ont besoin de lire la memoire
# de nie.exe (ex: extract_aes_key).

if(NOT WIN32)
    return()
endif()

add_library(iecode_memread_client STATIC
    memread_client.cpp
    memread_client.h
)

target_include_directories(iecode_memread_client
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/../iecode_memread
)

target_compile_features(iecode_memread_client PUBLIC cxx_std_20)

target_link_libraries(iecode_memread_client PUBLIC
    # kernel32 est implicite mais on l'explicite pour Toolhelp32.
    kernel32
)

if(MSVC)
    target_compile_options(iecode_memread_client PRIVATE /W4 /permissive-)
else()
    target_compile_options(iecode_memread_client PRIVATE -Wall -Wextra -Wpedantic)
endif()
