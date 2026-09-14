@echo off
REM ---------------------------------------------------------------
REM  LUCID AI Smart Mirror - local launcher
REM
REM  Serves the demo on http://localhost:5173 so the CAMERA works.
REM  Browsers only allow getUserMedia on https:// or localhost;
REM  double-clicking the HTML (file://) always blocks the camera.
REM
REM  NOTE: this file is deliberately ASCII-only. Putting UTF-8
REM  Chinese in a .bat corrupts cmd.exe parsing (it re-reads the
REM  remaining bytes under the new codepage and even REM lines
REM  start executing as commands). Chinese instructions live in
REM  the separate file: HOW-TO-RUN.txt
REM ---------------------------------------------------------------
title LUCID AI Smart Mirror
cd /d "%~dp0"

netstat -ano | findstr ":5173 " | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo.
  echo   Port 5173 is already in use.
  echo   A previous server is probably still running - close that
  echo   window and try again.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if not errorlevel 1 goto run_node
where python >nul 2>nul
if not errorlevel 1 goto run_python
goto no_runtime

:run_node
echo.
echo   Starting with Node.js  --  http://localhost:5173
echo   The browser opens in a few seconds.
echo   Close this window to stop the server.
echo.
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:5173"
node server.js
goto :eof

:run_python
echo.
echo   Starting with Python  --  http://localhost:5173
echo   The browser opens in a few seconds.
echo   Close this window to stop the server.
echo.
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:5173"
python -m http.server 5173
goto :eof

:no_runtime
echo.
echo   Node.js or Python not found.
echo.
echo   Two options:
echo     1) Install Node.js (https://nodejs.org), then run this file
echo        again - that gives you the live camera.
echo     2) Just double-click lucid-demo.html in this folder. It is
echo        fully offline and needs no install, but the camera will
echo        not work (browser security rule) - use "upload photo".
echo.
echo   See HOW-TO-RUN.txt for the Chinese version of these notes.
echo.
pause
