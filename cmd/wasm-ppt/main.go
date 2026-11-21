// cmd/wasm-ppt — SamOffice 分格式引擎：pptx/ppt（解析+renderHTML+savePptx）。
//
// 构建：GOOS=js GOARCH=wasm go build -ldflags="-w" -o samoffice-ppt.wasm ./cmd/wasm-ppt
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
	"github.com/zai/samoffice/internal/parser/ppt"
	"github.com/zai/samoffice/internal/parser/pptx"
)

const version = "1.1.0-wasm-ppt"

var reg = func() *parser.Registry {
	r := parser.NewRegistryEmpty()
	r.Register(&pptx.Parser{})
	r.Register(&ppt.Parser{})
	return r
}()

func main() {
	js.Global().Set("samoffice", js.ValueOf(map[string]any{
		"version":   js.FuncOf(versionFn),
		"parse":     js.FuncOf(parseFn),
		"renderHTML": js.FuncOf(renderHTMLFn),
		"savePptx":  js.FuncOf(savePptxFn),
		"writePPTX": js.FuncOf(savePptxFn),
		"saveDocx":  js.FuncOf(stubFn("docx 写回未启用（ppt 构建不含 docx 写回器）")),
		"xlsxOpen":  js.FuncOf(stubFn("xlsx 打开未启用（ppt 构建不含 xlsx 解析器）")),
		"saveXlsx":  js.FuncOf(stubFn("xlsx 写回未启用（ppt 构建不含 xlsx 写回器）")),
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
	if p := reg.PickByPath("file" + ext); p != nil {
		doc, warns, err = p.Parse(bytes.NewReader(raw))
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

// savePptxFn(slidesJSON) — 幻灯片 JSON → pptx 字节（base64），契约与 round53 一致
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
