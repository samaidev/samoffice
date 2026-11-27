#!/usr/bin/env bash
# SamOffice Linux 一行安装脚本：下载最新便携包，安装到 ~/.local（无需 root）
#
#   curl -fsSL https://raw.githubusercontent.com/samaidev/samoffice/main/scripts/install-linux.sh | bash
#
# 可选环境变量:
#   SAMOFFICE_PREFIX  安装前缀（默认 $HOME/.local）
#   SAMOFFICE_REPO    仓库（默认 samaidev/samoffice）
#
# 运行依赖（webview 桌面版）: libgtk-3-0、libwebkit2gtk-4.0-37
#   Debian/Ubuntu: sudo apt-get install -y libgtk-3-0 libwebkit2gtk-4.0-37
#   Fedora:        sudo dnf install -y gtk3 webkit2gtk4.0
#   Arch:          sudo pacman -S --needed gtk3 webkit2gtk-4.1
set -euo pipefail

REPO="${SAMOFFICE_REPO:-samaidev/samoffice}"
PREFIX="${SAMOFFICE_PREFIX:-$HOME/.local}"
APPDIR="$PREFIX/opt/samoffice"

if [ "$(uname -s)" != "Linux" ]; then
  echo "此脚本仅适用于 Linux（当前: $(uname -s)）" >&2
  exit 1
fi

echo "==> 查找 SamOffice 最新发布包（linux-x64）..."
URL=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases?per_page=20" \
  | grep -o "https://[^\"]*linux-x64[^\"]*\.tar\.gz" \
  | head -1)

if [ -z "${URL}" ]; then
  echo "没有找到 Linux 安装包。请到 https://github.com/${REPO}/releases 手动下载。" >&2
  exit 1
fi
echo "    ${URL}"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "==> 下载"
curl -fL --progress-bar -o "$TMP/SamOffice.tar.gz" "$URL"

echo "==> 安装到 ${APPDIR}"
rm -rf "$APPDIR"
mkdir -p "$APPDIR"
tar -xzf "$TMP/SamOffice.tar.gz" -C "$APPDIR"
chmod +x "$APPDIR/samoffice"

mkdir -p "$PREFIX/bin" "$PREFIX/share/applications" "$PREFIX/share/icons/hicolor/512x512/apps"
ln -sf "$APPDIR/samoffice" "$PREFIX/bin/samoffice"
cp "$APPDIR/samoffice.png" "$PREFIX/share/icons/hicolor/512x512/apps/samoffice.png"
cp "$APPDIR/samoffice.desktop" "$PREFIX/share/applications/samoffice.desktop"
command -v update-desktop-database >/dev/null 2>&1 \
  && update-desktop-database "$PREFIX/share/applications" >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null 2>&1 \
  && gtk-update-icon-cache -f -t "$PREFIX/share/icons/hicolor" >/dev/null 2>&1 || true

# webview 运行库缺失时给出一条提示（不影响安装，只影响启动）
if ldconfig -p 2>/dev/null | grep -q libwebkit2gtk; then
  :
else
  echo "WARN: 未检测到 libwebkit2gtk，SamOffice 启动会失败。请先安装："
  echo "      Debian/Ubuntu: sudo apt-get install -y libgtk-3-0 libwebkit2gtk-4.0-37"
  echo "      Fedora:        sudo dnf install -y gtk3 webkit2gtk4.0"
  echo "      Arch:          sudo pacman -S --needed gtk3 webkit2gtk-4.1"
fi

echo "==> 安装完成: $PREFIX/bin/samoffice"
case ":$PATH:" in
  *":$PREFIX/bin:"*) echo "    运行: samoffice" ;;
  *) echo "    $PREFIX/bin 不在 PATH 中，可直接运行: $APPDIR/samoffice" ;;
esac
echo "    应用菜单里也会出现 SamOffice（图标与文件关联来自 samoffice.desktop）"
