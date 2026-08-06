// Package pptx 实现 OOXML .pptx 的自研写入器（与 parser.go 的解析器互补）。
// 将前端传来的幻灯片 JSON 写成一个可被 PowerPoint / WPS / LibreOffice 打开的合法 PPTX。
// 支持：每页背景色、文本形状（位置/大小/文字/颜色/字号/加粗/对齐/垂直锚定）、
// 矩形/椭圆/三角/菱形/箭头/星形/六边形/五边形/心形/云形/标注等基础几何、
// 图片（data URL 嵌入）、以及艺术字（作为文本形状）。
package pptx

import (
	"archive/zip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path"
	"strings"
)

// ---------- 前端 JSON 结构 ----------

type writePPTX struct {
	PageW  int64        `json:"pageW"`
	PageH  int64        `json:"pageH"`
	Slides []slideWrite `json:"slides"`
}

type slideWrite struct {
	Bg     string       `json:"bg"`
	Notes  string       `json:"notes"`
	Shapes []shapeWrite `json:"shapes"`
}

type shapeWrite struct {
	Kind    string `json:"kind"`    // text | rect | pic
	Type    string `json:"type"`    // rect/ellipse/triangle/... (几何)
	X       int64  `json:"x"`       // EMU
	Y       int64  `json:"y"`       // EMU
	Cx      int64  `json:"cx"`      // EMU
	Cy      int64  `json:"cy"`      // EMU
	Fill    string `json:"fill"`    // #RRGGBB 或 url("data:...")
	Text    string `json:"text"`    // 多行以 \n 分隔
	Color   string `json:"color"`   // #RRGGBB
	SizePt  int    `json:"sizePt"`  // 磅
	Bold    bool   `json:"bold"`    // 文字加粗
	Align   string `json:"align"`   // l|c|r
	Vanchor string `json:"vanchor"` // t|ctr|b
	Img     string `json:"img"`     // 图片 data URL
}

// ---------- 公共入口 ----------

// WritePPTX 把前端 slides JSON 写成 PPTX 文件
func WritePPTX(p string, jsonStr string) error {
	var data writePPTX
	if err := json.Unmarshal([]byte(jsonStr), &data); err != nil {
		return fmt.Errorf("parse pptx json: %w", err)
	}
	if len(data.Slides) == 0 {
		return fmt.Errorf("no slides to write")
	}
	pageW, pageH := data.PageW, data.PageH
	if pageW <= 0 {
		pageW = 12192000
	}
	if pageH <= 0 {
		pageH = 6858000
	}

	builder := &pptxWriter{pageW: pageW, pageH: pageH}
	if err := builder.build(data.Slides); err != nil {
		return err
	}
	return builder.save(p)
}

// ---------- 写入器 ----------

type mediaFile struct {
	name string // ppt/media/image1.png
	ext  string
	data []byte
}

type pptxWriter struct {
	pageW  int64
	pageH  int64
	slides []slideWrite
	media  []mediaFile
}

// prstGeom 把前端类型映射为 PPTX 预设几何名
func prstGeom(t string) string {
	switch strings.ToLower(t) {
	case "ellipse", "circle":
		return "ellipse"
	case "roundrect", "rounded":
		return "roundRect"
	case "triangle":
		return "triangle"
	case "diamond":
		return "diamond"
	case "rightarrow", "arrow":
		return "rightArrow"
	case "star5", "star":
		return "star5"
	case "hexagon":
		return "hexagon"
	case "pentagon":
		return "pentagon"
	case "heart":
		return "heart"
	case "cloud":
		return "cloud"
	case "callout", "wedgerectcallout":
		return "wedgeRectCallout"
	default:
		return "rect"
	}
}

// normColor 把 #RRGGBB / #rrggbb 规整为 RRGGBB（大写，去 #）；空返回 ""
func normColor(c string) string {
	c = strings.TrimSpace(c)
	c = strings.TrimPrefix(c, "#")
	if len(c) == 3 {
		c = string([]byte{c[0], c[0], c[1], c[1], c[2], c[2]})
	}
	if len(c) != 6 {
		return ""
	}
	return strings.ToUpper(c)
}

