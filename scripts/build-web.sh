#!/usr/bin/env bash
# SamOffice 形态3：浏览器纯静态构建（无服务端、无桌面依赖）
#
# 产物 frontend/dist-web/：
#   - 应用外壳（vite build，VITE_WEB_ONLY=1 触发 WasmBackend 三级判定）
#   - samoffice.wasm      主模块（解析 + docx/xlsx/pptx 生成，仅首载）
#   - samoffice-pdf.wasm  PDF 子模块（内嵌 15MB 中文字体，点导出才懒加载）
#   - wasm_exec.js        Go WASM 运行时胶水
#
# WASM 二进制只落 dist-web —— 不污染 Wails 桌面构建（桌面 dist 保持无 wasm）。
# 用法：./scripts/build-web.sh   或   cd frontend && npm run build:web
# 跑起来：npx serve frontend/dist-web   （任意静态服务器即可）
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)

echo '[1/3] 前端构建（web-only 标记）...'
cd "$ROOT/frontend"
VITE_WEB_ONLY=1 npx tsc -b
VITE_WEB_ONLY=1 npx vite build --outDir dist-web --emptyOutDir

echo '[2/3] 编译 WASM 主模块 + PDF 子模块...'
cd "$ROOT"
export GOOS=js GOARCH=wasm
go build -ldflags "-s -w" -o frontend/dist-web/samoffice.wasm ./cmd/samoffice-wasm
go build -ldflags "-s -w" -o frontend/dist-web/samoffice-pdf.wasm ./cmd/samoffice-wasm-pdf
unset GOOS GOARCH

echo '[3/3] 复制 wasm_exec.js（Go 运行时胶水）...'
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" frontend/dist-web/wasm_exec.js

echo '--- 产物清单 ---'
ls -lh frontend/dist-web/ | grep -E 'wasm|wasm_exec' || true
echo "完成：npx serve frontend/dist-web 后访问即为浏览器内模式（徽标=浏览器内/In-browser）"
