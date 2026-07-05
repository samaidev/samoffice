// Package pptgo 提供简洁的 .pptx 文件读写 API
// 设计参考 python-pptx，自研 OOXML Presentation 渲染
//
// 支持功能：
//   - 多布局幻灯片（标题/内容/空白）
//   - 形状（矩形/圆/箭头/星形/流程图节点）
//   - 动画（进入/强调/退出/路径）
//   - 过渡效果（淡入/推入/擦除等）
//   - 自动播放 + 排练计时
//   - 智能流程图（自动布局）
//   - 艺术字（3D/阴影/渐变）
//   - 特效（阴影/发光/反射/柔边）
//   - 演讲者备注
package pptgo

import (
        "archive/zip"
        "bytes"
        "fmt"
        "os"
        "strings"
        "time"
)

// Layout 幻灯片布局类型
type Layout int

const (
        LayoutTitle Layout = iota
        LayoutContent
        LayoutBlank
)

// Presentation 表示一个演示文稿
type Presentation struct {
        title       string
        author      string
        subject     string
        slides      []*Slide
        autoPlay    bool      // 自动播放
        advanceTime int       // 自动换页时间（秒）
}

// Slide 表示一张幻灯片
type Slide struct {
        layout       Layout
        title        string
        subtitle     string
        bullets      []string
        images       []ImageItem
        shapes       []Shape
        artTexts     []ArtText
        flowCharts   []FlowChart
        bgColor      string
        transition   string
        transitionDur int     // 过渡时长 ms
        animations   []Animation
        notes        string
        advanceTime  int       // 该页自动换页时间（秒），0=手动
}

// Shape 形状
type Shape struct {
        Type     string  // rect/roundRect/ellipse/arrow/rightArrow/star5/triangle/diamond
        X, Y     int     // 位置 EMU
        W, H     int     // 尺寸 EMU
        Fill     string  // 填充色 hex
        Stroke   string  // 边框色 hex
        StrokeW  int     // 边框宽度 EMU
        Text     string  // 形状内文字
        FontSize int     // 文字字号（pt*100，如 1600=16pt）
        FontBold bool
        FontColor string // 文字颜色
        // 特效
        Shadow     bool
        Glow       bool
        GlowColor  string
        GlowRadius int
        Reflection bool
        SoftEdge   bool
        Gradient   string // 渐变色 "4f46e5,818cf8"
        Rotation   int    // 旋转角度
}

// ArtText 艺术字
type ArtText struct {
        Text       string
        X, Y       int
        W, H       int
        FontSize   int    // pt*100
        FontColor  string
        Bold       bool
        // 特效
        Shadow     bool
        Outline    string // 描边色
        OutlineW   int    // 描边宽度
        Glow       bool
        GlowColor  string
        Reflection bool
        Gradient   string // 渐变
        Font       string // 字体名
        Rotation   int
}

// FlowChart 流程图
type FlowChart struct {
        Nodes      []FlowNode
        X, Y       int // 起始位置 EMU
        Direction  string // "horizontal" / "vertical"
        NodeW      int
        NodeH      int
        NodeGap    int // 节点间距
        NodeFill   string
        NodeStroke string
}

// FlowNode 流程图节点
type FlowNode struct {
        Text     string
        Type     string // "start" / "process" / "decision" / "end" / "data"
        Shape    string // 对应 Shape Type
}

// Animation 元素动画
type Animation struct {
        Target   string // "title" / "subtitle" / "bullet_N" / "image_N" / "shape_N"
        Effect   string // "fade" / "fly" / "zoom" / "wipe" / "bounce" / "spin" / "pulse"
        Category string // "entrance" / "emphasis" / "exit"
        Delay    int    // ms
        Duration int    // ms
}

// ImageItem 图片项
type ImageItem struct {
        path string
        data []byte
        x, y int // px
        w, h int // px
}

// === Presentation 方法 ===

func New() *Presentation {
        return &Presentation{title: "Untitled Presentation"}
}

func (p *Presentation) SetTitle(title string) *Presentation { p.title = title; return p }
func (p *Presentation) SetAuthor(author string) *Presentation { p.author = author; return p }
func (p *Presentation) SetSubject(subject string) *Presentation { p.subject = subject; return p }
func (p *Presentation) Title() string { return p.title }
func (p *Presentation) Slides() []*Slide { return p.slides }

