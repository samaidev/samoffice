package main

import (
	"bytes"
	"fmt"
	"io"
	"os"

	"github.com/zai/samoffice/internal/core"
	"github.com/zai/samoffice/internal/parser/doc"
)

func dumpInline(inls []core.Inline, depth int) {
	pad := ""
	for i := 0; i < depth; i++ {
		pad += "  "
	}
	for _, inl := range inls {
		switch v := inl.(type) {
		case core.Text:
			flags := ""
			if v.Bold {
				flags += "B"
			}
			if v.Italic {
				flags += "I"
			}
			if v.Under {
				flags += "U"
			}
			if v.Strike {
				flags += "S"
			}
			fmt.Printf("%sTEXT[%s] font=%q size=%.1f color=%s content=%q\n", pad, flags, v.Font, v.FontSize, v.Color, truncate(v.Content, 40))
		case core.FootnoteRef:
			fmt.Printf("%sFN[%d] %q\n", pad, v.Num, v.Content)
		case core.InlineImage:
			fmt.Printf("%sIMG w=%.1fpt h=%.1fpt src=%s... (%d bytes)\n", pad, v.Width, v.Height, truncate(v.Src, 40), len(v.Src))
		default:
			fmt.Printf("%s?%T\n", pad, inl)
		}
	}
}

func propsStr(p map[string]any) string {
	if len(p) == 0 {
		return ""
	}
	return fmt.Sprintf(" props=%v", p)
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n]) + "..."
	}
	return s
}

func main() {
	path := "real.doc"
	if len(os.Args) > 1 {
		path = os.Args[1]
	}
	data, err := os.ReadFile(path)
	if err != nil {
		fmt.Println("read err:", err)
		return
	}
	d, _, err := (&doc.Parser{}).Parse(bytes.NewReader(data))
	if err != nil {
		fmt.Println("parse err:", err)
		return
	}
	fmt.Printf("=== %s : %d blocks ===\n", path, len(d.Blocks))
	if d.PageNumber != nil {
		fmt.Printf("PAGENUMBER enabled=%v format=%q align=%q\n", d.PageNumber.Enabled, d.PageNumber.Format, d.PageNumber.Align)
	}
	for i, b := range d.Blocks {
		switch v := b.(type) {
		case *core.PageBreak:
			fmt.Printf("[%d] PAGEBREAK\n", i)
		case *core.Paragraph:
			fmt.Printf("[%d] PARA align=%q%s\n", i, v.Align, propsStr(v.Props))
			dumpInline(v.Inline, 1)
		case *core.Heading:
			fmt.Printf("[%d] H%d align=%q%s\n", i, v.Level, v.Align, propsStr(v.Props))
			dumpInline(v.Inline, 1)
		case *core.BulletList:
			fmt.Printf("[%d] LIST ordered=%v items=%d\n", i, v.Ordered, len(v.Items))
			for it, item := range v.Items {
				fmt.Printf("   item %d:\n", it)
				for _, ib := range item {
					if p, ok := ib.(*core.Paragraph); ok {
						dumpInline(p.Inline, 3)
					}
				}
			}
		case *core.Table:
			fmt.Printf("[%d] TABLE rows=%d width=%v\n", i, len(v.Rows), v.Width)
			for r, row := range v.Rows {
				fmt.Printf("   row %d cells=%d\n", r, len(row))
				for c, cell := range row {
					span := ""
					if cell.ColSpan > 0 {
						span += fmt.Sprintf(" colspan=%d", cell.ColSpan)
					}
					if cell.RowSpan > 0 {
						span += fmt.Sprintf(" rowspan=%d", cell.RowSpan)
					}
					fmt.Printf("     cell %d:%s\n", c, span)
					dumpInline(cell.Inline, 3)
				}
			}
		case *core.FootnoteSection:
			fmt.Printf("[%d] FOOTNOTE_SECTION items=%d\n", i, len(v.Items))
			for _, item := range v.Items {
				txt := ""
				for _, inl := range item.Inline {
					if t, ok := inl.(core.Text); ok {
						txt += t.Content
					}
				}
				fmt.Printf("   fn %d: %q\n", item.Num, txt)
			}
		default:
			fmt.Printf("[%d] %T\n", i, b)
		}
	}
	_ = io.EOF
}
