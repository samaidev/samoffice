package xlsx

// charts_write.go —— round61：图表写出。
//
// 与图片（pictures_write.go）同策略：excelizelite 只登记 chart 部件与关系
// （RegisterChartPart），锚点（graphicFrame）与图表 XML（c:chartSpace）由本文件
// 生成后在 rewriteDrawings 阶段统一重写。未编辑过的图表（Edited=false 且带
// AnchorRaw/ChartRaw）原样写回原始 XML（3D/组合图等未建模属性不丢失）。

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/zai/samoffice/internal/excelizelite"
)

const (
	chartURI    = "http://schemas.openxmlformats.org/drawingml/2006/chart"
	chartXMLNS  = `xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"`
	catAxID     = 111111111
	valAxID     = 222222222
	defaultHole = 50
)

// chartPlan：一张待写出的图表（模型 + drawing 关系 id）。
type chartPlan struct {
	cj  *chartJSON
	rID string
}

// registerCharts 为一张工作表的图表登记 chart 部件，填充 drawingPlan。
// 图表固定渲染在图片之上（同一 drawing 内先写图片锚点再写图表锚点）。
func registerCharts(f *excelize.File, sheet string, sj *sheetJSON, plans map[string]*drawingPlan) {
	for i := range sj.Charts {
		cj := &sj.Charts[i]
		xml := []byte(cj.ChartRaw)
		if cj.Edited || cj.ChartRaw == "" {
			xml = []byte(buildChartXML(cj))
		}
		rID, draw, err := f.RegisterChartPart(sheet, xml)
		if err != nil {
			continue
		}
		plan := plans[draw]
		if plan == nil {
			plan = &drawingPlan{}
			plans[draw] = plan
		}
		plan.charts = append(plan.charts, chartPlan{cj: cj, rID: rID})
	}
}

