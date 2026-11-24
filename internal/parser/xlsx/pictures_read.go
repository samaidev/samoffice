package xlsx

// pictures_read.go —— 浮动图片读取：workbook → sheet rels → drawing → media 的完整链路。
// 支持普通 twoCellAnchor / oneCellAnchor / absoluteAnchor、组合 (grpSp) 中的图片、
// mc:AlternateContent 包装，以及 Excel 2010+ 的 a14:imgProps 效果。

import (
	"encoding/base64"
	"math"
	"strconv"
	"strings"

	"github.com/zai/samoffice/internal/excelizelite"
)

// affine：二维仿射变换（SVG 记法），x' = a·x + c·y + e；y' = b·x + d·y + f。
type affine struct{ a, b, c, d, e, f float64 }

func identAffine() affine { return affine{1, 0, 0, 1, 0, 0} }

// then 返回“先应用 c 再应用 p”的复合变换。
func (p affine) then(c affine) affine {
	return affine{
		a: p.a*c.a + p.c*c.b, b: p.b*c.a + p.d*c.b,
		c: p.a*c.c + p.c*c.d, d: p.b*c.c + p.d*c.d,
		e: p.a*c.e + p.c*c.f + p.e, f: p.b*c.e + p.d*c.f + p.f,
	}
}

type pt struct{ x, y float64 }

func (m affine) apply(p pt) pt {
	return pt{x: m.a*p.x + m.c*p.y + m.e, y: m.b*p.x + m.d*p.y + m.f}
}

// groupAffine 从 grpSpPr/xfrm（off/ext/chOff/chExt，EMU）构造组变换。
func groupAffine(x *xmlNode) affine {
	id := identAffine()
	off, ext := x.kid("off"), x.kid("ext")
	chOff, chExt := x.kid("chOff"), x.kid("chExt")
	if off == nil || ext == nil {
		return id
	}
	cw, ch := attrF(ext, "cx"), attrF(ext, "cy")
	kw, kh := cw, ch
	if chExt != nil {
		if v := attrF(chExt, "cx"); v != 0 {
			kw = v
		}
		if v := attrF(chExt, "cy"); v != 0 {
			kh = v
		}
	}
	m := affine{
		a: cw / kw, d: ch / kh,
		e: attrF(off, "x"), f: attrF(off, "y"),
	}
	if chOff != nil {
		m.e -= m.a * attrF(chOff, "x")
		m.f -= m.d * attrF(chOff, "y")
	}
	return m
}

func attrF(n *xmlNode, name string) float64 {
	v, err := strconv.ParseFloat(strings.TrimSpace(n.attr(name)), 64)
	if err != nil {
		return 0
	}
	return v
}

// ---------------------------------------------------------------------------
// 工作表几何：把单元格锚点与真实像素坐标互相换算（列宽 chars→px、行高 pt→px）。
// 仅在需要换算时使用（组合内图片、旧字段尺寸）；普通锚点直接保留标记值。
// ---------------------------------------------------------------------------

type sheetGeom struct {
	f     *excelize.File
	sheet string
	cols  map[int]float64
	rows  map[int]float64
}

func newSheetGeom(f *excelize.File, sheet string) *sheetGeom {
	return &sheetGeom{f: f, sheet: sheet, cols: map[int]float64{}, rows: map[int]float64{}}
}

func (g *sheetGeom) colW(c int) float64 {
	if v, ok := g.cols[c]; ok {
		return v
	}
	w := 8.43
	if name, err := excelize.ColumnNumberToName(c + 1); err == nil {
		if v, err := g.f.GetColWidth(g.sheet, name); err == nil && v > 0 {
			w = v
		}
	}
	px := math.Floor((256*w+18)/256*7) + 5
	if px < 2 {
		px = 2
	}
	g.cols[c] = px
	return px
}

func (g *sheetGeom) rowH(r int) float64 {
	if v, ok := g.rows[r]; ok {
		return v
	}
	h := 15.0
	if v, err := g.f.GetRowHeight(g.sheet, r+1); err == nil && v > 0 {
		h = v
	}
	px := math.Round(h * 4 / 3)
	g.rows[r] = px
	return px
}

func (g *sheetGeom) colLeft(c int) float64 {
	x := 0.0
	for i := 0; i < c; i++ {
		x += g.colW(i)
	}
	return x
}

