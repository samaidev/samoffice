package xlsx

import (
	"bytes"
	"testing"

	"github.com/xuri/excelize/v2"
	"github.com/zai/samoffice/internal/core"
)

// TestParseCellFontFamily 验证 xlsx 解析时，单元格字体名（excelize 映射到
// Font.Family）会被提取到 core.Text.FontFamily，供前端表格视图渲染字体。
func TestParseCellFontFamily(t *testing.T) {
	f := excelize.NewFile()
	styleID, err := f.NewStyle(&excelize.Style{
		Font: &excelize.Font{Family: "宋体", Bold: true},
	})
	if err != nil {
		t.Fatalf("NewStyle: %v", err)
	}
	if err := f.SetCellValue("Sheet1", "A1", "中文"); err != nil {
		t.Fatalf("SetCellValue: %v", err)
	}
	if err := f.SetCellStyle("Sheet1", "A1", "A1", styleID); err != nil {
		t.Fatalf("SetCellStyle: %v", err)
	}

	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}

	doc, _, err := New().Parse(bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(doc.Blocks) == 0 {
		t.Fatal("no blocks parsed")
	}

	table, ok := doc.Blocks[0].(*core.Table)
	if !ok {
		t.Fatalf("block 0 expected *core.Table, got %T", doc.Blocks[0])
	}
	if len(table.Rows) == 0 || len(table.Rows[0]) == 0 {
		t.Fatal("table has no cells")
	}

	got := ""
	for _, inl := range table.Rows[0][0].Inline {
		if txt, ok := inl.(core.Text); ok && txt.Content == "中文" {
			got = txt.FontFamily
		}
	}
	if got != "宋体" {
		t.Fatalf("cell font family not extracted: got %q, want %q", got, "宋体")
	}
}