// buildChartXML 按模型生成完整 c:chartSpace（12 种 2D 图表类型）。
func buildChartXML(cj *chartJSON) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n")
	b.WriteString(`<c:chartSpace ` + chartXMLNS + ` xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`)
	b.WriteString(`<c:date1904 val="0"/><c:lang val="zh-CN"/><c:roundedCorners val="0"/>`)
	b.WriteString(`<c:chart>`)
	// 标题
	if cj.TitleOn {
		fmt.Fprintf(&b, `<c:title><c:tx><c:rich><a:bodyPr rot="0" spcFirstLastPara="1" vertOverflow="ellipsis" vert="horz" wrap="square" anchor="ctr" anchorCtr="1"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400" b="1" i="0" u="none" strike="noStrike" kern="1200" baseline="0"/></a:pPr><a:r><a:rPr lang="zh-CN" altLang="en-US" sz="1400" b="1"/><a:t>%s</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`, xmlEsc(cj.Title))
	} else {
		b.WriteString(`<c:autoTitleDeleted val="1"/>`)
	}
	// 绘图区
	b.WriteString(`<c:plotArea><c:layout/>`)
	switch cj.Type {
	case "pie":
		b.WriteString(`<c:pieChart><c:varyColors val="1"/>`)
		writeSeries(&b, cj, "pie")
		writeDataLabels(&b, cj, "pie")
		b.WriteString(`<c:firstSliceAng val="0"/></c:pieChart>`)
	case "doughnut":
		hole := cj.HoleSize
		if hole <= 0 || hole > 90 {
			hole = defaultHole
		}
		b.WriteString(`<c:doughnutChart><c:varyColors val="1"/>`)
		writeSeries(&b, cj, "doughnut")
		writeDataLabels(&b, cj, "pie")
		fmt.Fprintf(&b, `<c:firstSliceAng val="0"/><c:holeSize val="%d"/></c:doughnutChart>`, hole)
	case "scatter":
		b.WriteString(`<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>`)
		writeSeries(&b, cj, "scatter")
		writeDataLabels(&b, cj, "scatter")
		fmt.Fprintf(&b, `<c:axId val="%d"/><c:axId val="%d"/></c:scatterChart>`, catAxID, valAxID)
	case "line", "lineMarker":
		b.WriteString(`<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>`)
		writeSeries(&b, cj, cj.Type)
		writeDataLabels(&b, cj, "line")
		fmt.Fprintf(&b, `<c:marker val="1"/><c:axId val="%d"/><c:axId val="%d"/></c:lineChart>`, catAxID, valAxID)
	case "area":
		b.WriteString(`<c:areaChart><c:grouping val="standard"/><c:varyColors val="0"/>`)
		writeSeries(&b, cj, "area")
		writeDataLabels(&b, cj, "area")
		fmt.Fprintf(&b, `<c:axId val="%d"/><c:axId val="%d"/></c:areaChart>`, catAxID, valAxID)
	default:
		// 柱形/条形 × 簇状/堆积/百分比堆积
		dir, grouping := "col", "clustered"
		overlap := cj.Overlap
		switch cj.Type {
		case "bar":
			dir, grouping = "bar", "clustered"
		case "barStacked":
			dir, grouping, overlap = "bar", "stacked", 100
		case "barStacked100":
			dir, grouping, overlap = "bar", "percentStacked", 100
		case "columnStacked":
			dir, grouping, overlap = "col", "stacked", 100
		case "columnStacked100":
			dir, grouping, overlap = "col", "percentStacked", 100
		}
		gap := cj.GapWidth
		if gap <= 0 {
			gap = 150
		}
		fmt.Fprintf(&b, `<c:barChart><c:barDir val="%s"/><c:grouping val="%s"/><c:varyColors val="0"/>`, dir, grouping)
		writeSeries(&b, cj, "bar")
		writeDataLabels(&b, cj, "bar")
		fmt.Fprintf(&b, `<c:gapWidth val="%d"/>`, gap)
		if grouping != "clustered" || overlap != 0 {
			fmt.Fprintf(&b, `<c:overlap val="%d"/>`, overlap)
		}
		fmt.Fprintf(&b, `<c:axId val="%d"/><c:axId val="%d"/></c:barChart>`, catAxID, valAxID)
	}
	// 坐标轴（饼/环无轴；round62：全属性轴配置 catAxis/valAxis）
	if cj.Type != "pie" && cj.Type != "doughnut" {
		barDir := cj.Type == "bar" || cj.Type == "barStacked" || cj.Type == "barStacked100"
		if cj.Type == "scatter" {
			// 散点：x/y 都是数值轴。x 轴配置存 CatAxis（编辑语义按"水平轴"），
			// 但写出按 valAx（含 min/max/unit）
			axX := cj.CatAxis
			writeValAxisFull(&b, catAxID, "b", axX)
			writeValAxis(&b, valAxID, "l", cj.ValAxis, cj.Gridlines)
		} else {
			// 类别轴：条形图在左，其余在下
			writeCatAxis(&b, cj.CatAxis, barDir)
			writeValAxis(&b, valAxID, axisPos(barDir), cj.ValAxis, cj.Gridlines)
		}
	}
	b.WriteString(`</c:plotArea>`)
	// 图例
	if cj.Legend != "" && cj.Legend != "none" {
		fmt.Fprintf(&b, `<c:legend><c:legendPos val="%s"/><c:overlay val="0"/></c:legend>`, xmlEsc(cj.Legend))
	}
	b.WriteString(`<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>`)
	b.WriteString(`</c:chart>`)
	// 图表区外观：白底 + 浅边框 + 默认字体
	b.WriteString(`<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr>`)
	b.WriteString(`<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000"/></a:pPr><a:endParaRPr lang="zh-CN"/></a:p></c:txPr>`)
	b.WriteString(`</c:chartSpace>`)
	return b.String()
}

func axisPos(barDir bool) string {
	if barDir {
		return "b"
	}
	return "l"
}

// writeCatAxis 写类别轴（round62：全属性——标题/刻度线/标签位置/格式/线条/网格线/反转）。
// barDir：条形图类别轴在左，柱形图在下。
func writeCatAxis(b *strings.Builder, a chartAxisJSON, barDir bool) {
	pos := "b"
	if barDir {
		pos = "l"
	}
	writeAxisCommon(b, catAxID, pos, valAxID, a, true, false)
}

// writeValAxis 写数值轴（round62：全属性 + min/max/单位/对数/反转）。
func writeValAxis(b *strings.Builder, id int, pos string, a chartAxisJSON, gridlines bool) {
	writeAxisCommon(b, id, pos, catAxID, a, false, gridlines)
}

// writeValAxisFull 散点 x 轴：valAx XML，crossAx 指向 y 轴（valAxID），
// 网格线由 a.MajorGridlines 自带（不经 round61 总开关）。
func writeValAxisFull(b *strings.Builder, id int, pos string, a chartAxisJSON) {
	writeAxisCommon(b, id, pos, valAxID, a, false, a.MajorGridlines)
}

