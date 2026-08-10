# ── SIMD detection (AVX2 / SSE4.2 / SSE2) ───────────────────────────
include(CheckCXXCompilerFlag)

if(MSVC)
    # MSVC : /arch:AVX2 active aussi SSE4.2, SSE2, BMI, BMI2, FMA, F16C
    check_cxx_compiler_flag("/arch:AVX2" COMPILER_SUPPORTS_AVX2)
    if(COMPILER_SUPPORTS_AVX2)
        set(IECODE_SIMD_FLAGS "/arch:AVX2")
        set(IECODE_HAS_AVX2 TRUE)
    endif()

    # SSE4.2 est toujours disponible sur x64 MSVC mais on verifie quand meme
    # pour le CRC32 hardware (_mm_crc32_u8/u64)
    set(IECODE_HAS_SSE42 TRUE)
else()
    check_cxx_compiler_flag("-mavx2" COMPILER_SUPPORTS_AVX2)
    check_cxx_compiler_flag("-msse4.2" COMPILER_SUPPORTS_SSE42)
    check_cxx_compiler_flag("-msse2" COMPILER_SUPPORTS_SSE2)

    if(COMPILER_SUPPORTS_AVX2)
        set(IECODE_SIMD_FLAGS "-mavx2 -mbmi2 -mfma")
        set(IECODE_HAS_AVX2 TRUE)
        set(IECODE_HAS_SSE42 TRUE)
    elseif(COMPILER_SUPPORTS_SSE42)
        set(IECODE_SIMD_FLAGS "-msse4.2")
        set(IECODE_HAS_SSE42 TRUE)
    elseif(COMPILER_SUPPORTS_SSE2)
        set(IECODE_SIMD_FLAGS "-msse2")
    endif()
endif()

if(IECODE_SIMD_FLAGS)
    message(STATUS "SIMD flags: ${IECODE_SIMD_FLAGS}")
endif()

if(IECODE_HAS_SSE42)
    message(STATUS "SSE4.2 CRC32 hardware: disponible")
endif()
