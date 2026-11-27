#!/usr/bin/env bash
# 构建 macOS 窗口版：SamOffice.app（图标 + Info.plist + ad-hoc 签名）→ zip / dmg
#
# 用法:
#   ./packaging/macos/build_macos_app.sh [版本号] [输出目录]
#   SKIP_FRONTEND=1  跳过前端构建（frontend/dist 已就绪，CI 里先用 npm 构建过）
#   ARCH=arm64|x64   目标架构，默认按 uname -m 推断
#
# 说明:
#   - macOS 的 Wails 运行时（Cocoa/WebKit）依赖 cgo，必须 CGO_ENABLED=1；
#     -H windowsgui 链接参数只在 Windows 有效，这里不能带。
#   - Apple Silicon 上未签名二进制无法启动，故默认 ad-hoc 签名（codesign -s -）。
#     未公证（notarize）的分发包首次打开仍需右键「打开」，或由 install-macos.sh 去掉隔离标记。
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  VERSION=$(node -e "console.log(require('./wails.json').info.productVersion)" 2>/dev/null || echo "0.0.0")
fi
OUT_DIR="${2:-dist-macos}"

ARCH="${ARCH:-}"
if [ -z "$ARCH" ]; then
  case "$(uname -m)" in
    arm64) ARCH="arm64" ;;
    x86_64) ARCH="x64" ;;
    *) echo "不支持的架构: $(uname -m)（macOS 仅支持 Apple Silicon / Intel）" >&2; exit 1 ;;
  esac
fi
case "$ARCH" in
  arm64) GOARCH="arm64" ;;
  x64|amd64|x86_64) ARCH="x64"; GOARCH="amd64" ;;
  *) echo "未知 ARCH: $ARCH（可选 arm64 / x64）" >&2; exit 1 ;;
esac

APP_NAME="SamOffice"
APP_DIR="$OUT_DIR/$APP_NAME.app"
MACOS_DIR="$APP_DIR/Contents/MacOS"
RES_DIR="$APP_DIR/Contents/Resources"
BIN="$MACOS_DIR/samoffice"
ICNS="build/darwin/AppIcon.icns"

echo "==> SamOffice macOS 构建  version=$VERSION  arch=$ARCH"

if [ "${SKIP_FRONTEND:-0}" != "1" ]; then
  echo "==> 构建前端"
  ( cd frontend && npm ci --no-audit --no-fund && npm run build )
fi
if [ ! -f frontend/dist/index.html ]; then
  echo "frontend/dist 不存在：请先构建前端（或去掉 SKIP_FRONTEND=1）" >&2
  exit 1
fi

echo "==> 编译桌面二进制 darwin/$GOARCH"
rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RES_DIR"
CGO_ENABLED=1 GOOS=darwin GOARCH="$GOARCH" \
  go build -tags desktop,production -trimpath -ldflags "-s -w" -o "$BIN" .
chmod +x "$BIN"

echo "==> 应用图标"
if [ ! -f "$ICNS" ]; then
  # 仓库未带 icns 时，用 Xcode 自带 sips/iconutil 从同一张 build/appicon.png 现场生成
  # （Windows 的 build/windows/icon.ico 也来自这张图，两端图标一致）
  WORK=$(mktemp -d)
  ICONSET="$WORK/AppIcon.iconset"
  mkdir -p "$ICONSET"
  for spec in 16:1 16:2 32:1 32:2 128:1 128:2 256:1 256:2 512:1 512:2; do
    size="${spec%%:*}"
    scale="${spec##*:}"
    px=$((size * scale))
    if [ "$scale" = "2" ]; then
      name="icon_${size}x${size}@2x.png"
    else
      name="icon_${size}x${size}.png"
    fi
    sips -z "$px" "$px" build/appicon.png --out "$ICONSET/$name" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$ICNS"
  rm -rf "$WORK"
fi
cp "$ICNS" "$RES_DIR/AppIcon.icns"

echo "==> Info.plist"
sed -e "s/__VERSION__/${VERSION}/g" packaging/macos/Info.plist > "$APP_DIR/Contents/Info.plist"

echo "==> ad-hoc 签名"
if command -v codesign >/dev/null 2>&1; then
  if codesign --force --deep --sign - "$APP_DIR" >/dev/null 2>&1; then
    echo "    codesign ok (ad-hoc)"
  else
    echo "    WARN: codesign 失败，产物仍可运行（首次打开需右键 → 打开）"
  fi
fi

mkdir -p "$OUT_DIR"
echo "==> 打包 zip"
ZIP="$OUT_DIR/SamOffice-macos-${ARCH}-${VERSION}.zip"
rm -f "$ZIP"
if command -v ditto >/dev/null 2>&1; then
  # ditto 保留符号链接/权限，比 zip 更贴合 .app 结构
  ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "$ZIP"
else
  ( cd "$OUT_DIR" && zip -qry "$(basename "$ZIP")" "${APP_NAME}.app" )
fi
echo "    $ZIP"

# dmg 只是可选的“双击安装”外壳（一行安装脚本用 zip）：
# hdiutil 在 CI runner 上偶发失败，不应连带整个打包步骤失败
echo "==> 打包 dmg（可选）"
if command -v hdiutil >/dev/null 2>&1; then
  DMG="$OUT_DIR/SamOffice-macos-${ARCH}-${VERSION}.dmg"
  rm -f "$DMG"
  if hdiutil create -volname "$APP_NAME" -srcfolder "$APP_DIR" -ov -format UDZO "$DMG" >/dev/null 2>&1; then
    echo "    $DMG"
  else
    echo "    WARN: dmg 创建失败，已跳过（zip 产物不受影响）"
  fi
fi

echo "==> 完成: $APP_DIR"
