@echo off
REM build_windows_package.bat
REM Build SamOffice Windows installer (NSIS)
REM
REM Requires:
REM   - Go 1.25+
REM   - Node.js 18+ (for frontend build)
REM   - NSIS 3.x (https://nsis.sourceforge.io/)

setlocal enabledelayedexpansion

set VERSION=0.1.0
set ROOT=%~dp0..\..
set STAGE=%ROOT%\packaging\windows\stage

cd /d %ROOT%

echo ==================================================
echo SamOffice Windows installer build v%VERSION%
echo ==================================================

echo.
echo [1/4] Clean old stage...
rmdir /s /q %STAGE% 2>nul
mkdir %STAGE%

echo.
echo [2/4] Build frontend (npm install + npm run build)...
pushd frontend
call npm install
if errorlevel 1 (
    echo [FAIL] npm install failed
    exit /b 1
)
call npm run build
if errorlevel 1 (
    echo [FAIL] npm run build failed
    exit /b 1
)
popd

echo.
echo [3/4] Build Go binaries...
set GOOS=windows
set GOARCH=amd64
go build -tags desktop,production -ldflags="-s -w -H windowsgui" -o %STAGE%\samoffice.exe .
if errorlevel 1 (
    echo [FAIL] samoffice.exe build failed
    exit /b 1
)
echo [OK] samoffice.exe built

go build -ldflags="-s -w" -o %STAGE%\samoffice-server.exe ./cmd/samoffice-server
if errorlevel 1 (
    echo [FAIL] samoffice-server.exe build failed
    exit /b 1
)
echo [OK] samoffice-server.exe built

echo.
echo [4/4] Prepare stage + run NSIS...
copy README.md %STAGE%\README.txt >nul
echo MIT License > %STAGE%\LICENSE.txt

set MAKENSIS=
where makensis >nul 2>nul && set MAKENSIS=makensis
if not defined MAKENSIS (
    if exist "C:\Program Files (x86)\NSIS\makensis.exe" set MAKENSIS="C:\Program Files (x86)\NSIS\makensis.exe"
)
if not defined MAKENSIS (
    if exist "C:\Program Files\NSIS\makensis.exe" set MAKENSIS="C:\Program Files\NSIS\makensis.exe"
)

if defined MAKENSIS (
    pushd packaging\windows
    %MAKENSIS% samoffice_installer.nsi
    if exist samoffice-setup-%VERSION%.exe (
        echo.
        echo ==================================================
        echo [OK] Installer: packaging\windows\samoffice-setup-%VERSION%.exe
        echo ==================================================
    ) else (
        echo [FAIL] NSIS packaging failed
    )
    popd
) else (
    echo [FAIL] makensis not found. Install NSIS 3.x from https://nsis.sourceforge.io/
)

endlocal