func (g *sheetGeom) rowTop(r int) float64 {
	y := 0.0
	for i := 0; i < r; i++ {
		y += g.rowH(i)
	}
	return y
}

// anchorAt 把工作表坐标 px 换算为单元格锚点。
func (g *sheetGeom) anchorAt(x, y float64) picPointJSON {
	c, dx := 0, x
	for {
		w := g.colW(c)
		if dx < w || c > 16383 {
			break
		}
		dx -= w
		c++
	}
	r, dy := 0, y
	for {
		h := g.rowH(r)
		if dy < h || r > 1048575 {
			break
		}
		dy -= h
		r++
	}
	return picPointJSON{Col: c, Row: r, Dx: math.Round(dx*10) / 10, Dy: math.Round(dy*10) / 10}
}

func (g *sheetGeom) ptOf(m picPointJSON) pt {
	return pt{x: g.colLeft(m.Col) + m.Dx, y: g.rowTop(m.Row) + m.Dy}
}

// ---------------------------------------------------------------------------
// 读取器主体
// ---------------------------------------------------------------------------

type picReader struct {
	zi    *zipIndex
	f     *excelize.File
	// resolve：单元格引用 → 值列表（图表系列缓存缺失时回退取数）
	resolve func(string) []string
	sheet string
	theme map[string]string
	draw  string
	drels []xmlRel
	geom  *sheetGeom
	out   []imageJSON
	// round61：图表（与图片共用 drawing 关系/几何辅助）
	outCharts []chartJSON
}

// readSheetPictures 解析一张工作表的浮动图片并追加到 sj.Images。
func readSheetPictures(zi *zipIndex, f *excelize.File, sheetIdx int, sj *sheetJSON) {
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
	rd := &picReader{
		zi: zi, f: f, sheet: sj.Name, theme: themeOf(f),
		draw: draw, drels: zi.rels(draw), geom: newSheetGeom(f, sj.Name),
	}
	rd.walk(root, identAffine(), false)
	sj.Images = append(sj.Images, rd.out...)
}

// readRowHeights 从工作表原始 XML 读取自定义行高（row/@ht，pt→px）。
// 行高必须随行持久化，否则浮动图片的两单元格锚点在前端无法按原样还原。
// 直接解析行 XML（O(一次)），避免 GetRowHeight 的 O(行数) 逐行扫描。
func readRowHeights(zi *zipIndex, sheetIdx int, sj *sheetJSON) {
	sheetPart := zi.part(sheetIdx, sj.Name)
	if sheetPart == "" {
		return
	}
	data, ok := zi.read(sheetPart)
	if !ok {
		return
	}
	root, err := parseXMLTree(data)
	if err != nil || root == nil {
		return
	}
	def := -1.0
	if pr := root.kid("sheetFormatPr"); pr != nil {
		def = attrF(pr, "defaultRowHeight")
	}
	// 行高只保留数据区/图片锚区附近（+ 余量）的自定义行，避免大表快照膨胀
	maxR := sj.Rows + 1
	for _, im := range sj.Images {
		for _, m := range []*picPointJSON{im.From, im.To} {
			if m != nil && m.Row+1 > maxR {
				maxR = m.Row + 1
			}
		}
	}
	sd := root.kid("sheetData")
	if sd == nil {
		return
	}
	out := map[string]float64{}
	for _, rw := range sd.kids {
		if rw.local != "row" {
			continue
		}
		r := int(attrF(rw, "r")) - 1
		if r < 0 || r > maxR {
			continue
		}
		ht := attrF(rw, "ht")
		if ht <= 0 {
			continue
		}
		// 与表默认一致的行不写（保持快照简洁，与列宽做法一致）
		if def > 0 && math.Abs(ht-def) < 0.01 {
			continue
		}
		px := math.Round(ht * 4 / 3)
		if px < 5 || px > 2000 {
			continue
		}
		out[strconv.Itoa(r)] = px
	}
	if len(out) > 0 {
		sj.RowHeights = out
	}
}

