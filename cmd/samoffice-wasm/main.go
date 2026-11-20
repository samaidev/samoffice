// cmd/samoffice-wasm — SamOffice 形态3（浏览器纯静态构建）的主 WASM 模块。
//
// 与 cmd/wasm（早期原型）不同，本模块按 Backend 契约对齐前端四类选项卡的
// 完整打开/保存链路，且刻意不 import 词典（sqlite）与 PDF 渲染器 ——
// 免字库、体积小；PDF 导出由 cmd/samoffice-wasm-pdf 子模块点导出时懒加载。
//
// 构建：GOOS=js GOARCH=wasm go build -o samoffice.wasm ./cmd/samoffice-wasm
//
// 全局对象 window.samoffice 提供：
//
//	samoffice.version()                        → string
//	samoffice.parse(ext, base64)               → {ok, doc?, rawContent?, warnings?, error?}
//	                                             ext 如 ".md"/".docx"/".xlsx"/".pptx"/".doc"/".xls"/".ppt"/".csv"
//	                                             doc 为 UDM（统一文档模型）JSON 字符串；
//	                                             文本类格式（md/html/txt/csv）额外带 rawContent（base64，
//	                                             与服务端 /api/doc/open 的响应字段对齐）。
//	samoffice.readXLSXBytes(base64)            → {ok, workbook?, error?}  工作簿 JSON（sheets/cells，全格式）
//	samoffice.renderDocx(docJSON)              → {ok, data?, error?}      docx 字节（base64）
//	samoffice.writeXLSX(workbookJSON)          → {ok, data?, error?}      xlsx 字节（base64）
//	samoffice.writePPTX(slidesJSON)            → {ok, data?, error?}      pptx 字节（base64）
//
// md/csv/HTML/TXT 的保存是纯文本，无需引擎参与，由前端直接写回。
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
	"github.com/zai/samoffice/internal/parser/pptx"
	"github.com/zai/samoffice/internal/parser/xlsx"
	"github.com/zai/samoffice/internal/renderer/docx"
)

const version = "1.0.0-wasm"

var reg = parser.NewRegistry()

// rawTextExts 原样回传原文（rawContent）的文本类扩展名；
// 前端 loadRawText 优先读 OpenFile 结果里的 rawContent（base64），
// 本地/远程模式由服务端回填，wasm 模式在这里对齐。
var rawTextExts = map[string]bool{
	".md": true, ".markdown": true, ".mdx": true,
	".txt": true, ".text": true,
	".html": true, ".htm": true,
	".csv": true,
}

func main() {
	js.Global().Set("samoffice", js.ValueOf(map[string]any{
		"version":       js.FuncOf(versionFn),
		"parse":         js.FuncOf(parseFn),
		"readXLSXBytes": js.FuncOf(readXLSXBytesFn),
		"renderDocx":    js.FuncOf(renderDocxFn),
		"writeXLSX":     js.FuncOf(writeXlsxFn),
		"writePPTX":     js.FuncOf(writePptxFn),
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

// parseFn(ext, base64) — 按扩展名路由到对应解析器，产出 UDM JSON。
// 文本类格式额外回传 rawContent（base64，与服务端 /api/doc/open 对齐），
// 供前端 Markdown/HTML 选项卡直接加载原文。
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
	p := reg.PickByPath("file" + ext)
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
	// syscall/js 的 ValueOf 不支持自定义结构体切片（[]core.Warning 会 panic），
	// 与 cmd/wasm 的处理一致：warnings 序列化为 JSON 字符串中转，前端再 parse
	warnJSON, err := json.Marshal(warns)
	if err != nil {
		return errResult(err)
	}
	res := map[string]any{
		"doc":      string(docJSON),
		"warnings": string(warnJSON), // 与 /api/doc/open 响应同构的 Warning 对象数组（JSON 字符串）
	}
	if rawTextExts[ext] {
		res["rawContent"] = base64.StdEncoding.EncodeToString(raw)
	}
	return okResult(res)
}

// readXLSXBytesFn(base64) — 工作簿级原生读取（保留样式/合并/列宽），供表格编辑器使用
func readXLSXBytesFn(this js.Value, args []js.Value) any {
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

// renderDocxFn(docJSON) — UDM JSON → docx 字节（base64）
func renderDocxFn(this js.Value, args []js.Value) any {
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

// writeXlsxFn(workbookJSON) — 工作簿 JSON → xlsx 字节（base64，全格式保留）
func writeXlsxFn(this js.Value, args []js.Value) any {
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

// writePptxFn(slidesJSON) — 幻灯片 JSON → pptx 字节（base64）。
// 与桌面版 WritePPTX binding、HTTP /api/pptx/save 同一 JSON 契约。
func writePptxFn(this js.Value, args []js.Value) any {
	slidesJSON, ok := argStr(args, 0)
	if !ok {
		return errResult(fmt.Errorf("缺少 slidesJSON 参数"))
	}
	data, err := pptx.WritePPTXBytes(slidesJSON)
	if err != nil {
		return errResult(err)
	}
	return okResult(map[string]any{"data": base64.StdEncoding.EncodeToString(data)})
}
