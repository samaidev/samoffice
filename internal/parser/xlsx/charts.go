package xlsx

// charts.go —— round61：浮动图表（对齐 MS Excel「插入图表」）。
//
// 读取：drawing 里的 graphicFrame 锚点 → 关系 → xl/charts/chartN.xml，
// 还原图表类型（柱形/条形/折线/面积/饼/环/散点 × 簇状/堆积/百分比堆积）、
// 数据系列（缓存值 + 单元格引用）、类别、标题、图例、网格线、数据标签、
// 分类间距/重叠、系列颜色、两单元格锚点与对象定位。
// 未在模型内的属性（3D、组合图、趋势线等）通过 ChartRaw 整段透传，
// 图表没被编辑过时保存原样写回（保真，与图片 round60 同策略）。

import (
	"math"
	"strconv"
	"strings"

	"github.com/zai/samoffice/internal/excelizelite"
)

// chartSeriesJSON：一个数据系列（缓存值 + 单元格引用，编辑单元格后前端重算缓存）
type chartSeriesJSON struct {
	Name      string    `json:"name,omitempty"`
	NameRef   string    `json:"nameRef,omitempty"`
	Cats      []string  `json:"cats,omitempty"`
	CatsRef   string    `json:"catsRef,omitempty"`
	Values    []float64 `json:"values"`
	ValuesRef string    `json:"valuesRef,omitempty"`
	Color     string    `json:"color,omitempty"`
}

// chartJSON：浮动图表模型（与前端 charts.ts 的 ChartSpecJSON 对应）。
// Type 取值：column|columnStacked|columnStacked100|bar|barStacked|barStacked100|
// line|lineMarker|area|pie|doughnut|scatter
type chartJSON struct {
	Name   string `json:"name,omitempty"`
	Type   string `json:"type"`
	From   *picPointJSON `json:"from,omitempty"`
	To     *picPointJSON `json:"to,omitempty"`
	Mode   string        `json:"mode,omitempty"` // moveSize|move|fixed
	Title  string        `json:"title,omitempty"`
	TitleOn bool         `json:"titleOn"`
	Legend string        `json:"legend"` // none|b|l|t|r
	Gridlines bool      `json:"gridlines"`
	DataLabels string   `json:"dataLabels"` // none|ctr|inEnd|outEnd
	GapWidth int         `json:"gapWidth,omitempty"`
	Overlap  int         `json:"overlap,omitempty"`
	Series  []chartSeriesJSON `json:"series"`
	// AnchorRaw：整段 graphicFrame 锚点 XML；ChartRaw：整段 chart 部件 XML。
	// Edited=true（用户改过任何属性）时两者都不再使用，按模型重建。
	AnchorRaw string `json:"anchorRaw,omitempty"`
	ChartRaw  string `json:"chartRaw,omitempty"`
	Edited    bool   `json:"edited,omitempty"`
	// HoleSize：环形图内径百分比（0-90，默认 50）
	HoleSize int `json:"holeSize,omitempty"`
	// round65：标题样式 + 位置（对齐 Excel「图表标题」格式面板；nil = 全默认）
	TitleStyle *chartTitleStyleJSON `json:"titleStyle,omitempty"`
	// round62：坐标轴全面编辑（对齐 Excel「设置坐标轴格式」）。
	// CatAxis/ValAxis 各自独立；文本空/nil = 自动（Excel 默认）。
	CatAxis chartAxisJSON `json:"catAxis,omitempty"`
	ValAxis chartAxisJSON `json:"valAxis,omitempty"`
}

// round65：图表标题样式（与前端 charts.ts TitleStyleJSON 一一对应）。
type chartTitleStyleJSON struct {
	FontSize int    `json:"fontSize,omitempty"` // pt（0 = 默认 14→140）
	Color    string `json:"color,omitempty"`    // #RRGGBB（"" = 默认 #333）
	Bold     *bool  `json:"bold,omitempty"`    // nil = 默认 true
	Italic   bool   `json:"italic,omitempty"`
	Pos      string `json:"pos,omitempty"`     // top/lt/ct/rt/l/c/r/lb/cb/rb（"" = top）
}