// writeAxisCommon 写一根轴的完整 XML（类别轴补 lblAlgn/lblOffset/auto）。
// gridlines 仅对 valAx 生效（类别轴网格线走 a.MajorGridlines）。
func writeAxisCommon(b *strings.Builder, id int, pos string, crossAx int, a chartAxisJSON, isCat bool, gridlines bool) {
	tag := "valAx"
	if isCat {
		tag = "catAx"
	}
	fmt.Fprintf(b, `<c:%s><c:axId val="%d"/>`, tag, id)

	// scaling：min/max/orientation/logBase（类别轴只写 orientation）
	fmt.Fprintf(b, `<c:scaling>`)
	if !isCat {
		if a.Min != nil {
			fmt.Fprintf(b, `<c:min val="%s"/>`, formatChartNum(*a.Min))
		}
		if a.Max != nil {
			fmt.Fprintf(b, `<c:max val="%s"/>`, formatChartNum(*a.Max))
		}
		if a.LogBase != nil && *a.LogBase > 1 && *a.LogBase <= 1000 {
			fmt.Fprintf(b, `<c:logBase val="%s"/>`, formatChartNum(*a.LogBase))
		}
	}
	orient := "minMax"
	if a.Reverse {
		orient = "maxMin"
	}
	fmt.Fprintf(b, `<c:orientation val="%s"/></c:scaling>`, orient)

	// delete：轴标签 none = 整轴隐藏（Excel「无坐标轴」）
	del := 0
	if a.TickLabelPos == "none" {
		del = 1
	}
	fmt.Fprintf(b, `<c:delete val="%d"/><c:axPos val="%s"/>`, del, pos)

	// 主网格线（CT 序列：axPos → majorGridlines → minorGridlines → title → numFmt；
	// valAx 侧用 gridlines 总开关兼容 round61，catAx 用 a.MajorGridlines）
	if isCat {
		if a.MajorGridlines {
			writeMajorGridlines(b, a)
		}
	} else if gridlines {
		writeMajorGridlines(b, a)
	}

	// 轴标题（c:title，CT 序列位于 majorGridlines 之后）
	if a.Title != "" {
		fmt.Fprintf(b, `<c:title><c:tx><c:rich><a:bodyPr rot="0" spcFirstLastPara="1" vertOverflow="ellipsis" vert="horz" wrap="square" anchor="ctr" anchorCtr="1"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000" b="0" i="0" u="none" strike="noStrike" kern="1200" baseline="0"/></a:pPr><a:r><a:rPr lang="zh-CN" altLang="en-US" sz="1000"/><a:t>%s</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`, xmlEsc(a.Title))
	}

	// 数字格式
	numFmt := a.NumFmt
	if numFmt == "" {
		numFmt = "General"
	}
	fmt.Fprintf(b, `<c:numFmt formatCode="%s" sourceLinked="0"/>`, xmlEsc(numFmt))

	// 主要/次要刻度线（默认 out/none，对齐 Excel 默认）
	majorTick := orDefault(a.MajorTick, "out")
	minorTick := orDefault(a.MinorTick, "none")
	fmt.Fprintf(b, `<c:majorTickMark val="%s"/><c:minorTickMark val="%s"/>`, majorTick, minorTick)

	// 轴标签位置
	tlp := orDefault(a.TickLabelPos, "nextTo")
	fmt.Fprintf(b, `<c:tickLblPos val="%s"/>`, tlp)

	// 轴线条样式（颜色/宽度）
	fmt.Fprintf(b, `<c:spPr>%s</c:spPr>`, axisLnXML(a))

	fmt.Fprintf(b, `<c:crossAx val="%d"/><c:crosses val="autoZero"/>`, crossAx)
	if !isCat {
		// 数值轴单位（major/minor）
		if a.MajorUnit != nil && *a.MajorUnit > 0 {
			fmt.Fprintf(b, `<c:majorUnit val="%s"/>`, formatChartNum(*a.MajorUnit))
		}
		if a.MinorUnit != nil && *a.MinorUnit > 0 {
			fmt.Fprintf(b, `<c:minorUnit val="%s"/>`, formatChartNum(*a.MinorUnit))
		}
		fmt.Fprintf(b, `<c:crossBetween val="between"/>`)
	} else {
		fmt.Fprintf(b, `<c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/>`)
	}
	fmt.Fprintf(b, `</c:%s>`, tag)
}

// writeMajorGridlines 写主网格线（含颜色/宽度样式）。
func writeMajorGridlines(b *strings.Builder, a chartAxisJSON) {
	if a.LineColor == "" && a.LineWidth == 0 {
		b.WriteString(`<c:majorGridlines/>`)
		return
	}
	fmt.Fprintf(b, `<c:majorGridlines><c:spPr>%s</c:spPr></c:majorGridlines>`, axisLnXML(a))
}

