# IECODE C++ Port — Documentation

Port du toolkit IECODE (.NET) vers C++ pour Windows/Ubuntu, avec support d'intégration de pseudo-C décompilé (Ghidra/IDA) et bridge vers le code nie.exe.

## Documents de ce dossier

| Fichier | Contenu |
|---------|---------|
| [architecture.md](architecture.md) | Structure du projet, arborescence, targets CMake |
| [dependencies.md](dependencies.md) | Bibliothèques C++, vcpkg, vendored headers |
| [porting-guide.md](porting-guide.md) | Mapping C# → C++, patterns, exemples concrets |
| [decomp-integration.md](decomp-integration.md) | Comment intégrer le pseudo-C décompilé de nie.exe |
| [format-reference.md](format-reference.md) | Référence complète des formats de fichiers du jeu |
| [phases.md](phases.md) | Plan d'implémentation par phases avec priorités |
| [cli-reference.md](cli-reference.md) | Commandes CLI à implémenter |
| [nie-inspection.md](nie-inspection.md) | Analyse complète de nie.exe (PE, RTTI, sections, formats) |

## Exports Ghidra (docs/ghidra-export/)

Analyse complète de nie.exe réalisée le 2026-04-05 :

| Fichier | Contenu |
|---------|---------|
| [REPORT.md](../../docs/ghidra-export/REPORT.md) | Rapport complet — architecture, constantes, VFS, rendu |
| [key-functions.md](../../docs/ghidra-export/key-functions.md) | Index des 60 fonctions décompilées (597 KB) |
| [rtti-analysis.md](../../docs/ghidra-export/rtti-analysis.md) | 1 234 classes RTTI en 25 groupes |
| [gds-system.md](../../docs/ghidra-export/gds-system.md) | 268 GDS*Config en 23 domaines |
| [nie-c-analysis.md](../../docs/ghidra-export/nie-c-analysis.md) | Stats nie.c (4.15M lignes, 60K fonctions) |
| [decompiled/](../../docs/ghidra-export/decompiled/) | 60 fichiers .c — Lua, D3D11, Soccer, PhysX, Audio, EOS, VFS… |
