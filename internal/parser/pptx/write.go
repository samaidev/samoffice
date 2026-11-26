// Package pptx 实现 OOXML .pptx 的自研写入器（与 parser.go 的解析器互补）。
// 将前端传来的幻灯片 JSON 写成一个可被 PowerPoint / WPS / LibreOffice 打开的合法 PPTX。
// 支持：每页背景色、文本形状（位置/大小/文字/颜色/字号/加粗/对齐/垂直锚定）、
// 矩形/椭圆/三角/菱形/箭头/星形/六边形/五边形/心形/云形/标注等基础几何、
// 图片（data URL 嵌入）、以及艺术字（作为文本形状）。
package pptx

import (
        "archive/zip"
        "bytes"
        "encoding/base64"
        "encoding/json"
        "fmt"
        "io"
        "math"
        "os"
        "path"
        "strings"
)

// ---------- 前端 JSON 结构 ----------

type writePPTX struct {
        PageW  int64        `json:"pageW"`
        PageH  int64        `json:"pageH"`
        Slides []slideWrite `json:"slides"`
        // 母版形状（母版视图编辑的装饰层；写盘进 slideMaster1.xml spTree，对齐 MS PPT 母版）
        MasterShapes []shapeWrite `json:"masterShapes,omitempty"`
        // round66：讲义母版（讲义母版视图编辑；写盘进 handoutMaster1.xml 占位符文本/字号/颜色）
        HandoutMaster *handoutWrite `json:"handoutMaster,omitempty"`
}

// round66：讲义母版写盘模型（与前端 HandoutMaster 一一对应）
type handoutWrite struct {
        Header   string `json:"header,omitempty"`
        Footer   string `json:"footer,omitempty"`
        Date     string `json:"date,omitempty"`
        PageOn   *bool  `json:"pageOn,omitempty"` // nil = 默认开
        FontSize int    `json:"fontSize,omitempty"`
        Color    string `json:"color,omitempty"`
}

// round72：标题/正文文字样式（前端 titleStyle/contentStyle 落盘模型）。
// 前端把标题/正文写成占位符形状（ph=ctrTitle/body），样式一并携带。
type textStyleWrite struct {
        Color      string  `json:"color,omitempty"`      // #RRGGBB
        FontSize   int     `json:"fontSize,omitempty"`   // pt
        FontFamily string  `json:"fontFamily,omitempty"` // 字体族
        Bold       *bool   `json:"bold,omitempty"`       // 显式加粗（nil = 版式默认）
        Align      string  `json:"align,omitempty"`      // left|center|right
        LineHeight float64 `json:"lineHeight,omitempty"`  // 行距倍数
        Indent     int     `json:"indent,omitempty"`     // 缩进层级
        Bullet     bool    `json:"bullet,omitempty"`     // 项目符号
        Numbered   bool    `json:"numbered,omitempty"`    // 编号列表
}

type slideWrite struct {
        Bg         string       `json:"bg"`
        Notes      string       `json:"notes"`
        Transition string       `json:"transition,omitempty"` // ""/fade/push/wipe/cover/cut/zoom/morph
        Shapes     []shapeWrite `json:"shapes"`
        // round72：标题/正文直接文字（前端标题/正文输入框内容落盘 —— 旧版只透传
        // 不写 XML，保存后标题正文丢失）。非空时写成 ctrTitle/body 占位符形状。
        Title       string          `json:"title,omitempty"`
        Content     string          `json:"content,omitempty"`
        TitleStyle  *textStyleWrite `json:"titleStyle,omitempty"`
        ContentStyle *textStyleWrite `json:"contentStyle,omitempty"`
}

type shapeWrite struct {
        Kind       string      `json:"kind"`   // text | rect | pic
        Type       string      `json:"type"`   // rect/ellipse/triangle/... (几何)
        X          int64       `json:"x"`      // EMU
        Y          int64       `json:"y"`      // EMU
        Cx         int64       `json:"cx"`     // EMU
        Cy         int64       `json:"cy"`     // EMU
        Fill       string      `json:"fill"`   // #RRGGBB 或 url("data:...")
        Text       string      `json:"text"`   // 多行以 \n 分隔
        Color      string      `json:"color"`  // #RRGGBB
        SizePt     int         `json:"sizePt"` // 磅
        Bold       bool        `json:"bold"`   // 文字加粗
        Italic     bool        `json:"italic"`
        Underline  bool        `json:"underline"`
        Font       string      `json:"font"`
        Align      string      `json:"align"`                // l|c|r
        Vanchor    string      `json:"vanchor"`              // t|ctr|b
        Img        string      `json:"img"`                  // 图片 data URL
        LineColor  string      `json:"lineColor,omitempty"`  // 边框色 #RRGGBB（a:ln solidFill）
        LineWpt    float64     `json:"lineWpt,omitempty"`    // 边框宽（磅）
        Gradient   string      `json:"gradient,omitempty"`   // 渐变 "RRGGBB,RRGGBB"
        Shadow     bool        `json:"shadow,omitempty"`     // 外阴影
        Glow       bool        `json:"glow,omitempty"`       // 发光
        GlowColor  string      `json:"glowColor,omitempty"`  // 发光色 #RRGGBB
        Rotation   float64     `json:"rotation,omitempty"`   // 旋转角度（度）
        Bullet     bool        `json:"bullet,omitempty"`     // 项目符号
        Numbered   bool        `json:"numbered,omitempty"`   // 编号列表
        LineHeight float64     `json:"lineHeight,omitempty"` // 行距倍数（1=单倍）
        Indent     int         `json:"indent,omitempty"`     // 缩进层级（0 起）
        Link       string      `json:"link,omitempty"`       // 超链接 URL
        GroupID    string      `json:"groupId,omitempty"`    // 所属组合 ID（非空时连续同组段写出为 p:grpSp）
        Paras      []paraWrite `json:"paras"`                // 逐段逐 run（优先于 Text/Color 等扁平字段）
}

