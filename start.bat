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
echo ^> Installing dependencies ...
call npm install --silent
echo   . node_modules ready

REM ── 3. Database ───────────────────────────────────────────────
echo.
echo ^> Setting up database (SQLite) ...
call npm run db:setup 2>nul || call npm run db:push
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

call npm run dev