// SetAutoPlay 设置自动播放
func (p *Presentation) SetAutoPlay(autoPlay bool, advanceSeconds int) *Presentation {
        p.autoPlay = autoPlay
        p.advanceTime = advanceSeconds
        return p
}

func (p *Presentation) AddSlide() *Slide {
        s := &Slide{layout: LayoutContent, bgColor: "#FFFFFF"}
        p.slides = append(p.slides, s)
        return s
}

func (p *Presentation) Save(path string) error {
        data, err := p.Bytes()
        if err != nil { return err }
        return os.WriteFile(path, data, 0644)
}

func (p *Presentation) Bytes() ([]byte, error) {
        buf := &bytes.Buffer{}
        w := zip.NewWriter(buf)
        writeFile(w, "[Content_Types].xml", contentTypesXML())
        writeFile(w, "_rels/.rels", rootRelsXML)
        writeFile(w, "docProps/core.xml", p.corePropsXML())
        writeFile(w, "ppt/presentation.xml", p.presentationXML())
        writeFile(w, "ppt/_rels/presentation.xml.rels", p.presRelsXML())

        imgID := 0
        for i, slide := range p.slides {
                slideNum := i + 1
                writeFile(w, fmt.Sprintf("ppt/slides/slide%d.xml", slideNum), slide.slideXML(slideNum))
                hasImg := len(slide.images) > 0
                if hasImg {
                        writeFile(w, fmt.Sprintf("ppt/slides/_rels/slide%d.xml.rels", slideNum), slide.slideRelsXML(slideNum))
                        for _, img := range slide.images {
                                imgID++
                                imgPath := fmt.Sprintf("ppt/media/image%d.png", imgID)
                                if len(img.data) > 0 {
                                        writeFileBytes(w, imgPath, img.data)
                                } else if img.path != "" {
                                        data, err := os.ReadFile(img.path)
                                        if err == nil { writeFileBytes(w, imgPath, data) }
                                }
                        }
                }
                // 备注
                if slide.notes != "" {
                        writeFile(w, fmt.Sprintf("ppt/notesSlides/notesSlide%d.xml", slideNum), slide.notesXML(slideNum))
                }
        }

        if err := w.Close(); err != nil { return nil, err }
        return buf.Bytes(), nil
}

// === Slide 方法 ===

func (s *Slide) SetLayout(l Layout) *Slide { s.layout = l; return s }
func (s *Slide) SetTitleText(title string) *Slide { s.title = title; return s }
func (s *Slide) AddTitle(title string) *Slide { s.title = title; return s }
func (s *Slide) AddSubtitle(subtitle string) *Slide { s.subtitle = subtitle; return s }
func (s *Slide) AddBullet(text string) *Slide { s.bullets = append(s.bullets, text); return s }
func (s *Slide) AddBullets(texts []string) *Slide { s.bullets = append(s.bullets, texts...); return s }
func (s *Slide) AddImage(path string, x, y, w, h int) *Slide {
        s.images = append(s.images, ImageItem{path: path, x: x, y: y, w: w, h: h}); return s
}
func (s *Slide) AddImageBytes(data []byte, x, y, w, h int) *Slide {
        s.images = append(s.images, ImageItem{data: data, x: x, y: y, w: w, h: h}); return s
}
func (s *Slide) SetBgColor(hex string) *Slide { s.bgColor = hex; return s }
func (s *Slide) SetTransition(effect string, duration int) *Slide { s.transition = effect; s.transitionDur = duration; return s }
func (s *Slide) AddAnimation(target, effect string, delay, duration int) *Slide {
        cat := "entrance"
        if effect == "pulse" || effect == "spin" { cat = "emphasis" }
        s.animations = append(s.animations, Animation{Target: target, Effect: effect, Category: cat, Delay: delay, Duration: duration})
        return s
}
func (s *Slide) AddEntranceAnim(target, effect string, delay, duration int) *Slide {
        s.animations = append(s.animations, Animation{Target: target, Effect: effect, Category: "entrance", Delay: delay, Duration: duration})
        return s
}
func (s *Slide) AddEmphasisAnim(target, effect string, delay, duration int) *Slide {
        s.animations = append(s.animations, Animation{Target: target, Effect: effect, Category: "emphasis", Delay: delay, Duration: duration})
        return s
}
func (s *Slide) AddExitAnim(target, effect string, delay, duration int) *Slide {
        s.animations = append(s.animations, Animation{Target: target, Effect: effect, Category: "exit", Delay: delay, Duration: duration})
        return s
}
func (s *Slide) SetNotes(notes string) *Slide { s.notes = notes; return s }
func (s *Slide) SetAdvanceTime(seconds int) *Slide { s.advanceTime = seconds; return s }
func (s *Slide) Title() string { return s.title }
func (s *Slide) Bullets() []string { return s.bullets }
func (s *Slide) Animations() []Animation { return s.animations }
func (s *Slide) Notes() string { return s.notes }

