#!/usr/bin/env bash
# round62 迭代用：tsc → vite → wasm 双模块 → 胶水拷回（vite 会清空 dist-web）
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH=/home/z/my-project/tools/go/bin:$PATH GOPATH=/home/z/my-project/tools/gopath GOMODCACHE=/home/z/my-project/tools/gopath/pkg/mod
cd frontend
npx tsc -b
VITE_WEB_ONLY=1 npx vite build --outDir dist-web >/dev/null 2>&1
cd ..
GOOS=js GOARCH=wasm go build -ldflags "-s -w" -o frontend/dist-web/samoffice.wasm ./cmd/samoffice-wasm
GOOS=js GOARCH=wasm go build -ldflags "-s -w" -o frontend/dist-web/samoffice-pdf.wasm ./cmd/samoffice-wasm-pdf
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" frontend/dist-web/
echo "rebuild done"