// chartAxisJSON：一根坐标轴的可编辑属性（类别轴/数值轴通用）。
type chartAxisJSON struct {
	// 轴标题（"" = 无；"auto" 不使用——Excel 语义就是有/无 + 文本）
	Title string `json:"title,omitempty"`
	// 数值轴刻度：min/max（nil = 自动）。类别轴忽略。
	Min *float64 `json:"min,omitempty"`
	Max *float64 `json:"max,omitempty"`
	// 主/次刻度单位（nil = 自动；0 = 隐藏该级刻度线）
	MajorUnit *float64 `json:"majorUnit,omitempty"`
	MinorUnit *float64 `json:"minorUnit,omitempty"`
	// 主要刻度线类型：none/inside/outside/cross
	MajorTick string `json:"majorTick,omitempty"`
	// 次要刻度线类型
	MinorTick string `json:"minorTick,omitempty"`
	// 轴标签位置：nextTo/high/low/none
	TickLabelPos string `json:"tickLabelPos,omitempty"`
	// 数字格式（"General"、"0.0"、"#,##0"、"0%"…；空 = General）
	NumFmt string `json:"numFmt,omitempty"`
	// 反转轴方向（scaling orientation = maxMin）
	Reverse bool `json:"reverse,omitempty"`
	// 对数刻度基数（nil = 关闭；典型 10）
	LogBase *float64 `json:"logBase,omitempty"`
	// 轴线条颜色（#RRGGBB；空 = 自动）+ 宽度（EMU→pt 由前端写 pt，Go 侧原样）
	LineColor string `json:"lineColor,omitempty"`
	LineWidth int     `json:"lineWidth,omitempty"` // pt（0 = 默认 1pt 上下）
	// 主网格线开关（round61 已有 Gridlines 总开关，round62 存细化样式）
	MajorGridlines bool `json:"majorGridlines,omitempty"`
}

// chartRelType 是 drawing 关系里的图表类型 URI。
const chartRelTypeSuffix = "/chart"

// readSheetCharts 解析一张工作表的浮动图表并追加到 sj.Charts。
func readSheetCharts(zi *zipIndex, f *excelize.File, sheetIdx int, sj *sheetJSON) {
	sheetPart := zi.part(sheetIdx, sj.Name)
	if sheetPart == "" {
		return
	}
	var draw string
	for _, r := range zi.rels(sheetPart) {
		if strings.HasSuffix(r.Type, "/drawing") {
			draw = resolvePart(sheetPart, r.Target)
			break
		}
	}
	if draw == "" {
		return
	}
	data, ok := zi.read(draw)
	if !ok {
		return
	}
	root, err := parseXMLTree(data)
	if err != nil || root == nil {
		return
	}
	rd := &picReader{zi: zi, f: f, sheet: sj.Name, draw: draw, drels: zi.rels(draw), geom: nil, resolve: makeRefResolver(f)}
	rd.walkCharts(root)
	sj.Charts = append(sj.Charts, rd.outCharts...)
}

// makeRefResolver 构造单元格引用解析器（"Sheet1!$B$2:$D$2" → 值列表）。
// excelize 写出的系列常只有引用没有缓存值，此时回退到工作表数据取值。
func makeRefResolver(f *excelize.File) func(string) []string {
	return func(ref string) []string {
		ref = strings.TrimSpace(ref)
		if ref == "" {
			return nil
		}
		i := strings.LastIndex(ref, "!")
		if i < 0 {
			return nil
		}
		sheet := strings.Trim(ref[:i], "'")
		rng := strings.ReplaceAll(ref[i+1:], "$", "")
		parts := strings.SplitN(rng, ":", 2)
		c1, r1, err := excelize.CellNameToCoordinates(parts[0])
		if err != nil {
			return nil
		}
		r2, c2 := r1, c1
		if len(parts) == 2 {
			c2, r2, err = excelize.CellNameToCoordinates(parts[1])
			if err != nil {
				return nil
			}
		}
		if (r2-r1+1)*(c2-c1+1) > 10000 {
			return nil
		}
		var out []string
		for r := r1; r <= r2; r++ {
			for c := c1; c <= c2; c++ {
				cell, _ := excelize.CoordinatesToCellName(c, r)
				v, _ := f.GetCellValue(sheet, cell)
				out = append(out, v)
			}
		}
		return out
	}
}

