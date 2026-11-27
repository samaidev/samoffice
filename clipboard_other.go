//go:build !windows

package main

// 非 Windows 平台的剪贴板实现：走 Wails runtime 的系统剪贴板（macOS NSPasteboard / Linux GTK）。
// Windows 版（clipboard_windows.go）用 Win32 API 同时写入 CF_HTML + CF_UNICODETEXT 保留富文本；
// 这里没有等价的跨平台富文本剪贴板 API，退化为纯文本 —— 方法签名与 Windows 完全一致，
// 前端（DocumentEditor 的复制/粘贴路径）无需区分平台。

import (
	"fmt"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// SetClipboardHtml 写入剪贴板（纯文本形式；html 仅作纯文本缺失时的兜底）。
func (a *App) SetClipboardHtml(html string, plain string) error {
	if a.ctx == nil {
		return fmt.Errorf("app not started")
	}
	if plain == "" {
		plain = html
	}
	return runtime.ClipboardSetText(a.ctx, plain)
}

// GetClipboardHtml 读取剪贴板文本（非 Windows 无 HTML 剪贴板通道，等同 ClipboardGetText）。
func (a *App) GetClipboardHtml() (string, error) {
	return a.ClipboardGetText()
}

// ClipboardGetText 读取剪贴板纯文本。
func (a *App) ClipboardGetText() (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("app not started")
	}
	return runtime.ClipboardGetText(a.ctx)
}
