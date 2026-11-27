#!/usr/bin/env bash
# 构建 Linux 桌面版：samoffice 二进制 + .desktop + 图标 → tar.gz 便携包
#
# 用法:
#   ./packaging/linux/build_linux_package.sh [版本号] [输出目录]
#   SKIP_FRONTEND=1  跳过前端构建（frontend/dist 已就绪时）
#
# 构建依赖（Debian/Ubuntu）:
#   sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.0-dev
# 运行依赖: libgtk-3-0、libwebkit2gtk-4.0-37
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  VERSION=$(node -e "console.log(require('./wails.json').info.productVersion)" 2>/dev/null || echo "0.0.0")
fi
OUT_DIR="${2:-dist-linux}"
STAGE="$OUT_DIR/SamOffice-linux-x64"

echo "==> SamOffice Linux 构建  version=$VERSION"

if [ "${SKIP_FRONTEND:-0}" != "1" ]; then
  echo "==> 构建前端"
  ( cd frontend && npm ci --no-audit --no-fund && npm run build )
fi
if [ ! -f frontend/dist/index.html ]; then
  echo "frontend/dist 不存在：请先构建前端（或去掉 SKIP_FRONTEND=1）" >&2
  exit 1
fi

echo "==> 编译桌面二进制 linux/amd64"
rm -rf "$STAGE"
mkdir -p "$STAGE"
# Linux 的 Wails 运行时依赖 cgo（GTK3 + WebKit2GTK）
CGO_ENABLED=1 GOOS=linux GOARCH=amd64 \
  go build -tags desktop,production -trimpath -ldflags "-s -w" -o "$STAGE/samoffice" .
chmod +x "$STAGE/samoffice"

cp build/appicon.png "$STAGE/samoffice.png"
cp packaging/linux/samoffice.desktop "$STAGE/samoffice.desktop"
cp README.md "$STAGE/README.md"

TARBALL="$OUT_DIR/SamOffice-linux-x64-${VERSION}.tar.gz"
tar -czf "$TARBALL" -C "$STAGE" .
echo "    $TARBALL"
echo "==> 完成: $STAGE"