// xmlEsc 转义 XML 文本
func xmlEsc(s string) string {
	r := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		`"`, "&quot;",
		"'", "&apos;",
	)
	return r.Replace(s)
}

// alignToPptx 把 l/c/r 转换为 PPTX algn 值
func alignToPptx(a string) string {
	switch a {
	case "c":
		return "ctr"
	case "r":
		return "r"
	default:
		return "l"
	}
}

// build 准备所有媒体并校验
func (w *pptxWriter) build(slides []slideWrite) error {
	w.slides = slides
	// 收集图片并解码
	for _, s := range slides {
		for i := range s.Shapes {
			sh := &s.Shapes[i]
			if (sh.Kind == "pic" || strings.HasPrefix(sh.Fill, "url(")) && sh.Img != "" {
				m, ok := decodeDataURL(sh.Img)
				if ok {
					name := fmt.Sprintf("ppt/media/image%d.%s", len(w.media)+1, m.ext)
					w.media = append(w.media, mediaFile{name: name, ext: m.ext, data: m.data})
					// 记录引用（用序号指向 w.media）
					sh.Img = name // 临时存为 media 名，后续映射 rId
					_ = i
				}
			}
		}
	}
	return nil
}

type decodedMedia struct {
	ext  string
	data []byte
}

// decodeDataURL 解析 data URL，返回扩展名与字节
func decodeDataURL(s string) (decodedMedia, bool) {
	const prefix = "data:"
	if !strings.HasPrefix(s, prefix) {
		return decodedMedia{}, false
	}
	comma := strings.Index(s, ",")
	if comma < 0 {
		return decodedMedia{}, false
	}
	meta := s[len(prefix):comma]
	b64 := s[comma+1:]
	// 去 URL-safe 与空白
	mime := ""
	if idx := strings.Index(meta, ";"); idx >= 0 {
		mime = meta[:idx]
	} else {
		mime = meta
	}
	var ext string
	switch mime {
	case "image/png":
		ext = "png"
	case "image/jpeg", "image/jpg":
		ext = "jpeg"
	case "image/gif":
		ext = "gif"
	case "image/bmp":
		ext = "bmp"
	case "image/svg+xml":
		ext = "svg"
	case "image/webp":
		ext = "webp"
	default:
		ext = "png"
	}
	data, err := base64.StdEncoding.DecodeString(strings.TrimSpace(b64))
	if err != nil {
		// 尝试 URL-safe
		data, err = base64.URLEncoding.DecodeString(strings.TrimSpace(b64))
		if err != nil {
			return decodedMedia{}, false
		}
	}
	if len(data) == 0 {
		return decodedMedia{}, false
	}
	return decodedMedia{ext: ext, data: data}, true
}

// ---------- XML 生成 ----------

