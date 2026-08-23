@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ===== %date% %time% ===== >> logs\daily-bot.log
node daily-bot.js >> logs\daily-bot.log 2>&1
