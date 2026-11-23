package pptx

import (
	"archive/zip"
	"encoding/xml"
	"io"
	"strings"

	"github.com/zai/samoffice/internal/core"
)

// ---------- SmartArt（dgm）解析：round32 ----------
//
// SmartArt 在 OOXML 里是独立的数据模型（ppt/diagrams/data*.xml 描述节点/
// 连接语义，layout*.xml 描述布局算法）。完整实现需要移植 150+ 种布局算法，
// 不现实；但微软在保存时会同步写一份【预渲染结果】ppt/diagrams/drawing*.xml
//（MS-ODRAWXML dsp: 命名空间）：每个节点的最终几何（a:off/a:ext）、形状
//（prstGeom）、填充（schemeClr 已解析到主题色）、完整文本都在里面 —— 与
// PowerPoint 显示一致。
//
// 策略：跳过数据模型/布局算法，直接把 dsp:drawing 的预渲染形状转成 shapeDef
// 追加进 slide.Shapes（坐标系换算：drawing 内部坐标是 graphicFrame 内容系，
// 需按 frame 的 off/ext 等比映射到 slide 系）。前端渲染链路（GEOM_MAP/
// paras/themeColors）全部复用，SmartArt 即为原生形状组 —— 可见、可导出。
//
// rels 链：slideN.xml 的 <dgm:relIds r:dm="rIdX"> → slideN.xml.rels 的
// diagramData → data1.xml；同一 rels 里微软扩展类型 diagramDrawing →
// drawing1.xml（预渲染）。data 只用来兜底（无 drawing 时抽节点文本）。

// dgmFrameState graphicFrame（SmartArt 帧）的几何与数据引用
type dgmFrameState struct {
	x, y, cx, cy int64  // 帧几何（slide 系 EMU）
	dmRID        string // dgm:relIds 的 r:dm（diagramData rId）
}

// parseSmartArt 解析 graphicFrame 里的 SmartArt：
// rels 为 slide rels（rId → 相对路径）；theme 用于 schemeClr → RGB；
// slideName 用于把 rels 相对路径（../diagrams/…）解析成 zip 全路径。
// 返回 slide 坐标系（EMU）的形状列表。frameX/Y/Cx/Cy 为 graphicFrame 几何。
func parseSmartArt(relIDs map[string]string, rels map[string]string, files map[string]*zip.File,
	theme themeScheme, slideName string, frameX, frameY, frameCx, frameCy int64) []shapeDef {

	// rels 相对路径 → zip 全路径（复用 loadMedia 的目录换算规则）
	resolve := func(target string) string {
		if target == "" {
			return ""
		}
		if strings.HasPrefix(target, "/") {
			return strings.TrimPrefix(target, "/")
		}
		dir := "ppt/slides"
		if i := strings.LastIndex(slideName, "/"); i >= 0 {
			dir = slideName[:i]
		}
		parts := append(strings.Split(dir, "/"), strings.Split(target, "/")...)
		var out []string
		for _, p := range parts {
			switch p {
			case ".", "":
			case "..":
				if len(out) > 0 {
					out = out[:len(out)-1]
				}
			default:
				out = append(out, p)
			}
		}
		return strings.Join(out, "/")
	}

	// r:dm → data 部件路径；diagramDrawing 是独立 rel 类型（不在 relIds 里）
	dataPath := resolve(rels[relIDs["dm"]])
	drawingPath := ""
	for _, tgt := range rels {
		full := resolve(tgt)
		if strings.Contains(full, "diagrams/drawing") && strings.HasSuffix(full, ".xml") {
			drawingPath = full
			break
		}
	}

	// 首选：预渲染 drawing（几何/颜色/文本完整）
	if drawingPath != "" {
		if f, ok := files[drawingPath]; ok {
			if rc, err := f.Open(); err == nil {
				shapes := parseDiagramDrawing(rc, theme, frameX, frameY, frameCx, frameCy)
				rc.Close()
				if len(shapes) > 0 {
					return shapes
				}
			}
		}
	}
	// 兜底：无预渲染（罕见，LibreOffice 保存的文件可能没有）—— 从 data 模型
	// 抽节点文本，按 frame 网格排布（保证内容不丢）
	if dataPath != "" {
		if f, ok := files[dataPath]; ok {
			if rc, err := f.Open(); err == nil {
				texts := parseDiagramDataTexts(rc)
				rc.Close()
				return diagramTextsToShapes(texts, frameX, frameY, frameCx, frameCy)
			}
		}
	}
	return nil
}

