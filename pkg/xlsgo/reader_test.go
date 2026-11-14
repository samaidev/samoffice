// reader_test.go — 验证 xlsgo 新增方法

package xlsgo

import (
	"testing"
	"time"
)

// TestNewMethods 验证新增的表格管理方法
func TestNewMethods(t *testing.T) {
	wb := New()
	ws := wb.ActiveSheet()

	// SetCellBool
	if err := ws.SetCellBool("A1", true); err != nil {
		t.Errorf("SetCellBool failed: %v", err)
	}

	// SetCellDate
	if err := ws.SetCellDate("B1", time.Date(2026, 7, 5, 12, 0, 0, 0, time.UTC)); err != nil {
		t.Errorf("SetCellDate failed: %v", err)
	}

	// SetCellFillColor
	if err := ws.SetCellFillColor("C1", "FF0000"); err != nil {
		t.Errorf("SetCellFillColor failed: %v", err)
	}

	// SetCellBorder
	if err := ws.SetCellBorder("D1", "thin"); err != nil {
		t.Errorf("SetCellBorder failed: %v", err)
	}

	// SetCellFontSize
	if err := ws.SetCellFontSize("E1", 14); err != nil {
		t.Errorf("SetCellFontSize failed: %v", err)
	}

	// SetCellAlign
	if err := ws.SetCellAlign("F1", "center", "center"); err != nil {
		t.Errorf("SetCellAlign failed: %v", err)
	}

	// MergeCell + GetMergedCells + UnmergeCell
	ws.MergeCell("A3:B3")
	merged, err := ws.GetMergedCells()
	if err != nil {
		t.Errorf("GetMergedCells failed: %v", err)
	}
	if len(merged) == 0 {
		t.Error("GetMergedCells returned empty, expected at least 1 merged range")
	}
	if err := ws.UnmergeCell("A3:B3"); err != nil {
		t.Errorf("UnmergeCell failed: %v", err)
	}

	// GetCellType
	ct, err := ws.GetCellType("A1")
	if err != nil {
		t.Errorf("GetCellType failed: %v", err)
	}
	if ct == "" {
		t.Error("GetCellType returned empty string")
	}
}

// TestInsertRemoveRowCol 验证插入/删除行列
func TestInsertRemoveRowCol(t *testing.T) {
	wb := New()
	ws := wb.ActiveSheet()

	ws.SetCell("A1", "R1")
	ws.SetCell("A2", "R2")
	ws.SetCell("A3", "R3")

	// InsertRow
	if err := ws.InsertRow(2, 1); err != nil {
		t.Errorf("InsertRow failed: %v", err)
	}

	// RemoveRow
	if err := ws.RemoveRow(2, 1); err != nil {
		t.Errorf("RemoveRow failed: %v", err)
	}

	// InsertCol
	if err := ws.InsertCol("B", 1); err != nil {
		t.Errorf("InsertCol failed: %v", err)
	}

	// RemoveCol
	if err := ws.RemoveCol("B", 1); err != nil {
		t.Errorf("RemoveCol failed: %v", err)
	}
}

// TestSheetManagement 验证工作表管理
func TestSheetManagement(t *testing.T) {
	wb := New()
	ws2 := wb.AddSheet("Sheet2")
	ws2.SetCell("A1", "test")

	// SheetCount
	if wb.SheetCount() < 2 {
		t.Errorf("SheetCount = %d, want >= 2", wb.SheetCount())
	}

	// DeleteSheet
	if err := wb.DeleteSheet("Sheet2"); err != nil {
		t.Errorf("DeleteSheet failed: %v", err)
	}
	if wb.SheetCount() != 1 {
		t.Errorf("After delete SheetCount = %d, want 1", wb.SheetCount())
	}
}

// TestProtectSheet 验证保护工作表
func TestProtectSheet(t *testing.T) {
	wb := New()
	ws := wb.ActiveSheet()

	if err := ws.ProtectSheet("secret123"); err != nil {
		t.Errorf("ProtectSheet failed: %v", err)
	}

	if err := ws.UnprotectSheet(); err != nil {
		t.Errorf("UnprotectSheet failed: %v", err)
	}
}

// TestRoundTripWriteRead 验证往返读写
func TestRoundTripWriteRead(t *testing.T) {
	wb := New()
	ws := wb.ActiveSheet()
	ws.SetCell("A1", "姓名")
	ws.SetCell("B1", "分数")
	ws.SetCell("A2", "张三")
	ws.SetCellNumber("B2", 95)
	ws.SetCellFormula("C2", "=B2*0.9")

	data, err := wb.Bytes()
	if err != nil {
		t.Fatalf("Bytes() failed: %v", err)
	}

	wb2, err := ParseBytes(data)
	if err != nil {
		t.Fatalf("ParseBytes() failed: %v", err)
	}
	ws2 := wb2.ActiveSheet()

	val, _ := ws2.GetCell("A2")
	if val != "张三" {
		t.Errorf("A2 = %q, want 张三", val)
	}

	num, _ := ws2.GetNumber("B2")
	if num != 95 {
		t.Errorf("B2 = %v, want 95", num)
	}
}
