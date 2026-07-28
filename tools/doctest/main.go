package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"

	"github.com/zai/samoffice/internal/core"
	"github.com/zai/samoffice/internal/parser/conv"
	"github.com/zai/samoffice/internal/parser/docx"
)

func main() {
	path := "real.doc"
	if len(os.Args) > 1 {
		path = os.Args[1]
	}
	data, err := os.ReadFile(path)
	if err != nil {
		panic(err)
	}
	fmt.Printf("input doc bytes=%d\n", len(data))

	docxData, ok, convErr := conv.ConvertDocToDocx(filepath.Base(path), data)
	fmt.Printf("ConvertDocToDocx ok=%v err=%v outBytes=%d\n", ok, convErr, len(docxData))
	if !ok || convErr != nil {
		fmt.Println(">>> conversion FAILED -> falls back to built-in text-only .doc parser (no formatting)")
		return
	}
	out := `c:\Users\Administrator\samoffice\build\real_converted.docx`
	_ = os.WriteFile(out, docxData, 0644)
	fmt.Println("wrote", out)

	doc, warns, perr := (&docx.Parser{}).Parse(bytes.NewReader(docxData))
	if perr != nil {
		fmt.Println("docx parse err:", perr)
		return
	}
	fmt.Printf("docx paragraphs=%d warnings=%v\n", len(doc.Blocks), warns)
	if doc.PageNumber != nil {
		fmt.Printf("PageNumber: enabled=%v format=%q align=%q\n", doc.PageNumber.Enabled, doc.PageNumber.Format, doc.PageNumber.Align)
	} else {
		fmt.Println("PageNumber: <nil>")
	}

	align := map[string]int{}
	headings := 0
	footnoteSec := 0
	footnoteRef := 0
	for _, b := range doc.Blocks {
		switch p := b.(type) {
		case *core.Paragraph:
			align[p.Align]++
		case *core.Heading:
			headings++
		case *core.FootnoteSection:
			footnoteSec++
			footnoteRef += len(p.Items)
		}
	}
	fmt.Printf("alignment distribution: %v\n", align)
	fmt.Printf("headings=%d footnoteSection=%d footnoteItems=%d\n", headings, footnoteSec, footnoteRef)

	fmt.Println("\n--- first 8 blocks ---")
	for i, b := range doc.Blocks {
		if i >= 8 {
			break
		}
		switch p := b.(type) {
		case *core.Paragraph:
			fmt.Printf("[P] align=%q style=%q inline=%d\n", p.Align, p.Style, len(p.Inline))
			dumpInline(p.Inline)
		case *core.Heading:
			fmt.Printf("[H] level=%d style=%q inline=%d\n", p.Level, p.Style, len(p.Inline))
			dumpInline(p.Inline)
		case *core.FootnoteSection:
			fmt.Printf("[FN-SECTION] items=%d\n", len(p.Items))
			for _, it := range p.Items {
				fmt.Printf("    fn#%d inline=%d\n", it.Num, len(it.Inline))
				dumpInline(it.Inline)
			}
		default:
			fmt.Printf("[%T]\n", b)
		}
	}
}

func dumpInline(inline []core.Inline) {
	for _, in := range inline {
		switch t := in.(type) {
		case core.Text:
			fs := ""
			if t.FontSize > 0 {
				fs = fmt.Sprintf(" fontSize=%.1f", t.FontSize)
			}
			fmt.Printf("      text %q bold=%v italic=%v%s\n", preview(t.Content), t.Bold, t.Italic, fs)
		case *core.Hyperlink:
			fmt.Printf("      hyperlink %d inlines\n", len(t.Text))
		default:
			fmt.Printf("      [%T]\n", in)
		}
	}
}

func preview(s string) string {
	if len(s) > 24 {
		return s[:24] + "..."
	}
	return s
}