// parseDiagramDrawing 解析 dsp:drawing 预渲染形状 → shapeDef（slide 系 EMU）
func parseDiagramDrawing(r io.Reader, theme themeScheme, frameX, frameY, frameCx, frameCy int64) []shapeDef {
	dec := xml.NewDecoder(r)
	dec.Strict = false

	// drawing 的 spTree 通常不带 chExt（<dsp:grpSpPr/> 空元素）—— 形状
	// off/ext 就是 frame 内容的绝对 EMU 坐标。先收集全部形状再按包围盒
	// 等比缩放到 frame（预渲染形状可能比 frame 大 ~7%）。

	type spState struct {
		x, y, cx, cy int64
		geom         string
		fill         string // 已解析 #RRGGBB
		lnColor      string
		lnWpt        int
		paras        []paraDef
		// 文本采集
		curPara *paraDef
		curRun  *runDef
		sawExt  bool
		sawOff  bool
	}
	var cur *spState
	var out []shapeDef

	// rawSp 预缩放的原始形状（drawing 坐标系）
	type rawSp struct {
		x, y, cx, cy int64
		geom, fill   string
		lnColor      string
		lnWpt        int
		paras        []paraDef
		text         string
		color        string
		sizePt       int
		bold         bool
		font         string
		align        string
	}
	var raws []rawSp

	// schemeClr 值 → RGB（lt1/dk1/accent1…）；tx1→dk1、bg1→lt1（clrMap 简化）
	clrOf := func(scheme string) string {
		if rgb, ok := theme[scheme]; ok && rgb != "" {
			return "#" + rgb
		}
		switch scheme {
		case "tx1", "dk1":
			return "#000000"
		case "bg1", "lt1":
			return "#FFFFFF"
		}
		return ""
	}

	inSp, inLn, inSolidFill, inTxBody, inPara, inRun := false, false, false, false, false, false
	// round58：solidFill 归属 —— dsp:spPr 内 = 形状填充/线色；txBody rPr 内 = 文字色。
	// 之前无区分：时间轴文本标签的红色强调文字（rPr solidFill FF0000）被当成
	// 形状填充 → 黑/红色块盖住文字（VLM 对比第 6/7 页）。
	inSpPr := false
	inRPr := false
	var pendingScheme, pendingSrgb string

	flushPara := func() {
		if cur != nil && cur.curPara != nil {
			if len(cur.curPara.Runs) > 0 {
				cur.paras = append(cur.paras, *cur.curPara)
			}
			cur.curPara = nil
		}
	}
	flushShape := func() {
		if cur == nil {
			return
		}
		flushPara()
		if !cur.sawOff || !cur.sawExt {
			cur = nil
			return
		}
		r := rawSp{x: cur.x, y: cur.y, cx: cur.cx, cy: cur.cy,
			geom: cur.geom, fill: cur.fill, lnColor: cur.lnColor, lnWpt: cur.lnWpt,
			paras: cur.paras}
		if len(cur.paras) > 0 {
			var sb strings.Builder
			for i, p := range cur.paras {
				if i > 0 {
					sb.WriteByte('\n')
				}
				for _, rn := range p.Runs {
					sb.WriteString(rn.Text)
				}
			}
			r.text = sb.String()
			f := cur.paras[0]
			if len(f.Runs) > 0 {
				r0 := f.Runs[0]
				r.color = r0.Color
				r.sizePt = r0.SizePt
				r.bold = r0.Bold
				r.font = r0.Font
			}
			r.align = f.Align
		}
		raws = append(raws, r)
		cur = nil
	}

	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "ext":
				// spTree 的 chExt / sp 的 a:ext —— 靠 inSp 区分
				if inSp && cur != nil {
					cur.cx, cur.cy = dgmAttrInt(t, "cx", "cy")
					cur.sawExt = true
				}
			case "off":
				if inSp && cur != nil {
					cur.x, cur.y = dgmAttrInt(t, "x", "y")
					cur.sawOff = true
				}

			case "sp":
				cur = &spState{}
				inSp = true
			case "prstGeom":
				if inSp && cur != nil {
					cur.geom = dgmAttrVal(t, "prst")
				}
			case "spPr":
				inSpPr = true
			case "endParaRPr", "defRPr":
				inRPr = true
			case "solidFill":
				inSolidFill = true
				pendingScheme, pendingSrgb = "", ""
			case "schemeClr":
				if inSolidFill {
					pendingScheme = dgmAttrVal(t, "val")
				}
			case "srgbClr":
				if inSolidFill {
					pendingSrgb = dgmAttrVal(t, "val")
				}
			case "ln":
				if inSp {
					inLn = true
					if cur != nil {
						cur.lnWpt = int(dgmAttrInt1(t, "w") / 12700)
					}
				}
			case "txBody":
				inTxBody = true
			case "p":
				if inTxBody {
					flushPara()
					if cur != nil {
						cur.curPara = &paraDef{}
					}
					inPara = true
				}
			case "r":
				if inTxBody && inPara {
					if cur != nil {
						cur.curRun = &runDef{}
					}
					inRun = true
				}
			case "rPr":
				inRPr = true
				if inRun && cur != nil && cur.curRun != nil {
					cur.curRun.SizePt = int(dgmAttrInt1(t, "sz") / 100)
					cur.curRun.Bold = dgmAttrVal(t, "b") == "1"
				}
			case "t":
				if inRun && cur != nil && cur.curRun != nil {
					txt := readCharData(dec)
					cur.curRun.Text += txt
				}
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "spPr":
				inSpPr = false
			case "rPr", "endParaRPr", "defRPr":
				inRPr = false
			case "sp":
				flushShape()
				inSp = false
			case "solidFill":
				if inSolidFill {
					var rgb string
					if pendingSrgb != "" {
						rgb = "#" + strings.TrimPrefix(pendingSrgb, "#")
					} else if pendingScheme != "" {
						rgb = clrOf(pendingScheme)
					}
					if rgb != "" {
						if inLn {
							if cur != nil {
								cur.lnColor = rgb
							}
						} else if inRPr {
							// round58：rPr 内 solidFill = 文字颜色
							if cur != nil && cur.curRun != nil && cur.curRun.Color == "" {
								cur.curRun.Color = rgb
							}
						} else if inSpPr || !inTxBody {
							if cur != nil {
								cur.fill = rgb
							}
						}
						// 其余（style fillRef 等中间层）：忽略
					}
					inSolidFill = false
					pendingScheme, pendingSrgb = "", ""
				}
			case "ln":
				inLn = false
			case "txBody":
				inTxBody = false
			case "p":
				if inPara {
					flushPara()
					inPara = false
				}
			case "r":
				if inRun && cur != nil && cur.curRun != nil && cur.curPara != nil {
					if cur.curRun.Text != "" {
						// 默认样式：SmartArt 白字优先（fontRef minor + lt1），
						// 显式 solidFill 在 rPr 内会覆盖
						if cur.curRun.Color == "" {
							cur.curRun.Color = "#FFFFFF"
						}
						cur.curPara.Runs = append(cur.curPara.Runs, *cur.curRun)
					}
					cur.curRun = nil
				}
				inRun = false
			}
		}
	}
	flushShape()
	// 包围盒 → frame 等比缩放：预渲染形状坐标就是 frame 内容的绝对 EMU，
	// 但整体可能比 frame 大/小（实测大 ~7%）。取全部形状 bbox，等比缩放
	// 并平移到 frame 原点（保持内部相对布局 —— 时间轴/箭头/节点不变形）。
	if len(raws) == 0 {
		return nil
	}
	var minX, minY, maxX, maxY int64
	minX, minY = raws[0].x, raws[0].y
	for _, r := range raws {
		if r.x < minX {
			minX = r.x
		}
		if r.y < minY {
			minY = r.y
		}
		if r.x+r.cx > maxX {
			maxX = r.x + r.cx
		}
		if r.y+r.cy > maxY {
			maxY = r.y + r.cy
		}
	}
	bw, bh := maxX-minX, maxY-minY
	if bw <= 0 || bh <= 0 {
		return nil
	}
	// 等比缩放（取小方向），frame 内居中
	scale := float64(frameCx) / float64(bw)
	if s2 := float64(frameCy) / float64(bh); s2 < scale {
		scale = s2
	}
	offX := frameX + int64(float64(frameCx)-float64(bw)*scale)/2
	offY := frameY + int64(float64(frameCy)-float64(bh)*scale)/2
	for _, r := range raws {
		sd := shapeDef{
			Kind:  "rect",
			X:     offX + int64(float64(r.x-minX)*scale),
			Y:     offY + int64(float64(r.y-minY)*scale),
			Cx:    int64(float64(r.cx) * scale),
			Cy:    int64(float64(r.cy) * scale),
			Fill:  r.fill,
			Geom:  r.geom,
			LineColor: r.lnColor,
			LineWpt: r.lnWpt,
			Text:  r.text,
			Paras: r.paras,
			Color: r.color,
			SizePt: r.sizePt,
			Bold:  r.bold,
			Font:  r.font,
			Align: r.align,
			Vanchor: "ctr", // SmartArt 节点文本默认垂直居中
		}
		if sd.Cx < 1 {
			sd.Cx = 1
		}
		if sd.Cy < 1 {
			sd.Cy = 1
		}
		out = append(out, sd)
	}
	return out
}

