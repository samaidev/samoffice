// 开发工具：解析 pptx → 打印幻灯片 JSON（round58 PPT 保真度对比用）
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/zai/samoffice/internal/parser"
)

func main() {
	path := os.Args[1]
	data, err := os.ReadFile(path)
	if err != nil {
		fmt.Println("ERR:", err)
		os.Exit(1)
	}
	reg := parser.NewRegistry()
	doc, warns, err := reg.ParseBytes(path, data)
	if err != nil {
		fmt.Println("ERR:", err)
		os.Exit(1)
	}
	_ = warns
	// RawBlocks 里每张幻灯片 Data = {slides:[...]}? 打印整体结构摘要
	b, _ := json.MarshalIndent(doc.Blocks, "", "  ")
	fmt.Println(string(b[:min(len(b), 3000)]))
	fmt.Println("blocks:", len(doc.Blocks))
	// 完整 JSON 落文件
	out, _ := json.MarshalIndent(doc, "", "  ")
	os.WriteFile("/tmp/pptx-dump.json", out, 0644)
	fmt.Println("written /tmp/pptx-dump.json", len(out))
}

func min(a, b int) int { if a < b { return a }; return b }
