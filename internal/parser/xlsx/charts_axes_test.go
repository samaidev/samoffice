package xlsx

// charts_axes_test.go —— round62：坐标轴全面编辑的读写往返测试。
//
// 	1. 轴属性全字段写出 → chart XML 断言（scaling/单位/刻度线/格式/标题/线条/网格线）
// 	2. 读回 → 逐字段核对（min/max/majorUnit/majorTick/tickLabelPos/numFmt/reverse/logBase）
// 	3. 上游 excelize 生成（YAxis 定制）→ 我的读取器解析
// 	4. 条形图轴位置互换（类别轴在左）+ 类别轴标题

import (
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

func ptrF(v float64) *float64 { return &v }

func axisFixture() chartJSON {
	min, max, mu, logb := 0.0, 500.0, 100.0, 10.0
	return chartJSON{
		Name: "轴测试图", Type: "column", Edited: true,
		From: &picPointJSON{Col: 2, Row: 2}, To: &picPointJSON{Col: 10, Row: 18}, Mode: "moveSize",
		Title: "销量", TitleOn: true, Legend: "b", Gridlines: true, DataLabels: "none",
		Series: []chartSeriesJSON{{
			Name: "Q1", Cats: []string{"一月", "二月"}, Values: []float64{120, 340},
		}},
		ValAxis: chartAxisJSON{
			Title:    "销售额（万元）",
			Min:      &min, Max: &max,
			MajorUnit: &mu,
			MajorTick: "inside",
			MinorTick: "outside",
			TickLabelPos: "high",
			NumFmt:    "#,##0",
			Reverse:   true,
			LogBase:   &logb,
			LineColor: "#FF0000",
			LineWidth: 3,
		},
		CatAxis: chartAxisJSON{
			Title: "月份",
			MajorTick: "none",
			MajorGridlines: true,
		},
	}
}

func TestAxesFullRoundTrip(t *testing.T) {
	wb := workbookJSON{Sheets: []sheetJSON{{
		Name: "S1", Rows: 20, Cols: 12, Cells: map[string]cellJSON{},
		Charts: []chartJSON{axisFixture()},
	}}}
	data, err := WriteXLSXBytes(mustJSONMarshal(t, wb))
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	cx := chartOf(t, data)
	for _, want := range []string{
		// 数值轴：scaling min/max/logBase/orientation + 单位 + 刻度线 + 标签位置 + 格式 + 标题 + 线条 + 网格线
		`<c:min val="0"/>`, `<c:max val="500"/>`, `<c:logBase val="10"/>`,
		`<c:orientation val="maxMin"/>`,
		`<c:majorUnit val="100"/>`,
		`<c:majorTickMark val="inside"/>`, `<c:minorTickMark val="outside"/>`,
		`<c:tickLblPos val="high"/>`,
		`formatCode="#,##0"`,
		`<a:t>销售额（万元）</a:t>`,
		`<a:srgbClr val="FF0000"/>`, `w="38100"`, // 3pt → 38100 EMU
		// 类别轴：标题 + 刻度线关 + 类别网格线开
		`<a:t>月份</a:t>`,
		`<c:majorTickMark val="none"/>`,
		`<c:catAx>`,
	} {
		if !strings.Contains(cx, want) {
			t.Errorf("chart XML 缺少 %q\n实际（前 2000 字）：%s", want, cx[:min(2000, len(cx))])
		}
	}

	// 读回逐字段核对
	back := readBack(t, data)
	cj := back.Sheets[0].Charts[0]
	va, ca := cj.ValAxis, cj.CatAxis
	if va.Title != "销售额（万元）" {
		t.Errorf("valAxis.title = %q", va.Title)
	}
	if va.Min == nil || *va.Min != 0 || va.Max == nil || *va.Max != 500 {
		t.Errorf("valAxis min/max = %v/%v", va.Min, va.Max)
	}
	if va.MajorUnit == nil || *va.MajorUnit != 100 {
		t.Errorf("valAxis.majorUnit = %v", va.MajorUnit)
	}
	if va.MajorTick != "inside" || va.MinorTick != "outside" {
		t.Errorf("ticks = %q/%q", va.MajorTick, va.MinorTick)
	}
	if va.TickLabelPos != "high" {
		t.Errorf("tickLabelPos = %q", va.TickLabelPos)
	}
	if va.NumFmt != "#,##0" {
		t.Errorf("numFmt = %q", va.NumFmt)
	}
	if !va.Reverse {
		t.Errorf("reverse 丢失")
	}
	if va.LogBase == nil || *va.LogBase != 10 {
		t.Errorf("logBase = %v", va.LogBase)
	}
	if va.LineColor != "#FF0000" || va.LineWidth != 3 {
		t.Errorf("line = %q/%d", va.LineColor, va.LineWidth)
	}
	if ca.Title != "月份" {
		t.Errorf("catAxis.title = %q", ca.Title)
	}
	if ca.MajorTick != "none" {
		t.Errorf("catAxis.majorTick = %q", ca.MajorTick)
	}
	if !ca.MajorGridlines {
		t.Errorf("catAxis.majorGridlines 丢失")
	}
}

func TestAxesUpstreamYAxisRead(t *testing.T) {
	// 上游 excelize：YAxis 定制（Max/Min/MajorUnit/Reverse + 轴标题）→ 我的读取器
	f := excelize.NewFile()
	_ = f.SetCellValue("Sheet1", "A1", "一月")
	_ = f.SetCellValue("Sheet1", "B1", 120)
	_ = f.SetCellValue("Sheet1", "A2", "二月")
	_ = f.SetCellValue("Sheet1", "B2", 340)
	series := []excelize.ChartSeries{{Name: "Sheet1!$B$1", Categories: "Sheet1!$A$1:$A$2", Values: "Sheet1!$B$1:$B$2"}}
	if err := f.AddChart("Sheet1", "D2", &excelize.Chart{
		Type: excelize.Col, Series: series,
		YAxis: excelize.ChartAxis{
			Maximum:     ptrF(500),
			Minimum:     ptrF(0),
			MajorUnit:   100,
			ReverseOrder: true,
			LogBase:     0,
		},
	}); err != nil {
		t.Fatalf("upstream AddChart: %v", err)
	}
	buf, err := f.WriteToBuffer()
	f.Close()
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	wb := readBack(t, buf.Bytes())
	cj := wb.Sheets[0].Charts[0]
	if cj.ValAxis.Max == nil || *cj.ValAxis.Max != 500 {
		t.Errorf("valAxis.max = %v, want 500", cj.ValAxis.Max)
	}
	if cj.ValAxis.Min == nil || *cj.ValAxis.Min != 0 {
		t.Errorf("valAxis.min = %v, want 0", cj.ValAxis.Min)
	}
	if cj.ValAxis.MajorUnit == nil || *cj.ValAxis.MajorUnit != 100 {
		t.Errorf("valAxis.majorUnit = %v, want 100", cj.ValAxis.MajorUnit)
	}
	if !cj.ValAxis.Reverse {
		t.Errorf("valAxis.reverse 丢失")
	}
}

func TestAxesBarChartPositions(t *testing.T) {
	// 条形图：类别轴在左（axPos=l）、数值轴在下（axPos=b）；轴标题写出
	wb := workbookJSON{Sheets: []sheetJSON{{
		Name: "S1", Rows: 20, Cols: 12, Cells: map[string]cellJSON{},
		Charts: []chartJSON{{
			Type: "bar", Edited: true,
			From: &picPointJSON{Col: 2, Row: 2}, To: &picPointJSON{Col: 10, Row: 18},
			Legend: "b", Gridlines: true,
			Series: []chartSeriesJSON{{Name: "Q1", Cats: []string{"a", "b"}, Values: []float64{1, 2}}},
			CatAxis: chartAxisJSON{Title: "类别左"},
			ValAxis: chartAxisJSON{Title: "数值下"},
		}},
	}}}
	data, err := WriteXLSXBytes(mustJSONMarshal(t, wb))
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	cx := chartOf(t, data)
	// 类别轴 axPos=l 且带标题；数值轴 axPos=b
	iCat := strings.Index(cx, "<c:catAx>")
	iVal := strings.Index(cx, "<c:valAx>")
	if iCat < 0 || iVal < 0 {
		t.Fatalf("缺轴：%d/%d", iCat, iVal)
	}
	catSeg, valSeg := cx[iCat:iVal], cx[iVal:]
	if !strings.Contains(catSeg, `<c:axPos val="l"/>`) {
		t.Errorf("条形图类别轴应在左（axPos=l）\n%s", catSeg[:min(300, len(catSeg))])
	}
	if !strings.Contains(catSeg, "<a:t>类别左</a:t>") {
		t.Errorf("类别轴标题丢失")
	}
	if !strings.Contains(valSeg, `<c:axPos val="b"/>`) {
		t.Errorf("条形图数值轴应在下（axPos=b）")
	}
	if !strings.Contains(valSeg, "<a:t>数值下</a:t>") {
		t.Errorf("数值轴标题丢失")
	}
}
