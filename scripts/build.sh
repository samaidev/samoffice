#!/bin/bash
# GoOffice 构建脚本
# 用法: ./scripts/build.sh [server|wails|all]

set -e

export PATH=$HOME/sdk/go/bin:$HOME/go/bin:$PATH
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

TARGET="${1:-all}"

build_server() {
    echo "==> Building samoffice-server..."
    go build -o bin/samoffice-server ./cmd/samoffice-server
    echo "    Output: bin/samoffice-server"
}

build_frontend() {
    echo "==> Building frontend..."
    cd frontend
    npm install --silent
    npm run build
    cd ..
}

build_wails() {
    echo "==> Building samoffice (Wails desktop)..."
    build_frontend
    go build -o bin/samoffice .
    echo "    Output: bin/samoffice"
}

build_all() {
    build_server
    build_wails
}

case "$TARGET" in
    server) build_server ;;
    wails)  build_wails ;;
    all)    build_all ;;
    *) echo "Usage: $0 [server|wails|all]"; exit 1 ;;
esac

echo "==> Done."