type paraWrite struct {
        Align string     `json:"align"` // l|c|r
        Runs  []runWrite `json:"runs"`
}

type runWrite struct {
        Text      string `json:"text"`
        Color     string `json:"color"`
        SizePt    int    `json:"sizePt"`
        Bold      bool   `json:"bold"`
        Italic    bool   `json:"italic"`
        Underline bool   `json:"underline"`
        Font      string `json:"font"`
}

// ---------- 公共入口 ----------

// WritePPTX 把前端 slides JSON 写成 PPTX 文件
func WritePPTX(p string, jsonStr string) error {
	data, err := pptxBytesFromJSON(jsonStr)
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0o644)
}

// WritePPTXBytes 把前端 slides JSON 在内存中生成完整 PPTX 字节并返回。
// 供 HTTP 导出（远程/浏览器模式下载）复用同一套写入器，不落盘。
func WritePPTXBytes(jsonStr string) ([]byte, error) {
	return pptxBytesFromJSON(jsonStr)
}

// pptxBytesFromJSON 解析前端 JSON 并构建 PPTX ZIP 字节
func pptxBytesFromJSON(jsonStr string) ([]byte, error) {
	var data writePPTX
	if err := json.Unmarshal([]byte(jsonStr), &data); err != nil {
		return nil, fmt.Errorf("parse pptx json: %w", err)
	}
	if len(data.Slides) == 0 {
		return nil, fmt.Errorf("no slides to write")
	}
	pageW, pageH := data.PageW, data.PageH
	if pageW <= 0 {
		pageW = 12192000
	}
	if pageH <= 0 {
		pageH = 6858000
	}

	builder := &pptxWriter{pageW: pageW, pageH: pageH}
	if err := builder.build(data.Slides, data.MasterShapes); err != nil {
		return nil, err
	}
	// round66：讲义母版（写盘占位符文本/样式）
	builder.handout = data.HandoutMaster
	var buf bytes.Buffer
	if err := builder.writeTo(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ---------- 写入器 ----------

type mediaFile struct {
        name string // ppt/media/image1.png
        ext  string
        data []byte
}

type pptxWriter struct {
        pageW   int64
        pageH   int64
        slides  []slideWrite
        media   []mediaFile
        bgMedia []string     // 每页背景图的 media 名（无背景图为空串），与 slides 一一对应
        master  []shapeWrite // 母版形状（母版视图编辑，写盘进 slideMaster1.xml）
        // round66：讲义母版（讲义母版视图编辑，写盘进 handoutMaster1.xml）
        handout *handoutWrite
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
        // === 流程图（对齐 MS PPT 形状库；解析端 GEOM_MAP 逆向对应）===
        case "parallelogram":
                return "parallelogram"
        case "trapezoid":
                return "trapezoid"
        case "can", "cylinder":
                return "can"
        case "flowdoc", "flowdocument":
                return "flowChartDocument"
        case "chevron":
                return "chevron"
        case "lightning", "lightningbolt":
                return "lightningBolt"
        case "flowmanualinput":
                return "flowChartManualInput"
        case "flowdelay":
                return "flowChartDelay"
        case "flowmerge":
                return "flowChartMerge"
        case "flowoffpage", "flowoffpageconnector":
                return "flowChartOffpageConnector"
        case "leftarrow":
                return "leftArrow"
        case "uparrow":
                return "upArrow"
        case "downarrow":
                return "downArrow"
        case "leftrightarrow":
                return "leftRightArrow"
        case "updownarrow":
                return "upDownArrow"
        case "bentarrow":
                return "bentArrow"
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

// normFont 清理字体名（去引号/空白）；空或主题占位名返回 ""
func normFont(f string) string {
        f = strings.TrimSpace(f)
        f = strings.Trim(f, "\"'")
        switch strings.ToLower(f) {
        case "", "+mn-lt", "+mj-lt", "sans-serif", "serif":
                return ""
        }
        return f
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

// extractBGDataURL 从背景 "url(...)" 形式中提取 data: URL；非图片背景返回 ""
func extractBGDataURL(bg string) string {
        bg = strings.TrimSpace(bg)
        if !strings.HasPrefix(bg, "url(") {
                return ""
        }
        i := strings.Index(bg, "data:")
        if i < 0 {
                return ""
        }
        rest := bg[i:]
        // 截到收尾引号或右括号
        end := len(rest)
        for j := 0; j < len(rest); j++ {
                if rest[j] == '"' || rest[j] == '\'' || rest[j] == ')' {
                        end = j
                        break
                }
        }
        return strings.TrimSpace(rest[:end])
}

// parseGradientColors 解析 "C1,C2"（可带 #）渐变为两个 RRGGBB；不足两个有效色返回 false
func parseGradientColors(g string) (string, string, bool) {
        parts := strings.Split(g, ",")
        var cols []string
        for _, p := range parts {
                if c := normColor(p); c != "" {
                        cols = append(cols, c)
                }
        }
        if len(cols) >= 2 {
                return cols[0], cols[1], true
        }
        return "", "", false
}

// effectLstXML 生成 a:effectLst（形状效果）。
// 注意 CT_EffectList 子元素顺序：glow 必须在 outerShdw 之前。
func effectLstXML(shadow, glow bool, glowColor string) string {
        if !shadow && !glow {
                return ""
        }
        var b strings.Builder
        b.WriteString(`<a:effectLst>`)
        if glow {
                gc := normColor(glowColor)
                if gc == "" {
                        gc = "6366F1"
                }
                b.WriteString(`<a:glow rad="76200"><a:srgbClr val="`)
                b.WriteString(gc)
                b.WriteString(`"/></a:glow>`)
        }
        if shadow {
                b.WriteString(`<a:outerShdw blurRad="50800" dist="38100" dir="5400000" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:outerShdw>`)
        }
        b.WriteString(`</a:effectLst>`)
        return b.String()
}

// paraPrXML 生成完整的 <a:pPr> 元素。
// 子元素按 OOXML schema 顺序：lnSpc 最先，buFont 在 buChar/buAutoNum 之前。
// bullet/numbered 时 marL=285750*(indent+1)、indent=-285750。
func paraPrXML(align string, lineHeight float64, bullet, numbered bool, indent int) string {
        lvl := indent
        if lvl < 0 {
                lvl = 0
        }
        var b strings.Builder
        b.WriteString(`<a:pPr`)
        if bullet || numbered {
                fmt.Fprintf(&b, ` marL="%d" indent="-285750"`, 285750*(lvl+1))
        }
        b.WriteString(` algn="`)
        b.WriteString(alignToPptx(align))
        b.WriteString(`"`)
        hasLnSpc := lineHeight > 0 && lineHeight != 1
        if !hasLnSpc && !bullet && !numbered {
                b.WriteString(`/>`)
                return b.String()
        }
        b.WriteString(`>`)
        if hasLnSpc {
                fmt.Fprintf(&b, `<a:lnSpc><a:spcPct val="%d"/></a:lnSpc>`, int64(math.Round(lineHeight*100000)))
        }
        if bullet || numbered {
                b.WriteString(`<a:buFont typeface="Arial"/>`)
                if numbered {
                        b.WriteString(`<a:buAutoNum type="arabicPeriod"/>`)
                } else {
                        b.WriteString(`<a:buChar char="•"/>`)
                }
        }
        b.WriteString(`</a:pPr>`)
        return b.String()
}

// transitionXML 幻灯片切换效果（morph 按 fade 处理；其余未知值忽略）。
// 输出形如 <p:transition spd="med"><p:fade/></p:transition>。
func transitionXML(t string) string {
        var inner string
        switch strings.ToLower(strings.TrimSpace(t)) {
        case "push":
                inner = `<p:push dir="u"/>`
        case "wipe":
                inner = `<p:wipe dir="d"/>`
        case "cover":
                inner = `<p:cover dir="d"/>`
        case "cut":
                inner = `<p:cut/>`
        case "zoom":
                inner = `<p:zoom/>`
        case "fade", "morph":
                inner = `<p:fade/>`
        default:
                return ""
        }
        return `<p:transition spd="med">` + inner + `</p:transition>`
}

// build 准备所有媒体并校验
func (w *pptxWriter) build(slides []slideWrite, masterShapes []shapeWrite) error {
        w.slides = slides
        w.master = masterShapes
        w.bgMedia = make([]string, len(slides))
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
        // 背景图：bg 形如 url("data:image/png;base64,...") → 解码为媒体部件
        for i := range slides {
                s := &slides[i]
                if du := extractBGDataURL(s.Bg); du != "" {
                        if m, ok := decodeDataURL(du); ok {
                                name := fmt.Sprintf("ppt/media/image%d.%s", len(w.media)+1, m.ext)
                                w.media = append(w.media, mediaFile{name: name, ext: m.ext, data: m.data})
                                w.bgMedia[i] = name
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

// slideXML 生成单张幻灯片 XML。
// mediaRels 为该页引用的 media -> rId 映射；linkRels 为 URL -> rId 映射；bgRId 为背景图 rId（无则空）
func (w *pptxWriter) slideXML(s slideWrite, mediaRels map[string]string, linkRels map[string]string, bgRId string) string {
        var b strings.Builder
        b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
        b.WriteString(`<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">`)
        // 背景：图片背景（url("data:...")）优先，其次纯色
        bgWritten := false
        if bgRId != "" {
                b.WriteString(`<p:cSld><p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="`)
                b.WriteString(bgRId)
                b.WriteString(`"/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>`)
                bgWritten = true
        }
        if !bgWritten {
                bg := normColor(s.Bg)
                if bg != "" && strings.ToUpper(bg) != "FFFFFF" {
                        b.WriteString(`<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="`)
                        b.WriteString(bg)
                        b.WriteString(`"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`)
                        bgWritten = true
                }
        }
        if !bgWritten {
                b.WriteString(`<p:cSld>`)
        }

        b.WriteString(`<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>`)

        // round72：标题/正文占位符形状（旧版 title/content 只透传不落盘，保存即丢）。
        // 写成 ctrTitle/body 占位符 —— 解析端按 ph 提取回 slide.Title/Bullets，
        // 应用内保存重开往返不丢。id 2/3（形状 idBase=10 起，不冲突）。
        // paraPrXML 的 align 入参是 l|c|r（其内部 alignToPptx 转 ctr/r/l）
        phAlignToPptx := func(a string) string {
                switch a {
                case "left":
                        return "l"
                case "right":
                        return "r"
                case "center":
                        return "c"
                }
                return ""
        }
        // writePlaceholder 生成单个占位符 sp（ph=ctrTitle|body；文本多行逐段写出，
        // 样式：颜色/字号/字体/加粗/对齐/行距/缩进/项目符号/编号）
        writePlaceholder := func(id int, phType, name, text string, st *textStyleWrite, defaultSz int, defaultBold bool) {
                if strings.TrimSpace(text) == "" && st == nil {
                        return
                }
                b.WriteString(`<p:sp><p:nvSpPr><p:cNvPr id="`)
                b.WriteString(fmt.Sprintf("%d", id))
                b.WriteString(`" name="`)
                b.WriteString(name)
                b.WriteString(`"/><p:cNvSpPr/><p:nvPr><p:ph type="`)
                b.WriteString(phType)
                b.WriteString(`"/></p:nvPr></p:nvSpPr><p:spPr/>`)
                b.WriteString(`<p:txBody><a:bodyPr/><a:lstStyle/>`)
                lines := strings.Split(text, "\n")
                for _, line := range lines {
                        b.WriteString(`<a:p>`)
                        // 段落属性：对齐/行距/项目符号/编号/缩进（占位符文本与普通文本一致）
                        align := ""
                        if st != nil {
                                align = phAlignToPptx(st.Align)
                        }
                        var lh float64
                        var bullet, numbered bool
                        var indent int
                        if st != nil {
                                lh = st.LineHeight
                                bullet = st.Bullet
                                numbered = st.Numbered
                                indent = st.Indent
                        }
                        b.WriteString(paraPrXML(align, lh, bullet, numbered, indent))
                        if strings.TrimSpace(line) != "" {
                                sz := defaultSz
                                if st != nil && st.FontSize > 0 {
                                        sz = st.FontSize
                                }
                                color := "1F2937"
                                if st != nil && normColor(st.Color) != "" {
                                        color = normColor(st.Color)
                                }
                                bold := defaultBold
                                if st != nil && st.Bold != nil {
                                        bold = *st.Bold
                                }
                                b.WriteString(`<a:r><a:rPr lang="en-US" sz="`)
                                b.WriteString(fmt.Sprintf("%d", sz*100))
                                b.WriteString(`"`)
                                if bold {
                                        b.WriteString(` b="1"`)
                                }
                                b.WriteString(`><a:solidFill><a:srgbClr val="`)
                                b.WriteString(color)
                                b.WriteString(`"/></a:solidFill>`)
                                if st != nil && st.FontFamily != "" {
                                        if tf := normFont(st.FontFamily); tf != "" {
                                                b.WriteString(`<a:latin typeface="`)
                                                b.WriteString(xmlEsc(tf))
                                                b.WriteString(`"/>`)
                                        }
                                }
                                b.WriteString(`</a:rPr><a:t>`)
                                b.WriteString(xmlEsc(line))
                                b.WriteString(`</a:t></a:r>`)
                        }
                        b.WriteString(`</a:p>`)
                }
                b.WriteString(`</p:txBody></p:sp>`)
        }
        // 标题：默认 32pt 粗体（前端 title 布局语义）；正文：18pt 常规
        titleBold := true
        contentBold := false
        if s.Title != "" || s.TitleStyle != nil {
                writePlaceholder(2, "ctrTitle", "Title", s.Title, s.TitleStyle, 32, titleBold)
        }
        if s.Content != "" || s.ContentStyle != nil {
                writePlaceholder(3, "body", "Content", s.Content, s.ContentStyle, 18, contentBold)
        }

        // 形状序列化（文本/图片/组合）——与母版 shapesXML 共用
        b.WriteString(w.shapesXML(s.Shapes, mediaRels, linkRels, 10))

        b.WriteString(`</p:spTree></p:cSld>`)
        b.WriteString(`<p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr>`)
        // 幻灯片切换效果（CT_Slide 顺序：cSld → clrMapOvr → transition）
        if tx := transitionXML(s.Transition); tx != "" {
                b.WriteString(tx)
        }
        b.WriteString(`</p:sld>`)
        return b.String()
}

// shapesXML 把形状列表序列化为 spTree 内部 XML（文本/矩形/图片/组合）。
// mediaRels 为 media 名称→rId 映射（图片）；linkRels 为 URL→rId（超链接）；
// idBase 为 cNvPr id 基数（slide 用 10，master 用 90000 以避免与占位符 id 冲突）。
func (w *pptxWriter) shapesXML(shapes []shapeWrite, mediaRels map[string]string, linkRels map[string]string, idBase int) string {
        var b strings.Builder
        // writeShape 输出单个形状/图片（id = idBase+idx 保持全局唯一，组内同样适用）
        writeShape := func(idx int, sh shapeWrite) {
                // 旋转属性（前端存角度，xfrm rot 单位 1/60000 度）
                rotAttr := ""
                if sh.Rotation != 0 {
                        rotAttr = fmt.Sprintf(` rot="%d"`, int64(math.Round(sh.Rotation*60000)))
                }
                if sh.Kind == "pic" || strings.HasPrefix(sh.Fill, "url(") {
                        // 图片
                        imgName := sh.Img
                        rId, ok := mediaRels[imgName]
                        if !ok {
                                return
                        }
                        b.WriteString(`<p:pic><p:nvPicPr><p:cNvPr id="`)
                        b.WriteString(fmt.Sprintf("%d", idBase+idx))
                        b.WriteString(`" name="Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="`)
                        b.WriteString(rId)
                        b.WriteString(`"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm`)
                        b.WriteString(rotAttr)
                        b.WriteString(`><a:off x="`)
                        b.WriteString(fmt.Sprintf("%d", sh.X))
                        b.WriteString(`" y="`)
                        b.WriteString(fmt.Sprintf("%d", sh.Y))
                        b.WriteString(`"/><a:ext cx="`)
                        b.WriteString(fmt.Sprintf("%d", sh.Cx))
                        b.WriteString(`" cy="`)
                        b.WriteString(fmt.Sprintf("%d", sh.Cy))
                        b.WriteString(`"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`)
                        return
                }
                // 文本 / 矩形
                geom := prstGeom(sh.Type)
                fill := normColor(sh.Fill)
                b.WriteString(`<p:sp><p:nvSpPr><p:cNvPr id="`)
                b.WriteString(fmt.Sprintf("%d", idBase+idx))
                b.WriteString(`" name="Shape`)
                b.WriteString(fmt.Sprintf("%d", idx+1))
                b.WriteString(`"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>`)
                b.WriteString(`<a:xfrm`)
                b.WriteString(rotAttr)
                b.WriteString(`><a:off x="`)
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
                // 填充：渐变优先，其次纯色，否则无填充
                if c1, c2, ok := parseGradientColors(sh.Gradient); ok {
                        b.WriteString(`<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="`)
                        b.WriteString(c1)
                        b.WriteString(`"/></a:gs><a:gs pos="100000"><a:srgbClr val="`)
                        b.WriteString(c2)
                        b.WriteString(`"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="1"/></a:gradFill>`)
                } else if fill != "" {
                        b.WriteString(`<a:solidFill><a:srgbClr val="`)
                        b.WriteString(fill)
                        b.WriteString(`"/></a:solidFill>`)
                } else {
                        b.WriteString(`<a:noFill/>`)
                }
                // 描边：有边框色时输出实线，否则无线条
                if lc := normColor(sh.LineColor); lc != "" {
                        lw := int64(math.Round(sh.LineWpt * 12700))
                        if lw <= 0 {
                                lw = 12700
                        }
                        b.WriteString(`<a:ln w="`)
                        b.WriteString(fmt.Sprintf("%d", lw))
                        b.WriteString(`"><a:solidFill><a:srgbClr val="`)
                        b.WriteString(lc)
                        b.WriteString(`"/></a:solidFill></a:ln>`)
                } else {
                        b.WriteString(`<a:ln><a:noFill/></a:ln>`)
                }
                // 阴影/发光（glow 在 outerShdw 之前，符合 CT_EffectList 顺序）
                b.WriteString(effectLstXML(sh.Shadow, sh.Glow, sh.GlowColor))
                b.WriteString(`</p:spPr>`)

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
                if len(sh.Paras) > 0 {
                        // 逐段逐 run 写出（保留每个 run 的颜色/字号/加粗/斜体/下划线/字体）
                        for _, pa := range sh.Paras {
                                b.WriteString(`<a:p>`)
                                b.WriteString(paraPrXML(pa.Align, sh.LineHeight, sh.Bullet, sh.Numbered, sh.Indent))
                                for _, rn := range pa.Runs {
                                        if rn.Text == "" {
                                                continue
                                        }
                                        runSz := rn.SizePt
                                        if runSz <= 0 {
                                                runSz = sz
                                        }
                                        runColor := normColor(rn.Color)
                                        if runColor == "" {
                                                runColor = color
                                        }
                                        b.WriteString(`<a:r><a:rPr lang="en-US" sz="`)
                                        b.WriteString(fmt.Sprintf("%d", runSz*100))
                                        b.WriteString(`"`)
                                        if rn.Bold {
                                                b.WriteString(` b="1"`)
                                        }
                                        if rn.Italic {
                                                b.WriteString(` i="1"`)
                                        }
                                        if rn.Underline {
                                                b.WriteString(` u="sng"`)
                                        }
                                        b.WriteString(`><a:solidFill><a:srgbClr val="`)
                                        b.WriteString(runColor)
                                        b.WriteString(`"/></a:solidFill>`)
                                        if tf := normFont(rn.Font); tf != "" {
                                                b.WriteString(`<a:latin typeface="`)
                                                b.WriteString(xmlEsc(tf))
                                                b.WriteString(`"/>`)
                                        }
                                        // 超链接（hlinkClick 位于所有字体元素之后）
                                        if sh.Link != "" {
                                                if rid, ok := linkRels[strings.TrimSpace(sh.Link)]; ok {
                                                        b.WriteString(`<a:hlinkClick r:id="`)
                                                        b.WriteString(rid)
                                                        b.WriteString(`"/>`)
                                                }
                                        }
                                        b.WriteString(`</a:rPr><a:t>`)
                                        b.WriteString(xmlEsc(rn.Text))
                                        b.WriteString(`</a:t></a:r>`)
                                }
                                b.WriteString(`</a:p>`)
                        }
                } else {
                        lines := strings.Split(sh.Text, "\n")
                        for li, line := range lines {
                                if li > 0 {
                                        b.WriteString(`<a:p/>`)
                                }
                                b.WriteString(`<a:p>`)
                                b.WriteString(paraPrXML(sh.Align, sh.LineHeight, sh.Bullet, sh.Numbered, sh.Indent))
                                if line != "" {
                                        b.WriteString(`<a:r><a:rPr lang="en-US" sz="`)
                                        b.WriteString(fmt.Sprintf("%d", sz*100))
                                        b.WriteString(`"`)
                                        if sh.Bold {
                                                b.WriteString(` b="1"`)
                                        }
                                        if sh.Italic {
                                                b.WriteString(` i="1"`)
                                        }
                                        if sh.Underline {
                                                b.WriteString(` u="sng"`)
                                        }
                                        b.WriteString(`><a:solidFill><a:srgbClr val="`)
                                        b.WriteString(color)
                                        b.WriteString(`"/></a:solidFill>`)
                                        // 超链接（hlinkClick 位于字体填充之后）
                                        if sh.Link != "" {
                                                if rid, ok := linkRels[strings.TrimSpace(sh.Link)]; ok {
                                                        b.WriteString(`<a:hlinkClick r:id="`)
                                                        b.WriteString(rid)
                                                        b.WriteString(`"/>`)
                                                }
                                        }
                                        b.WriteString(`</a:rPr><a:t>`)
                                        b.WriteString(xmlEsc(line))
                                        b.WriteString(`</a:t></a:r>`)
                                }
                                b.WriteString(`</a:p>`)
                        }
                        if len(lines) == 0 {
                                b.WriteString(`<a:p><a:endParaRPr lang="en-US"/></a:p>`)
                        }
                }
                b.WriteString(`</p:txBody></p:sp>`)
        }

        // 遍历形状：连续同 GroupID 的段包进 p:grpSp（off/ext=成员包围盒，
        // chOff/chExt=off/ext → 恒等子空间，子形状坐标已绝对，合法 OOXML）
        idx := 0
        for idx < len(shapes) {
                gid := shapes[idx].GroupID
                if gid == "" {
                        writeShape(idx, shapes[idx])
                        idx++
                        continue
                }
                j := idx + 1
                for j < len(shapes) && shapes[j].GroupID == gid {
                        j++
                }
                members := shapes[idx:j]
                minX, minY := members[0].X, members[0].Y
                maxX, maxY := members[0].X+members[0].Cx, members[0].Y+members[0].Cy
                for _, m := range members[1:] {
                        if m.X < minX {
                                minX = m.X
                        }
                        if m.Y < minY {
                                minY = m.Y
                        }
                        if m.X+m.Cx > maxX {
                                maxX = m.X + m.Cx
                        }
                        if m.Y+m.Cy > maxY {
                                maxY = m.Y + m.Cy
                        }
                }
                b.WriteString(`<p:grpSp><p:nvGrpSpPr><p:cNvPr id="`)
                // 组 id 与形状 id（idBase+idx）不冲突（≥1000+len，远大于 idBase+idx 的上限）
                b.WriteString(fmt.Sprintf("%d", len(shapes)+1000+idx))
                b.WriteString(`" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm>`)
                b.WriteString(`<a:off x="`)
                b.WriteString(fmt.Sprintf("%d", minX))
                b.WriteString(`" y="`)
                b.WriteString(fmt.Sprintf("%d", minY))
                b.WriteString(`"/><a:ext cx="`)
                b.WriteString(fmt.Sprintf("%d", maxX-minX))
                b.WriteString(`" cy="`)
                b.WriteString(fmt.Sprintf("%d", maxY-minY))
                b.WriteString(`"/><a:chOff x="`)
                b.WriteString(fmt.Sprintf("%d", minX))
                b.WriteString(`" y="`)
                b.WriteString(fmt.Sprintf("%d", minY))
                b.WriteString(`"/><a:chExt cx="`)
                b.WriteString(fmt.Sprintf("%d", maxX-minX))
                b.WriteString(`" cy="`)
                b.WriteString(fmt.Sprintf("%d", maxY-minY))
                b.WriteString(`"/></a:xfrm></p:grpSpPr>`)
                for k := idx; k < j; k++ {
                        writeShape(k, shapes[k])
                }
                b.WriteString(`</p:grpSp>`)
                idx = j
        }
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
// save 保留写盘入口（旧签名兼容）；内部统一走 writeTo
func (w *pptxWriter) save(p string) error {
	f, err := os.Create(p)
	if err != nil {
		return err
	}
	defer f.Close()
	return w.writeTo(f)
}

// writeTo 把整个 PPTX ZIP 写入任意 io.Writer（内存 buffer / 磁盘文件 / HTTP 响应体）
func (w *pptxWriter) writeTo(dst io.Writer) error {
	zw := zip.NewWriter(dst)
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
        // 母版形状（MasterShapes 非空时写进 spTree，实现真实母版层）
        if err := writeZip(zw, "ppt/slideMasters/slideMaster1.xml", w.buildMasterXML(w.master)); err != nil {
                return err
        }
        if err := writeZip(zw, "ppt/slideMasters/_rels/slideMaster1.xml.rels", masterRels); err != nil {
                return err
        }
        // round66：讲义母版 + 备注母版（对齐 MS PPT 母版家族：幻灯片/讲义/备注三母版）。
        // 讲义母版承载讲义页的页眉/页脚/日期/页码占位符（打印讲义时应用）；
        // 备注母版承载备注页版式。均为标准 OOXML 部件 —— 之前缺失，用户在 MS PPT
        // 里看到的"讲义母版视图"在本工程保存的文件里不存在，保存往返丢配置。
        if err := writeZip(zw, "ppt/handoutMasters/handoutMaster1.xml", w.buildHandoutMasterXML(w.handout)); err != nil {
                return err
        }
        if err := writeZip(zw, "ppt/handoutMasters/_rels/handoutMaster1.xml.rels", handoutMasterRels); err != nil {
                return err
        }
        if err := writeZip(zw, "ppt/notesMasters/notesMaster1.xml", buildNotesMasterXML()); err != nil {
                return err
        }
        if err := writeZip(zw, "ppt/notesMasters/_rels/notesMaster1.xml.rels", notesMasterRels); err != nil {
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
                // 背景图关系
                bgRId := ""
                if i < len(w.bgMedia) && w.bgMedia[i] != "" {
                        for mi, m := range w.media {
                                if m.name == w.bgMedia[i] {
                                        bgRId = fmt.Sprintf("rIdM%d", mi+1)
                                        mediaRels[m.name] = bgRId
                                        break
                                }
                        }
                }
                // 超链接外部关系（按出现顺序去重，rIdH1..N）
                linkOrder := []string{}
                seenLink := map[string]bool{}
                for _, sh := range s.Shapes {
                        if u := strings.TrimSpace(sh.Link); u != "" && !seenLink[u] {
                                seenLink[u] = true
                                linkOrder = append(linkOrder, u)
                        }
                }
                linkRels := map[string]string{}
                for n, u := range linkOrder {
                        linkRels[u] = fmt.Sprintf("rIdH%d", n+1)
                }
                xml := w.slideXML(s, mediaRels, linkRels, bgRId)
                name := fmt.Sprintf("ppt/slides/slide%d.xml", i+1)
                if err := writeZip(zw, name, xml); err != nil {
                        return err
                }
                // slide rels（含图片引用 + 超链接）
                rels := w.slideRels(mediaRels, linkOrder)
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

        // 关闭 zip（写入中央目录）——不关闭则 ZIP 不完整，PPT 打不开
        return zw.Close()
}

// presentation 生成 presentation.xml 与 rels（rId1=master, rId2=layout, rId3=theme, rId4..N+3=slides）
func (w *pptxWriter) presentation(n int) (string, string) {
        var body strings.Builder
        body.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
        body.WriteString(`<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">`)
        body.WriteString(`<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>`)
        // round66：讲义/备注母版注册（notesMasterIdLst CT_IndexList，讲义母版通过
        // presentation.xml.rels 直接引用 —— 无 presentation 内引用元素；notesMasterIdLst
        // 挂备注母版。二者 PowerPoint 均要求存在）。rId 用 slides 之后的首两个
        //（rId(N+4)、rId(N+5)）—— 保持全数字序列，最大化 PowerPoint 兼容。
        handoutRId := fmt.Sprintf("rId%d", n+4)
        notesRId := fmt.Sprintf("rId%d", n+5)
        body.WriteString(`<p:notesMasterIdLst><p:notesMasterId id="2147483649" r:id="` + notesRId + `"/></p:notesMasterIdLst>`)
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
        // round66：讲义母版 + 备注母版关系（slides 之后的两个数字 rId，与上方
        // notesMasterIdLst/notesRId 一致；讲义母版无 presentation 内元素只挂 rels）
        rels.WriteString(`<Relationship Id="` + handoutRId + `" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/handoutMaster" Target="handoutMasters/handoutMaster1.xml"/>`)
        rels.WriteString(`<Relationship Id="` + notesRId + `" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="notesMasters/notesMaster1.xml"/>`)
        for i := 0; i < n; i++ {
                rels.WriteString(fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide%d.xml"/>`, i+4, i+1))
        }
        rels.WriteString(`</Relationships>`)
        return body.String(), rels.String()
}

// slideRels 生成单页 rels（含图片引用 rIdM* 与超链接 rIdH*）
func (w *pptxWriter) slideRels(mediaRels map[string]string, linkOrder []string) string {
        var b strings.Builder
        b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
        b.WriteString(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`)
        b.WriteString(`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`)
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
        // 超链接外部关系
        for n, u := range linkOrder {
                b.WriteString(fmt.Sprintf(`<Relationship Id="rIdH%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="%s" TargetMode="External"/>`, n+1, xmlEsc(u)))
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
        b.WriteString(`<Default Extension="svg" ContentType="image/svg+xml"/>`)
        b.WriteString(`<Default Extension="webp" ContentType="image/webp"/>`)
        b.WriteString(`<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`)
        b.WriteString(`<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`)
        // round66：讲义/备注母版部件类型注册
        b.WriteString(`<Override PartName="/ppt/handoutMasters/handoutMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.handoutMaster+xml"/>`)
        b.WriteString(`<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>`)
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

// buildMasterXML 生成 slideMaster1.xml；masterShapes 非空时写入母版 spTree（母版层），
// 否则与旧静态模板等价。母版图片未收集 media，忽略 pic 类型。
func (w *pptxWriter) buildMasterXML(shapes []shapeWrite) string {
        // 过滤掉图片形状（母版媒体关系未登记；母版通常只放文本/装饰形状）
        filtered := make([]shapeWrite, 0, len(shapes))
        for _, sh := range shapes {
                if sh.Kind == "pic" || strings.HasPrefix(sh.Fill, "url(") {
                        continue
                }
                filtered = append(filtered, sh)
        }
        var sb strings.Builder
        sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
        sb.WriteString(`<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">`)
        sb.WriteString(`<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>`)
        sb.WriteString(`<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>`)
        sb.WriteString(w.shapesXML(filtered, map[string]string{}, map[string]string{}, 90000))
        sb.WriteString(`</p:spTree></p:cSld>`)
        sb.WriteString(`<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>`)
        sb.WriteString(`<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>`)
        sb.WriteString(`<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>`)
        sb.WriteString(`</p:sldMaster>`)
        return sb.String()
}

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

// round66：讲义/备注母版（对齐 MS PPT「讲义母版视图」「备注母版视图」）。
// 讲义母版标准占位符四件套（与 PowerPoint 默认 handoutMaster 一致）：
//   页眉（hdr 顶部左）/ 页脚（ftr 底部左）/ 日期（dt 顶部左上）/ 页码（sldNum 底部右）。
// notesSz 纵向 A4（6858000×9144000 EMU = 7.5×10 英寸）与 presentation.xml 一致。

const handoutMasterRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>` +
        `</Relationships>`

const notesMasterRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>` +
        `</Relationships>`

// 占位符 sp 生成（type=hdr/ftr/dt/sldNum + 位置 + 默认字号）。文本为空 ——
// PowerPoint 打开时按幻灯片母版页脚设置渲染实际内容（讲义母版只管样式与布局）。
const handoutNS = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`

func handoutPlaceholder(id int, name, phType, phIdx string, x, y, cx, cy int, align string) string {
        algn := ""
        if align != "" {
                algn = `<a:pPr algn="` + align + `"/>`
        }
        return `<p:sp><p:nvSpPr><p:cNvPr id="` + fmt.Sprintf("%d", id) + `" name="` + name + `"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="` + phType + `"` +
                func() string { if phIdx != "" { return ` idx="` + phIdx + `"` } ; return `` }() + `/></p:nvPr></p:nvSpPr>` +
                `<p:spPr><a:xfrm><a:off x="` + fmt.Sprintf("%d", x) + `" y="` + fmt.Sprintf("%d", y) + `"/><a:ext cx="` + fmt.Sprintf("%d", cx) + `" cy="` + fmt.Sprintf("%d", cy) + `"/></a:xfrm>` +
                `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
                `<p:txBody ` + handoutNS + `><a:bodyPr/><a:lstStyle/><a:p>` + algn + `<a:r><a:rPr lang="zh-CN" sz="1200"/><a:t></a:t></a:r></a:p></p:txBody></p:sp>`
}

// round66：带文本/样式/页码字段（fld）的占位符 —— 讲义母版编辑态写出。
// text = 占位符文字（页码传 "<fld>" 特殊值 → 输出 a:fld slidenc 自动页码）。
func handoutPlaceholderText(id int, name, phType string, x, y, cx, cy int, align, text, rPrFull string) string {
        algn := ""
        if align != "" {
                algn = `<a:pPr algn="` + align + `"/>`
        }
        var run string
        if text == "<Compatible:页码自动>" {
                // sldNum 占位符用字段（PowerPoint 自动填页码）—— 对齐 MS PPT 讲义母版
                run = `<a:fld id="{28B5D1D5-31BE-4CE5-BFBB-D6AC9A1AF02B}" type="slidenum">` + rPrFull + `<a:t>1</a:t></a:fld>`
        } else if text != "" {
                run = `<a:r>` + rPrFull + `<a:t>` + xmlEsc(text) + `</a:t></a:r>`
        } else {
                run = `<a:endParaRPr lang="zh-CN" sz="1200"/>`
        }
        return `<p:sp><p:nvSpPr><p:cNvPr id="` + fmt.Sprintf("%d", id) + `" name="` + name + `"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="` + phType + `"/></p:nvPr></p:nvSpPr>` +
                `<p:spPr><a:xfrm><a:off x="` + fmt.Sprintf("%d", x) + `" y="` + fmt.Sprintf("%d", y) + `"/><a:ext cx="` + fmt.Sprintf("%d", cx) + `" cy="` + fmt.Sprintf("%d", cy) + `"/></a:xfrm>` +
                `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
                `<p:txBody ` + handoutNS + `><a:bodyPr/><a:lstStyle/><a:p>` + algn + run + `</a:p></p:txBody></p:sp>`
}

// buildHandoutMasterXML：讲义母版（页眉/页脚/日期/页码四占位符，纵向 A4 版面）。
// round66：接受编辑态（页眉/页脚/日期文本 + 字号/颜色写进占位符 rPr；页码开关
// 映射 sldNum 占位符的文本 —— 关时输出空占位符保留结构）。
func (w *pptxWriter) buildHandoutMasterXML(h *handoutWrite) string {
        // A4 纵向 6858000×9144000；占位符条位于页缘（页眉 y=612940 上部 / 页脚 y=8429400 底部）
        const bandH = 457200 // 0.5in
        // 编辑态归一化（nil = 全默认）
        hdrText, ftrText, dtText := "", "", ""
        sz := 1200 // 12pt
        colr := ""
        if h != nil {
                hdrText, ftrText, dtText = h.Header, h.Footer, h.Date
                if h.FontSize > 0 && h.FontSize <= 400 {
                        sz = h.FontSize * 100
                }
                colr = strings.TrimPrefix(h.Color, "#")
                if len(colr) == 6 {
                        colr = strings.ToUpper(colr)
                } else {
                        colr = ""
                }
        }
        rPrFull := func() string {
                s := fmt.Sprintf(` sz="%d"`, sz)
                if colr != "" {
                        s += fmt.Sprintf(`<a:solidFill><a:srgbClr val="%s"/></a:solidFill>`, colr)
                }
                return s
        }
        ph := make([]string, 0, 4)
        ph = append(ph, handoutPlaceholderText(2, "Date Placeholder 1", "dt", 457200, 612940, 2133600, bandH, "", dtText, rPrFull()))
        ph = append(ph, handoutPlaceholderText(3, "Header Placeholder 2", "hdr", 4267200, 612940, 2133600, bandH, "r", hdrText, rPrFull()))
        ph = append(ph, handoutPlaceholderText(4, "Footer Placeholder 3", "ftr", 457200, 8429400, 2133600, bandH, "", ftrText, rPrFull()))
        ph = append(ph, handoutPlaceholderText(5, "Slide Number Placeholder 4", "sldNum", 4267200, 8429400, 2133600, bandH, "r", "<Compatible:页码自动>", rPrFull()))
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
                `<p:handoutMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
                `<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>` +
                `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
                strings.Join(ph, "") +
                `</p:spTree></p:cSld>` +
                `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
                `</p:handoutMaster>`
}

// buildNotesMasterXML：备注母版（幻灯片图像区 + 备注文本区 + 页眉/页脚/日期/页码）。
func buildNotesMasterXML() string {
        const W = 6858000
        const H = 9144000
        ph := make([]string, 0, 6)
        // 幻灯片图像区（sldImg 上半部居中）+ 备注正文（body 下半部）
        ph = append(ph, `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="685800"/><a:ext cx="5486400" cy="2743200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp>`)
        ph = append(ph, `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="3657600"/><a:ext cx="5486400" cy="4114800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="1200"/><a:t></a:t></a:r></a:p></p:txBody></p:sp>`)
        ph = append(ph, handoutPlaceholder(4, "Date Placeholder 3", "dt", "", 457200, 612940, 2133600, 457200, ""))
        ph = append(ph, handoutPlaceholder(5, "Slide Number Placeholder 4", "sldNum", "", 4267200, 8429400, 2133600, 457200, "r"))
        ph = append(ph, handoutPlaceholder(6, "Footer Placeholder 5", "ftr", "", 457200, 8429400, 2133600, 457200, ""))
        ph = append(ph, handoutPlaceholder(7, "Header Placeholder 6", "hdr", "", 4267200, 612940, 2133600, 457200, "r"))
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
                `<p:notesMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
                `<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>` +
                `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
                strings.Join(ph, "") +
                `</p:spTree></p:cSld>` +
                `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
                `</p:notesMaster>`
}

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