// walkCharts 与图片共用锚点遍历：twoCell/oneCell/absoluteAnchor 里的 graphicFrame。
func (rd *picReader) walkCharts(n *xmlNode) {
	for _, ch := range n.kids {
		switch ch.local {
		case "twoCellAnchor", "oneCellAnchor", "absoluteAnchor":
			if cj := rd.chartFromAnchor(ch); cj != nil {
				rd.outCharts = append(rd.outCharts, *cj)
			}
		case "AlternateContent":
			if c := ch.kid("Choice"); c != nil {
				rd.walkCharts(c)
			} else if fb := ch.kid("Fallback"); fb != nil {
				rd.walkCharts(fb)
			}
		}
	}
}

// chartFromAnchor 解析 graphicFrame 锚点：锚点标记 + 关系 → chart 部件 → 模型。
func (rd *picReader) chartFromAnchor(a *xmlNode) *chartJSON {
	gf := a.kid("graphicFrame")
	if gf == nil {
		return nil
	}
	gd := gf.kid("graphic").kid("graphicData")
	if gd == nil || !strings.HasSuffix(gd.attr("uri"), chartRelTypeSuffix) {
		return nil
	}
	cc := gd.kid("chart")
	if cc == nil {
		return nil
	}
	rid := cc.attr("r:id")
	if rid == "" {
		return nil
	}
	rel := findRel(rd.drels, rid)
	if rel == nil || strings.EqualFold(rel.TargetMode, "External") {
		return nil
	}
	chartPart := resolvePart(rd.draw, rel.Target)
	cdata, ok := rd.zi.read(chartPart)
	if !ok {
		return nil
	}
	cj := parseChartXML(cdata, rd.resolve)
	if cj == nil {
		return nil
	}

	// ---- 锚点与对象定位（与图片同构） ----
	cj.Mode = "moveSize"
	switch a.attr("editAs") {
	case "oneCell":
		cj.Mode = "move"
	case "absolute":
		cj.Mode = "fixed"
	}
	if from := markerOf(a.kid("from")); from != nil {
		cj.From = from
	}
	if to := markerOf(a.kid("to")); to != nil {
		cj.To = to
	}
	cj.AnchorRaw = a.raw
	return cj
}

