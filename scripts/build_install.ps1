# 编译并把最新 exe 覆盖到安装目录 (Program Files\SamOffice)
# 用法: powershell -ExecutionPolicy Bypass -File scripts/build_install.ps1
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "==> wails build ..." -ForegroundColor Cyan
wails build -clean
if ($LASTEXITCODE -ne 0) { throw "wails build failed" }

$src = Join-Path $root 'build\bin\samoffice.exe'
$dstDir = 'C:\Program Files\SamOffice'
$dst = Join-Path $dstDir 'samoffice.exe'

if (-not (Test-Path $src)) { throw "未找到编译产物: $src" }
if (-not (Test-Path $dstDir)) {
    Write-Host "==> 创建安装目录 $dstDir" -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
}

Write-Host "==> 覆盖安装: $src -> $dst" -ForegroundColor Cyan
Copy-Item -Path $src -Destination $dst -Force

Write-Host "==> 完成。当前安装版:" -ForegroundColor Green
Get-Item $dst | Select-Object FullName, Length, LastWriteTime | Format-Table -AutoSize
