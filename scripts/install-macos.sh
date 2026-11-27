#!/usr/bin/env bash
# SamOffice macOS 一行安装脚本：下载最新发布包，安装到 /Applications
#
#   curl -fsSL https://raw.githubusercontent.com/samaidev/samoffice/main/scripts/install-macos.sh | bash
#
# 可选环境变量:
#   SAMOFFICE_APP_DIR  安装目录（默认 /Applications）
#   SAMOFFICE_REPO     仓库（默认 samaidev/samoffice）
#
# 说明: 分发包为 ad-hoc 签名（未做 Apple 公证）。脚本会去掉 com.apple.quarantine
# 隔离标记并重新 ad-hoc 签名，避免 Gatekeeper 报「已损坏，无法打开」。
set -euo pipefail

REPO="${SAMOFFICE_REPO:-samaidev/samoffice}"
APP_NAME="SamOffice"
DEST="${SAMOFFICE_APP_DIR:-/Applications}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "此脚本仅适用于 macOS（当前: $(uname -s)）" >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *)
    echo "不支持的 CPU 架构: $(uname -m)（支持 arm64 / x86_64）" >&2
    exit 1
    ;;
esac

echo "==> 查找 SamOffice 最新发布包（macOS $ARCH）..."
URL=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases?per_page=20" \
  | grep -o "https://[^\"]*macos-${ARCH}[^\"]*\.zip" \
  | head -1)

if [ -z "${URL}" ]; then
  echo "没有找到 macOS ${ARCH} 安装包。请到 https://github.com/${REPO}/releases 手动下载。" >&2
  exit 1
fi
echo "    ${URL}"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "==> 下载"
curl -fL --progress-bar -o "$TMP/SamOffice.zip" "$URL"

echo "==> 解包"
ditto -x -k "$TMP/SamOffice.zip" "$TMP/out"
SRC=$(/usr/bin/find "$TMP/out" -maxdepth 2 -type d -name "${APP_NAME}.app" | head -1)
if [ -z "$SRC" ]; then
  echo "压缩包里没有找到 ${APP_NAME}.app" >&2
  exit 1
fi

TARGET="${DEST}/${APP_NAME}.app"
echo "==> 安装到 ${TARGET}"
rm -rf "$TARGET" 2>/dev/null || true
if ! ditto "$SRC" "$TARGET" 2>/dev/null; then
  echo "    需要管理员权限写入 ${DEST}，请输入密码："
  sudo rm -rf "$TARGET"
  sudo ditto "$SRC" "$TARGET"
fi

# 去掉隔离属性（未公证包的 Gatekeeper 拦截），并按需重新 ad-hoc 签名
xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null || true
/usr/bin/codesign --force --deep --sign - "$TARGET" >/dev/null 2>&1 || true

echo "==> 安装完成：${TARGET}"
echo "    启动: open -a \"${TARGET}\"（或在启动台搜索 SamOffice）"
open -a "$TARGET" 2>/dev/null || true