// axisLnXML 生成 a:ln 轴/网格线条 XML（颜色 + 宽度 pt→EMU）。
func axisLnXML(a chartAxisJSON) string {
	w := 9525 // 默认 0.75pt
	if a.LineWidth > 0 {
		w = a.LineWidth * 12700
	}
	if a.LineColor != "" {
		return fmt.Sprintf(`<a:ln w="%d"><a:solidFill><a:srgbClr val="%s"/></a:solidFill></a:ln>`, w, hex6(a.LineColor))
	}
	return fmt.Sprintf(`<a:ln w="%d"/>`, w)
}

func orDefault(v, d string) string {
	if v == "" {
		return d
	}
	return v
}

// writeSeries 写全部系列（kind 决定 ser 内部结构：bar/line/area/pie/scatter）。
func writeSeries(b *strings.Builder, cj *chartJSON, kind string) {
	for i := range cj.Series {
		writeOneSeries(b, i, &cj.Series[i], kind)
	}
}

func writeOneSeries(b *strings.Builder, idx int, ser *chartSeriesJSON, kind string) {
	fmt.Fprintf(b, `<c:ser><c:idx val="%d"/><c:order val="%d"/>`, idx, idx)
	// 系列名（带缓存）
	if ser.Name != "" || ser.NameRef != "" {
		fmt.Fprintf(b, `<c:tx><c:strRef>%s<c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>%s</c:v></c:pt></c:strCache></c:strRef></c:tx>`,
			refTag(ser.NameRef), xmlEsc(ser.Name))
	}
	// 系列主色
	if ser.Color != "" {
		fmt.Fprintf(b, `<c:spPr><a:solidFill><a:srgbClr val="%s"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="%s"/></a:solidFill></a:ln></c:spPr>`, hex6(ser.Color), hex6(ser.Color))
	}
	// 折线/散点：标记
	if kind == "line" {
		b.WriteString(`<c:marker><c:symbol val="none"/></c:marker>`)
	}
	if kind == "lineMarker" || kind == "scatter" {
		b.WriteString(`<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>`)
	}
	// 类别（散点图用 xVal 数值引用）
	if kind == "scatter" {
		writeNumCache(b, "xVal", ser.CatsRef, catsAsFloats(ser.Cats))
	} else {
		writeCatCache(b, ser.CatsRef, ser.Cats)
	}
	// 数值（散点图用 yVal）
	if kind == "scatter" {
		writeNumCache(b, "yVal", ser.ValuesRef, ser.Values)
	} else {
		writeNumCache(b, "val", ser.ValuesRef, ser.Values)
	}
	// 折线平滑
	if kind == "line" || kind == "lineMarker" || kind == "scatter" {
		b.WriteString(`<c:smooth val="0"/>`)
	}
	b.WriteString(`</c:ser>`)
}

func refTag(ref string) string {
	if ref == "" {
		return ""
	}
	return `<c:f>` + xmlEsc(ref) + `</c:f>`
}

// writeCatCache 写类别（c:cat：字符串或数值缓存）。
func writeCatCache(b *strings.Builder, ref string, cats []string) {
	b.WriteString(`<c:cat>`)
	numeric := len(cats) > 0
	for _, c := range cats {
		if _, err := strconv.ParseFloat(strings.TrimSpace(c), 64); err != nil {
			numeric = false
			break
		}
	}
	if numeric {
		var vals []float64
		for _, c := range cats {
			v, _ := strconv.ParseFloat(strings.TrimSpace(c), 64)
			vals = append(vals, v)
		}
		b.WriteString(`<c:numRef>` + refTag(ref) + `<c:numCache><c:formatCode>General</c:formatCode>`)
		writePts(b, vals)
		b.WriteString(`</c:numCache></c:numRef>`)
	} else {
		b.WriteString(`<c:strRef>` + refTag(ref) + `<c:strCache>`)
		fmt.Fprintf(b, `<c:ptCount val="%d"/>`, len(cats))
		for i, c := range cats {
			fmt.Fprintf(b, `<c:pt idx="%d"><c:v>%s</c:v></c:pt>`, i, xmlEsc(c))
		}
		b.WriteString(`</c:strCache></c:strRef>`)
	}
	b.WriteString(`</c:cat>`)
}

