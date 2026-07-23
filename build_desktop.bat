@echo off
cd /d c:\Users\Administrator\samoffice
go build -tags desktop,production -ldflags="-s -w -H windowsgui" -o build/samoffice.exe .
echo BUILD_EXIT=%ERRORLEVEL%
