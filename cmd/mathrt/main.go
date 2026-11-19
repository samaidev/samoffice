package main

import (
	"fmt"
	"os"

	"github.com/zai/samoffice/internal/core"
	"github.com/zai/samoffice/internal/parser"
	docxrenderer "github.com/zai/samoffice/internal/renderer/docx"
)

// mathrt 公式往返验证：解析 docx → 统计 Math/InlineMath → 导出 docx。
// usage: mathrt <in.docx> <out.docx>
func main() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "usage: mathrt <in.docx> <out.docx>")
		os.Exit(2)
	}
	data, err := os.ReadFile(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, "read:", err)
		os.Exit(1)
	}
	reg := parser.NewRegistry()
	doc, _, err := reg.ParseBytes(os.Args[1], data)
	if err != nil {
		fmt.Fprintln(os.Stderr, "parse:", err)
		os.Exit(1)
	}

	nBlock, nInline, nBlockOmml, nInlineOmml := 0, 0, 0, 0
	walkBlocks(doc.Blocks, func(b core.Block) {
		if m, ok := b.(*core.Math); ok {
			nBlock++
			if m.OMML != "" {
				nBlockOmml++
			}
		}
	}, func(in core.Inline) {
		if m, ok := in.(*core.InlineMath); ok {
			nInline++
			if m.OMML != "" {
				nInlineOmml++
			}
		}
	})
	fmt.Printf("parse: Math blocks=%d (with omml=%d), InlineMath=%d (with omml=%d)\n",
		nBlock, nBlockOmml, nInline, nInlineOmml)

	out, err := docxrenderer.New().Render(doc)
	if err != nil {
		fmt.Fprintln(os.Stderr, "render:", err)
		os.Exit(1)
	}
	if err := os.WriteFile(os.Args[2], out, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "write:", err)
		os.Exit(1)
	}
	fmt.Printf("render: wrote %s (%d bytes)\n", os.Args[2], len(out))
}

// walkBlocks 与 renderer 同名工具保持一致的遍历语义（块 + 其内行内元素）。
func walkBlocks(blocks []core.Block, visitBlock func(core.Block), visitInline func(core.Inline)) {
	var walkInlines func(in []core.Inline)
	walkInlines = func(in []core.Inline) {
		for _, it := range in {
			visitInline(it)
			if h, ok := it.(*core.Hyperlink); ok {
				walkInlines(h.Text)
			}
		}
	}
	var walk func(b core.Block)
	walk = func(b core.Block) {
		visitBlock(b)
		switch v := b.(type) {
		case *core.Paragraph:
			walkInlines(v.Inline)
		case *core.Heading:
			walkInlines(v.Inline)
		case *core.Table:
			for _, row := range v.Rows {
				for _, cell := range row {
					for _, c := range cell.Blocks {
						walk(c)
					}
				}
			}
		case *core.Textbox:
			for _, c := range v.Blocks {
				walk(c)
			}
		case *core.BulletList:
			for _, item := range v.Items {
				for _, c := range item {
					walk(c)
				}
			}
		case *core.FootnoteSection:
			for _, item := range v.Items {
				walkInlines(item.Inline)
			}
		}
	}
	for _, b := range blocks {
		walk(b)
	}
}