func (rd *picReader) walk(n *xmlNode, xf affine, grouped bool) {
	for _, ch := range n.kids {
		switch ch.local {
		case "twoCellAnchor", "oneCellAnchor", "absoluteAnchor":
			// 锚点内容：直接图片（标记定位）或组合（组合内图片用子坐标空间换算）
			if im := rd.pic(ch); im != nil {
				rd.out = append(rd.out, *im)
			}
			rd.walk(ch, xf, grouped)
		case "grpSp":
			gx := identAffine()
			if g := ch.kid("grpSpPr"); g != nil {
				if x := g.kid("xfrm"); x != nil {
					gx = groupAffine(x)
				}
			}
			rd.walk(ch, xf.then(gx), true)
		case "pic":
			// 组合内的图片：无锚点，位置与尺寸来自 spPr/xfrm 的 off/ext（子坐标空间 EMU）
			if grouped {
				if im := rd.picFromGroup(ch, xf); im != nil {
					rd.out = append(rd.out, *im)
				}
			}
		case "AlternateContent":
			if c := ch.kid("Choice"); c != nil {
				rd.walk(c, xf, grouped)
			} else if fb := ch.kid("Fallback"); fb != nil {
				rd.walk(fb, xf, grouped)
			}
		}
	}
}

func markerOf(n *xmlNode) *picPointJSON {
	if n == nil {
		return nil
	}
	return &picPointJSON{
		Col: int(nodeInt(n.kid("col"))),
		Row: int(nodeInt(n.kid("row"))),
		Dx:  float64(nodeInt(n.kid("colOff"))) / emuPerPx,
		Dy:  float64(nodeInt(n.kid("rowOff"))) / emuPerPx,
	}
}

// pic 解析一个锚点（twoCellAnchor / oneCellAnchor / absoluteAnchor）里的图片。
func (rd *picReader) pic(a *xmlNode) *imageJSON {
	pc := a.kid("pic")
	if pc == nil {
		return nil
	}
	im := rd.newPic(pc)
	if im == nil {
		return nil
	}

	// ---- 锚点与对象定位 ----
	im.Mode = "moveSize"
	switch a.attr("editAs") {
	case "oneCell":
		im.Mode = "move"
	case "absolute":
		im.Mode = "fixed"
	}
	var p0, p1 pt
	var fromMarker, toMarker *picPointJSON
	switch a.local {
	case "absoluteAnchor":
		pos := a.kid("pos")
		if pos == nil {
			return nil
		}
		p0 = pt{x: attrF(pos, "x") / emuPerPx, y: attrF(pos, "y") / emuPerPx}
		p1 = p0.add(sizePt(a.kid("ext")))
		im.Mode = "fixed"
	case "oneCellAnchor":
		fromMarker = markerOf(a.kid("from"))
		if fromMarker == nil {
			return nil
		}
		p0 = rd.geom.ptOf(*fromMarker)
		p1 = p0.add(sizePt(a.kid("ext")))
		im.Mode = "move"
	default: // twoCellAnchor
		fromMarker = markerOf(a.kid("from"))
		toMarker = markerOf(a.kid("to"))
		if fromMarker == nil || toMarker == nil {
			return nil
		}
		p0 = rd.geom.ptOf(*fromMarker)
		p1 = rd.geom.ptOf(*toMarker)
	}
	if p1.x < p0.x || p1.y < p0.y {
		// 反向锚点（压缩或异常）：以较小角为 from
		if p1.x < p0.x {
			p0.x, p1.x = p1.x, p0.x
		}
		if p1.y < p0.y {
			p0.y, p1.y = p1.y, p0.y
		}
		fromMarker, toMarker = nil, nil
	}
	if fromMarker == nil {
		f, t := rd.geom.anchorAt(p0.x, p0.y), rd.geom.anchorAt(p1.x, p1.y)
		im.From, im.To = &f, &t
	} else {
		f, t := *fromMarker, *toMarker
		im.From, im.To = &f, &t
	}
	rd.finishGeom(im, p0, p1)

	// ---- clientData：随工作表锁定 / 打印对象 ----
	if cd := a.kid("clientData"); cd != nil {
		if v := cd.attr("fLocksWithSheet"); v != "" {
			b := parseBool(v)
			im.Locked = &b
		}
		if v := cd.attr("fPrintsWithSheet"); v != "" {
			b := parseBool(v)
			im.PrintObj = &b
		}
	}

	im.Raw = a.raw
	return im
}

