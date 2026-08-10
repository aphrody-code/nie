vcpkg_from_github(
    OUT_SOURCE_PATH SOURCE_PATH
    REPO CLIUtils/CLI11
    REF "v${VERSION}"
    SHA512 3b17c02e120d6c14246157fcfef1e55c34462d8ee3adb55e49f4b180fc2e0d52ec4371505c009839c623ccc5bf4ac16c8c94707d10b1f1cb0e916c3402d2e7a6
    HEAD_REF main
    PATCHES
        revert-1012-pkgconfig.diff
)

# Build header-only — evite le LNK2001 sur __std_find_first_not_of_trivial_pos_1
# (symbole STL introduit dans MSVC 17.14 headers mais absent des runtime libs).
vcpkg_cmake_configure(
    SOURCE_PATH "${SOURCE_PATH}"
    OPTIONS
        -DCLI11_BUILD_EXAMPLES=OFF
        -DCLI11_BUILD_DOCS=OFF
        -DCLI11_BUILD_TESTS=OFF
        -DCLI11_PRECOMPILED=OFF
        -DCMAKE_CXX_STANDARD=17
)

vcpkg_cmake_install()

vcpkg_cmake_config_fixup(CONFIG_PATH share/cmake/CLI11)
vcpkg_fixup_pkgconfig()
file(REMOVE_RECURSE
    "${CURRENT_PACKAGES_DIR}/debug/include"
    "${CURRENT_PACKAGES_DIR}/debug/share"
    "${CURRENT_PACKAGES_DIR}/debug/lib"
    "${CURRENT_PACKAGES_DIR}/lib"
)

vcpkg_install_copyright(FILE_LIST "${SOURCE_PATH}/LICENSE")
