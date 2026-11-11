package xlsx

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

// buildFmtMergeValidWorkbook 用 excelize 直接构造一个带数字格式、空合并区域
// 与下拉列表验证的工作簿（验证 ReadXLSX 的读取路径）。
func buildFmtMergeValidWorkbook(t *testing.T) []byte {
	t.Helper()
	f := excelize.NewFile()
	sheet := "Sheet1"

	// A1 = 5，百分比格式（内置 numFmtId 9）
	pctStyle, err := f.NewStyle(&excelize.Style{NumFmt: 9})
	if err != nil {
		t.Fatalf("NewStyle percent: %v", err)
	}
	if err := f.SetCellValue(sheet, "A1", 5); err != nil {
		t.Fatalf("SetCellValue A1: %v", err)
	}
	if err := f.SetCellStyle(sheet, "A1", "A1", pctStyle); err != nil {
		t.Fatalf("SetCellStyle A1: %v", err)
	}

	// A2 = 1234.5，千分位格式（内置 numFmtId 3）
	thStyle, err := f.NewStyle(&excelize.Style{NumFmt: 3})
	if err != nil {
		t.Fatalf("NewStyle thousands: %v", err)
	}
	if err := f.SetCellValue(sheet, "A2", 1234.5); err != nil {
		t.Fatalf("SetCellValue A2: %v", err)
	}
	if err := f.SetCellStyle(sheet, "A2", "A2", thStyle); err != nil {
		t.Fatalf("SetCellStyle A2: %v", err)
	}

	// B2:C3 合并区域，左上角为空值（回归：空合并区域丢失 mergeRange）
	if err := f.MergeCell(sheet, "B2", "C3"); err != nil {
		t.Fatalf("MergeCell B2:C3: %v", err)
	}

	// A6:B6 横向合并（非对称区域，回归：行列颠倒导致 rowSpan/colSpan 互换）
	if err := f.SetCellValue(sheet, "A6", "宽表头"); err != nil {
		t.Fatalf("SetCellValue A6: %v", err)
	}
	if err := f.MergeCell(sheet, "A6", "B6"); err != nil {
		t.Fatalf("MergeCell A6:B6: %v", err)
	}

	// D4 = 1.5，自定义数字格式 0.000（numFmts 表，通常 id>=164）
	customFmt := "0.000"
	custStyle, err := f.NewStyle(&excelize.Style{CustomNumFmt: &customFmt})
	if err != nil {
		t.Fatalf("NewStyle custom: %v", err)
	}
	if err := f.SetCellValue(sheet, "D4", 1.5); err != nil {
		t.Fatalf("SetCellValue D4: %v", err)
	}
	if err := f.SetCellStyle(sheet, "D4", "D4", custStyle); err != nil {
		t.Fatalf("SetCellStyle D4: %v", err)
	}

	// E5 = 日期文本，日期格式（内置 numFmtId 14）
	dateStyle, err := f.NewStyle(&excelize.Style{NumFmt: 14})
	if err != nil {
		t.Fatalf("NewStyle date: %v", err)
	}
	if err := f.SetCellValue(sheet, "E5", "2024-01-15"); err != nil {
		t.Fatalf("SetCellValue E5: %v", err)
	}
	if err := f.SetCellStyle(sheet, "E5", "E5", dateStyle); err != nil {
		t.Fatalf("SetCellStyle E5: %v", err)
	}

	// A3 下拉列表验证 yes/no
	dv := excelize.NewDataValidation(true)
	dv.SetSqref("A3")
	if err := dv.SetDropList([]string{"yes", "no"}); err != nil {
		t.Fatalf("SetDropList: %v", err)
	}
	if err := f.AddDataValidation(sheet, dv); err != nil {
		t.Fatalf("AddDataValidation: %v", err)
	}

	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	return buf.Bytes()
}

