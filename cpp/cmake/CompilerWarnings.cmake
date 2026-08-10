# ── Compiler warnings + optimisations ───────────────────────────────
if(MSVC)
    add_compile_options(/W4 /permissive- /utf-8)

    # Optimisations MSVC pour Release/RelWithDebInfo
    # /Gw : Optimise le placement des donnees globales (garbage collection par le linker)
    # /Zc:inline : Supprime les fonctions inline non referencees
    # /Zc:__cplusplus : Rapporte la bonne valeur de __cplusplus (requis pour C++20)
    # /EHsc : Modele d'exceptions synchrone (pas de SEH sauf si demande)
    add_compile_options(/Zc:inline /Zc:__cplusplus /Zc:preprocessor /EHsc)

    # Flags d'optimisation uniquement en Release/RelWithDebInfo
    if(NOT CMAKE_BUILD_TYPE STREQUAL "Debug")
        add_compile_options(
            /O2         # Optimisation vitesse maximale
            /Oi         # Fonctions intrinseques
            /Gw         # Placement donnees globales optimise
            /GS-        # Desactiver les security cookies (code de parsing, pas de surface d'attaque)
            /Gy         # Function-level linking (requis pour /OPT:REF)
        )
    endif()
else()
    add_compile_options(-Wall -Wextra -Wpedantic -Wno-unused-parameter)
endif()