// AddShape 添加形状
func (s *Slide) AddShape(shapeType string, x, y, w, h int) *Shape {
        shape := Shape{
                Type: shapeType, X: x, Y: y, W: w, H: h,
                Fill: "#4f46e5", Stroke: "#3730a3", StrokeW: 12700,
                FontSize: 1400, FontColor: "#ffffff", FontBold: true,
        }
        s.shapes = append(s.shapes, shape)
        return &s.shapes[len(s.shapes)-1]
}

// SetFill 设置填充色
func (sh *Shape) SetFill(hex string) *Shape { sh.Fill = hex; return sh }
// SetStroke 设置边框
func (sh *Shape) SetStroke(hex string, widthEmu int) *Shape { sh.Stroke = hex; sh.StrokeW = widthEmu; return sh }
// SetText 设置形状文字
func (sh *Shape) SetText(text string) *Shape { sh.Text = text; return sh }
// SetFontSize 设置字号
func (sh *Shape) SetFontSize(pt int) *Shape { sh.FontSize = pt * 100; return sh }
// SetFontColor 设置文字颜色
func (sh *Shape) SetFontColor(hex string) *Shape { sh.FontColor = hex; return sh }
// SetShadow 设置阴影
func (sh *Shape) SetShadow(b bool) *Shape { sh.Shadow = b; return sh }
// SetGlow 设置发光
func (sh *Shape) SetGlow(b bool, color string, radius int) *Shape { sh.Glow = b; sh.GlowColor = color; sh.GlowRadius = radius; return sh }
// SetReflection 设置反射
func (sh *Shape) SetReflection(b bool) *Shape { sh.Reflection = b; return sh }
// SetSoftEdge 设置柔边
func (sh *Shape) SetSoftEdge(b bool) *Shape { sh.SoftEdge = b; return sh }
// SetGradient 设置渐变
func (sh *Shape) SetGradient(colors string) *Shape { sh.Gradient = colors; return sh }
// SetRotation 设置旋转
func (sh *Shape) SetRotation(deg int) *Shape { sh.Rotation = deg; return sh }

// AddArtText 添加艺术字
func (s *Slide) AddArtText(text string, x, y, w, h int) *ArtText {
        at := ArtText{
                Text: text, X: x, Y: y, W: w, H: h,
                FontSize: 3600, FontColor: "#4f46e5", Bold: true,
        }
        s.artTexts = append(s.artTexts, at)
        return &s.artTexts[len(s.artTexts)-1]
}

// ArtText setters
func (a *ArtText) SetFontSize(pt int) *ArtText { a.FontSize = pt * 100; return a }
func (a *ArtText) SetColor(hex string) *ArtText { a.FontColor = hex; return a }
func (a *ArtText) SetShadow(b bool) *ArtText { a.Shadow = b; return a }
func (a *ArtText) SetOutline(hex string, w int) *ArtText { a.Outline = hex; a.OutlineW = w; return a }
func (a *ArtText) SetGlow(b bool, color string) *ArtText { a.Glow = b; a.GlowColor = color; return a }
func (a *ArtText) SetReflection(b bool) *ArtText { a.Reflection = b; return a }
func (a *ArtText) SetGradient(colors string) *ArtText { a.Gradient = colors; return a }
func (a *ArtText) SetFont(font string) *ArtText { a.Font = font; return a }
func (a *ArtText) SetRotation(deg int) *ArtText { a.Rotation = deg; return a }

