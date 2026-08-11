@echo off
REM Build Release du toolkit C++ (iecode). Racine = dossier de ce script.
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64
cd /d "%~dp0"
cmake --build --preset release -- -j16
if errorlevel 1 (
    echo === BUILD FAILED ===
    exit /b 1
)
echo === BUILD SUCCEEDED ===
