@echo off
chcp 65001 >nul
title SamOffice 办公套件
cd /d "%~dp0"

echo ========================================
echo   SamOffice 本地办公套件 (Web 模式)
echo ========================================
echo.
echo 正在启动服务，请稍候...
echo.

REM 启动后端服务（监听本地 8080 端口）
start "SamOffice-Server" /min "%~dp0bin\samoffice-server.exe" --addr 127.0.0.1:8080 --data "%~dp0samoffice-data"

REM 等待服务就绪
set /a tries=0
:wait
set /a tries+=1
timeout /t 1 >nul
curl -s http://127.0.0.1:8080/api/health >nul 2>&1
if errorlevel 1 (
    if %tries% lss 15 goto wait
    echo 服务启动失败，请检查 bin\samoffice-server.exe 是否存在。
    pause
    exit /b 1
)

echo 服务已就绪！正在打开浏览器...
echo 访问地址: http://127.0.0.1:8080/
echo.
start "" "http://127.0.0.1:8080/"
echo 浏览器已打开。关闭此窗口不会停止服务；如需停止，请在任务管理器结束 "samoffice-server.exe"。
echo 按任意键打开管理控制台（保持服务运行）...
pause >nul
