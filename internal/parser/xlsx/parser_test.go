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

// TestParseMergedCells 验证 xlsx 合并单元格会被解析为 RowSpan/ColSpan
func TestParseMergedCells(t *testing.T) {
	f := excelize.NewFile()
	sheet := "Sheet1"
	if err := f.SetCellValue(sheet, "A1", "合并标题"); err != nil {
		t.Fatal(err)
	}
	if err := f.SetCellValue(sheet, "A2", "单元格"); err != nil {
		t.Fatal(err)
	}
	// 在 B 列也放置一个值，确保表格列数覆盖到合并区域
	if err := f.SetCellValue(sheet, "B2", "B列值"); err != nil {
		t.Fatal(err)
	}
	if err := f.MergeCell(sheet, "A1", "B1"); err != nil {
		t.Fatalf("MergeCell: %v", err)
	}

	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	doc, _, err := New().Parse(bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	table, ok := doc.Blocks[0].(*core.Table)
	if !ok {
		t.Fatalf("expected *core.Table, got %T", doc.Blocks[0])
	}
	topLeft := table.Rows[0][0]
	if topLeft.ColSpan != 2 {
		t.Errorf("expected merged cell ColSpan=2, got %d", topLeft.ColSpan)
	}
	if topLeft.RowSpan != 1 {
		t.Errorf("expected RowSpan=1, got %d", topLeft.RowSpan)
	}
	// 被覆盖单元格应标记为占位（VMerge=1，内容清空）
	covered := table.Rows[0][1]
	if covered.VMerge != 1 {
		t.Errorf("expected covered cell VMerge=1, got %d", covered.VMerge)
	}
}