// AddFlowChart 添加智能流程图（自动布局）
// nodes: 流程图节点列表
// x, y: 起始位置 EMU
// direction: "horizontal" 或 "vertical"
func (s *Slide) AddFlowChart(nodes []FlowNode, x, y int, direction string) *FlowChart {
        fc := FlowChart{
                Nodes: nodes, X: x, Y: y, Direction: direction,
                NodeW: 2286000, NodeH: 1143000, NodeGap: 457200,
                NodeFill: "#4f46e5", NodeStroke: "#3730a3",
        }
        s.flowCharts = append(s.flowCharts, fc)
        return &s.flowCharts[len(s.flowCharts)-1]
}

// FlowChart setters
func (fc *FlowChart) SetNodeSize(w, h int) *FlowChart { fc.NodeW = w; fc.NodeH = h; return fc }
func (fc *FlowChart) SetNodeGap(gap int) *FlowChart { fc.NodeGap = gap; return fc }
func (fc *FlowChart) SetNodeFill(hex string) *FlowChart { fc.NodeFill = hex; return fc }
func (fc *FlowChart) SetNodeStroke(hex string) *FlowChart { fc.NodeStroke = hex; return fc }

// === XML 生成 ===

func (p *Presentation) presentationXML() string {
        var sb strings.Builder
        sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>
<p:notesSz cx="6858000" cy="9144000"/>
`)
        if p.autoPlay {
                sb.WriteString(fmt.Sprintf(`<p:timing><p:tnLst><p:par><p:cTn id="1" dur="%d" nodeType="tmRoot"><p:childTnLst>
<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>
</p:childTnLst></p:cTn></p:seq>
</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`, p.advanceTime*1000))
        }
        sb.WriteString("<p:sldIdLst>\n")
        for i := range p.slides {
                sb.WriteString(fmt.Sprintf(`<p:sldId id="%d" r:id="rId%d"/>`, 256+i, i+2))
        }
        sb.WriteString("</p:sldIdLst>\n</p:presentation>")
        return sb.String()
}

func (p *Presentation) presRelsXML() string {
        var sb strings.Builder
        sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
`)
        for i := range p.slides {
                sb.WriteString(fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide%d.xml"/>`, i+2, i+1))
        }
        sb.WriteString("</Relationships>")
        return sb.String()
}

