package main

// 仅 Windows 平台：通过 Win32 Clipboard API 同时写入 HTML(CF_HTML) 与纯文本(CF_UNICODETEXT)，
// 保证从编辑器复制的内容在 Word / WPS / 浏览器等目标中保留富文本格式。
// 前端在 WebView2 中 execCommand('copy') 不可靠，故改为前端序列化 HTML 后调用本方法写入系统剪贴板。

import (
	"fmt"
	"syscall"
	"unicode/utf16"
	"unsafe"
)

var (
	modUser32           = syscall.NewLazyDLL("user32.dll")
	procOpenClipboard   = modUser32.NewProc("OpenClipboard")
	procCloseClipboard  = modUser32.NewProc("CloseClipboard")
	procEmptyClipboard  = modUser32.NewProc("EmptyClipboard")
	procSetClipboardData = modUser32.NewProc("SetClipboardData")
	procGetClipboardData = modUser32.NewProc("GetClipboardData")
	procRegisterClipFmt = modUser32.NewProc("RegisterClipboardFormatW")
	modKernel32         = syscall.NewLazyDLL("kernel32.dll")
	procGlobalAlloc     = modKernel32.NewProc("GlobalAlloc")
	procGlobalFree      = modKernel32.NewProc("GlobalFree")
	procGlobalLock      = modKernel32.NewProc("GlobalLock")
	procGlobalUnlock    = modKernel32.NewProc("GlobalUnlock")
)

const cfUnicodeText = 13

// CF_HTML 头部模板，描述 HTML 片段在整体字节流中的偏移（按字节计），占位用 10 位零填充。
func buildCfHtml(html string) string {
	const startTag = "<!--StartFragment-->"
	const endTag = "<!--EndFragment-->"
	body := "<html><body>" + startTag + html + endTag + "</body></html>"
	header := "Version:0.9\r\n" +
		"StartHTML:0000000000\r\n" +
		"EndHTML:0000000000\r\n" +
		"StartFragment:0000000000\r\n" +
		"EndFragment:0000000000\r\n"
	startHtml := len(header)
	startFrag := startHtml + len("<html><body>"+startTag)
	endFrag := startFrag + len(html)
	endHtml := startFrag + len(endTag+"</body></html>")
	pad := func(n int) string { return fmt.Sprintf("%010d", n) }
	out := "Version:0.9\r\n" +
		"StartHTML:" + pad(startHtml) + "\r\n" +
		"EndHTML:" + pad(endHtml) + "\r\n" +
		"StartFragment:" + pad(startFrag) + "\r\n" +
		"EndFragment:" + pad(endFrag) + "\r\n" +
		body
	return out
}

func utf16Bytes(s string) []byte {
	u16 := utf16.Encode([]rune(s))
	buf := make([]byte, len(u16)*2)
	for i, v := range u16 {
		buf[i*2] = byte(v)
		buf[i*2+1] = byte(v >> 8)
	}
	// 追加 NUL 终止符
	return append(buf, 0, 0)
}

func setClipboardData(format uint, data []byte) bool {
	h, _, _ := procGlobalAlloc.Call(0x0002, uintptr(len(data))) // GMEM_MOVEABLE
	if h == 0 {
		return false
	}
	p, _, _ := procGlobalLock.Call(h)
	if p == 0 {
		procGlobalFree.Call(h)
		return false
	}
	copy((*[1 << 30]byte)(unsafe.Pointer(p))[:len(data)], data)
	procGlobalUnlock.Call(h)
	r, _, _ := procSetClipboardData.Call(uintptr(format), h)
	return r != 0
}

func htmlClipFormat() uint {
	ft, _, _ := procRegisterClipFmt.Call(uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr("HTML Format"))))
	if ft == 0 {
		return 49314
	}
	return uint(ft)
}

// SetClipboardHtml 将 html + 其纯文本形式写入系统剪贴板（HTML 与文本双格式）。
func (a *App) SetClipboardHtml(html string, plain string) error {
	if html == "" {
		html = plain
	}
	if plain == "" {
		plain = html
	}
	r, _, _ := procOpenClipboard.Call(0)
	if r == 0 {
		return fmt.Errorf("open clipboard failed")
	}
	defer procCloseClipboard.Call()
	procEmptyClipboard.Call()

	// HTML 格式（UTF-16LE 字节）
	htmlBytes := utf16Bytes(buildCfHtml(html))
	setClipboardData(htmlClipFormat(), htmlBytes)

	// 纯文本 UTF-16LE
	textBytes := utf16Bytes(plain)
	setClipboardData(cfUnicodeText, textBytes)
	return nil
}

// GetClipboardHtml 优先读取 HTML 格式，否则回退纯文本。
func (a *App) GetClipboardHtml() (string, error) {
	r, _, _ := procOpenClipboard.Call(0)
	if r == 0 {
		return "", fmt.Errorf("open clipboard failed")
	}
	defer procCloseClipboard.Call()

	fmtHtml := htmlClipFormat()
	h, _, _ := procGetClipboardData.Call(uintptr(fmtHtml))
	if h != 0 {
		p, _, _ := procGlobalLock.Call(h)
		if p != 0 {
			raw := utf16ToString(p)
			procGlobalUnlock.Call(h)
			return extractFragment(raw), nil
		}
	}

	h2, _, _ := procGetClipboardData.Call(cfUnicodeText)
	if h2 != 0 {
		p, _, _ := procGlobalLock.Call(h2)
		if p != 0 {
			s := utf16ToString(p)
			procGlobalUnlock.Call(h2)
			return s, nil
		}
	}
	return "", nil
}

// utf16ToString 从锁定的全局内存指针读取以 NUL 结尾的 UTF-16LE 字符串。
func utf16ToString(p uintptr) string {
	if p == 0 {
		return ""
	}
	var n int
	for {
		w := *(*uint16)(unsafe.Pointer(p + uintptr(n*2)))
		if w == 0 {
			break
		}
		n++
		if n > 10<<20 {
			break
		}
	}
	if n == 0 {
		return ""
	}
	u16 := make([]uint16, n)
	for i := 0; i < n; i++ {
		u16[i] = *(*uint16)(unsafe.Pointer(p + uintptr(i*2)))
	}
	return string(utf16.Decode(u16))
}

// extractFragment 从 CF_HTML 文本中解析出 <!--StartFragment--> 与 <!--EndFragment--> 之间的片段。
func extractFragment(cfHtml string) string {
	const startTag = "<!--StartFragment-->"
	const endTag = "<!--EndFragment-->"
	si := indexOf(cfHtml, startTag)
	if si < 0 {
		return cfHtml
	}
	si += len(startTag)
	ei := indexOf(cfHtml[si:], endTag)
	if ei < 0 {
		return cfHtml[si:]
	}
	return cfHtml[si : si+ei]
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
