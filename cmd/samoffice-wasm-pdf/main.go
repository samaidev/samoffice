// cmd/samoffice-wasm-pdf — SamOffice 形态3（浏览器纯静态构建）的 PDF 导出子模块。
//
// PDF 渲染依赖 go:embed 内嵌的 15MB 中文字体（NotoSerifSC），为避免拖累首屏，
// 主模块 cmd/samoffice-wasm 刻意不 import 本包：前端只在用户点“导出 PDF”时
// 才拉取并实例化本模块（懒加载）。两个模块共用 wasm_exec.js 运行时。
//
// 构建：GOOS=js GOARCH=wasm go build -o samoffice-pdf.wasm ./cmd/samoffice-wasm-pdf
//
// 全局对象 window.samofficePdf 提供：
//
//	samofficePdf.version()              → string
//	samofficePdf.renderPdf(docJSON)     → {ok, data?, error?}  pdf 字节（base64）
package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"syscall/js"

	"github.com/zai/samoffice/internal/core"
	"github.com/zai/samoffice/internal/renderer/pdf"
)

const version = "1.0.0-wasm-pdf"

func main() {
	js.Global().Set("samofficePdf", js.ValueOf(map[string]any{
		"version":   js.FuncOf(versionFn),
		"renderPdf": js.FuncOf(renderPdfFn),
	}))
	select {} // 常驻，等待 JS 调用
}

func okResult(extra map[string]any) js.Value {
	m := map[string]any{"ok": true}
	for k, v := range extra {
		m[k] = v
	}
	return js.ValueOf(m)
}

func errResult(err error) js.Value {
	return js.ValueOf(map[string]any{"ok": false, "error": err.Error()})
}

func argStr(args []js.Value, i int) (string, bool) {
	if len(args) <= i {
		return "", false
	}
	return args[i].String(), true
}

func versionFn(this js.Value, args []js.Value) any {
	return version
}

// renderPdfFn(docJSON) — UDM JSON → PDF 字节（base64）。
// 字体全部来自 go:embed（NotoSerifSC/Liberation 家族），无需文件系统。
func renderPdfFn(this js.Value, args []js.Value) any {
	docJSON, ok := argStr(args, 0)
	if !ok {
		return errResult(fmt.Errorf("缺少 docJSON 参数"))
	}
	var doc core.Document
	if err := json.Unmarshal([]byte(docJSON), &doc); err != nil {
		return errResult(err)
	}
	data, err := pdf.New().Render(&doc)
	if err != nil {
		return errResult(err)
	}
	return okResult(map[string]any{"data": base64.StdEncoding.EncodeToString(data)})
}
