@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo AZLA CB5100 EQ Test Studio
where py >nul 2>&1
if %errorlevel%==0 goto launcher_py
where python >nul 2>&1
if %errorlevel%==0 goto launcher_python
echo.
echo Python 3 is required for the local server.
echo Install it from https://www.python.org/downloads/
echo Then double-click this file again.
pause
exit /b 1
:launcher_py
start "AZLA EQ v1.4 SERVER" cmd /k "py -3 -m http.server 8768 --bind 127.0.0.1"
goto open_browser
:launcher_python
start "AZLA EQ v1.4 SERVER" cmd /k "python -m http.server 8768 --bind 127.0.0.1"
:open_browser
timeout /t 2 /nobreak >nul
start "" "http://localhost:8768"
echo.
echo Keep the AZLA EQ v1.4 SERVER window open while using the app.
echo If the old version appears, close the old server and run this launcher again.
exit /b 0
