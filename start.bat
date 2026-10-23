@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "node_modules\electron" (
  echo Installing dependencies...
  call npm install
)
call npm start
if errorlevel 1 pause
