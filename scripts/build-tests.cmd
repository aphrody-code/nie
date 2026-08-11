@echo off
REM Compile la cible GTest (src/tests). Racine = parent de scripts/.
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
cd /d "%~dp0.."
cmake --build --preset debug --target iecode_tests 2>&1
