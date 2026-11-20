// cmd/wasm — SamOffice 文档引擎的浏览器 WASM 构建。
//
// 构建：GOOS=js GOARCH=wasm go build -o samoffice.wasm ./cmd/wasm
// 运行：页面先加载 wasm_exec.js，再实例化 samoffice.wasm，
//
//	    全局对象 window.samoffice 提供：
//
//	samoffice.version()                       → string
//	samoffice.parse(ext, base64)              → {ok, doc?, warnings?, error?}
//	                                            ext 如 ".md"/".docx"/".xlsx"/".pptx"/".doc"/".xls"/".ppt"/".csv"
//	                                            doc 为 UDM（统一文档模型）JSON 字符串
//	samoffice.xlsxOpen(base64)                → {ok, workbook?, error?}  工作簿 JSON（sheets/cells）
//	samoffice.saveDocx(docJSON)               → {ok, data?, error?}      docx 字节（base64）
//	samoffice.saveXlsx(workbookJSON)          → {ok, data?, error?}      xlsx 字节（base64）
//
// md/csv 的保存是纯文本，无需引擎参与，直接由前端写回。
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"syscall/js"

	"github.com/zai/samoffice/internal/core"
	"github.com/zai/samoffice/internal/parser"
	"github.com/zai/samoffice/internal/parser/xlsx"
	"github.com/zai/samoffice/internal/renderer/docx"
)

const version = "0.1.0-wasm"

var reg = parser.NewRegistry()

func main() {
	js.Global().Set("samoffice", js.ValueOf(map[string]any{
		"version":  js.FuncOf(versionFn),
		"parse":    js.FuncOf(parseFn),
		"xlsxOpen": js.FuncOf(xlsxOpenFn),
		"saveDocx": js.FuncOf(saveDocxFn),
		"saveXlsx": js.FuncOf(saveXlsxFn),
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

// argStr 取第 i 个参数（string）；越界返回 false
func argStr(args []js.Value, i int) (string, bool) {
	if len(args) <= i {
		return "", false
	}
	return args[i].String(), true
}

func b64decode(s string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(s)
}

func versionFn(this js.Value, args []js.Value) any {
	return version
}

// parseFn(ext, base64) — 按扩展名路由到对应解析器，产出 UDM JSON
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
	p := reg.PickByPath("file" + strings.ToLower(ext))
	if p == nil {
		return errResult(fmt.Errorf("不支持的格式: " + ext))
	}
	doc, warns, err := p.Parse(bytes.NewReader(raw))
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
	warnList := make([]any, 0, len(warns))
	for _, w := range warns {
		warnList = append(warnList, w.Message)
	}
	return okResult(map[string]any{
		"doc":      string(docJSON),
		"warnings": warnList,
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

// saveDocxFn(docJSON) — UDM JSON → docx 字节（base64）
func saveDocxFn(this js.Value, args []js.Value) any {
	docJSON, ok := argStr(args, 0)
	if !ok {
		return errResult(fmt.Errorf("缺少 docJSON 参数"))
	}
	var doc core.Document
	if err := json.Unmarshal([]byte(docJSON), &doc); err != nil {
		return errResult(err)
	}
	data, err := docx.New().Render(&doc)
	if err != nil {
		return errResult(err)
	}
	return okResult(map[string]any{"data": base64.StdEncoding.EncodeToString(data)})
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
