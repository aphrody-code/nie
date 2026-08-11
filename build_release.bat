@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64
cd /d "C:\Users\yohan\rg\iecode\cli"
cmake --build --preset release -- -j16
if errorlevel 1 (
    echo === BUILD FAILED ===
    exit /b 1
)
echo === BUILD SUCCEEDED ===