// parseChartXML 把 c:chartSpace 解析为模型（resolve 在缓存缺失时解析单元格引用）。
func parseChartXML(data []byte, resolve func(string) []string) *chartJSON {
	root, err := parseXMLTree(data)
	if err != nil || root == nil {
		return nil
	}
	chart := root.kid("chart")
	if chart == nil {
		return nil
	}
	cj := &chartJSON{Type: "column", Legend: "r", Gridlines: true, DataLabels: "none", TitleOn: true, HoleSize: 50}

	// ---- 标题 ----
	if title := chart.kid("title"); title != nil {
		cj.Title = titleText(title)
		cj.TitleOn = true
		// 显式删除（罕见：<c:title/> + autoTitleDeleted=1）
		if atd := chart.kid("autoTitleDeleted"); atd != nil && parseBool(atd.attr("val")) {
			cj.TitleOn = false
		}
		// round65：标题样式/位置（保存往返保真）—— sz/b/i/srgbClr + manualLayout
		if ts := parseTitleStyle(title); ts != nil {
			cj.TitleStyle = ts
		}
	} else {
		cj.TitleOn = false
	}

	// ---- 图例 ----
	if legend := chart.kid("legend"); legend != nil {
		if pos := legend.kid("legendPos"); pos != nil {
			cj.Legend = pos.attr("val")
			if cj.Legend == "" {
				cj.Legend = "r"
			}
		}
	} else {
		cj.Legend = "none"
	}

	// ---- 绘图区：图表类型 + 系列 ----
	pa := chart.kid("plotArea")
	if pa == nil {
		return nil
	}
	for _, k := range pa.kids {
		var sers []*xmlNode
		switch k.local {
		case "barChart":
			dir, grouping := k.kid("barDir").attr("val"), "clustered"
			if g := k.kid("grouping"); g != nil {
				grouping = g.attr("val")
			}
			cj.Type = barChartType(dir, grouping)
			if gw := k.kid("gapWidth"); gw != nil {
				cj.GapWidth = int(attrF(gw, "val"))
			}
			if ov := k.kid("overlap"); ov != nil {
				cj.Overlap = int(attrF(ov, "val"))
			}
			sers = k.children("ser")
			cj.DataLabels = chartLevelDataLabels(k)
		case "lineChart":
			cj.Type = "line"
			sers = k.children("ser")
			for _, s := range sers {
				if m := s.kid("marker"); m != nil {
					if sym := m.kid("symbol"); sym != nil && sym.attr("val") != "none" {
						cj.Type = "lineMarker"
					}
				}
			}
			cj.DataLabels = chartLevelDataLabels(k)
		case "areaChart":
			cj.Type = "area"
			sers = k.children("ser")
			cj.DataLabels = chartLevelDataLabels(k)
		case "pieChart":
			cj.Type = "pie"
			sers = k.children("ser")
			cj.DataLabels = chartLevelDataLabels(k)
		case "doughnutChart":
			cj.Type = "doughnut"
			if hs := k.kid("holeSize"); hs != nil {
				cj.HoleSize = int(attrF(hs, "val"))
			}
			sers = k.children("ser")
			cj.DataLabels = chartLevelDataLabels(k)
		case "scatterChart":
			cj.Type = "scatter"
			sers = k.children("ser")
			cj.DataLabels = chartLevelDataLabels(k)
		default:
			continue
		}
		for _, s := range sers {
			if ser := parseChartSeries(s, cj.Type, resolve); ser != nil {
				cj.Series = append(cj.Series, *ser)
			}
		}
		// 只取第一组图表（组合图 round61 不建模，靠 raw 透传）
		if len(sers) > 0 {
			break
		}
	}

	// ---- 坐标轴：round62 全面解析（类别轴 + 数值轴；散点图 x 轴也是 valAx） ----
	// 兼容 round61 的 Gridlines 总开关：取第一根未删除轴的 majorGridlines。
	for _, ax := range pa.children("valAx") {
		if ax.kid("delete") != nil && parseBool(ax.kid("delete").attr("val")) {
			continue
		}
		cj.Gridlines = ax.kid("majorGridlines") != nil
		break
	}
	// 数值轴 = 第一根 valAx（y 轴）；散点图第二根 valAx 是 x 轴（round62 仍建模为 catAxis 位置）
	valAxes := pa.children("valAx")
	if len(valAxes) > 0 {
		cj.ValAxis = parseAxis(valAxes[0])
	}
	// 类别轴 = catAx；散点图没有 catAx，x 轴取第二根 valAx
	catAxes := pa.children("catAx")
	if len(catAxes) > 0 {
		cj.CatAxis = parseAxis(catAxes[0])
	} else if len(valAxes) > 1 && cj.Type == "scatter" {
		// 散点 x 轴：数值轴但按类别轴编辑语义（轴标题/刻度线/格式）
		cj.CatAxis = parseAxis(valAxes[1])
	}

	cj.ChartRaw = string(data)
	return cj
}

func barChartType(dir, grouping string) string {
	if dir == "bar" {
		switch grouping {
		case "stacked":
			return "barStacked"
		case "percentStacked":
			return "barStacked100"
		}
		return "bar"
	}
	switch grouping {
	case "stacked":
		return "columnStacked"
	case "percentStacked":
		return "columnStacked100"
	}
	return "column"
}

// chartLevelDataLabels 读取图表级数据标签（位置）。
func chartLevelDataLabels(chartNode *xmlNode) string {
	dl := chartNode.kid("dLbls")
	if dl == nil {
		return "none"
	}
	if sv := dl.kid("showVal"); sv != nil && !parseBool(sv.attr("val")) {
		return "none"
	}
	if p := dl.kid("dLblPos"); p != nil {
		v := p.attr("val")
		switch v {
		case "ctr", "inEnd", "outEnd", "inBase", "bestFit", "l", "r", "t", "b":
			return v
		}
	}
	return "ctr"
}

