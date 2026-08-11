#pragma once

/// @file export.h
/// Macro de visibilite pour l'export de symboles en shared library.
///
/// Usage : prefixer les fonctions/classes publiques avec IECODE_EXPORT.
/// En build statique (defaut), la macro est vide.

#if defined(IECODE_SHARED)
    #if defined(_WIN32) || defined(__CYGWIN__)
        #if defined(IECODE_BUILDING)
            #define IECODE_EXPORT __declspec(dllexport)
        #else
            #define IECODE_EXPORT __declspec(dllimport)
        #endif
    #elif defined(__GNUC__) || defined(__clang__)
        #define IECODE_EXPORT __attribute__((visibility("default")))
    #else
        #define IECODE_EXPORT
    #endif
#else
    #define IECODE_EXPORT
#endif