// attrVal 取指定属性
func dgmAttrVal(t xml.StartElement, name string) string {
	for _, a := range t.Attr {
		if a.Name.Local == name {
			return a.Value
		}
	}
	return ""
}

// attrInt 取两个 int64 属性
func dgmAttrInt(t xml.StartElement, k1, k2 string) (int64, int64) {
	var v1, v2 int64
	for _, a := range t.Attr {
		switch a.Name.Local {
		case k1:
			v1 = atoiSafe(a.Value)
		case k2:
			v2 = atoiSafe(a.Value)
		}
	}
	return v1, v2
}

// attrInt1 取单个 int64 属性
func dgmAttrInt1(t xml.StartElement, name string) int64 {
	for _, a := range t.Attr {
		if a.Name.Local == name {
			return atoiSafe(a.Value)
		}
	}
	return 0
}

// atoiSafe 宽松 int64 解析（空/非数字返回 0）
func atoiSafe(s string) int64 {
	var n int64
	var neg bool
	i := 0
	if i < len(s) && (s[i] == '-' || s[i] == '+') {
		neg = s[i] == '-'
		i++
	}
	for ; i < len(s); i++ {
		c := s[i]
		if c < '0' || c > '9' {
			return 0
		}
		n = n*10 + int64(c-'0')
	}
	if neg {
		return -n
	}
	return n
}