// writeNumCache 写数值缓存（tag = val/yVal/xVal）。
func writeNumCache(b *strings.Builder, tag, ref string, vals []float64) {
	fmt.Fprintf(b, `<c:%s><c:numRef>%s<c:numCache><c:formatCode>General</c:formatCode>`, tag, refTag(ref))
	writePts(b, vals)
	b.WriteString(`</c:numCache></c:numRef></c:` + tag + `>`)
}

func writePts(b *strings.Builder, vals []float64) {
	fmt.Fprintf(b, `<c:ptCount val="%d"/>`, len(vals))
	for i, v := range vals {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			continue
		}
		fmt.Fprintf(b, `<c:pt idx="%d"><c:v>%s</c:v></c:pt>`, i, formatChartNum(v))
	}
}

func catsAsFloats(cats []string) []float64 {
	out := make([]float64, len(cats))
	for i, c := range cats {
		v, err := strconv.ParseFloat(strings.TrimSpace(c), 64)
		if err != nil {
			v = math.NaN()
		}
		out[i] = v
	}
	return out
}

// writeDataLabels 写图表级数据标签（kind 决定允许的位置）。
func writeDataLabels(b *strings.Builder, cj *chartJSON, kind string) {
	if cj.DataLabels == "" || cj.DataLabels == "none" {
		return
	}
	pos := cj.DataLabels
	// dLblPos 对堆积柱/面积图非法：退回 ctr；饼图仅 bestFit/ctr/inEnd/outEnd
	if kind == "area" || kind == "line" || kind == "scatter" {
		if pos != "ctr" {
			pos = "ctr"
		}
	}
	if kind == "pie" || kind == "doughnut" {
		switch pos {
		case "bestFit", "ctr", "inEnd", "outEnd":
		default:
			pos = "bestFit"
		}
	}
	posTag := ""
	if pos != "" {
		posTag = `<c:dLblPos val="` + pos + `"/>`
	}
	fmt.Fprintf(b, `<c:dLbls><c:numFmt formatCode="General" sourceLinked="1"/>%s<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>`, posTag)
}

// buildChartAnchor 生成 graphicFrame 锚点（与图片的 twoCellAnchor 同构）。
func buildChartAnchor(cj *chartJSON, id int, rID string) string {
	from, to, mode := chartAnchors(cj)
	editAs := "twoCell"
	switch mode {
	case "move":
		editAs = "oneCell"
	case "fixed":
		editAs = "absolute"
	}
	var b strings.Builder
	fmt.Fprintf(&b, `<xdr:twoCellAnchor editAs="%s">`, editAs)
	writeMarker(&b, "from", from)
	writeMarker(&b, "to", to)
	name := cj.Name
	if name == "" {
		name = "Chart " + strconv.Itoa(id)
	}
	fmt.Fprintf(&b, `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="%d" name="%s"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="%s"><c:chart %s r:id="%s"/></a:graphicData></a:graphic></xdr:graphicFrame>`,
		id, xmlEsc(name), chartURI, chartXMLNS, rID)
	b.WriteString(`<xdr:clientData fLocksWithSheet="1" fPrintsWithSheet="1"/></xdr:twoCellAnchor>`)
	return b.String()
}

// chartAnchors 规范化图表锚点（缺省给一个 8 列 × 15 行的默认框）。
func chartAnchors(cj *chartJSON) (picPointJSON, picPointJSON, string) {
	from, to := cj.From, cj.To
	mode := cj.Mode
	if mode == "" {
		mode = "moveSize"
	}
	if from == nil {
		from = &picPointJSON{Col: 1, Row: 1, Dx: 0, Dy: 0}
	}
	if to == nil {
		to = &picPointJSON{Col: from.Col + 8, Row: from.Row + 15, Dx: 0, Dy: 0}
	}
	return *from, *to, mode
}

// reuseChartAnchor 原样写回未编辑图表的锚点 XML（仅替换关系 id）。
func reuseChartAnchor(cj *chartJSON, p chartPlan) (string, bool) {
	s := reHlink.ReplaceAllString(cj.AnchorRaw, "")
	// 图表部件引用（r:id）替换为新关系
	if m := reChartRelAttr.FindStringSubmatch(s); m != nil {
		s = strings.ReplaceAll(s, m[0], `r:id="`+p.rID+`"`)
	}
	for _, m := range reRelAttr.FindAllStringSubmatch(s, -1) {
		if m[1] != p.rID {
			return "", false // 悬空引用（外链等）→ 模型重建
		}
	}
	return s, true
}

var reChartRelAttr = regexp.MustCompile(`\br:id="[^"]*"`)