// parseChartSeries 解析 <c:ser>：名称/类别/数值（缓存优先，缺失回退到单元格引用），
// 散点图取 xVal/yVal。
func parseChartSeries(s *xmlNode, chartType string, resolve func(string) []string) *chartSeriesJSON {
	ser := &chartSeriesJSON{}
	// 系列名：c:tx/c:strRef（f + 缓存）
	if tx := s.kid("tx"); tx != nil {
		if ref := tx.kid("strRef"); ref != nil {
			ser.NameRef = refText(ref, "f")
			ser.Name = refText(ref, "strCache")
		}
	}
	// 缓存缺失（excelize 生成的文件只有引用）→ 从工作表取值
	if ser.Name == "" && ser.NameRef != "" && resolve != nil {
		if vals := resolve(ser.NameRef); len(vals) > 0 {
			ser.Name = vals[0]
		}
	}
	// 系列颜色：c:spPr/a:solidFill/a:srgbClr
	if sp := s.kid("spPr"); sp != nil {
		if fill := sp.kid("solidFill"); fill != nil {
			if c := fill.kid("srgbClr"); c != nil {
				ser.Color = "#" + hex6(c.attr("val"))
			}
		}
	}
	if chartType == "scatter" {
		xv, xref := cachedNums(s.kid("xVal"))
		ser.CatsRef = xref
		for _, v := range xv {
			ser.Cats = append(ser.Cats, formatChartNum(v))
		}
		if ser.Cats == nil && ser.CatsRef != "" && resolve != nil {
			ser.Cats = resolve(ser.CatsRef)
		}
		ser.Values, ser.ValuesRef = cachedNums(s.kid("yVal"))
		if ser.Values == nil && ser.ValuesRef != "" && resolve != nil {
			ser.Values = parseFloats(resolve(ser.ValuesRef))
		}
	} else {
		ser.Values, ser.ValuesRef = cachedNums(s.kid("val"))
		if ser.Values == nil && ser.ValuesRef != "" && resolve != nil {
			ser.Values = parseFloats(resolve(ser.ValuesRef))
		}
		if cat := s.kid("cat"); cat != nil {
			ser.Cats, ser.CatsRef = cachedCats(cat)
		}
		if ser.Cats == nil && ser.CatsRef != "" && resolve != nil {
			ser.Cats = resolve(ser.CatsRef)
		}
	}
	if ser.Values == nil && ser.Name == "" && len(ser.Cats) == 0 {
		return nil
	}
	return ser
}

// parseFloats 把字符串值解析为数值（非数值记 NaN）。
func parseFloats(vals []string) []float64 {
	if vals == nil {
		return nil
	}
	out := make([]float64, len(vals))
	for i, v := range vals {
		f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
		if err != nil {
			f = math.NaN()
		}
		out[i] = f
	}
	return out
}