// picFromGroup 解析组合 (grpSp) 里的图片：位置与尺寸来自 pic/spPr/xfrm 的 off/ext
// （子坐标空间 EMU），经组变换（off/ext/chOff/chExt）换算为工作表坐标后重新锚定。
func (rd *picReader) picFromGroup(pc *xmlNode, xf affine) *imageJSON {
	im := rd.newPic(pc)
	if im == nil {
		return nil
	}
	x := pc.kid("spPr").kid("xfrm")
	off, ext := x.kid("off"), x.kid("ext")
	if off == nil || ext == nil {
		return nil
	}
	x0, y0 := attrF(off, "x"), attrF(off, "y")
	p0 := xf.apply(pt{x0, y0})
	p1 := xf.apply(pt{x0 + attrF(ext, "cx"), y0 + attrF(ext, "cy")})
	if p1.x < p0.x || p1.y < p0.y {
		if p1.x < p0.x {
			p0.x, p1.x = p1.x, p0.x
		}
		if p1.y < p0.y {
			p0.y, p1.y = p1.y, p0.y
		}
	}
	p0.x, p0.y = p0.x/emuPerPx, p0.y/emuPerPx
	p1.x, p1.y = p1.x/emuPerPx, p1.y/emuPerPx
	f, t := rd.geom.anchorAt(p0.x, p0.y), rd.geom.anchorAt(p1.x, p1.y)
	im.From, im.To = &f, &t
	rd.finishGeom(im, p0, p1)
	return im
}

// finishGeom 由左上/右下角坐标填充尺寸与兼容字段。
func (rd *picReader) finishGeom(im *imageJSON, p0, p1 pt) {
	w, h := p1.x-p0.x, p1.y-p0.y
	im.Width, im.Height = int(math.Round(w)), int(math.Round(h))
	if im.From != nil {
		im.Row, im.Col = im.From.Row, im.From.Col
	}
	if im.Mode != "moveSize" {
		s := picSizeJSON{W: w, H: h}
		im.Size = &s
	}
	if im.Mode == "fixed" {
		im.Abs = &picPosJSON{X: p0.x, Y: p0.y}
	}
}

// newPic 解析 <xdr:pic> 的媒体与外观（不含锚点），失败返回 nil。
func (rd *picReader) newPic(pc *xmlNode) *imageJSON {
	bf := pc.kid("blipFill")
	if bf == nil {
		return nil
	}
	blip := bf.kid("blip")
	if blip == nil || blip.attr("r:embed") == "" {
		return nil
	}
	rel := findRel(rd.drels, blip.attr("r:embed"))
	if rel == nil || strings.EqualFold(rel.TargetMode, "External") {
		return nil
	}
	media := resolvePart(rd.draw, rel.Target)
	raw, ok := rd.zi.read(media)
	if !ok || len(raw) == 0 {
		return nil
	}
	im := &imageJSON{
		Base64: base64.StdEncoding.EncodeToString(raw),
		Ext:    mediaExt(media, raw),
		Mode:   "moveSize",
	}

	// ---- nvPicPr：名称 / 可选文字 / 隐藏 / 锁定纵横比 ----
	if nv := pc.kid("nvPicPr"); nv != nil {
		if p := nv.kid("cNvPr"); p != nil {
			im.Name = p.attr("name")
			im.Alt = p.attr("descr")
			if im.Alt == "" {
				im.Alt = p.attr("title")
			}
			im.Hidden = parseBool(p.attr("hidden"))
		}
		if locks := nv.kid("cNvPicPr").kid("picLocks"); locks != nil {
			im.LockAspect = parseBool(locks.attr("noChangeAspect"))
		}
	}

	// ---- blipFill：裁剪 / 颜色校正 / SVG 矢量部件 ----
	im.RawBlipFill = bf.raw
	im.SrcRel = blip.attr("r:embed")
	if sr := bf.kid("srcRect"); sr != nil {
		im.Crop = &picCropJSON{L: pct(sr.attr("l")), T: pct(sr.attr("t")), R: pct(sr.attr("r")), B: pct(sr.attr("b"))}
	}
	rd.readBlipColor(blip, im)
	if extLst := blip.kid("extLst"); extLst != nil {
		for _, ext := range extLst.kids {
			if svg := ext.desc("svgBlip"); svg != nil && svg.attr("r:embed") != "" {
				if srel := findRel(rd.drels, svg.attr("r:embed")); srel != nil && !strings.EqualFold(srel.TargetMode, "External") {
					if sdata, ok := rd.zi.read(resolvePart(rd.draw, srel.Target)); ok && len(sdata) > 0 {
						im.SVG = base64.StdEncoding.EncodeToString(sdata)
						im.SVGRel = svg.attr("r:embed")
					}
				}
			}
		}
	}

	// ---- spPr：旋转/翻转 / 几何 / 填充 / 边框 / 效果 / 三维 ----
	rd.readSpPr(pc, im)

	// ---- pic 级 extLst（Excel 2010+ 把图片效果放在 a14:imgProps）----
	if e := pc.kid("extLst"); e != nil {
		im.RawPicExt = e.raw
		rd.readA14(e, im)
	}
	return im
}

