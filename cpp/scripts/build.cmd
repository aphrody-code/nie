@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64 >/dev/null 2>&1
cmake --build "%~dp0..\build\debug" %*