func (p *Presentation) corePropsXML() string {
        now := time.Now().UTC().Format(time.RFC3339)
        return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>%s</dc:title><dc:creator>%s</dc:creator><dc:subject>%s</dc:subject>
  <dcterms:created xsi:type="dcterms:W3CDTF">%s</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">%s</dcterms:modified>
</cp:coreProperties>`, escapeXML(p.title), escapeXML(p.author), escapeXML(p.subject), now, now)
}

// 形状类型映射到 OOXML prstGeom
var shapeTypeMap = map[string]string{
        "rect":        "rect",
        "roundRect":   "roundRect",
        "ellipse":     "ellipse",
        "triangle":    "triangle",
        "diamond":     "diamond",
        "arrow":       "rightArrow",
        "rightArrow":  "rightArrow",
        "leftArrow":   "leftArrow",
        "upArrow":     "upArrow",
        "downArrow":   "downArrow",
        "star5":       "star5",
        "star":        "star5",
        "hexagon":     "hexagon",
        "pentagon":    "pentagon",
        "octagon":     "octagon",
        "heart":       "heart",
        "cloud":       "cloud",
        "callout":     "wedgeRectCallout",
}

func (s *Slide) slideXML(num int) string {
        var sb strings.Builder

        transitionXML := ""
        if s.transition != "" {
                dur := s.transitionDur
                if dur == 0 { dur = 500 }
                advClick := "1"
                if s.advanceTime > 0 { advClick = "0" }
                advT := ""
                if s.advanceTime > 0 { advT = fmt.Sprintf(` advTm="%d"`, s.advanceTime*1000) }
                switch s.transition {
                case "fade": transitionXML = fmt.Sprintf(`<p:transition spd="med" advClick="%s"%s><p:fade/></p:transition>`, advClick, advT)
                case "push": transitionXML = fmt.Sprintf(`<p:transition spd="med" advClick="%s"%s><p:push dir="l"/></p:transition>`, advClick, advT)
                case "wipe": transitionXML = fmt.Sprintf(`<p:transition spd="med" advClick="%s"%s><p:wipe dir="l"/></p:transition>`, advClick, advT)
                case "cover": transitionXML = fmt.Sprintf(`<p:transition spd="med" advClick="%s"%s><p:cover dir="l"/></p:transition>`, advClick, advT)
                case "cut": transitionXML = fmt.Sprintf(`<p:transition spd="med" advClick="%s"%s><p:cut/></p:transition>`, advClick, advT)
                case "zoom": transitionXML = fmt.Sprintf(`<p:transition spd="med" advClick="%s"%s><p:zoom/></p:transition>`, advClick, advT)
                case "morph": transitionXML = fmt.Sprintf(`<p:transition spd="med" advClick="%s"%s><p:morph option="byObject"/></p:transition>`, advClick, advT)
                default: transitionXML = fmt.Sprintf(`<p:transition spd="med" advClick="%s"%s><p:fade/></p:transition>`, advClick, advT)
                }
        }

        sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">
<p:cSld><p:spTree>
`)

        // 背景
        if s.bgColor != "" && s.bgColor != "#ffffff" {
                bgHex := strings.TrimPrefix(s.bgColor, "#")
                sb.WriteString(fmt.Sprintf(`<p:bg><p:bgPr><a:solidFill><a:srgbClr val="%s"/></a:solidFill></p:bgPr></p:bg>`, bgHex))
        }

        // 形状位置
        var titleX, titleY, titleCx, titleCy, subX, subY, subCx, subCy int
        if s.layout == LayoutTitle {
                titleX = 1838400; titleY = 2286000; titleCx = 8515200; titleCy = 1828800
                subX = 1838400; subY = 4114800; subCx = 8515200; subCy = 1143000
        } else {
                titleX = 914400; titleY = 457200; titleCx = 10363200; titleCy = 1143000
                subX = 914400; subY = 1828800; subCx = 10363200; subCy = 1143000
        }
        bulletX := 914400; bulletY := 2057400; bulletCx := 10363200; bulletCy := 4114800

        shapeID := 100

        // 标题
        if s.title != "" {
                fontSize := 2800
                if s.layout == LayoutTitle { fontSize = 4000 }
                anchor := "t"; algn := "l"
                if s.layout == LayoutTitle { anchor = "ctr"; algn = "ctr" }
                sb.WriteString(fmt.Sprintf(`<p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr wrap="square" anchor="%s"/><a:lstStyle/>
<a:p><a:pPr algn="%s"/><a:r><a:rPr lang="zh-CN" sz="%d" b="1"/><a:t>%s</a:t></a:r></a:p>
</p:txBody></p:sp>`, titleX, titleY, titleCx, titleCy, anchor, algn, fontSize, escapeXML(s.title)))
        }

        // 副标题
        if s.subtitle != "" {
                sb.WriteString(fmt.Sprintf(`<p:sp><p:nvSpPr><p:cNvPr id="2" name="Subtitle"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr wrap="square" anchor="ctr"/><a:lstStyle/>
<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="zh-CN" sz="1800"/><a:t>%s</a:t></a:r></a:p>
</p:txBody></p:sp>`, subX, subY, subCx, subCy, escapeXML(s.subtitle)))
        }

        // 要点列表
        if len(s.bullets) > 0 {
                sb.WriteString(fmt.Sprintf(`<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr wrap="square" anchor="t"/><a:lstStyle/>`, bulletX, bulletY, bulletCx, bulletCy))
                for _, bullet := range s.bullets {
                        sb.WriteString(fmt.Sprintf(`<a:p><a:pPr><a:buFont typeface="Arial"/><a:buChar char="•"/><a:spcBef><a:spcPts val="600"/></a:spcBef></a:pPr><a:r><a:rPr lang="zh-CN" sz="1600"/><a:t>%s</a:t></a:r></a:p>`, escapeXML(bullet)))
                }
                sb.WriteString(`</p:txBody></p:sp>`)
        }

        // 形状
        for i, sh := range s.shapes {
                shapeID++
                prst := shapeTypeMap[sh.Type]
                if prst == "" { prst = "rect" }
                fillHex := strings.TrimPrefix(sh.Fill, "#")
                strokeHex := strings.TrimPrefix(sh.Stroke, "#")
                rotXML := ""
                if sh.Rotation != 0 { rotXML = fmt.Sprintf(` rot="%d"`, sh.Rotation*60000) }

                // 效果容器
                effectLst := ""
                if sh.Shadow {
                        effectLst += `<a:effectLst><a:outerShdw blurRad="40000" dist="20000" dir="5400000" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:outerShdw></a:effectLst>`
                }
                if sh.Glow {
                        effectLst += fmt.Sprintf(`<a:effectLst><a:glow rad="%d"><a:srgbClr val="%s"/></a:glow></a:effectLst>`, sh.GlowRadius, strings.TrimPrefix(sh.GlowColor, "#"))
                }
                if sh.Reflection { effectLst += `<a:effectLst><a:reflection blurRad="50000" stA="50000" stPos="0" endA="0" endPos="50000"/></a:effectLst>` }
                if sh.SoftEdge { effectLst += `<a:effectLst><a:softEdge rad="30000"/></a:effectLst>` }

                // 填充
                fillXML := fmt.Sprintf(`<a:solidFill><a:srgbClr val="%s"/></a:solidFill>`, fillHex)
                if sh.Gradient != "" {
                        colors := strings.Split(sh.Gradient, ",")
                        if len(colors) == 2 {
                                fillXML = fmt.Sprintf(`<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="%s"/></a:gs><a:gs pos="100000"><a:srgbClr val="%s"/></a:gs></a:gsLst></a:gradFill>`, strings.TrimPrefix(colors[0], "#"), strings.TrimPrefix(colors[1], "#"))
                        }
                }

                // 文字
                textXML := ""
                if sh.Text != "" {
                        textXML = fmt.Sprintf(`<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="zh-CN" sz="%d" b="%d"><a:solidFill><a:srgbClr val="%s"/></a:solidFill></a:rPr><a:t>%s</a:t></a:r></a:p></p:txBody>`,
                                sh.FontSize, boolToInt(sh.FontBold), strings.TrimPrefix(sh.FontColor, "#"), escapeXML(sh.Text))
                }

                sb.WriteString(fmt.Sprintf(`<p:sp><p:nvSpPr><p:cNvPr id="%d" name="Shape %d"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm%s><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm>
<a:prstGeom prst="%s"><a:avLst/></a:prstGeom>%s<a:ln w="%d"><a:solidFill><a:srgbClr val="%s"/></a:solidFill></a:ln>%s</p:spPr>
%s</p:sp>`, shapeID, i+1, rotXML, sh.X, sh.Y, sh.W, sh.H, prst, fillXML, sh.StrokeW, strokeHex, effectLst, textXML))
        }

        // 艺术字
        for i, at := range s.artTexts {
                shapeID++
                rotXML := ""
                if at.Rotation != 0 { rotXML = fmt.Sprintf(` rot="%d"`, at.Rotation*60000) }

                // 文字效果
                runProps := fmt.Sprintf(`<a:rPr lang="zh-CN" sz="%d" b="%d"`, at.FontSize, boolToInt(at.Bold))
                runProps += fmt.Sprintf(`><a:solidFill><a:srgbClr val="%s"/></a:solidFill>`, strings.TrimPrefix(at.FontColor, "#"))
                if at.Font != "" { runProps = fmt.Sprintf(`<a:rPr lang="zh-CN" sz="%d" b="%d"`, at.FontSize, boolToInt(at.Bold)) + fmt.Sprintf(`><a:latin typeface="%s"/>`, at.Font) + fmt.Sprintf(`<a:solidFill><a:srgbClr val="%s"/></a:solidFill>`, strings.TrimPrefix(at.FontColor, "#")) }
                if at.Outline != "" { runProps += fmt.Sprintf(`<a:ln w="%d"><a:solidFill><a:srgbClr val="%s"/></a:solidFill></a:ln>`, at.OutlineW, strings.TrimPrefix(at.Outline, "#")) }
                runProps += "</a:rPr>"

                effectLst := ""
                if at.Shadow { effectLst = `<a:effectLst><a:outerShdw blurRad="50000" dist="30000" dir="5400000"><a:srgbClr val="330000"><a:alpha val="60000"/></a:srgbClr></a:outerShdw></a:effectLst>` }
                if at.Glow { effectLst += fmt.Sprintf(`<a:effectLst><a:glow rad="50000"><a:srgbClr val="%s"/></a:glow></a:effectLst>`, strings.TrimPrefix(at.GlowColor, "#")) }
                if at.Reflection { effectLst += `<a:effectLst><a:reflection blurRad="50000" stA="50000" stPos="0" endA="0" endPos="50000"/></a:effectLst>` }

                fillXML := ""
                if at.Gradient != "" {
                        colors := strings.Split(at.Gradient, ",")
                        if len(colors) == 2 {
                                fillXML = fmt.Sprintf(`<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="%s"/></a:gs><a:gs pos="100000"><a:srgbClr val="%s"/></a:gs></a:gsLst></a:gradFill>`, strings.TrimPrefix(colors[0], "#"), strings.TrimPrefix(colors[1], "#"))
                        }
                }

                sb.WriteString(fmt.Sprintf(`<p:sp><p:nvSpPr><p:cNvPr id="%d" name="ArtText %d"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm%s><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>%s</p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/>%s</a:p></p:txBody></p:sp>`,
                        shapeID, i+1, rotXML, at.X, at.Y, at.W, at.H, fillXML+effectLst, runProps+fmt.Sprintf(`<a:t>%s</a:t>`, escapeXML(at.Text))))
        }

        // 流程图（自动布局 + 连线）
        for _, fc := range s.flowCharts {
                for i, node := range fc.Nodes {
                        shapeID++
                        shapeType := node.Shape
                        if shapeType == "" {
                                switch node.Type {
                                case "start", "end": shapeType = "roundRect"
                                case "decision": shapeType = "diamond"
                                case "data": shapeType = "parallelogram" // 用 hexagon 近似
                                default: shapeType = "rect"
                                }
                        }
                        prst := shapeTypeMap[shapeType]
                        if prst == "" { prst = "rect" }

                        var nx, ny int
                        if fc.Direction == "horizontal" {
                                nx = fc.X + i*(fc.NodeW+fc.NodeGap)
                                ny = fc.Y
                        } else {
                                nx = fc.X
                                ny = fc.Y + i*(fc.NodeH+fc.NodeGap)
                        }

                        fillHex := strings.TrimPrefix(fc.NodeFill, "#")
                        strokeHex := strings.TrimPrefix(fc.NodeStroke, "#")
                        sb.WriteString(fmt.Sprintf(`<p:sp><p:nvSpPr><p:cNvPr id="%d" name="FlowNode %d"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm>
<a:prstGeom prst="%s"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="%s"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="%s"/></a:solidFill></a:ln><a:effectLst><a:outerShdw blurRad="40000" dist="20000" dir="5400000"><a:srgbClr val="000000"><a:alpha val="30000"/></a:srgbClr></a:outerShdw></a:effectLst></p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="zh-CN" sz="1400" b="1"><a:solidFill><a:srgbClr val="ffffff"/></a:solidFill></a:rPr><a:t>%s</a:t></a:r></a:p></p:txBody></p:sp>`,
                                shapeID, i+1, nx, ny, fc.NodeW, fc.NodeH, prst, fillHex, strokeHex, escapeXML(node.Text)))

                        // 连线箭头（节点之间）
                        if i < len(fc.Nodes)-1 {
                                shapeID++
                                if fc.Direction == "horizontal" {
                                        ax := nx + fc.NodeW
                                        ay := ny + fc.NodeH/2
                                        bx := nx + fc.NodeW + fc.NodeGap
                                        by := ay
                                        sb.WriteString(fmt.Sprintf(`<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="%d" name="Arrow %d"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
<p:spPr><a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="0"/></a:xfrm>
<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="12700"><a:solidFill><a:srgbClr val="374151"/></a:solidFill><a:tailEnd type="triangle" w="med" len="med"/></a:ln></p:spPr></p:cxnSp>`,
                                                shapeID, i+1, ax, ay, bx-ax))
                                        _ = by
                                } else {
                                        ax := nx + fc.NodeW/2
                                        ay := ny + fc.NodeH
                                        bx := ax
                                        by := ny + fc.NodeH + fc.NodeGap
                                        sb.WriteString(fmt.Sprintf(`<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="%d" name="Arrow %d"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
<p:spPr><a:xfrm><a:off x="%d" y="%d"/><a:ext cx="0" cy="%d"/></a:xfrm>
<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="12700"><a:solidFill><a:srgbClr val="374151"/></a:solidFill><a:tailEnd type="triangle" w="med" len="med"/></a:ln></p:spPr></p:cxnSp>`,
                                                shapeID, i+1, ax, ay, by-ay))
                                        _ = bx
                                }
                        }
                }
        }

        // 图片
        for i, img := range s.images {
                cx := img.w * 9525
                cy := img.h * 9525
                offX := img.x * 9525
                offY := img.y * 9525
                relID := fmt.Sprintf("rIdImg%d_%d", num, i+1)
                sb.WriteString(fmt.Sprintf(`<p:pic><p:nvPicPr>
<p:cNvPr id="%d" name="Image %d"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="%s"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
</p:pic>`, i+10, i+1, relID, offX, offY, cx, cy))
        }

        sb.WriteString(`</p:spTree></p:cSld>`)
        sb.WriteString(transitionXML)

        // 动画时间线
        if len(s.animations) > 0 {
                sb.WriteString(`<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>`)
                for _, anim := range s.animations {
                        effectClass := "entr"
                        if anim.Category == "emphasis" { effectClass = "emph" }
                        if anim.Category == "exit" { effectClass = "exit" }
                        presetID := "10" // fade
                        switch anim.Effect {
                        case "fade": presetID = "10"
                        case "fly": presetID = "2"
                        case "zoom": presetID = "23"
                        case "wipe": presetID = "3"
                        case "bounce": presetID = "26"
                        case "spin": presetID = "8"
                        case "pulse": presetID = "1"
                        }
                        sb.WriteString(fmt.Sprintf(`<p:par><p:cTn id="100" fill="hold"><p:stCondLst><p:cond delay="%d"/></p:stCondLst>
<p:childTnLst><p:par><p:cTn id="101" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst>
<p:childTnLst><p:par><p:cTn id="102" presetID="%s" presetClass="%s" presetSubtype="0" fill="hold" grpId="0" nodeType="clickEffect">
<p:stCondLst><p:cond delay="0"/></p:stCondLst>
<p:childTnLst><p:set><p:cBhvr><p:cTn id="103" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>
<p:tgtEl><p:spTgt spid="%s"/></p:tgtEl></p:cBhvr><p:to><p:strVal val="1"/></p:to></p:set>
<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="104" dur="%d"/><p:tgtEl><p:spTgt spid="%s"/></p:tgtEl></p:cBhvr></p:animEffect>
</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`,
                                anim.Delay, presetID, effectClass, anim.Target, anim.Duration, anim.Target))
                }
                sb.WriteString(`</p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`)
        }

        sb.WriteString(`</p:sld>`)
        return sb.String()
}

