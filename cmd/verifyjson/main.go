package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/zai/samoffice/internal/parser"
)

// 解析给定文件并打印前端实际收到的 UDM JSON（仅输出紧凑 JSON，便于做 fixture）。
// 用法: go run ./cmd/verifyjson <file> [out.json]
func main() {
	if len(os.Args) < 2 {
		fmt.Println("usage: verifyjson <file> [out.json]")
		os.Exit(1)
	}
	path := os.Args[1]
	data, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "read ERR:", err)
		os.Exit(1)
	}
	reg := parser.NewRegistry()
	doc, warns, err := reg.ParseBytes(path, data)
	if err != nil {
		fmt.Fprintln(os.Stderr, "parse ERR:", err)
		os.Exit(1)
	}
	fmt.Fprintln(os.Stderr, "warnings:", len(warns))
	b, err := json.Marshal(doc)
	if err != nil {
		fmt.Fprintln(os.Stderr, "marshal ERR:", err)
		os.Exit(1)
	}
	if len(os.Args) > 2 {
		if err := os.WriteFile(os.Args[2], b, 0644); err != nil {
			fmt.Fprintln(os.Stderr, "write ERR:", err)
			os.Exit(1)
		}
		fmt.Fprintln(os.Stderr, "wrote", os.Args[2])
		return
	}
	fmt.Println(string(b))
}