// slideXML 生成单张幻灯片 XML。mediaRels 为该页引用的 media -> rId 映射
func (w *pptxWriter) slideXML(s slideWrite, mediaRels map[string]string) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
	b.WriteString(`<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">`)
	// 背景
	bg := normColor(s.Bg)
	if bg != "" && strings.ToUpper(bg) != "FFFFFF" {
		b.WriteString(`<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="`)
		b.WriteString(bg)
		b.WriteString(`"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`)
	} else {
		b.WriteString(`<p:cSld>`)
	}

	b.WriteString(`<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>`)

	for idx, sh := range s.Shapes {
		if sh.Kind == "pic" || strings.HasPrefix(sh.Fill, "url(") {
			// 图片
			imgName := sh.Img
			rId, ok := mediaRels[imgName]
			if !ok {
				continue
			}
			b.WriteString(`<p:pic><p:nvPicPr><p:cNvPr id="`)
			b.WriteString(fmt.Sprintf("%d", idx+10))
			b.WriteString(`" name="Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="`)
			b.WriteString(rId)
			b.WriteString(`"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="`)
			b.WriteString(fmt.Sprintf("%d", sh.X))
			b.WriteString(`" y="`)
			b.WriteString(fmt.Sprintf("%d", sh.Y))
			b.WriteString(`"/><a:ext cx="`)
			b.WriteString(fmt.Sprintf("%d", sh.Cx))
			b.WriteString(`" cy="`)
			b.WriteString(fmt.Sprintf("%d", sh.Cy))
			b.WriteString(`"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`)
		} else {
			// 文本 / 矩形
			geom := prstGeom(sh.Type)
			fill := normColor(sh.Fill)
			b.WriteString(`<p:sp><p:nvSpPr><p:cNvPr id="`)
			b.WriteString(fmt.Sprintf("%d", idx+10))
			b.WriteString(`" name="Shape`)
			b.WriteString(fmt.Sprintf("%d", idx+1))
			b.WriteString(`"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>`)
			b.WriteString(`<a:xfrm><a:off x="`)
			b.WriteString(fmt.Sprintf("%d", sh.X))
			b.WriteString(`" y="`)
			b.WriteString(fmt.Sprintf("%d", sh.Y))
			b.WriteString(`"/><a:ext cx="`)
			b.WriteString(fmt.Sprintf("%d", sh.Cx))
			b.WriteString(`" cy="`)
			b.WriteString(fmt.Sprintf("%d", sh.Cy))
			b.WriteString(`"/></a:xfrm>`)
			b.WriteString(`<a:prstGeom prst="`)
			b.WriteString(geom)
			b.WriteString(`"><a:avLst/></a:prstGeom>`)
			if fill != "" {
				b.WriteString(`<a:solidFill><a:srgbClr val="`)
				b.WriteString(fill)
				b.WriteString(`"/></a:solidFill>`)
			} else {
				b.WriteString(`<a:noFill/>`)
			}
			b.WriteString(`<a:ln><a:noFill/></a:ln></p:spPr>`)

			// 文本框
			color := normColor(sh.Color)
			if color == "" {
				color = "1F2937"
			}
			sz := sh.SizePt
			if sz <= 0 {
				sz = 18
			}
			b.WriteString(`<p:txBody><a:bodyPr anchor="`)
			b.WriteString(vanchorToPptx(sh.Vanchor))
			b.WriteString(`"/><a:lstStyle/>`)
			lines := strings.Split(sh.Text, "\n")
			for li, line := range lines {
				if li > 0 {
					b.WriteString(`<a:p/>`)
				}
				b.WriteString(`<a:p><a:pPr algn="`)
				b.WriteString(alignToPptx(sh.Align))
				b.WriteString(`"/>`)
				if line != "" {
					b.WriteString(`<a:r><a:rPr lang="en-US" sz="`)
					b.WriteString(fmt.Sprintf("%d", sz*100))
					b.WriteString(`"`)
					if sh.Bold {
						b.WriteString(` b="1"`)
					}
					b.WriteString(`><a:solidFill><a:srgbClr val="`)
					b.WriteString(color)
					b.WriteString(`"/></a:solidFill></a:rPr><a:t>`)
					b.WriteString(xmlEsc(line))
					b.WriteString(`</a:t></a:r>`)
				}
				b.WriteString(`</a:p>`)
			}
			if len(lines) == 0 {
				b.WriteString(`<a:p><a:endParaRPr lang="en-US"/></a:p>`)
			}
			b.WriteString(`</p:txBody></p:sp>`)
		}
	}

	b.WriteString(`</p:spTree></p:cSld>`)
	b.WriteString(`<p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr>`)
	b.WriteString(`</p:sld>`)
	return b.String()
}

func vanchorToPptx(v string) string {
	switch v {
	case "t":
		return "t"
	case "b":
		return "b"
	default:
		return "ctr"
	}
}

