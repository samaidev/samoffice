package xlsx

// pictures_write.go —— 浮动图片写出：excelize 只负责登记媒体文件与 drawing 部件
// （RegisterPictureMedia），锚点 XML 在这里生成完整 DrawingML 后重写进 zip。
//
// 保真策略：
//   - 图片完全没动过（Raw 非空）：原样写回原始锚点，仅替换媒体关系 id；
//   - 动过位置/尺寸：用模型重建锚点与 xdr:pic，但未编辑的属性（几何、填充、边框、
//     效果、颜色、裁剪）优先沿用读取时保留的原始 XML 片段；
//   - 用户编辑过的属性（geomEdited / lnEdited / fxEdited / cropEdited / colorEdited）
//     才用模型生成对应片段。

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/zai/samoffice/internal/excelizelite"
)

// svgBlipExtURI 是 Excel SVG 扩展的 GUID（a:ext uri，svgBlip 所在扩展）。
const svgBlipExtURI = "{96DAC541-7B7A-43D3-8B79-37D633B846F1}"

// picPlan：一张待写出的图片（图片模型 + drawing 关系 id）。
type picPlan struct {
	im     *imageJSON
	rID    string
	svgRID string
}

// registerPictures 为一张工作表的图片登记媒体部件，返回“drawing 部件 → 锚点列表”。
func registerPictures(f *excelize.File, sheet string, sj *sheetJSON, plans map[string][]picPlan) {
	for i := range sj.Images {
		im := &sj.Images[i]
		if im.Base64 == "" {
			continue
		}
		raw, err := base64.StdEncoding.DecodeString(im.Base64)
		if err != nil || len(raw) == 0 {
			continue
		}
		ext := "." + strings.ToLower(strings.TrimSpace(im.Ext))
		if ext == "." || !isWritableImageExt(ext) {
			continue
		}
		rID, draw, err := f.RegisterPictureMedia(sheet, raw, ext)
		if err != nil {
			continue
		}
		p := picPlan{im: im, rID: rID}
		if im.SVG != "" {
			if sb, err := base64.StdEncoding.DecodeString(im.SVG); err == nil && len(sb) > 0 {
				if rid, _, err := f.RegisterPictureMedia(sheet, sb, ".svg"); err == nil {
					p.svgRID = rid
				}
			}
		}
		plans[draw] = append(plans[draw], p)
	}
}

// writeRowHeights 把前端行高表（key 为 0 基行号字符串，value 为 px）写回 xlsx（px→pt）。
func writeRowHeights(f *excelize.File, sheet string, sj *sheetJSON) {
	for key, px := range sj.RowHeights {
		r, err := strconv.Atoi(key)
		if err != nil || r < 0 || r > 1048575 || px < 5 || px > 2000 {
			continue
		}
		pt := px * 3 / 4
		if pt > 409 {
			pt = 409 // excelize MaxRowHeight
		}
		_ = f.SetRowHeight(sheet, r+1, pt)
	}
}

func isWritableImageExt(ext string) bool {
	_, ok := writableImageExts[ext]
	return ok
}