// parseDiagramDataTexts 兜底：从 data 模型抽全部节点文本（dgm:pt 内 a:t）
func parseDiagramDataTexts(r io.Reader) []string {
	dec := xml.NewDecoder(r)
	dec.Strict = false
	var texts []string
	var sb strings.Builder
	inPt := false
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "pt":
				inPt = true
				sb.Reset()
			case "t":
				if inPt {
					sb.WriteString(readCharData(dec))
				}
			}
		case xml.EndElement:
			if t.Name.Local == "pt" {
				s := strings.TrimSpace(sb.String())
				if s != "" {
					texts = append(texts, s)
				}
				inPt = false
			}
		}
	}
	return texts
}

// diagramTextsToShapes 兜底排布：文本按 frame 网格纵向铺开
func diagramTextsToShapes(texts []string, frameX, frameY, frameCx, frameCy int64) []shapeDef {
	if len(texts) == 0 {
		return nil
	}
	n := int64(len(texts))
	rowH := frameCy / n
	if rowH < 1 {
		rowH = 1
	}
	var out []shapeDef
	for i, txt := range texts {
		out = append(out, shapeDef{
			Kind:   "rect",
			X:      frameX,
			Y:      frameY + int64(i)*rowH,
			Cx:     frameCx,
			Cy:     rowH,
			Fill:   "#A5B592",
			Text:   txt,
			Color:  "#FFFFFF",
			Align:  "c",
			Vanchor: "ctr",
		})
	}
	return out
}

// 确保引用 core（paras 类型在 parser.go 内定义，此处保留 import 供将来扩展）
var _ = core.BulletList{}
