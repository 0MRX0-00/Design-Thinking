@echo off
title CampusShield - Smart Campus Safety System
color 0B

echo ===============================================================================
echo   CAMPUSSHIELD - SMART CAMPUS SAFETY & EMERGENCY RESPONSE SYSTEM
echo   Institution: Kongu Engineering College (KEC)
echo ===============================================================================
echo.

:: Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo [ERROR] Node.js is not found in PATH!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo [OK] Node.js detected:
node -v
echo.

:: Check MongoDB Service (try to start if stopped)
echo [*] Checking MongoDB Community Server service...
net start MongoDB >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] MongoDB Windows Service is active and running.
) else (
    echo [INFO] MongoDB service already active or running as standalone mongod.
)
echo.

:MENU
echo -------------------------------------------------------------------------------
echo  Select an option to run:
echo -------------------------------------------------------------------------------
echo   [1] Start CampusShield Web Server (Default - Port 5000)
echo   [2] Start in Development Mode (Auto-reload on file change)
echo   [3] Seed Database with KEC Demo Accounts & Responders
echo   [4] Run Automated Verification Tests (15/15 Tests)
echo   [5] Launch MongoDB Compass (Database Inspector)
echo   [6] Open Student Safety Portal (http://localhost:5000/student)
echo   [7] Open Security Command Center (http://localhost:5000)
echo   [8] Open Administration Portal (http://localhost:5000/admin)
echo   [0] Exit
echo -------------------------------------------------------------------------------
set /p choice="Enter choice [1-8, or 0]: "

if "%choice%"=="1" goto START_SERVER
if "%choice%"=="2" goto DEV_SERVER
if "%choice%"=="3" goto SEED_DB
if "%choice%"=="4" goto RUN_TESTS
if "%choice%"=="5" goto LAUNCH_COMPASS
if "%choice%"=="6" goto OPEN_STUDENT
if "%choice%"=="7" goto OPEN_SECURITY
if "%choice%"=="8" goto OPEN_ADMIN
if "%choice%"=="0" exit /b 0

:: Default to 1 if user just presses Enter
if "%choice%"=="" goto START_SERVER

echo Invalid choice, please try again.
goto MENU

:START_SERVER
echo.
echo ===============================================================================
echo  Starting CampusShield Server on http://localhost:5000 ...
echo ===============================================================================
echo  Press Ctrl+C to stop the server at any time.
echo.
timeout /t 2 >nul
start "" "http://localhost:5000"
npm start
goto END

:DEV_SERVER
echo.
echo ===============================================================================
echo  Starting in Development Watch Mode ...
echo ===============================================================================
start "" "http://localhost:5000"
npm run dev
goto END

:SEED_DB
echo.
echo ===============================================================================
echo  Seeding Database with Kongu Engineering College Demo Records ...
echo ===============================================================================
npm run seed
echo.
pause
goto MENU

:RUN_TESTS
echo.
echo ===============================================================================
echo  Running Automated Verification Test Suite (Tests 1-15) ...
echo ===============================================================================
npm test
echo.
pause
goto MENU

:LAUNCH_COMPASS
echo.
echo [*] Looking for MongoDB Compass...
if exist "%LOCALAPPDATA%\MongoDBCompass\MongoDBCompass.exe" (
    start "" "%LOCALAPPDATA%\MongoDBCompass\MongoDBCompass.exe"
    echo [OK] Launched MongoDB Compass.
) else if exist "%ProgramFiles%\MongoDB Compass\MongoDBCompass.exe" (
    start "" "%ProgramFiles%\MongoDB Compass\MongoDBCompass.exe"
    echo [OK] Launched MongoDB Compass.
) else (
    echo [INFO] Compass executable not found in default paths.
    echo URI to connect in Compass: mongodb://127.0.0.1:27017/campusshield
)
echo.
pause
goto MENU

:OPEN_STUDENT
start "" "http://localhost:5000/student"
goto MENU

:OPEN_SECURITY
start "" "http://localhost:5000"
goto MENU

:OPEN_ADMIN
start "" "http://localhost:5000/admin"
goto MENU

:END
pause