// rewriteDrawings 把 excelize 生成的 xlsx 里各 drawing 部件替换为完整 DrawingML。
func rewriteDrawings(data []byte, plans map[string][]picPlan) ([]byte, error) {
	if len(plans) == 0 {
		return data, nil
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("reopen zip: %w", err)
	}
	var out bytes.Buffer
	zw := zip.NewWriter(&out)
	wrote := 0
	for _, zf := range zr.File {
		ps, ok := plans[zf.Name]
		if !ok {
			if err := zw.Copy(zf); err != nil {
				return nil, fmt.Errorf("copy %s: %w", zf.Name, err)
			}
			continue
		}
		old, _ := ioReadZip(zf)
		w, err := zw.CreateHeader(&zip.FileHeader{Name: zf.Name, Method: zip.Deflate})
		if err != nil {
			return nil, err
		}
		if _, err := w.Write([]byte(buildDrawingXML(old, ps))); err != nil {
			return nil, err
		}
		wrote++
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	if wrote != len(plans) {
		return nil, fmt.Errorf("drawing rewrite: expected %d parts, wrote %d", len(plans), wrote)
	}
	return out.Bytes(), nil
}

func ioReadZip(zf *zip.File) ([]byte, error) {
	rc, err := zf.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(rc)
}

// drawingHeader 是 xdr:wsDr 根元素的命名空间声明（含 a14/asvg/a16，供原始片段透传引用）。
const drawingHeader = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
	`<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ` +
	`xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
	`xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
	`xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ` +
	`xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" ` +
	`xmlns:a16="http://schemas.microsoft.com/office/drawing/2014/main" ` +
	`xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main">`

// buildDrawingXML 生成 drawing 部件：保留原有非图片锚点，再按计划顺序写图片锚点。
// 未编辑的图片原样写回原始锚点；模型重建的图片 cNvPr id 续接原始锚点里的最大 id。
func buildDrawingXML(old []byte, ps []picPlan) string {
	var b strings.Builder
	b.WriteString(drawingHeader)
	if root, err := parseXMLTree(old); err == nil && root != nil {
		for _, k := range root.kids {
			if k.kid("pic") != nil {
				continue // 旧的图片锚点由计划中的完整重写替换
			}
			b.WriteString(k.raw)
		}
	}
	maxID := 0
	for _, p := range ps {
		if p.im.Raw != "" {
			if m := reCNvPrID.FindStringSubmatch(p.im.Raw); m != nil {
				if v, err := strconv.Atoi(m[1]); err == nil && v > maxID {
					maxID = v
				}
			}
		}
	}
	id := maxID + 1
	for _, p := range ps {
		switch {
		case p.im.Raw == "":
			b.WriteString(buildAnchor(p.im, id, p))
			id++
		default:
			if s, ok := reuseAnchor(p.im, p); ok {
				b.WriteString(s)
			} else {
				// 原始锚点引用了未登记的关系（如超链接）→ 模型重建，避免产出损坏文件
				b.WriteString(buildAnchor(p.im, id, p))
				id++
			}
		}
	}
	b.WriteString("</xdr:wsDr>")
	return b.String()
}

var reCNvPrID = regexp.MustCompile(`<xdr:cNvPr id="(\d+)"`)

// reuseAnchor 原样写回未编辑图片的锚点 XML：替换媒体关系 id、剥掉悬空的关系引用
// （超链接等我们未登记的关系，保留会让 Excel 报“发现不可读取的内容”）。
// reuseAnchor 原样写回未编辑图片的锚点 XML：替换媒体关系 id、剥掉悬空的关系引用
// （超链接等我们未登记的关系，保留会让 Excel 报“发现不可读取的内容”）。
// 返回 false 表示原始锚点里还有无法替换的关系引用，调用方退回模型重建。
func reuseAnchor(im *imageJSON, p picPlan) (string, bool) {
	s := im.Raw
	s = reHlink.ReplaceAllString(s, "")
	if p.svgRID != "" && im.SVGRel != "" {
		s = strings.ReplaceAll(s, `r:embed="`+im.SVGRel+`"`, `r:embed="`+p.svgRID+`"`)
	} else {
		s = reSVGBlip.ReplaceAllString(s, "")
	}
	if im.SrcRel != "" {
		s = strings.ReplaceAll(s, `r:embed="`+im.SrcRel+`"`, `r:embed="`+p.rID+`"`)
		s = strings.ReplaceAll(s, `r:link="`+im.SrcRel+`"`, `r:embed="`+p.rID+`"`)
	}
	for _, m := range reRelAttr.FindAllStringSubmatch(s, -1) {
		if m[1] != p.rID && m[1] != p.svgRID {
			return "", false
		}
	}
	return s, true
}

// picAnchors 规范化锚点：补齐 from/to/size/abs 与 mode（兼容旧快照只有 row/col/width/height）。
func picAnchors(im *imageJSON) (from, to picPointJSON, mode string, size picSizeJSON, abs picPosJSON) {
	mode = im.Mode
	if mode == "" {
		mode = "moveSize"
	}
	from = picPointJSON{Col: im.Col, Row: im.Row, Dx: 2, Dy: 2}
	if im.From != nil {
		from = *im.From
	}
	size = picSizeJSON{W: float64(im.Width), H: float64(im.Height)}
	if im.Size != nil {
		size = *im.Size
	}
	abs = picPosJSON{}
	if im.Abs != nil {
		abs = *im.Abs
	}
	if im.To != nil {
		to = *im.To
		return
	}
	// 旧快照：只有锚定单元格 + 显示尺寸 → 用默认几何（列 64px / 行 20px）推算 to
	x, y := float64(from.Col)*64+from.Dx, float64(from.Row)*20+from.Dy
	if mode == "fixed" && (abs.X != 0 || abs.Y != 0) {
		x, y = abs.X, abs.Y
	}
	to = anchorAtDefault(x+size.W, y+size.H)
	return
}

// anchorAtDefault 用 Excel 默认几何（列 64px / 行 20px）把坐标换算为锚点。
func anchorAtDefault(x, y float64) picPointJSON {
	c, dx := int(x/64), math.Mod(x, 64)
	if dx < 0 {
		dx += 64
		c--
	}
	r, dy := int(y/20), math.Mod(y, 20)
	if dy < 0 {
		dy += 20
		r--
	}
	return picPointJSON{Col: c, Row: r, Dx: round1(dx), Dy: round1(dy)}
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }

func emu(px float64) int64 { return int64(math.Round(px * emuPerPx)) }

// pct100k 把 -1~1 的分数换算为 DrawingML 的十万分比整数。
func pct100k(v float64) int64 { return int64(math.Round(v * 100000)) }

func xmlEsc(s string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

// buildAnchor 生成一条完整锚点（twoCellAnchor + editAs，与 Excel 的对象定位一致）。
func buildAnchor(im *imageJSON, id int, p picPlan) string {
	from, to, mode, size, abs := picAnchors(im)
	var b strings.Builder
	editAs := "twoCell"
	switch mode {
	case "move":
		editAs = "oneCell"
	case "fixed":
		editAs = "absolute"
	}
	fmt.Fprintf(&b, `<xdr:twoCellAnchor editAs="%s">`, editAs)
	writeMarker(&b, "from", from)
	writeMarker(&b, "to", to)
	buildPic(&b, im, id, p, mode, size, abs)
	lock, print := 1, 1
	if im.Locked != nil && !*im.Locked {
		lock = 0
	}
	if im.PrintObj != nil && !*im.PrintObj {
		print = 0
	}
	fmt.Fprintf(&b, `<xdr:clientData fLocksWithSheet="%d" fPrintsWithSheet="%d"/></xdr:twoCellAnchor>`, lock, print)
	return b.String()
}

func writeMarker(b *strings.Builder, tag string, m picPointJSON) {
	fmt.Fprintf(b, `<xdr:%s><xdr:col>%d</xdr:col><xdr:colOff>%d</xdr:colOff><xdr:row>%d</xdr:row><xdr:rowOff>%d</xdr:rowOff></xdr:%s>`,
		tag, m.Col, emu(m.Dx), m.Row, emu(m.Dy), tag)
}

// buildPic 生成 <xdr:pic>：nvPicPr / blipFill / spPr。
func buildPic(b *strings.Builder, im *imageJSON, id int, p picPlan, mode string, size picSizeJSON, abs picPosJSON) {
	name := im.Name
	if name == "" {
		name = "图片 " + strconv.Itoa(id)
	}
	b.WriteString(`<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="` + strconv.Itoa(id) + `" name="` + xmlEsc(name) + `"`)
	if im.Alt != "" {
		b.WriteString(` descr="` + xmlEsc(im.Alt) + `"`)
	}
	if im.Hidden {
		b.WriteString(` hidden="1"`)
	}
	aspect := 0
	if im.LockAspect {
		aspect = 1
	}
	fmt.Fprintf(b, `/><xdr:cNvPicPr><a:picLocks noChangeAspect="%d"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill>`, aspect)

	// ---- blipFill ----
	if im.RawBlipFill != "" && !im.CropEdited && !im.ColorEdited {
		b.WriteString(reuseBlipFill(im, p))
	} else {
		b.WriteString(`<a:blip r:embed="` + p.rID + `">`)
		if p.svgRID != "" {
			fmt.Fprintf(b, `<a:extLst><a:ext uri="%s"><asvg:svgBlip r:embed="%s"/></a:ext></a:extLst>`, svgBlipExtURI, p.svgRID)
		}
		writeBlipColor(b, im.Color)
		b.WriteString(`</a:blip>`)
		if im.Crop != nil && (im.Crop.L != 0 || im.Crop.T != 0 || im.Crop.R != 0 || im.Crop.B != 0) {
			crop := `<a:srcRect`
			if im.Crop.L != 0 {
				crop += fmt.Sprintf(` l="%d"`, pct100k(im.Crop.L))
			}
			if im.Crop.T != 0 {
				crop += fmt.Sprintf(` t="%d"`, pct100k(im.Crop.T))
			}
			if im.Crop.R != 0 {
				crop += fmt.Sprintf(` r="%d"`, pct100k(im.Crop.R))
			}
			if im.Crop.B != 0 {
				crop += fmt.Sprintf(` b="%d"`, pct100k(im.Crop.B))
			}
			b.WriteString(crop + `/>`)
		}
		b.WriteString(`<a:stretch><a:fillRect/></a:stretch>`)
	}
	b.WriteString(`</xdr:blipFill>`)

	// ---- spPr ----
	b.WriteString(`<xdr:spPr>`)
	if im.Rot != 0 || im.FlipH || im.FlipV || mode != "moveSize" {
		rot := int64(math.Round(im.Rot*60000)) % 21600000
		if rot < 0 {
			rot += 21600000
		}
		fmt.Fprintf(b, `<a:xfrm rot="%d"`, rot)
		if im.FlipH {
			b.WriteString(` flipH="1"`)
		}
		if im.FlipV {
			b.WriteString(` flipV="1"`)
		}
		b.WriteString(`>`)
		if mode == "fixed" {
			fmt.Fprintf(b, `<a:off x="%d" y="%d"/>`, emu(abs.X), emu(abs.Y))
		} else {
			b.WriteString(`<a:off x="0" y="0"/>`)
		}
		if mode == "moveSize" {
			b.WriteString(`<a:ext cx="0" cy="0"/>`)
		} else {
			fmt.Fprintf(b, `<a:ext cx="%d" cy="%d"/>`, emu(size.W), emu(size.H))
		}
		b.WriteString(`</a:xfrm>`)
	}
	// 几何
	switch {
	case im.GeomEdited || im.RawGeom == "":
		prst := im.Geom
		if prst == "" || prst == "custGeom" {
			prst = "rect"
		}
		fmt.Fprintf(b, `<a:prstGeom prst="%s"><a:avLst/></a:prstGeom>`, xmlEsc(prst))
	default:
		b.WriteString(im.RawGeom)
	}
	// 填充（图片本身不建模形状填充，透传原始片段）
	if im.RawFill != "" {
		b.WriteString(im.RawFill)
	}
	// 边框
	switch {
	case im.LnEdited:
		writeLine(b, im.Ln)
	case im.RawLn != "":
		b.WriteString(im.RawLn)
	default:
		b.WriteString(`<a:ln><a:noFill/></a:ln>`)
	}
	// 效果与三维
	if im.FxEdited {
		writeEffects(b, im)
		if im.Cam != "" || im.Bevel != nil {
			writeScene3d(b, im)
		}
	} else {
		if im.RawFx != "" {
			b.WriteString(im.RawFx)
		}
		b.WriteString(im.RawScene)
	}
	if im.RawSpExt != "" {
		b.WriteString(im.RawSpExt)
	}
	b.WriteString(`</xdr:spPr>`)
	// pic 级扩展（a14:imgProps 等）：效果或颜色被动过时不再保留，避免与新写的效果叠加
	if im.RawPicExt != "" && !im.FxEdited && !im.ColorEdited {
		b.WriteString(im.RawPicExt)
	}
	b.WriteString(`</xdr:pic>`)
}

// reuseBlipFill 原样复用原始 blipFill 内容（未编辑裁剪/颜色时），仅替换关系 id。
// RawBlipFill 存的是【整个】<xdr:blipFill>…</xdr:blipFill> 元素，而 buildPic 已经
// 打开了自己的 <xdr:blipFill> —— 这里必须剥掉外层标签（曾导致双层嵌套、Excel 报错）。
func reuseBlipFill(im *imageJSON, p picPlan) string {
	s := strings.TrimSpace(im.RawBlipFill)
	if strings.HasPrefix(s, "<xdr:blipFill") {
		if i := strings.Index(s, ">"); i >= 0 {
			s = s[i+1:]
		}
	}
	if j := strings.LastIndex(s, "</xdr:blipFill>"); j >= 0 {
		s = s[:j]
	}
	s = strings.TrimSpace(s)
	if p.svgRID != "" && im.SVGRel != "" {
		s = strings.ReplaceAll(s, `r:embed="`+im.SVGRel+`"`, `r:embed="`+p.svgRID+`"`)
	} else {
		s = reSVGBlip.ReplaceAllString(s, "")
	}
	if im.SrcRel != "" {
		s = strings.ReplaceAll(s, `r:embed="`+im.SrcRel+`"`, `r:embed="`+p.rID+`"`)
	}
	return s
}

// writeBlipColor 写出颜色校正（a:blip 的子元素）。
func writeBlipColor(b *strings.Builder, c *picColorJSON) {
	if c == nil {
		return
	}
	if c.Transparency > 0 {
		fmt.Fprintf(b, `<a:alphaModFix amt="%d"/>`, pct100k(1-c.Transparency))
	}
	if c.Brightness != 0 || c.Contrast != 0 {
		fmt.Fprintf(b, `<a:lum bright="%d" contrast="%d"/>`, pct100k(c.Brightness), pct100k(c.Contrast))
	}
	if c.Saturation != 0 {
		fmt.Fprintf(b, `<a:satMod val="%d"/>`, pct100k(1+c.Saturation))
	}
	if c.Grayscale {
		b.WriteString(`<a:grayscl/>`)
	}
	if len(c.Duotone) >= 2 {
		fmt.Fprintf(b, `<a:duotone><a:srgbClr val="%s"/><a:srgbClr val="%s"/></a:duotone>`, hex6(c.Duotone[0]), hex6(c.Duotone[1]))
	}
	if c.Transparent != "" {
		fmt.Fprintf(b, `<a:clrChange><a:srgbClr val="%s"><a:alpha val="0"/></a:srgbClr><a:srgbClr val="FFFFFF"/></a:clrChange>`, hex6(c.Transparent))
	}
}

// writeLine 写出图片边框。
func writeLine(b *strings.Builder, ln *picLineJSON) {
	if ln == nil {
		b.WriteString(`<a:ln><a:noFill/></a:ln>`)
		return
	}
	fmt.Fprintf(b, `<a:ln w="%d" cap="flat" cmpd="sng" algn="ctr">`, int64(math.Round(ln.W*12700)))
	alphaAttr := ""
	if ln.Alpha < 1 {
		alphaAttr = fmt.Sprintf(`<a:alpha val="%d"/>`, pct100k(ln.Alpha))
	}
	if ln.Color != "" {
		fmt.Fprintf(b, `<a:solidFill><a:srgbClr val="%s">%s</a:srgbClr></a:solidFill>`, hex6(ln.Color), alphaAttr)
	}
	if ln.Dash != "" && ln.Dash != "solid" {
		fmt.Fprintf(b, `<a:prstDash val="%s"/>`, xmlEsc(ln.Dash))
	}
	b.WriteString(`<a:miter lim="800000"/></a:ln>`)
}

// writeEffects 写出 effectLst（子元素顺序遵循 schema：glow → innerShdw/outerShdw → reflection → softEdge）。
func writeEffects(b *strings.Builder, im *imageJSON) {
	b.WriteString(`<a:effectLst>`)
	if im.Glow != nil && im.Glow.Size > 0 {
		fmt.Fprintf(b, `<a:glow rad="%d">%s</a:glow>`, emu(im.Glow.Size), dmlColorXML(im.Glow.Color, im.Glow.Alpha))
	}
	if im.Shadow != nil && (im.Shadow.Blur > 0 || im.Shadow.Dist > 0) {
		dir := int64(math.Round(im.Shadow.Dir*60000)) % 21600000
		if dir < 0 {
			dir += 21600000
		}
		blur, dist := emu(im.Shadow.Blur), emu(im.Shadow.Dist)
		if blur == 0 {
			blur = 50800 // 4pt：Excel 默认阴影模糊
		}
		if im.Shadow.Kind == "inner" {
			fmt.Fprintf(b, `<a:innerShdw blurRad="%d" dist="%d" dir="%d">%s</a:innerShdw>`, blur, dist, dir, dmlColorXML(im.Shadow.Color, im.Shadow.Alpha))
		} else {
			fmt.Fprintf(b, `<a:outerShdw blurRad="%d" dist="%d" dir="%d" algn="ctr" rotWithShape="0">%s</a:outerShdw>`, blur, dist, dir, dmlColorXML(im.Shadow.Color, im.Shadow.Alpha))
		}
	}
	if im.Reflection > 0 {
		fmt.Fprintf(b, `<a:reflection blurRad="6350" stA="%d" endA="300" dir="5400000" sy="-100000" algn="bl" rotWithShape="0"/>`, pct100k(im.Reflection))
	}
	if im.SoftEdge > 0 {
		fmt.Fprintf(b, `<a:softEdge rad="%d"/>`, emu(im.SoftEdge))
	}
	b.WriteString(`</a:effectLst>`)
}

// dmlColorXML 生成带 alpha 的颜色元素。
func dmlColorXML(hex string, alpha float64) string {
	if alpha >= 1 {
		return fmt.Sprintf(`<a:srgbClr val="%s"/>`, hex6(hex))
	}
	return fmt.Sprintf(`<a:srgbClr val="%s"><a:alpha val="%d"/></a:srgbClr>`, hex6(hex), pct100k(clamp01(alpha)))
}

// writeScene3d 写出三维旋转（scene3d）与棱台（sp3d）。
func writeScene3d(b *strings.Builder, im *imageJSON) {
	prst := im.Cam
	if prst == "" {
		prst = "orthographicFront"
	}
	rig, dir := im.LightRig, im.LightDir
	if rig == "" {
		rig, dir = "threePt", "t"
	}
	// fov 不写出：相机预设自带默认视场角，自定义格式有兼容风险
	b.WriteString(`<a:scene3d>`)
	fmt.Fprintf(b, `<a:camera prst="%s">`, xmlEsc(prst))
	if im.CamLat != 0 || im.CamLon != 0 || im.CamRev != 0 {
		fmt.Fprintf(b, `<a:rot lat="%d" lon="%d" rev="%d"/>`,
			int64(math.Round(im.CamLat*60000)), int64(math.Round(im.CamLon*60000)), int64(math.Round(im.CamRev*60000)))
	}
	b.WriteString(`</a:camera>`)
	fmt.Fprintf(b, `<a:lightRig rig="%s" dir="%s"/>`, xmlEsc(rig), xmlEsc(dir))
	b.WriteString(`</a:scene3d>`)
	if im.Bevel != nil {
		fmt.Fprintf(b, `<a:sp3d prstMaterial="plastic"><a:bevelT w="%d" h="%d" prst="%s"/></a:sp3d>`,
			emu(im.Bevel.W), emu(im.Bevel.H), xmlEsc(bevelPreset(im.Bevel.Preset)))
	}
}

func bevelPreset(p string) string {
	switch p {
	case "":
		return "circle"
	case "circle", "relax", "slope", "cross", "angle", "softRound", "divot", "riblet", "hardEdge", "artDeco":
		return p
	default:
		return "circle"
	}
}
