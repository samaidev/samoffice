package xlsgo

import (
	"os"
	"testing"
)

func TestCreateAndSave(t *testing.T) {
	wb := New()
	ws := wb.ActiveSheet()
	ws.SetCell("A1", "Name")
	ws.SetCellNumber("B1", 42)
	ws.SetCellFormula("C1", "=B1*2")

	tmpFile := "/tmp/xlsgo-test.xlsx"
	if err := wb.Save(tmpFile); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpFile)
	defer wb.Close()
}

func TestOpenAndRead(t *testing.T) {
	wb := New()
	ws := wb.ActiveSheet()
	ws.SetCell("A1", "Hello")
	ws.SetCellInt("A2", 123)

	tmpFile := "/tmp/xlsgo-read-test.xlsx"
	wb.Save(tmpFile)
	defer os.Remove(tmpFile)
	wb.Close()

	wb2, err := Open(tmpFile)
	if err != nil {
		t.Fatal(err)
	}
	defer wb2.Close()

	ws2 := wb2.ActiveSheet()
	val, err := ws2.GetCell("A1")
	if err != nil {
		t.Fatal(err)
	}
	if val != "Hello" {
		t.Errorf("A1 = %q, want 'Hello'", val)
	}
}

func TestFillTable(t *testing.T) {
	wb := New()
	ws := wb.ActiveSheet()
	data := [][]string{
		{"Name", "Score"},
		{"Alice", "95"},
		{"Bob", "87"},
	}
	if err := ws.FillTable("A1", data); err != nil {
		t.Fatal(err)
	}
	rows, _ := ws.ReadAll()
	if len(rows) != 3 {
		t.Errorf("rows = %d, want 3", len(rows))
	}
}

func TestMultiSheet(t *testing.T) {
	wb := New()
	wb.AddSheet("Data")
	wb.SetActive("Data")
	ws := wb.GetSheet("Data")
	ws.SetCell("A1", "test")

	if len(wb.Sheets()) < 2 {
		t.Errorf("sheets = %d, want >= 2", len(wb.Sheets()))
	}
}
