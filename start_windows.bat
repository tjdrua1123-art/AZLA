@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo AZLA Equalizer
py -3 --version >nul 2>&1
if not errorlevel 1 goto launcher_py
python --version >nul 2>&1
if not errorlevel 1 goto launcher_python
node --version >nul 2>&1
if not errorlevel 1 goto launcher_node
echo Python 3 or Node.js is required for the source edition.
echo Use the same Python installation as the previous AZLA program.
pause
exit /b 1
:launcher_py
start "AZLA EQ SERVER" cmd /k "py -3 -m http.server 8768 --bind 127.0.0.1"
goto open_browser
:launcher_python
start "AZLA EQ SERVER" cmd /k "python -m http.server 8768 --bind 127.0.0.1"
goto open_browser
:launcher_node
start "AZLA EQ SERVER" cmd /k "node server.mjs"
:open_browser
timeout /t 2 /nobreak >nul
start "" "http://localhost:8768"
echo Keep the AZLA EQ SERVER window open while using the program.
echo Close the previous program server before starting this version.
exit /b 0
