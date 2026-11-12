@echo off
chcp 65001 >nul
cd /d "%~dp0"
node scripts\dev-services.cjs start
if errorlevel 1 pause
