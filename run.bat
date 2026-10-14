@echo off
title CampusShield - Direct Server Launcher
color 0A

echo Starting CampusShield...
net start MongoDB >nul 2>&1
timeout /t 1 >nul
start "" "http://localhost:5000"
npm start
