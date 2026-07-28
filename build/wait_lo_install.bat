@echo off
REM 若安装进程未运行则启动；随后轮询 soffice.exe 直到出现（或超时 9 分钟）
tasklist /fi "imagename eq winget.exe" | find /i "winget.exe" >nul
if errorlevel 1 (
  start "" /min cmd /c "winget install --id TheDocumentFoundation.LibreOffice --silent --accept-package-agreements --accept-source-agreements --disable-interactivity > c:\Users\Administrator\samoffice\build\lo_install.txt 2>&1 & echo INSTALL_EXIT=%ERRORLEVEL% >> c:\Users\Administrator\samoffice\build\lo_install.txt"
)
set t=0
:loop
if exist "C:\Program Files\LibreOffice\program\soffice.exe" (
  echo SOFFICE_READY
  goto :eof
)
timeout /t 10 /nobreak >nul
set /a t=t+10
echo WAITING %t%s
if %t% lss 540 goto loop
echo TIMEOUT_WAIT