func (p pt) add(s pt) pt { return pt{x: p.x + s.x, y: p.y + s.y} }

// sizePt 读取 <xdr:ext>/<a:ext cx cy> 为 px。
func sizePt(n *xmlNode) pt {
	if n == nil {
		return pt{}
	}
	return pt{x: attrF(n, "cx") / emuPerPx, y: attrF(n, "cy") / emuPerPx}
}

func findRel(rels []xmlRel, id string) *xmlRel {
	for i := range rels {
		if rels[i].ID == id {
			return &rels[i]
		}
	}
	return nil
}

// readBlipColor 把 a:blip 的颜色变换解析为模型字段（仅用于展示与编辑时的初值）。
func (rd *picReader) readBlipColor(blip *xmlNode, im *imageJSON) {
	c := &picColorJSON{}
	any := false
	for _, k := range blip.kids {
		switch k.local {
		case "alphaModFix":
			c.Transparency = 1 - clamp01(pct(k.attr("amt")))
			any = true
		case "lum":
			c.Brightness = pct(k.attr("bright"))
			c.Contrast = pct(k.attr("contrast"))
			any = true
		case "satMod":
			c.Saturation = pct(k.attr("val")) - 1
			any = true
		case "grayscl":
			c.Grayscale = true
			any = true
		case "duotone":
			if len(k.kids) >= 2 {
				c1, _ := rd.dmlColor(k.kids[0])
				c2, _ := rd.dmlColor(k.kids[1])
				c.Duotone = []string{c1, c2}
				any = true
			}
		case "clrChange":
			if len(k.kids) >= 1 {
				// 第一个颜色带 alpha=0，即被设为透明的颜色
				if hex, _ := rd.dmlColor(k.kids[0]); hex != "" {
					c.Transparent = hex
					any = true
				}
			}
		}
	}
	if any {
		im.Color = c
	}
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func (rd *picReader) readSpPr(pc *xmlNode, im *imageJSON) {
	sp := pc.kid("spPr")
	if sp == nil {
		return
	}
	for _, k := range sp.kids {
		switch k.local {
		case "xfrm":
			im.Rot = math.Mod(angle(k.attr("rot"))+360, 360)
			im.FlipH = parseBool(k.attr("flipH"))
			im.FlipV = parseBool(k.attr("flipV"))
		case "prstGeom":
			im.Geom = k.attr("prst")
			im.RawGeom = k.raw
		case "custGeom":
			im.Geom = "custGeom"
			im.RawGeom = k.raw
		case "noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill":
			im.RawFill = k.raw
		case "ln":
			rd.readLine(k, im)
		case "effectLst":
			rd.readEffectList(k, im)
			im.RawFx = k.raw
		case "scene3d":
			rd.readScene3d(k, im)
			im.RawScene += k.raw
		case "sp3d":
			rd.readSp3d(k, im)
			im.RawScene += k.raw
		case "extLst":
			im.RawSpExt = k.raw
		}
	}
}

// readLine 解析图片边框：常见情形（无边框 / 纯色 + 宽度 + 虚线）进模型，
// 其余（渐变、复合线型、箭头）保留 RawLn。
func (rd *picReader) readLine(ln *xmlNode, im *imageJSON) {
	im.RawLn = ln.raw
	lj := &picLineJSON{Alpha: 1}
	w := attrF(ln, "w")
	if w > 0 {
		lj.W = w / 12700 // EMU → pt
	}
	var fill *xmlNode
	for _, k := range ln.kids {
		switch k.local {
		case "noFill", "solidFill", "gradFill", "pattFill":
			fill = k
		case "prstDash":
			lj.Dash = k.attr("val")
		case "custDash", "headEnd", "tailEnd":
			// 复杂线型：不进模型，保留原始 XML
			return
		}
	}
	switch {
	case fill == nil || fill.local == "noFill":
		im.Ln = nil
	case fill.local == "solidFill":
		if c := fill.kid("srgbClr"); c != nil {
			hex, alpha := rd.dmlColor(c)
			lj.Color, lj.Alpha = hex, alpha
			im.Ln = lj
		} else if len(fill.kids) > 0 {
			hex, alpha := rd.dmlColor(fill.kids[0])
			lj.Color, lj.Alpha = hex, alpha
			im.Ln = lj
		} else {
			return
		}
	default:
		return // 渐变等：保留原始 XML
	}
	// 颜色修饰（alpha/lumMod 等）在子节点里，dmlColor 已处理
}

func (rd *picReader) readEffectList(e *xmlNode, im *imageJSON) {
	for _, k := range e.kids {
		switch k.local {
		case "outerShdw", "innerShdw":
			sh := &picShadowJSON{Alpha: 1}
			if k.local == "innerShdw" {
				sh.Kind = "inner"
			} else {
				sh.Kind = "outer"
			}
			sh.Blur = attrF(k, "blurRad") / emuPerPx
			sh.Dist = attrF(k, "dist") / emuPerPx
			sh.Dir = angle(k.attr("dir"))
			if len(k.kids) > 0 {
				sh.Color, sh.Alpha = rd.dmlColor(k.kids[0])
				if sh.Alpha >= 1 {
					sh.Alpha = 0.4 // 无 alpha 时 DrawingML 默认不透明，但阴影视觉过深
				}
			} else {
				sh.Color = "#000000"
				sh.Alpha = 0.4
			}
			im.Shadow = sh
		case "glow":
			gl := &picGlowJSON{Alpha: 1}
			gl.Size = attrF(k, "rad") / emuPerPx
			if len(k.kids) > 0 {
				gl.Color, gl.Alpha = rd.dmlColor(k.kids[0])
			} else {
				gl.Color = "#000000"
			}
			im.Glow = gl
		case "softEdge":
			im.SoftEdge = attrF(k, "rad") / emuPerPx
		case "reflection":
			// 映像强度用起始透明度近似
			st := pct(k.attr("stA"))
			if st <= 0 {
				st = 0.5
			}
			im.Reflection = clamp01(st)
		}
	}
}

func (rd *picReader) readScene3d(s *xmlNode, im *imageJSON) {
	if cam := s.kid("camera"); cam != nil {
		im.Cam = cam.attr("prst")
		im.CamFov = pct(cam.attr("fov"))
		if r := cam.kid("rot"); r != nil {
			im.CamLat = angle(r.attr("lat"))
			im.CamLon = angle(r.attr("lon"))
			im.CamRev = angle(r.attr("rev"))
		}
	}
	if lr := s.kid("lightRig"); lr != nil {
		im.LightRig = lr.attr("rig")
		im.LightDir = lr.attr("dir")
	}
}

func (rd *picReader) readSp3d(s *xmlNode, im *imageJSON) {
	if bt := s.kid("bevelT"); bt != nil {
		im.Bevel = &picBevelJSON{
			Preset: bt.attr("prst"),
			W:      attrF(bt, "w") / emuPerPx,
			H:      attrF(bt, "h") / emuPerPx,
		}
	}
}

// readA14 解析 Excel 2010+ 的 a14:imgProps（图片效果 / 三维旋转 / 图片样式预设名）。
func (rd *picReader) readA14(e *xmlNode, im *imageJSON) {
	props := e.desc("imgProps")
	if props == nil {
		return
	}
	for _, k := range props.kids {
		switch k.local {
		case "imgPropsPrst":
			if im.StylePreset == "" {
				im.StylePreset = k.attr("prst")
			}
		case "imgLayer":
			for _, l := range k.kids {
				switch l.local {
				case "imgEffect":
					// a14:imgEffect 的子元素与 effectLst 同构（a14:outerShdw / a14:glow / …）
					rd.readEffectList(l, im)
				case "imgCamera":
					if cam := l.kid("camera"); cam != nil {
						im.Cam = cam.attr("prst")
						im.CamFov = pct(cam.attr("fov"))
						if r := cam.kid("rot"); r != nil {
							im.CamLat = angle(r.attr("lat"))
							im.CamLon = angle(r.attr("lon"))
							im.CamRev = angle(r.attr("rev"))
						}
					}
				case "imgLightRig":
					if lr := l.kid("lightRig"); lr != nil {
						im.LightRig = lr.attr("rig")
						im.LightDir = lr.attr("dir")
					}
				case "imgSp3d":
					rd.readSp3d(l, im)
				}
			}
		}
	}
}
