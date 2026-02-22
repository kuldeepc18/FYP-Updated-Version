@echo off
REM Build the matching engine (Windows, requires MinGW g++)
REM ws2_32 is required for QuestDB ILP TCP socket support
g++ -std=c++17 -I../include -o .\matching_engine.exe .\main.cpp -lws2_32
if %ERRORLEVEL% NEQ 0 (
    echo Build FAILED.
    pause
    exit /b %ERRORLEVEL%
)
echo Build succeeded: matching_engine.exe
