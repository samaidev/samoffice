// dumpdoc 直接解析真实 .doc 文件，输出脚注提取结果与正文里作者简介相关内容，用于实证调试。
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"

	"github.com/zai/samoffice/internal/parser/doc"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: dumpdoc <file.doc>")
		os.Exit(1)
	}
	data, err := os.ReadFile(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, "read:", err)
		os.Exit(1)
	}

	docm, warns, err := doc.New().Parse(bytes.NewReader(data))
	if err != nil {
		fmt.Fprintln(os.Stderr, "parse:", err)
		os.Exit(1)
	}
	if len(warns) > 0 {
		fmt.Fprintln(os.Stderr, "warns:", warns)
	}

	fmt.Println("==== UDM JSON ====")
	out, _ := json.MarshalIndent(docm, "", "  ")
	os.Stdout.Write(out)
}
