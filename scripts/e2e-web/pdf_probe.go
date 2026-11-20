//go:build ignore

// pdf_probe — 对照实验：走真实 JSON → UnmarshalJSON → Render 链路（与 e2e/wasm/服务端完全同构）。
// 用法：go run scripts/e2e-web/pdf_probe.go
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/zai/samoffice/internal/core"
	"github.com/zai/samoffice/internal/renderer/pdf"
)

func main() {
	payload := []byte(`{
		"meta": {"title": "PDF 渲染探针"},
		"blocks": [
			{"level": 1, "inline": [{"content": "中文渲染探针标题"}]},
			{"inline": [{"content": "这段中文必须出现在 PDF 页面上，否则链路有 bug。English sentence too."}]}
		]
	}`)
	var doc core.Document
	if err := json.Unmarshal(payload, &doc); err != nil {
		fmt.Println("unmarshal err:", err)
		return
	}
	fmt.Println("blocks:", len(doc.Blocks))
	for i, b := range doc.Blocks {
		fmt.Printf("block[%d] type=%s isPtr=%v\n", i, b.BlockType(), fmt.Sprintf("%T", b)[0] == '*')
	}
	data, err := pdf.New().Render(&doc)
	fmt.Println("size:", len(data), "err:", err)
	if err == nil {
		os.WriteFile("/tmp/probe.pdf", data, 0o644)
		fmt.Println("written /tmp/probe.pdf")
	}
}
