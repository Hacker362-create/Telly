@echo off
REM ─────────────────────────────────────────────────────────────────
REM start.bat — One-shot local development launcher for Telly VoIP (Windows)
REM
REM Usage: double-click start.bat  OR  run from Command Prompt / PowerShell
REM
REM Then open http://localhost:3000 in your browser.
REM ─────────────────────────────────────────────────────────────────

echo.
echo  ==========================================
echo       ^|  Telly VoIP  ^|
echo  ==========================================
echo.

REM ── Guard: Node.js required ───────────────────────────────────
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo X Node.js is not installed.
  echo   -^> Download it from https://nodejs.org ^(LTS version recommended^)
  pause
  exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do echo   . Node.js %%i found

cd /d "%~dp0backend"

REM ── 1. .env ───────────────────────────────────────────────────
if not exist ".env" (
  echo ^> Creating .env from .env.example ...
  copy ".env.example" ".env" >nul
  echo   . .env created (SQLite -- no database server needed)
) else (
  echo   . .env already exists
)

REM ── 2. npm install ────────────────────────────────────────────
echo.
echo ^> Installing dependencies (this may take a minute on first run) ...
call npm install --silent
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo X npm install failed.
  echo   -^> Make sure you have internet access, then try again.
  pause
  exit /b 1
)
echo   . node_modules ready

REM ── 3. Database ───────────────────────────────────────────────
echo.
echo ^> Setting up database (SQLite) ...
call npm run db:setup 2>nul
if %ERRORLEVEL% NEQ 0 (
  call npm run db:push 2>nul
)
echo   . Database ready

REM ── 4. Start server ───────────────────────────────────────────
echo.
echo ^> Starting Telly backend ...
echo.
echo   Open your browser:
echo   --^>  http://localhost:3000
echo.
echo   Press Ctrl+C to stop.
echo.

call npm start
