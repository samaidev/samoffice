// cmd/wasm-docx — SamOffice 分格式引擎：docx/doc/md/markdown/mdx/txt/html/csv。
//
// 构建：GOOS=js GOARCH=wasm go build -ldflags="-w" -o samoffice-docx.wasm ./cmd/wasm-docx
// 全局对象 window.samoffice 提供：
//   version()                → "1.1.0-wasm-docxp"
//   parse(ext, base64)       → {ok, doc?, rawContent?, warnings?, error?}
//   renderHTML(docJSON)      → {ok, html?, error?}
//   saveDocx(docJSON)        → {ok, data?, error?}（本构建含写回渲染器）
//   xlsxOpen/saveXlsx/savePptx → 明确的 stub 报错（跨格式调用面齐平）
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
	"github.com/zai/samoffice/internal/parser/csv"
	"github.com/zai/samoffice/internal/parser/doc"
	"github.com/zai/samoffice/internal/parser/docx"
	"github.com/zai/samoffice/internal/parser/markdown"
)

const version = "1.1.0-wasm-docxp"

// [v1.7.72] 写回渲染器（internal/renderer/docx）实测使 br 从 ~1.0MB 涨到 2.97MB，
// 超单分包 2MB 上限——docx 构建保持 parse-only，写回由前端 utils/docxwrite.js
// 生成最小 OOXML（store-zip），所见即所得编辑保存走该链路。

// 本地注册表：只装 docx 组解析器（分格式裁剪的关键——不 import 全量
// registry，链接器才能剔除 ppt/xls/xlsx 代码）。
var reg = func() *parser.Registry {
	r := parser.NewRegistryEmpty()
	r.Register(&docx.Parser{})
	r.Register(&doc.Parser{})
	r.Register(&markdown.Parser{})
	r.Register(&csv.Parser{})
	return r
}()

func main() {
	js.Global().Set("samoffice", js.ValueOf(map[string]any{
		"version":  js.FuncOf(versionFn),
		"parse":    js.FuncOf(parseFn),
		"renderHTML": js.FuncOf(renderHTMLFn),
		"saveDocx": js.FuncOf(saveDocxFn),
		// 跨格式 stub：调用面齐平，误用给出明确报错而非 undefined
		"xlsxOpen":  js.FuncOf(stubFn("xlsx 打开未启用（docx 构建不含 xlsx 解析器）")),
		"saveXlsx":  js.FuncOf(stubFn("xlsx 写回未启用（docx 构建不含 xlsx 写回器）")),
		"savePptx":  js.FuncOf(stubFn("pptx 写回未启用（docx 构建不含 ppt 写回器）")),
		"renderDocx": js.FuncOf(saveDocxFn),
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

// stubFn 生成统一签名的 stub 方法
func stubFn(msg string) func(this js.Value, args []js.Value) any {
	return func(this js.Value, args []js.Value) any {
		return errResult(fmt.Errorf("%s", msg))
	}
}

var rawTextExts = map[string]bool{
	".md": true, ".markdown": true, ".mdx": true,
	".txt": true, ".text": true,
	".html": true, ".htm": true,
	".csv": true,
}

func synthTextDoc(raw []byte) *core.Document {
	doc := &core.Document{Meta: core.Meta{Title: "text"}}
	for _, line := range strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n") {
		doc.Blocks = append(doc.Blocks, core.Paragraph{Inline: []core.Inline{core.Text{Content: line}}})
	}
	return doc
}

func synthHTMLDoc(raw []byte) *core.Document {
	return &core.Document{Meta: core.Meta{Title: "html"}, Blocks: []core.Block{
		core.RawBlock{Kind: "html", Data: map[string]any{"html": string(raw)}},
	}}
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

func saveDocxFn(this js.Value, args []js.Value) any {
	return errResult(fmt.Errorf("docx 写回由前端生成（引擎构建不含渲染器以控分包体积）"))
}
