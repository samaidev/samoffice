// cmd/wasm — SamOffice 文档引擎的浏览器 WASM 构建。
//
// 构建：GOOS=js GOARCH=wasm go build -o samoffice.wasm ./cmd/wasm
// 运行：页面先加载 wasm_exec.js，再实例化 samoffice.wasm，
//
//	    全局对象 window.samoffice 提供：
//
//	samoffice.version()                       → string
//	samoffice.parse(ext, base64)              → {ok, doc?, rawContent?, warnings?, error?}
//	                                            ext 如 ".md"/".mdx"/".txt"/".html"/".docx"/".xlsx"/".pptx"/".doc"/".xls"/".ppt"/".csv"
//	                                            doc 为 UDM（统一文档模型）JSON 字符串；文本类格式额外回传
//	                                            rawContent（原文 base64，与 cmd/samoffice-wasm、/api/doc/open 对齐）
//	samoffice.xlsxOpen(base64)                → {ok, workbook?, error?}  工作簿 JSON（sheets/cells）
//	samoffice.saveDocx(docJSON)               → {ok, data?, error?}      docx 字节（base64）
//	samoffice.saveXlsx(workbookJSON)          → {ok, data?, error?}      xlsx 字节（base64）
//	samoffice.savePptx(slidesJSON)            → {ok, data?, error?}      pptx 字节（base64）
//	samoffice.renderHTML(docJSON)             → {ok, html?, error?}      UDM → 富文本 HTML（rich-text 兼容）
//	                                            slidesJSON 与桌面 WritePPTX binding / /api/pptx/save 同一契约
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
	"github.com/zai/samoffice/internal/parser/markdown"
	"github.com/zai/samoffice/internal/parser/pptx"
	"github.com/zai/samoffice/internal/parser/xlsx"
	"github.com/zai/samoffice/internal/renderer/docx"
)

const version = "1.1.0-wasm"

var reg = parser.NewRegistry()

func main() {
	js.Global().Set("samoffice", js.ValueOf(map[string]any{
		"version":  js.FuncOf(versionFn),
		"parse":    js.FuncOf(parseFn),
		"xlsxOpen": js.FuncOf(xlsxOpenFn),
		"saveDocx": js.FuncOf(saveDocxFn),
		"saveXlsx": js.FuncOf(saveXlsxFn),
		"savePptx": js.FuncOf(savePptxFn),
		// 与 cmd/samoffice-wasm（应用后端）同名的别名——两个引擎共享一套调用面
		"renderHTML":    js.FuncOf(renderHTMLFn),
		"readXLSXBytes": js.FuncOf(xlsxOpenFn),
		"renderDocx":    js.FuncOf(saveDocxFn),
		"writeXLSX":     js.FuncOf(saveXlsxFn),
		"writePPTX":     js.FuncOf(savePptxFn),
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

// rawTextExts 原样回传原文（rawContent）的文本类扩展名，
// 与 cmd/samoffice-wasm、服务端 /api/doc/open 对齐。
var rawTextExts = map[string]bool{
	".md": true, ".markdown": true, ".mdx": true,
	".txt": true, ".text": true,
	".html": true, ".htm": true,
	".csv": true,
}

// synthTextDoc 无解析器的纯文本（txt/text）合成 UDM：每行一段，保留空行结构
func synthTextDoc(raw []byte) *core.Document {
	doc := &core.Document{Meta: core.Meta{Title: "text"}}
	for _, line := range strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n") {
		doc.Blocks = append(doc.Blocks, core.Paragraph{Inline: []core.Inline{core.Text{Content: line}}})
	}
	return doc
}

// synthHTMLDoc 无解析器的 html/htm 合成 UDM：整页入 RawBlock{kind:"html"}，前端自行预览
func synthHTMLDoc(raw []byte) *core.Document {
	return &core.Document{Meta: core.Meta{Title: "html"}, Blocks: []core.Block{
		core.RawBlock{Kind: "html", Data: map[string]any{"html": string(raw)}},
	}}
}

// parseFn(ext, base64) — 按扩展名路由到对应解析器，产出 UDM JSON；
// 文本类格式额外回传 rawContent（base64）；warnings 为 /api/doc/open 同构的 JSON 字符串
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
	if p := reg.PickByPath("file" + ext); p != nil {
		doc, warns, err = p.Parse(bytes.NewReader(raw))
	} else if ext == ".txt" || ext == ".text" {
		doc = synthTextDoc(raw)
	} else if ext == ".html" || ext == ".htm" {
		doc = synthHTMLDoc(raw)
	} else if ext == ".mdx" {
		doc, warns, err = markdown.New().Parse(bytes.NewReader(raw))
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
	// syscall/js 的 ValueOf 不支持结构体切片——warnings 以 JSON 字符串中转
	//（Warning 对象数组，与 /api/doc/open 响应同构；nil 切片序列化为 "null"，归一为 []）
	if warns == nil {
		warns = []core.Warning{}
	}
	warnJSON, err := json.Marshal(warns)
	if err != nil {
		return errResult(err)
	}
	res := map[string]any{
		"doc":      string(docJSON),
		"warnings": string(warnJSON),
	}
	if rawTextExts[ext] {
		res["rawContent"] = base64.StdEncoding.EncodeToString(raw)
	}
	return okResult(res)
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

// savePptxFn(slidesJSON) — 幻灯片 JSON → pptx 字节（base64）。
// 契约与桌面 WritePPTX binding / HTTP /api/pptx/save 完全一致（round53）。
func savePptxFn(this js.Value, args []js.Value) any {
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
