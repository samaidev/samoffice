// cmd/wasm-xlsx — SamOffice 分格式引擎：xlsx（excelize，解析+xlsxOpen+saveXlsx）。
//
// 构建：GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o samoffice-xlsx.wasm ./cmd/wasm-xlsx
// 目标：brotli 后 ≤2MB 进单分包（1.7.70 全量 br≈2.95MB 超预算 defer）。
// [v1.7.73] 体积根因定位：internal/parser 的 registry.go import 全部 8 个解析器包，
// 各包 init/包级变量无条件链接（docx 解析器 ≈5MB raw），excelize 本体触底仅
// ≈4.2MB raw（探针实测 br≈1.61MB）。本入口直接路由 xlsx.Parser，不 import
// internal/parser，链接后 br≈1.7MB 量级，稳进单分包。
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"syscall/js"

	"github.com/zai/samoffice/internal/core"
	"github.com/zai/samoffice/internal/parser/xlsx"
)

const version = "1.1.0-wasm-xlsx"

// extOK xlsx 解析器支持的扩展名（不经 registry，直接路由）
var extOK = func() map[string]bool {
	m := map[string]bool{}
	for _, e := range (&xlsx.Parser{}).Supported() {
		m[e] = true
	}
	return m
}()

func main() {
	js.Global().Set("samoffice", js.ValueOf(map[string]any{
		"version":   js.FuncOf(versionFn),
		"parse":     js.FuncOf(parseFn),
		"renderHTML": js.FuncOf(renderHTMLFn),
		"xlsxOpen":  js.FuncOf(xlsxOpenFn),
		"saveXlsx":  js.FuncOf(saveXlsxFn),
		"readXLSXBytes": js.FuncOf(xlsxOpenFn),
		"writeXLSX": js.FuncOf(saveXlsxFn),
		"saveDocx":  js.FuncOf(stubFn("docx 写回未启用（xlsx 构建不含 docx 写回器）")),
		"savePptx":  js.FuncOf(stubFn("pptx 写回未启用（xlsx 构建不含 ppt 写回器）")),
	}))
	select {}
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

func b64decode(s string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(s)
}

func versionFn(this js.Value, args []js.Value) any { return version }

func stubFn(msg string) func(this js.Value, args []js.Value) any {
	return func(this js.Value, args []js.Value) any {
		return errResult(fmt.Errorf("%s", msg))
	}
}

func parseFn(this js.Value, args []js.Value) any {
	ext, ok := argStr(args, 0)
	if !ok {
		return errResult(fmt.Errorf("缺少 ext 参数"))
	}
	b64, ok := argStr(args, 1)
	if !ok {
		return errResult(fmt.Errorf("缺少 base64 数据参数"))
	}
	raw, err := b64decode(b64)
	if err != nil {
		return errResult(err)
	}
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}
	ext = strings.ToLower(ext)
	var doc *core.Document
	var warns []core.Warning
	if extOK[ext] {
		doc, warns, err = (&xlsx.Parser{}).Parse(bytes.NewReader(raw))
	} else {
		return errResult(fmt.Errorf("不支持的格式: " + ext))
	}
	if err != nil {
		return errResult(err)
	}
	if doc == nil {
		doc = &core.Document{}
	}
	docJSON, err := json.Marshal(doc)
	if err != nil {
		return errResult(err)
	}
	if warns == nil {
		warns = []core.Warning{}
	}
	warnJSON, err := json.Marshal(warns)
	if err != nil {
		return errResult(err)
	}
	return okResult(map[string]any{
		"doc":      string(docJSON),
		"warnings": string(warnJSON),
	})
}

// xlsxOpenFn(base64) — 工作簿级打开（保留样式/合并/列宽），供表格编辑器使用
func xlsxOpenFn(this js.Value, args []js.Value) any {
	b64, ok := argStr(args, 0)
	if !ok {
		return errResult(fmt.Errorf("缺少 base64 数据参数"))
	}
	raw, err := b64decode(b64)
	if err != nil {
		return errResult(err)
	}
	wbJSON, err := xlsx.ReadXLSXBytes(raw)
	if err != nil {
		return errResult(err)
	}
	return okResult(map[string]any{"workbook": wbJSON})
}

// saveXlsxFn(workbookJSON) — 工作簿 JSON → xlsx 字节（base64）
func saveXlsxFn(this js.Value, args []js.Value) any {
	wbJSON, ok := argStr(args, 0)
	if !ok {
		return errResult(fmt.Errorf("缺少 workbookJSON 参数"))
	}
	data, err := xlsx.WriteXLSXBytes(wbJSON)
	if err != nil {
		return errResult(err)
	}
	return okResult(map[string]any{"data": base64.StdEncoding.EncodeToString(data)})
}
