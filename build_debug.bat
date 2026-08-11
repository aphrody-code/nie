@echo off
REM Build Debug du toolkit C++ (iecode). Racine = dossier de ce script :
REM plus aucun chemin machine en dur depuis l'unification (2026-08-11).
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64
cd /d "%~dp0"
cmake --preset debug
if errorlevel 1 (
    echo === CMAKE CONFIGURE FAILED ===
    exit /b 1
)
cmake --build --preset debug -- -j16
if errorlevel 1 (
    echo === BUILD FAILED ===
    exit /b 1
)
echo === BUILD SUCCEEDED ===