// TestReadXLSXFmtMergeValid 验证 ReadXLSX 输出 fmt / mergeRange / hiddenBy / valid。
func TestReadXLSXFmtMergeValid(t *testing.T) {
	path := filepath.Join(t.TempDir(), "in.xlsx")
	if err := os.WriteFile(path, buildFmtMergeValidWorkbook(t), 0o644); err != nil {
		t.Fatalf("write temp file: %v", err)
	}

	jsonStr, err := ReadXLSX(path)
	if err != nil {
		t.Fatalf("ReadXLSX: %v", err)
	}
	var wb workbookJSON
	if err := json.Unmarshal([]byte(jsonStr), &wb); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(wb.Sheets) == 0 {
		t.Fatal("no sheets")
	}
	cells := wb.Sheets[0].Cells

	// A1：fmt == "percent"
	if got := cells["0-0"].Fmt; got != "percent" {
		t.Errorf("A1 fmt = %q, want %q", got, "percent")
	}
	// A2：fmt == "thousands"
	if got := cells["1-0"].Fmt; got != "thousands" {
		t.Errorf("A2 fmt = %q, want %q", got, "thousands")
	}
	// D4：自定义格式 0.000 → fmt == "0.000"
	if got := cells["3-3"].Fmt; got != "0.000" {
		t.Errorf("D4 fmt = %q, want %q", got, "0.000")
	}
	// E5：日期格式 → fmt == "date"
	if got := cells["4-4"].Fmt; got != "date" {
		t.Errorf("E5 fmt = %q, want %q", got, "date")
	}

	// B2（空值左上角）必须存在并携带 mergeRange 2x2
	b2, ok := cells["1-1"]
	if !ok {
		t.Fatalf("merged empty top-left B2 missing from cells (keys=%v)", keysOf(cells))
	}
	if b2.MergeRange == nil || b2.MergeRange.RowSpan != 2 || b2.MergeRange.ColSpan != 2 {
		t.Errorf("B2 mergeRange = %+v, want {2 2}", b2.MergeRange)
	}
	// 被覆盖单元格 hiddenBy 指向左上角
	for _, key := range []string{"1-2", "2-1", "2-2"} {
		if got := cells[key].HiddenBy; got != "1-1" {
			t.Errorf("%s hiddenBy = %q, want %q", key, got, "1-1")
		}
	}

	// A3：下拉列表验证 → valid == "yes,no"（无引号、无前导 =）
	if got := cells["2-0"].Valid; got != "yes,no" {
		t.Errorf("A3 valid = %q, want %q", got, "yes,no")
	}

	// A6:B6 横向合并：colSpan=2、rowSpan=1，B6 hiddenBy（回归行列颠倒）
	a6, ok := cells["5-0"]
	if !ok || a6.MergeRange == nil {
		t.Fatalf("A6 merge missing (keys=%v)", keysOf(cells))
	}
	if a6.MergeRange.RowSpan != 1 || a6.MergeRange.ColSpan != 2 {
		t.Errorf("A6 mergeRange = %+v, want {1 2}", a6.MergeRange)
	}
	if got := cells["5-1"].HiddenBy; got != "5-0" {
		t.Errorf("B6 hiddenBy = %q, want %q", got, "5-0")
	}
}

// TestWriteXLSXFmtMergeValid 验证 WriteXLSX 把 fmt/mergeRange/valid 写回 xlsx。
func TestWriteXLSXFmtMergeValid(t *testing.T) {
	wb := workbookJSON{Sheets: []sheetJSON{{
		Name: "S1", Rows: 10, Cols: 10,
		Cells: map[string]cellJSON{
			"0-0": {Value: "5", Fmt: "percent"},
			"0-1": {Value: "3.14159", Fmt: "0.00"},
			"0-2": {Value: "2024-01-15", Fmt: "date"},
			// B2:C3 合并（左上角空值）
			"1-1": {MergeRange: mergeSpan(2, 2)},
			// A5:C5 连续三个单元格同一列表 → 应合并为一条验证
			"4-0": {Valid: "yes,no,maybe"},
			"4-1": {Valid: "yes,no,maybe"},
			"4-2": {Valid: "yes,no,maybe"},
			// A4 单独一个列表
			"3-0": {Valid: "a,b"},
		},
	}}}
	data, err := json.Marshal(wb)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	path := filepath.Join(t.TempDir(), "out.xlsx")
	if err := WriteXLSX(path, string(data)); err != nil {
		t.Fatalf("WriteXLSX: %v", err)
	}

	f, err := excelize.OpenFile(path)
	if err != nil {
		t.Fatalf("open written file: %v", err)
	}
	defer f.Close()

	// A1 百分比 → NumFmt 9；B1 → NumFmt 2；C1 → NumFmt 14
	for _, tc := range []struct {
		ref  string
		want int
	}{{"A1", 9}, {"B1", 2}, {"C1", 14}} {
		sid, err := f.GetCellStyle("S1", tc.ref)
		if err != nil {
			t.Fatalf("GetCellStyle %s: %v", tc.ref, err)
		}
		st, err := f.GetStyle(sid)
		if err != nil || st == nil {
			t.Fatalf("GetStyle %s: %v", tc.ref, err)
		}
		if st.NumFmt != tc.want {
			t.Errorf("%s NumFmt = %d, want %d", tc.ref, st.NumFmt, tc.want)
		}
	}

	// 合并区域 B2:C3
	merged, err := f.GetMergeCells("S1")
	if err != nil || len(merged) == 0 {
		t.Fatalf("GetMergeCells: %v (n=%d)", err, len(merged))
	}
	found := false
	for _, m := range merged {
		if m.GetStartAxis() == "B2" && m.GetEndAxis() == "C3" {
			found = true
		}
	}
	if !found {
		t.Errorf("merge B2:C3 not found, got %v", merged)
	}

	// 数据验证：A5:C5 一条 "yes,no,maybe"，A4 一条 "a,b"
	dvs, err := f.GetDataValidations("S1")
	if err != nil {
		t.Fatalf("GetDataValidations: %v", err)
	}
	type dvWant struct {
		sqref   string
		formula string
	}
	wants := []dvWant{{sqref: "A5:C5", formula: `"yes,no,maybe"`}, {sqref: "A4", formula: `"a,b"`}}
	if len(dvs) != len(wants) {
		t.Fatalf("got %d validations, want %d: %+v", len(dvs), len(wants), dvs)
	}
	for _, w := range wants {
		hit := false
		for _, dv := range dvs {
			if dv != nil && dv.Sqref == w.sqref && dv.Type == "list" && dv.Formula1 == w.formula {
				hit = true
			}
		}
		if !hit {
			t.Errorf("validation %s=%s missing, got %+v", w.sqref, w.formula, dvs)
		}
	}
}

