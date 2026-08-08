package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/zai/samoffice/internal/parser"
)

// verifycmp 解析指定的老版文件（.ppt / .xls），并打印 UDM 的摘要（JSON），
// 用于与对应现代格式（.pptx / .xlsx）的解析结果对比。
func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: verifycmp <file.ppt|.xls> [file2 ...]")
		os.Exit(2)
	}
	reg := parser.NewRegistry()
	for _, path := range os.Args[1:] {
		data, err := os.ReadFile(path)
		if err != nil {
			fmt.Fprintf(os.Stderr, "read %s: %v\n", path, err)
			os.Exit(1)
		}
		doc, warns, err := reg.ParseBytes(path, data)
		if err != nil {
			fmt.Fprintf(os.Stderr, "parse %s: %v\n", path, err)
			os.Exit(1)
		}
		out := struct {
			Path    string       `json:"path"`
			Warns   []interface{} `json:"warns"`
			Blocks  []interface{} `json:"blocks"`
		}{
			Path:   path,
			Warns:  toIface(warns),
			Blocks: toIface(doc.Blocks),
		}
		b, _ := json.MarshalIndent(out, "", "  ")
		fmt.Println(string(b))
	}
}

func toIface[T any](s []T) []interface{} {
	out := make([]interface{}, len(s))
	for i := range s {
		out[i] = s[i]
	}
	return out
}
