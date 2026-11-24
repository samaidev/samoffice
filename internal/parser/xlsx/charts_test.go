package xlsx

// charts_test.go —— round61 浮动图表读写的往返与保真测试。
//
//  1. 上游 excelize AddChart 生成 Excel 风格图表 → 我的读取器解析为模型；
//  2. 模型 → 写出（完整 c:chartSpace + graphicFrame 锚点）→ 读回逐字段核对；
//  3. 未编辑图表保存原样写回（chart XML 字节级一致）+ 真 excelize 能重新打开。

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

// chartOf 从 xlsx 字节里取出第一个 chart 部件文本。
func chartOf(t *testing.T, data []byte) string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	for _, zf := range zr.File {
		if strings.HasPrefix(zf.Name, "xl/charts/chart") && strings.HasSuffix(zf.Name, ".xml") {
			rc, _ := zf.Open()
			defer rc.Close()
			var buf bytes.Buffer
			if _, err := buf.ReadFrom(rc); err != nil {
				t.Fatalf("read %s: %v", zf.Name, err)
			}
			return buf.String()
		}
	}
	return ""
}

// buildExcelStyleChartWorkbook 用上游 excelize 生成带图表（柱形簇状，2 系列）的工作簿。
func buildExcelStyleChartWorkbook(t *testing.T) []byte {
	t.Helper()
	f := excelize.NewFile()
	sheet := "Sheet1"
	_ = f.SetCellValue(sheet, "A1", "水果")
	_ = f.SetCellValue(sheet, "B1", "Q1")
	_ = f.SetCellValue(sheet, "C1", "Q2")
	_ = f.SetCellValue(sheet, "D1", "Q3")
	_ = f.SetCellValue(sheet, "A2", "苹果")
	_ = f.SetCellValue(sheet, "B2", 10)
	_ = f.SetCellValue(sheet, "C2", 20)
	_ = f.SetCellValue(sheet, "D2", 30)
	_ = f.SetCellValue(sheet, "A3", "香蕉")
	_ = f.SetCellValue(sheet, "B3", 15)
	_ = f.SetCellValue(sheet, "C3", 25)
	_ = f.SetCellValue(sheet, "D3", 35)
	series := []excelize.ChartSeries{
		{Name: sheet + "!$A$2", Categories: sheet + "!$B$1:$D$1", Values: sheet + "!$B$2:$D$2"},
		{Name: sheet + "!$A$3", Categories: sheet + "!$B$1:$D$1", Values: sheet + "!$B$3:$D$3"},
	}
	if err := f.AddChart(sheet, "F2", &excelize.Chart{
		Type:   excelize.Col,
		Series: series,
		Title:  []excelize.RichTextRun{{Text: "季度销量"}},
		Legend: excelize.ChartLegend{Position: "bottom"},
		PlotArea: excelize.ChartPlotArea{ShowCatName: false, ShowSerName: false, ShowVal: true},
	}); err != nil {
		t.Fatalf("upstream AddChart: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	f.Close()
	return buf.Bytes()
}

// ---- 1. Excel 风格图表读取 ----

func TestChartsExcelStyleRead(t *testing.T) {
	wb := readBack(t, buildExcelStyleChartWorkbook(t))
	if len(wb.Sheets) == 0 || len(wb.Sheets[0].Charts) != 1 {
		t.Fatalf("charts = %+v (graphicFrame→chart 未解析)", wb.Sheets)
	}
	cj := wb.Sheets[0].Charts[0]
	if cj.Type != "column" {
		t.Errorf("type = %q, want column", cj.Type)
	}
	if cj.Title != "季度销量" || !cj.TitleOn {
		t.Errorf("title = %q/%v", cj.Title, cj.TitleOn)
	}
	if cj.Legend != "b" {
		t.Errorf("legend = %q, want b (bottom)", cj.Legend)
	}
	if len(cj.Series) != 2 {
		t.Fatalf("series = %d, want 2", len(cj.Series))
	}
	s0 := cj.Series[0]
	if s0.Name != "苹果" || s0.NameRef != "Sheet1!$A$2" {
		t.Errorf("ser0 name = %q/%q", s0.Name, s0.NameRef)
	}
	if len(s0.Cats) != 3 || s0.Cats[0] != "Q1" || s0.Cats[2] != "Q3" {
		t.Errorf("ser0 cats = %v", s0.Cats)
	}
	if len(s0.Values) != 3 || s0.Values[0] != 10 || s0.Values[2] != 30 {
		t.Errorf("ser0 values = %v", s0.Values)
	}
	if cj.Series[1].Name != "香蕉" || cj.Series[1].Values[1] != 25 {
		t.Errorf("ser1 = %+v", cj.Series[1])
	}
	if cj.From == nil || cj.To == nil {
		t.Errorf("锚点丢失: from=%+v to=%+v", cj.From, cj.To)
	}
	if cj.ChartRaw == "" || cj.AnchorRaw == "" {
		t.Errorf("raw 透传丢失（chart=%v anchor=%v）", cj.ChartRaw != "", cj.AnchorRaw != "")
	}
	// 数据标签（上游 PlotArea.ShowVal=true → 图表级 dLbls）
	if cj.DataLabels == "none" {
		t.Errorf("数据标签未解析")
	}
}

// ---- 2. 模型 → DrawingML → 读回 ----

func TestChartsModelRoundTrip(t *testing.T) {
	wb := workbookJSON{Sheets: []sheetJSON{{
		Name: "S1", Rows: 20, Cols: 12, Cells: map[string]cellJSON{},
		Charts: []chartJSON{{
			Name: "销售图", Type: "columnStacked",
			From: &picPointJSON{Col: 2, Row: 2, Dx: 10, Dy: 8},
			To:   &picPointJSON{Col: 10, Row: 18, Dx: 0, Dy: 0},
			Mode: "moveSize",
			Title: "季度销量", TitleOn: true,
			Legend: "b", Gridlines: true, DataLabels: "outEnd",
			GapWidth: 120, Overlap: 100, Edited: true,
			Series: []chartSeriesJSON{
				{Name: "苹果", NameRef: "S1!$A$2", Cats: []string{"Q1", "Q2", "Q3"}, CatsRef: "S1!$B$1:$D$1", Values: []float64{10, 20, 30}, ValuesRef: "S1!$B$2:$D$2", Color: "#4472C4"},
				{Name: "香蕉", NameRef: "S1!$A$3", Cats: []string{"Q1", "Q2", "Q3"}, CatsRef: "S1!$B$1:$D$1", Values: []float64{15, 25, 35}, ValuesRef: "S1!$B$3:$D$3"},
			},
		}},
	}}}
	data, err := WriteXLSXBytes(mustJSONMarshal(t, wb))
	if err != nil {
		t.Fatalf("write: %v", err)
	}

	// drawing：graphicFrame 锚点 + c:chart 关系
	dx := drawingOf(t, data)
	for _, want := range []string{
		`editAs="twoCell"`,
		"<xdr:graphicFrame",
		`uri="http://schemas.openxmlformats.org/drawingml/2006/chart"`,
		`r:id="rId`,
	} {
		if !strings.Contains(dx, want) {
			t.Errorf("drawing XML 缺少 %q\n%s", want, dx)
		}
	}
	// chart 部件：barChart 堆积 + 双系列缓存 + 图例 + 网格线 + 数据标签
	cx := chartOf(t, data)
	for _, want := range []string{
		"<c:barChart>", `<c:barDir val="col"/>`, `<c:grouping val="stacked"/>`,
		`<c:gapWidth val="120"/>`, `<c:overlap val="100"/>`,
		"<c:ser>", "<c:v>苹果</c:v>", "<c:v>Q1</c:v>", "<c:v>30</c:v>",
		`<c:legendPos val="b"/>`, "<c:majorGridlines/>",
		`<c:dLblPos val="outEnd"/>`, `<c:showVal val="1"/>`,
		`<a:t>季度销量</a:t>`, `<a:srgbClr val="4472C4"/>`,
		"S1!$B$2:$D$2",
	} {
		if !strings.Contains(cx, want) {
			t.Errorf("chart XML 缺少 %q\n实际：\n%s", want, cx)
		}
	}
	// 真 excelize（上游）能打开（其解析器对结构错误零容错）
	vf, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("upstream open: %v", err)
	}
	vf.Close()

	// 读回：逐字段核对
	back := readBack(t, data)
	if len(back.Sheets[0].Charts) != 1 {
		t.Fatalf("读回图表数 = %d", len(back.Sheets[0].Charts))
	}
	got := back.Sheets[0].Charts[0]
	if got.Type != "columnStacked" {
		t.Errorf("type = %q, want columnStacked", got.Type)
	}
	if got.From == nil || got.From.Col != 2 || got.From.Row != 2 || got.From.Dx != 10 || got.From.Dy != 8 {
		t.Errorf("from = %+v", got.From)
	}
	if got.To == nil || got.To.Col != 10 || got.To.Row != 18 {
		t.Errorf("to = %+v", got.To)
	}
	if got.Title != "季度销量" || !got.TitleOn {
		t.Errorf("title = %q/%v", got.Title, got.TitleOn)
	}
	if got.Legend != "b" {
		t.Errorf("legend = %q", got.Legend)
	}
	if !got.Gridlines {
		t.Errorf("gridlines 丢失")
	}
	if got.DataLabels != "outEnd" {
		t.Errorf("dataLabels = %q", got.DataLabels)
	}
	if len(got.Series) != 2 || got.Series[0].Name != "苹果" || len(got.Series[0].Values) != 3 || got.Series[0].Values[2] != 30 {
		t.Errorf("series = %+v", got.Series)
	}
	if got.Series[0].Color != "#4472C4" {
		t.Errorf("ser0 color = %q", got.Series[0].Color)
	}
	if got.Series[0].ValuesRef != "S1!$B$2:$D$2" {
		t.Errorf("ser0 valuesRef = %q", got.Series[0].ValuesRef)
	}
}

// ---- 3. 未编辑图表原样写回（字节级保真） ----

func TestChartsUneditedRawFidelity(t *testing.T) {
	src := buildExcelStyleChartWorkbook(t)
	wb := readBack(t, src)
	data, err := WriteXLSXBytes(mustJSONMarshal(t, wb))
	if err != nil {
		t.Fatalf("rewrite: %v", err)
	}
	// chart 部件应与源文件字节一致（未编辑 → ChartRaw 原样写回）
	want := chartOf(t, src)
	got := chartOf(t, data)
	if want == "" {
		t.Fatal("源文件没有 chart 部件")
	}
	if got != want {
		t.Errorf("未编辑图表的 chart XML 未原样写回（%d vs %d 字节）", len(got), len(want))
	}
	// drawing 里 graphicFrame 保留
	if !strings.Contains(drawingOf(t, data), "<xdr:graphicFrame") {
		t.Errorf("graphicFrame 锚点丢失")
	}
	// 真 excelize 能重新打开
	vf, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("upstream open rewritten: %v", err)
	}
	vf.Close()
}