// parseAxis 把一根 c:catAx/c:valAx 解析为可编辑轴属性（round62）。
func parseAxis(ax *xmlNode) chartAxisJSON {
	var a chartAxisJSON
	if ax == nil {
		return a
	}
	// 轴标题：c:title 富文本
	if title := ax.kid("title"); title != nil {
		a.Title = titleText(title)
	}
	// scaling：min/max/orientation/logBase
	if sc := ax.kid("scaling"); sc != nil {
		if m := sc.kid("min"); m != nil {
			if v, err := strconv.ParseFloat(strings.TrimSpace(m.attr("val")), 64); err == nil {
				a.Min = &v
			}
		}
		if m := sc.kid("max"); m != nil {
			if v, err := strconv.ParseFloat(strings.TrimSpace(m.attr("val")), 64); err == nil {
				a.Max = &v
			}
		}
		if o := sc.kid("orientation"); o != nil && o.attr("val") == "maxMin" {
			a.Reverse = true
		}
		if lb := sc.kid("logBase"); lb != nil {
			if v, err := strconv.ParseFloat(strings.TrimSpace(lb.attr("val")), 64); err == nil && v > 0 {
				a.LogBase = &v
			}
		}
	}
	if ax.kid("delete") != nil && parseBool(ax.kid("delete").attr("val")) {
		a.TickLabelPos = "none" // delete=1 → 轴隐藏（映射为标签 none + 后端写 delete）
	}
	// 主要/次要刻度线类型
	if m := ax.kid("majorTickMark"); m != nil {
		a.MajorTick = m.attr("val")
	}
	if m := ax.kid("minorTickMark"); m != nil {
		a.MinorTick = m.attr("val")
	}
	// 轴标签位置
	if m := ax.kid("tickLblPos"); m != nil {
		v := m.attr("val")
		if v != "" && v != "nextTo" {
			a.TickLabelPos = v
		}
	}
	// 数字格式
	if nf := ax.kid("numFmt"); nf != nil && !parseBool(nf.attr("sourceLinked")) {
		a.NumFmt = nf.attr("formatCode")
	}
	// 主刻度单位（valAx 专用）
	if u := ax.kid("majorUnit"); u != nil {
		if v, err := strconv.ParseFloat(strings.TrimSpace(u.attr("val")), 64); err == nil && v > 0 {
			a.MajorUnit = &v
		}
	}
	if u := ax.kid("minorUnit"); u != nil {
		if v, err := strconv.ParseFloat(strings.TrimSpace(u.attr("val")), 64); err == nil && v > 0 {
			a.MinorUnit = &v
		}
	}
	// 网格线开关 + 样式
	if g := ax.kid("majorGridlines"); g != nil {
		a.MajorGridlines = true
		// 网格线颜色（spPr/ln/solidFill/srgbClr）
		if ln := g.kid("spPr").kid("ln"); ln != nil {
			if c := ln.kid("solidFill").kid("srgbClr"); c != nil {
				a.LineColor = "#" + hex6(c.attr("val"))
			}
			if w, err := strconv.ParseFloat(strings.TrimSpace(ln.attr("w")), 64); err == nil {
				a.LineWidth = int(math.Round(w / 12700)) // EMU → pt
			}
		}
	}
	// 轴线条颜色/宽度（spPr/ln）
	if ln := ax.kid("spPr").kid("ln"); ln != nil {
		if c := ln.kid("solidFill").kid("srgbClr"); c != nil && a.LineColor == "" {
			a.LineColor = "#" + hex6(c.attr("val"))
		}
		if a.LineWidth == 0 {
			if w, err := strconv.ParseFloat(strings.TrimSpace(ln.attr("w")), 64); err == nil {
				a.LineWidth = int(math.Round(w / 12700))
			}
		}
	}
	return a
}

// formatChartNum 数值 → 显示字符串（去多余尾零）。
func formatChartNum(v float64) string {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return ""
	}
	return strconv.FormatFloat(v, 'g', -1, 64)
}

// refText 读取 strRef 下的 f（引用）或 strCache（首个缓存值）。
// 全程 nil 防护：f/pt/v 元素缺失时返回空（Excel 侧引用与缓存都可选）。
func refText(ref *xmlNode, want string) string {
	if ref == nil {
		return ""
	}
	if want == "f" {
		if f := ref.kid("f"); f != nil {
			return strings.TrimSpace(f.text)
		}
		return ""
	}
	if cache := ref.kid("strCache"); cache != nil {
		for _, pt := range cache.children("pt") {
			if v := pt.kid("v"); v != nil {
				return strings.TrimSpace(v.text)
			}
		}
	}
	return ""
}

// cachedNums 读取 numRef：返回缓存数值数组 + 引用。
func cachedNums(valNode *xmlNode) ([]float64, string) {
	if valNode == nil {
		return nil, ""
	}
	ref := valNode.kid("numRef")
	if ref == nil {
		return nil, ""
	}
	var f string
	if node := ref.kid("f"); node != nil {
		f = strings.TrimSpace(node.text)
	}
	if cache := ref.kid("numCache"); cache != nil {
		var out []float64
		for _, pt := range cache.children("pt") {
			if v, err := strconv.ParseFloat(strings.TrimSpace(pt.kid("v").text), 64); err == nil {
				out = append(out, v)
			} else {
				out = append(out, math.NaN())
			}
		}
		return out, f
	}
	return nil, f
}