// save 打包为 zip
func (w *pptxWriter) save(p string) error {
	f, err := os.Create(p)
	if err != nil {
		return err
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	defer zw.Close()

	// Content Types
	ct := w.contentTypes()
	if err := writeZip(zw, "[Content_Types].xml", ct); err != nil {
		return err
	}
	// root rels
	if err := writeZip(zw, "_rels/.rels", rootRels); err != nil {
		return err
	}
	// docProps
	if err := writeZip(zw, "docProps/core.xml", coreXML); err != nil {
		return err
	}
	if err := writeZip(zw, "docProps/app.xml", appXML); err != nil {
		return err
	}
	// theme / master / layout
	if err := writeZip(zw, "ppt/theme/theme1.xml", themeXML); err != nil {
		return err
	}
	if err := writeZip(zw, "ppt/slideMasters/slideMaster1.xml", masterXML); err != nil {
		return err
	}
	if err := writeZip(zw, "ppt/slideMasters/_rels/slideMaster1.xml.rels", masterRels); err != nil {
		return err
	}
	if err := writeZip(zw, "ppt/slideLayouts/slideLayout1.xml", layoutXML); err != nil {
		return err
	}
	if err := writeZip(zw, "ppt/slideLayouts/_rels/slideLayout1.xml.rels", layoutRels); err != nil {
		return err
	}

	// presentation.xml + rels
	n := len(w.slides)
	presXML, presRels := w.presentation(n)
	if err := writeZip(zw, "ppt/presentation.xml", presXML); err != nil {
		return err
	}
	if err := writeZip(zw, "ppt/_rels/presentation.xml.rels", presRels); err != nil {
		return err
	}

	// slides
	for i, s := range w.slides {
		// 该页引用的媒体（按 w.slides 顺序时，图片在 build 已收集，但需按页映射）
		mediaRels := map[string]string{}
		for _, sh := range s.Shapes {
			if (sh.Kind == "pic" || strings.HasPrefix(sh.Fill, "url(")) && sh.Img != "" {
				// 在 w.media 中找到对应索引
				for mi, m := range w.media {
					if m.name == sh.Img {
						mediaRels[m.name] = fmt.Sprintf("rIdM%d", mi+1)
						break
					}
				}
			}
		}
		xml := w.slideXML(s, mediaRels)
		name := fmt.Sprintf("ppt/slides/slide%d.xml", i+1)
		if err := writeZip(zw, name, xml); err != nil {
			return err
		}
		// slide rels（含图片引用）
		rels := w.slideRels(mediaRels)
		relsName := fmt.Sprintf("ppt/slides/_rels/slide%d.xml.rels", i+1)
		if err := writeZip(zw, relsName, rels); err != nil {
			return err
		}
	}

	// media 字节
	for _, m := range w.media {
		if err := writeZipBytes(zw, m.name, m.data); err != nil {
			return err
		}
	}

	return nil
}

// presentation 生成 presentation.xml 与 rels（rId1=master, rId2=layout, rId3=theme, rId4..N+3=slides）
func (w *pptxWriter) presentation(n int) (string, string) {
	var body strings.Builder
	body.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
	body.WriteString(`<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">`)
	body.WriteString(`<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>`)
	body.WriteString(`<p:sldIdLst>`)
	for i := 0; i < n; i++ {
		id := 256 + i
		body.WriteString(fmt.Sprintf(`<p:sldId id="%d" r:id="rId%d"/>`, id, i+4))
	}
	body.WriteString(`</p:sldIdLst>`)
	body.WriteString(fmt.Sprintf(`<p:sldSz cx="%d" cy="%d"/>`, w.pageW, w.pageH))
	body.WriteString(`<p:notesSz cx="6858000" cy="9144000"/>`)
	body.WriteString(`</p:presentation>`)

	var rels strings.Builder
	rels.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
	rels.WriteString(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`)
	rels.WriteString(`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slides/slideMaster1.xml"/>`)
	rels.WriteString(`<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="slides/slideLayout1.xml"/>`)
	rels.WriteString(`<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>`)
	for i := 0; i < n; i++ {
		rels.WriteString(fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide%d.xml"/>`, i+4, i+1))
	}
	rels.WriteString(`</Relationships>`)
	return body.String(), rels.String()
}

// slideRels 生成单页 rels（含图片引用 rIdM*）
func (w *pptxWriter) slideRels(mediaRels map[string]string) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
	b.WriteString(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`)
	b.WriteString(`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`)
	idx := 1
	for _, rId := range mediaRels {
		_ = rId
		idx++
	}
	// 按 rIdM 顺序输出，确保与 slide 中引用一致
	for mi := range w.media {
		rId := fmt.Sprintf("rIdM%d", mi+1)
		// 仅当该 media 被本页引用
		referenced := false
		for _, rr := range mediaRels {
			if rr == rId {
				referenced = true
				break
			}
		}
		if referenced {
			b.WriteString(fmt.Sprintf(`<Relationship Id="%s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/%s"/>`, rId, path.Base(w.media[mi].name)))
		}
	}
	b.WriteString(`</Relationships>`)
	return b.String()
}

func (w *pptxWriter) contentTypes() string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
	b.WriteString(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`)
	b.WriteString(`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`)
	b.WriteString(`<Default Extension="xml" ContentType="application/xml"/>`)
	b.WriteString(`<Default Extension="png" ContentType="image/png"/>`)
	b.WriteString(`<Default Extension="jpeg" ContentType="image/jpeg"/>`)
	b.WriteString(`<Default Extension="jpg" ContentType="image/jpeg"/>`)
	b.WriteString(`<Default Extension="gif" ContentType="image/gif"/>`)
	b.WriteString(`<Default Extension="bmp" ContentType="image/bmp"/>`)
	b.WriteString(`<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`)
	b.WriteString(`<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`)
	b.WriteString(`<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`)
	b.WriteString(`<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`)
	for i := range w.slides {
		b.WriteString(fmt.Sprintf(`<Override PartName="/ppt/slides/slide%d.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`, i+1))
	}
	b.WriteString(`<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`)
	b.WriteString(`<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`)
	b.WriteString(`</Types>`)
	return b.String()
}

// ---------- 静态模板 ----------

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
	`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
	`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>` +
	`<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
	`<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
	`</Relationships>`

const coreXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
	`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
	`<dc:title>Presentation</dc:title><dc:creator>SamOffice</dc:creator><cp:lastModifiedBy>SamOffice</cp:lastModifiedBy>` +
	`</cp:coreProperties>`

const appXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
	`<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
	`<Application>SamOffice</Application></Properties>`

const themeXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
	`<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">` +
	`<a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
	`<a:dk2><a:srgbClr val="1F3864"/></a:dk2><a:lt2><a:srgbClr val="EEF1F5"/></a:lt2>` +
	`<a:accent1><a:srgbClr val="4F46E5"/></a:accent1><a:accent2><a:srgbClr val="2E75B6"/></a:accent2><a:accent3><a:srgbClr val="10B981"/></a:accent3>` +
	`<a:accent4><a:srgbClr val="F59E0B"/></a:accent4><a:accent5><a:srgbClr val="EF4444"/></a:accent5><a:accent6><a:srgbClr val="8B5CF6"/></a:accent6>` +
	`<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>` +
	`<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
	`<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>` +
	`<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>` +
	`<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
	`<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>` +
	`</a:themeElements></a:theme>`

const masterXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
	`<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
	`<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>` +
	`<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>` +
	`<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
	`<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
	`<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>` +
	`</p:sldMaster>`

const masterRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
	`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
	`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
	`<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>` +
	`</Relationships>`

const layoutXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
	`<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">` +
	`<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>` +
	`<p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr>` +
	`</p:sldLayout>`

const layoutRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
	`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
	`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>` +
	`<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>` +
	`</Relationships>`

// ---------- zip 助手 ----------

func writeZip(zw *zip.Writer, name, content string) error {
	w, err := zw.Create(name)
	if err != nil {
		return err
	}
	_, err = io.WriteString(w, content)
	return err
}

func writeZipBytes(zw *zip.Writer, name string, data []byte) error {
	w, err := zw.Create(name)
	if err != nil {
		return err
	}
	_, err = w.Write(data)
	return err
}
