// docpdf: 用当前原生 .doc 解析器解析文档并渲染为 PDF，用于肉眼对比效果。
package main

import (
	"bytes"
	"fmt"
	"os"

	"github.com/zai/samoffice/internal/parser/doc"
	"github.com/zai/samoffice/internal/renderer/pdf"
)

func main() {
	in := "real.doc"
	if len(os.Args) > 1 {
		in = os.Args[1]
	}
	out := "build/real_native.pdf"
	if len(os.Args) > 2 {
		out = os.Args[2]
	}
	data, err := os.ReadFile(in)
	if err != nil {
		panic(err)
	}
	d, warns, err := (&doc.Parser{}).Parse(bytes.NewReader(data))
	if err != nil {
		fmt.Println("parse err:", err)
		return
	}
	fmt.Printf("blocks=%d warnings=%v\n", len(d.Blocks), warns)
	pdfBytes, err := pdf.New().Render(d)
	if err != nil {
		fmt.Println("render err:", err)
		return
	}
	if err := os.WriteFile(out, pdfBytes, 0644); err != nil {
		panic(err)
	}
	fmt.Println("wrote", out, len(pdfBytes), "bytes")
}