// TestRoundTripFull 完整走一遍 Write → Read，确认三个新字段都能还原。
func TestRoundTripFull(t *testing.T) {
	wb := workbookJSON{Sheets: []sheetJSON{{
		Name: "S1", Rows: 10, Cols: 10,
		Cells: map[string]cellJSON{
			"0-0": {Value: "5", Fmt: "percent"},
			"1-1": {MergeRange: mergeSpan(2, 2)}, // B2:C3 空合并
			"2-0": {Valid: "yes,no"},             // A3
		},
	}}}
	data, err := json.Marshal(wb)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	path := filepath.Join(t.TempDir(), "rt.xlsx")
	if err := WriteXLSX(path, string(data)); err != nil {
		t.Fatalf("WriteXLSX: %v", err)
	}
	jsonStr, err := ReadXLSX(path)
	if err != nil {
		t.Fatalf("ReadXLSX: %v", err)
	}
	var back workbookJSON
	if err := json.Unmarshal([]byte(jsonStr), &back); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(back.Sheets) == 0 {
		t.Fatal("no sheets after round trip")
	}
	cells := back.Sheets[0].Cells

	if got := cells["0-0"].Fmt; got != "percent" {
		t.Errorf("round trip A1 fmt = %q, want %q", got, "percent")
	}
	b2, ok := cells["1-1"]
	if !ok || b2.MergeRange == nil || b2.MergeRange.RowSpan != 2 || b2.MergeRange.ColSpan != 2 {
		t.Errorf("round trip B2 merge missing/broken: %+v (present=%v)", b2.MergeRange, ok)
	}
	if got := cells["2-0"].Valid; got != "yes,no" {
		t.Errorf("round trip A3 valid = %q, want %q", got, "yes,no")
	}
	// 既有字段不受影响：value / hiddenBy 保持原语义
	if got := cells["0-0"].Value; got != "5" {
		t.Errorf("round trip A1 value = %q, want %q", got, "5")
	}
	if got := cells["1-2"].HiddenBy; got != "1-1" {
		t.Errorf("round trip C2 hiddenBy = %q, want %q", got, "1-1")
	}
}

// TestLiteralListValidationRef 验证引用区域型列表（=$E$1:$E$3）不会被当成字面列表。
func TestLiteralListValidationRef(t *testing.T) {
	if got := literalList(`"yes,no"`); got != "yes,no" {
		t.Errorf("literalList quoted = %q, want %q", got, "yes,no")
	}
	if got := literalList(`="yes,no"`); got != "yes,no" {
		t.Errorf("literalList =quoted = %q, want %q", got, "yes,no")
	}
	if got := literalList("$E$1:$E$3"); got != "" {
		t.Errorf("literalList range ref = %q, want empty", got)
	}
	if got := literalList("Sheet1!$A$1:$A$3"); got != "" {
		t.Errorf("literalList cross-sheet ref = %q, want empty", got)
	}
}

func mergeSpan(rowSpan, colSpan int) *struct {
	RowSpan int `json:"rowSpan"`
	ColSpan int `json:"colSpan"`
} {
	return &struct {
		RowSpan int `json:"rowSpan"`
		ColSpan int `json:"colSpan"`
	}{RowSpan: rowSpan, ColSpan: colSpan}
}

func keysOf(cells map[string]cellJSON) string {
	var b strings.Builder
	for k := range cells {
		b.WriteString(k)
		b.WriteString(" ")
	}
	return b.String()
}
