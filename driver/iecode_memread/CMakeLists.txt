# CMakeLists.txt pour iecode_memread.sys
#
# NOTE : construire un driver kernel Windows depuis CMake est non-trivial car
# le WDK utilise un toolchain MSBuild specifique (.vcxproj) avec des cibles
# Driver.Common.targets. Ce CMakeLists detecte juste la presence du WDK et
# delegue au script build_driver.ps1 qui invoque msbuild directement sur un
# projet .vcxproj genere. Pour un build direct, voir build_driver.ps1.

cmake_minimum_required(VERSION 3.20)

# Ce sous-projet n'est pas ajoute a la build principale iecode par defaut.
# Il faut l'activer explicitement : -DIECODE_BUILD_DRIVER=ON
if(NOT IECODE_BUILD_DRIVER)
    return()
endif()

if(NOT WIN32)
    message(STATUS "[iecode_memread] driver kernel Windows uniquement — skip")
    return()
endif()

# Detection du WDK via la cle de registre standard.
find_path(WDK_ROOT
    NAMES "Include/wdf/umdf/2.33/wdf.h" "Include/10.0.22621.0/km/ntddk.h" "Include/10.0.22000.0/km/ntddk.h"
    PATHS
        "C:/Program Files (x86)/Windows Kits/10"
        "C:/Program Files/Windows Kits/10"
    NO_DEFAULT_PATH
)

if(NOT WDK_ROOT)
    message(WARNING
        "[iecode_memread] WDK introuvable. "
        "Installer le Windows Driver Kit 10 (https://learn.microsoft.com/windows-hardware/drivers/download-the-wdk) "
        "puis utiliser cli/driver/iecode_memread/build_driver.ps1 pour builder."
    )
    return()
endif()

message(STATUS "[iecode_memread] WDK trouve : ${WDK_ROOT}")
message(STATUS "[iecode_memread] Build : executer build_driver.ps1 (msbuild/WDK hors CMake)")

# On expose un target custom qui invoque le script PowerShell.
add_custom_target(iecode_memread_driver
    COMMAND powershell -ExecutionPolicy Bypass -File "${CMAKE_CURRENT_SOURCE_DIR}/build_driver.ps1"
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
    COMMENT "Build iecode_memread.sys via WDK msbuild"
    VERBATIM
)