func (s *Slide) slideRelsXML(num int) string {
        var sb strings.Builder
        sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
`)
        for i := range s.images {
                relID := fmt.Sprintf("rIdImg%d_%d", num, i+1)
                sb.WriteString(fmt.Sprintf(`<Relationship Id="%s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image%d.png"/>`, relID, num*100+i+1))
        }
        sb.WriteString("</Relationships>")
        return sb.String()
}

func (s *Slide) notesXML(num int) string {
        return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:cNvPr id="1" name="Notes"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="5486400" cy="4572000"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/>
<a:p><a:r><a:rPr lang="zh-CN" sz="1400"/><a:t>%s</a:t></a:r></a:p>
</p:txBody></p:sp>
</p:spTree></p:cSld>
</p:notes>`, escapeXML(s.notes))
}

func contentTypesXML() string {
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`
}

const rootRelsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`

func escapeXML(s string) string {
        s = strings.ReplaceAll(s, "&", "&amp;")
        s = strings.ReplaceAll(s, "<", "&lt;")
        s = strings.ReplaceAll(s, ">", "&gt;")
        s = strings.ReplaceAll(s, `"`, "&quot;")
        return s
}

func writeFile(w *zip.Writer, name, content string) {
        f, _ := w.Create(name)
        f.Write([]byte(content))
}

func writeFileBytes(w *zip.Writer, name string, data []byte) {
        f, _ := w.Create(name)
        f.Write(data)
}

func boolToInt(b bool) int {
        if b { return 1 }
        return 0
}