// cachedCats 读取类别（strRef→字符串 / numRef→数值，统一转显示字符串）。
func cachedCats(cat *xmlNode) ([]string, string) {
	if cat == nil {
		return nil, ""
	}
	if ref := cat.kid("strRef"); ref != nil {
		var f string
		if node := ref.kid("f"); node != nil {
			f = strings.TrimSpace(node.text)
		}
		var out []string
		if cache := ref.kid("strCache"); cache != nil {
			for _, pt := range cache.children("pt") {
				if v := pt.kid("v"); v != nil {
					out = append(out, strings.TrimSpace(v.text))
				}
			}
		}
		return out, f
	}
	if ref := cat.kid("numRef"); ref != nil {
		var f string
		if node := ref.kid("f"); node != nil {
			f = strings.TrimSpace(node.text)
		}
		var out []string
		if cache := ref.kid("numCache"); cache != nil {
			for _, pt := range cache.children("pt") {
				if v := pt.kid("v"); v != nil {
					out = append(out, strings.TrimSpace(v.text))
				}
			}
		}
		return out, f
	}
	return nil, ""
}

// titleText 拼接标题富文本（a:t 片段）。
func titleText(title *xmlNode) string {
	var b strings.Builder
	for _, t := range allDescendants(title, "t") {
		b.WriteString(t.text)
	}
	return strings.TrimSpace(b.String())
}

// parseTitleStyle 解析标题样式（round65：保存往返保真）。
// sz（centipoint）/ b / i / solidFill srgbClr + manualLayout x/y → 9 宫格 pos。
// 全默认时返回 nil（写出侧省略 titleStyle 字段）。
func parseTitleStyle(title *xmlNode) *chartTitleStyleJSON {
	ts := &chartTitleStyleJSON{}
	// 富文本 rPr：sz / b / i / solidFill
	for _, rpr := range allDescendants(title, "rPr") {
		if v := rpr.attr("sz"); v != "" {
			if n := parseIntDefault(v, 0); n > 0 {
				ts.FontSize = n / 100
			}
		}
		if v := rpr.attr("b"); v != "" && parseBool(v) {
			f := true
			ts.Bold = &f
		} else if v := rpr.attr("b"); v != "" && !parseBool(v) {
			f := false
			ts.Bold = &f
		}
		if v := rpr.attr("i"); v != "" && parseBool(v) {
			ts.Italic = true
		}
		for _, clr := range allDescendants(rpr, "srgbClr") {
			ts.Color = "#" + clr.attr("val")
			break
		}
		break // 首个 run 的样式（写侧单 run）
	}
	// manualLayout → 9 宫格
	if ml := firstDescendant(title, "manualLayout"); ml != nil {
		x, y := attrF(ml, "x"), attrF(ml, "y")
		var col, row int // 0=左 1=中 2=右；0=上 1=中 2=下
		switch {
		case x < 0.2:
			col = 0
		case x < 0.6:
			col = 1
		default:
			col = 2
		}
		switch {
		case y < 0.2:
			row = 0
		case y < 0.7:
			row = 1
		default:
			row = 2
		}
		pos := [3][3]string{{"lt", "ct", "rt"}, {"l", "c", "r"}, {"lb", "cb", "rb"}}[row][col]
		ts.Pos = pos
	}
	// 全默认 → nil
	if ts.FontSize == 0 && ts.Color == "" && ts.Italic == false && ts.Bold == nil && ts.Pos == "" {
		return nil
	}
	return ts
}

// parseIntDefault：十进制整数解析失败给默认值。
func parseIntDefault(s string, def int) int {
	n := 0
	ok := false
	for _, c := range s {
		if c < '0' || c > '9' {
			ok = false
			break
		}
		n = n*10 + int(c-'0')
		ok = true
	}
	if !ok || s == "" {
		return def
	}
	return n
}

// firstDescendant：首个指定名后代（深度优先）。
func firstDescendant(n *xmlNode, local string) *xmlNode {
	for _, c := range n.kids {
		if c.local == local {
			return c
		}
		if r := firstDescendant(c, local); r != nil {
			return r
		}
	}
	return nil
}

// allDescendants 深度优先收集指定局部名的全部后代。
func allDescendants(n *xmlNode, local string) []*xmlNode {
	if n == nil {
		return nil
	}
	var out []*xmlNode
	for _, k := range n.kids {
		if k.local == local {
			out = append(out, k)
		}
		out = append(out, allDescendants(k, local)...)
	}
	return out
}