// ---- 4. 类型映射：饼/环/散点/条形堆积/折线 ----

func TestChartsTypeMapping(t *testing.T) {
	cases := []struct {
		tp      excelize.ChartType
		want    string
		nameRef bool
	}{
		{excelize.Pie, "pie", true},
		{excelize.Doughnut, "doughnut", true},
		{excelize.Scatter, "scatter", true},
		{excelize.BarStacked, "barStacked", true},
		{excelize.Line, "line", true},
		{excelize.ColPercentStacked, "columnStacked100", true},
	}
	for _, c := range cases {
		f := excelize.NewFile()
		_ = f.SetCellValue("Sheet1", "A1", "苹果")
		_ = f.SetCellValue("Sheet1", "B1", 10)
		_ = f.SetCellValue("Sheet1", "C1", 20)
		_ = f.SetCellValue("Sheet1", "A2", "香蕉")
		_ = f.SetCellValue("Sheet1", "B2", 15)
		_ = f.SetCellValue("Sheet1", "C2", 25)
		series := []excelize.ChartSeries{{Name: "Sheet1!$A$1", Categories: "Sheet1!$B$1:$C$1", Values: "Sheet1!$B$1:$C$1"}}
		if c.tp == excelize.Scatter {
			series = []excelize.ChartSeries{{Name: "Sheet1!$A$1", Categories: "Sheet1!$B$1:$C$1", Values: "Sheet1!$B$2:$C$2"}}
		}
		if err := f.AddChart("Sheet1", "E2", &excelize.Chart{Type: c.tp, Series: series}); err != nil {
			t.Fatalf("AddChart(%v): %v", c.tp, err)
		}
		buf, err := f.WriteToBuffer()
		f.Close()
		if err != nil {
			t.Fatalf("write: %v", err)
		}
		wb := readBack(t, buf.Bytes())
		if len(wb.Sheets[0].Charts) != 1 {
			t.Fatalf("[%v] charts = %d", c.tp, len(wb.Sheets[0].Charts))
		}
		if got := wb.Sheets[0].Charts[0].Type; got != c.want {
			t.Errorf("[%v] type = %q, want %q", c.tp, got, c.want)
		}
	}
}

// ---- 5. 旧快照兼容：无 charts 字段的 JSON 照常工作 ----

func TestChartsLegacyNoCharts(t *testing.T) {
	wb := workbookJSON{Sheets: []sheetJSON{{
		Name: "S1", Rows: 5, Cols: 5, Cells: map[string]cellJSON{"0-0": {Value: "x"}},
	}}}
	data, err := WriteXLSXBytes(mustJSONMarshal(t, wb))
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	if chartOf(t, data) != "" {
		t.Errorf("不应生成 chart 部件")
	}
}
