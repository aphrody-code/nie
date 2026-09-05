# `cmake/` — les modules CMake du toolkit C++

Ce que le `CMakeLists.txt` racine inclut, plus ce que vcpkg lit.

| Fichier | Rôle |
|---|---|
| `CompilerWarnings.cmake` | le jeu d'avertissements commun aux cibles `iecode_*` |
| `SIMDDetect.cmake` | la détection des jeux d'instructions vectorielles à la configuration |
| `iecode-config.cmake.in` | le gabarit du paquet `find_package(iecode)` installé |
| `overlay-ports/` | les ports vcpkg surchargés localement |
| `CMakeLists.app_export.txt` | projet **autonome** de l'outil d'export d'icônes d'application (cf. [`docs/EXPORT-APP.md`](../docs/EXPORT-APP.md)) — il n'est inclus par rien, il se configure seul |

vcpkg est installé dans `var/vcpkg` mais `VCPKG_ROOT` n'est pas exporté : le poser dans la
commande plutôt que de compter dessus. Les bibliothèques sont déjà dans
`build/msvc/vcpkg_installed`, donc une reconfiguration incrémentale ne recompile aucun
port.

Le toolkit ne se construit **que depuis le poste Windows** : le VPS Linux n'a pas MSVC.
