package docx

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"
	"testing"

	"github.com/zai/samoffice/internal/core"
	coreparser "github.com/zai/samoffice/internal/parser/docx"
)

// 单元格边框（表格工具"边框"预设）→ docx w:tcBorders → 重新解析的往返一致。
// 用户报告"表格工具无法添加边框/无法给单个格子添加边框"修复后的回归保护。
func TestTableCellBordersRoundTrip(t *testing.T) {
	doc := &core.Document{
		Meta: core.Meta{Title: "borders-test"},
		Blocks: []core.Block{
			&core.Table{
				Rows: [][]core.TableCell{
					{
						{Inline: []core.Inline{&core.Text{Content: "A"}}, IsHeader: true},
						{Inline: []core.Inline{&core.Text{Content: "B"}}, IsHeader: true},
					},
					{
						{Inline: []core.Inline{&core.Text{Content: "C"}}, Borders: "1111", BorderColor: "E11D48", BorderW: 1.5},
						{Inline: []core.Inline{&core.Text{Content: "D"}}, Borders: "0000"},
					},
				},
			},
		},
	}

	var buf bytes.Buffer
	if err := New().RenderToWriter(doc, &buf); err != nil {
		t.Fatalf("render: %v", err)
	}

	// docx 是 zip 包：解出 word/document.xml 再断言
	docXML := extractDocXML(t, buf.Bytes())
	if !strings.Contains(docXML, `<w:tcBorders>`) {
		t.Fatalf("document.xml missing tcBorders:\n%s", docXML[:min(len(docXML), 3000)])
	}
	if !strings.Contains(docXML, `w:color="E11D48"`) {
		t.Fatalf("document.xml missing border color E11D48")
	}
	if !strings.Contains(docXML, `<w:left w:val="nil"/>`) {
		t.Fatalf("document.xml missing nil side for 0000 cell")
	}

	// 重新解析：C 格应还原 1111 + 色值 + 线宽 1.5pt；D 格应为 0000
	parsed, _, err := coreparser.New().Parse(bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	var tbl *core.Table
	for _, b := range parsed.Blocks {
		if tb, ok := b.(*core.Table); ok {
			tbl = tb
			break
		}
	}
	if tbl == nil {
		t.Fatalf("parsed doc has no table")
	}
	c := tbl.Rows[1][0]
	if c.Borders != "1111" || !strings.EqualFold(strings.TrimPrefix(c.BorderColor, "#"), "E11D48") || c.BorderW != 1.5 {
		t.Errorf("cell C borders=%s color=%s w=%v, want 1111/E11D48/1.5", c.Borders, c.BorderColor, c.BorderW)
	}
	d := tbl.Rows[1][1]
	if d.Borders != "0000" {
		t.Errorf("cell D borders=%s, want 0000", d.Borders)
	}
}

func extractDocXML(t *testing.T, data []byte) string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("zip open: %v", err)
	}
	for _, f := range zr.File {
		if f.Name == "word/document.xml" {
			rc, err := f.Open()
			if err != nil {
				t.Fatalf("open document.xml: %v", err)
			}
			defer rc.Close()
			b, err := io.ReadAll(rc)
			if err != nil {
				t.Fatalf("read document.xml: %v", err)
			}
			return string(b)
		}
	}
	t.Fatalf("word/document.xml not found in zip")
	return ""
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
