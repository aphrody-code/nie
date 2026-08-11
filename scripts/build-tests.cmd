@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
cd /d C:\Users\yohan\rg\iecode\cli
cmake --build --preset debug --target iecode_tests 2>&1
