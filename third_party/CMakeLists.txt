# ── Vendored headers (stb, bcdec) ────────────────────────────────────
add_library(iecode_third_party INTERFACE)
target_include_directories(iecode_third_party SYSTEM INTERFACE
    ${CMAKE_CURRENT_SOURCE_DIR}/stb
    ${CMAKE_CURRENT_SOURCE_DIR}/bcdec
    ${CMAKE_CURRENT_SOURCE_DIR}/mio
    ${CMAKE_CURRENT_SOURCE_DIR}/xxhash
    ${CMAKE_CURRENT_SOURCE_DIR}/concurrentqueue
)
