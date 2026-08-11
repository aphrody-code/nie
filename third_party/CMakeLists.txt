# ── En-têtes vendorisés ──────────────────────────────────────────────
# Tous header-only, tous sous licence permissive. `tinygltf` a rejoint la liste après que
# son port vcpkg soit devenu ininstallable : GitHub régénère les archives de tag, le SHA512
# figé dans le port ne correspond plus, et l'échec d'UN port fait tomber l'installation
# entière. Un header de 280 Kio dans l'arbre coûte moins qu'une dépendance qui casse.
add_library(iecode_third_party INTERFACE)
target_include_directories(iecode_third_party SYSTEM INTERFACE
    ${CMAKE_CURRENT_SOURCE_DIR}/stb
    ${CMAKE_CURRENT_SOURCE_DIR}/bcdec
    ${CMAKE_CURRENT_SOURCE_DIR}/mio
    ${CMAKE_CURRENT_SOURCE_DIR}/xxhash
    ${CMAKE_CURRENT_SOURCE_DIR}/concurrentqueue
    ${CMAKE_CURRENT_SOURCE_DIR}/tinygltf
)
