@echo off
start "" /min cmd /c "winget install --id TheDocumentFoundation.LibreOffice --silent --accept-package-agreements --accept-source-agreements --disable-interactivity > c:\Users\Administrator\samoffice\build\lo_install.txt 2>&1 & echo INSTALL_EXIT=%ERRORLEVEL% >> c:\Users\Administrator\samoffice\build\lo_install.txt"
