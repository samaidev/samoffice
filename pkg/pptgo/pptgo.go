// Package pptgo 提供简洁的 .pptx 文件读写 API
// 设计参考 python-pptx，自研 OOXML Presentation 渲染
//
// 快速开始：
//
//      prs := pptgo.New()
//      prs.SetTitle("演示标题").SetAuthor("SamAI")
//
//      slide1 := prs.AddSlide()
//      slide1.SetLayout(pptgo.LayoutTitle)
//      slide1.AddTitle("第一页标题")
//      slide1.AddSubtitle("副标题内容")
//
//      slide2 := prs.AddSlide()
//      slide2.SetLayout(pptgo.LayoutContent)
//      slide2.AddTitle("内容页")
//      slide2.AddBullet("要点一")
//      slide2.AddBullet("要点二")
//      slide2.AddImage("chart.png", 100, 300, 400, 200)
//
//      prs.Save("presentation.pptx")
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
        LayoutTitle Layout = iota   // 居中标题
        LayoutContent               // 标题+内容
        LayoutBlank                 // 空白
)

// Presentation 表示一个演示文稿
type Presentation struct {
        title    string
        author   string
        subject  string
        slides   []*Slide
}

// Slide 表示一张幻灯片
type Slide struct {
        layout     Layout
        title      string
        subtitle   string
        bullets    []string
        images     []ImageItem
        bgColor    string
        // 高级功能
        transition string   // 过渡效果：fade/push/wipe/cover
        animations []Animation // 元素动画
        notes      string   // 演讲者备注
}

// Animation 元素动画
type Animation struct {
        target   string // "title" / "subtitle" / "bullet_N" / "image_N"
        effect   string // "fade" / "fly" / "zoom" / "wipe"
        delay    int    // ms
        duration int    // ms
}

// ImageItem 图片项
type ImageItem struct {
        path   string
        data   []byte
        x, y   int // px
        w, h   int // px
}

// New 创建新演示文稿
func New() *Presentation {
        return &Presentation{
                title: "Untitled Presentation",
        }
}

// SetTitle 设置标题
func (p *Presentation) SetTitle(title string) *Presentation {
        p.title = title
        return p
}

// SetAuthor 设置作者
func (p *Presentation) SetAuthor(author string) *Presentation {
        p.author = author
        return p
}

// SetSubject 设置主题
func (p *Presentation) SetSubject(subject string) *Presentation {
        p.subject = subject
        return p
}

// Title 获取标题
func (p *Presentation) Title() string { return p.title }

// Slides 返回所有幻灯片
func (p *Presentation) Slides() []*Slide { return p.slides }

// AddSlide 添加幻灯片
func (p *Presentation) AddSlide() *Slide {
        s := &Slide{
                layout:  LayoutContent,
                bgColor: "#FFFFFF",
        }
        p.slides = append(p.slides, s)
        return s
}

// Save 保存为 pptx
func (p *Presentation) Save(path string) error {
        data, err := p.Bytes()
        if err != nil {
                return err
        }
        return os.WriteFile(path, data, 0644)
}

// Bytes 生成 pptx 字节流
func (p *Presentation) Bytes() ([]byte, error) {
        buf := &bytes.Buffer{}
        w := zip.NewWriter(buf)

        // [Content_Types].xml
        writeFile(w, "[Content_Types].xml", contentTypesXML())

        // _rels/.rels
        writeFile(w, "_rels/.rels", rootRelsXML)

        // docProps/core.xml
        writeFile(w, "docProps/core.xml", p.corePropsXML())

        // ppt/presentation.xml
        writeFile(w, "ppt/presentation.xml", p.presentationXML())

        // ppt/_rels/presentation.xml.rels
        writeFile(w, "ppt/_rels/presentation.xml.rels", p.presRelsXML())

        // 每张幻灯片
        imgID := 0
        for i, slide := range p.slides {
                slideNum := i + 1
                writeFile(w, fmt.Sprintf("ppt/slides/slide%d.xml", slideNum), slide.slideXML(slideNum))

                // 图片关系
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
                                        if err == nil {
                                                writeFileBytes(w, imgPath, data)
                                        }
                                }
                        }
                }
        }

        if err := w.Close(); err != nil {
                return nil, err
        }
        return buf.Bytes(), nil
}

// === Slide 方法 ===

// SetLayout 设置布局
func (s *Slide) SetLayout(l Layout) *Slide {
        s.layout = l
        return s
}

// SetTitleText 设置标题文本
func (s *Slide) SetTitleText(title string) *Slide {
        s.title = title
        return s
}

// AddTitle 添加标题（别名）
func (s *Slide) AddTitle(title string) *Slide {
        s.title = title
        return s
}

// AddSubtitle 添加副标题
func (s *Slide) AddSubtitle(subtitle string) *Slide {
        s.subtitle = subtitle
        return s
}

// AddBullet 添加要点
func (s *Slide) AddBullet(text string) *Slide {
        s.bullets = append(s.bullets, text)
        return s
}

// AddBullets 批量添加要点
func (s *Slide) AddBullets(texts []string) *Slide {
        s.bullets = append(s.bullets, texts...)
        return s
}

// AddImage 添加图片（路径）
func (s *Slide) AddImage(path string, x, y, w, h int) *Slide {
        s.images = append(s.images, ImageItem{path: path, x: x, y: y, w: w, h: h})
        return s
}

// AddImageBytes 添加图片（字节数据）
func (s *Slide) AddImageBytes(data []byte, x, y, w, h int) *Slide {
        s.images = append(s.images, ImageItem{data: data, x: x, y: y, w: w, h: h})
        return s
}

// SetBgColor 设置背景色
func (s *Slide) SetBgColor(hex string) *Slide {
        s.bgColor = hex
        return s
}

// SetTransition 设置幻灯片过渡效果
// effect: "fade" / "push" / "wipe" / "cover" / "cut"
// duration: 毫秒
func (s *Slide) SetTransition(effect string, duration int) *Slide {
        s.transition = effect
        return s
}

// AddAnimation 添加元素动画
// target: "title" / "subtitle" / "bullet_1" / "image_1"
// effect: "fade" / "fly" / "zoom" / "wipe"
func (s *Slide) AddAnimation(target, effect string, delay, duration int) *Slide {
        s.animations = append(s.animations, Animation{
                target:   target,
                effect:   effect,
                delay:    delay,
                duration: duration,
        })
        return s
}

// SetNotes 设置演讲者备注
func (s *Slide) SetNotes(notes string) *Slide {
        s.notes = notes
        return s
}

// Animations 返回所有动画
func (s *Slide) Animations() []Animation { return s.animations }

// Notes 返回备注
func (s *Slide) Notes() string { return s.notes }

// Title 获取标题
func (s *Slide) Title() string { return s.title }

// Bullets 获取要点
func (s *Slide) Bullets() []string { return s.bullets }

// === XML 生成 ===

func (p *Presentation) presentationXML() string {
        var sb strings.Builder
        sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:sldIdLst>
`)
        for i := range p.slides {
                sb.WriteString(fmt.Sprintf(`<p:sldId id="%d" r:id="rId%d"/>`, 256+i, i+2))
        }
        sb.WriteString(`</p:sldIdLst>
</p:presentation>`)
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

func (s *Slide) slideXML(num int) string {
        var sb strings.Builder
        // 过渡效果通过 <p:transition> 元素
        transitionXML := ""
        if s.transition != "" {
                switch s.transition {
                case "fade":
                        transitionXML = `<p:transition><p:fade/></p:transition>`
                case "push":
                        transitionXML = `<p:transition><p:push/></p:transition>`
                case "wipe":
                        transitionXML = `<p:transition><p:wipe/></p:transition>`
                case "cover":
                        transitionXML = `<p:transition><p:cover/></p:transition>`
                case "cut":
                        transitionXML = `<p:transition><p:cut/></p:transition>`
                }
        }

        sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:cSld><p:spTree>
`)

        // 标题
        if s.title != "" {
                fontSize := 2800
                if s.layout == LayoutTitle {
                        fontSize = 4000
                }
                sb.WriteString(fmt.Sprintf(`<p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>
<a:p><a:r><a:rPr lang="zh-CN" sz="%d" b="1"/><a:t>%s</a:t></a:r></a:p>
</p:txBody></p:sp>`, fontSize, escapeXML(s.title)))
        }

        // 副标题
        if s.subtitle != "" {
                sb.WriteString(fmt.Sprintf(`<p:sp><p:nvSpPr><p:cNvPr id="2" name="Subtitle"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>
<a:p><a:r><a:rPr lang="zh-CN" sz="1800"/><a:t>%s</a:t></a:r></a:p>
</p:txBody></p:sp>`, escapeXML(s.subtitle)))
        }

        // 要点列表
        if len(s.bullets) > 0 {
                sb.WriteString(`<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>`)
                for _, bullet := range s.bullets {
                        sb.WriteString(fmt.Sprintf(`<a:p><a:pPr><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="zh-CN" sz="1600"/><a:t>%s</a:t></a:r></a:p>`, escapeXML(bullet)))
                }
                sb.WriteString(`</p:txBody></p:sp>`)
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

        // 过渡效果
        sb.WriteString(transitionXML)

        // 动画时间线（简化版：每个动画作为 seq 节点）
        if len(s.animations) > 0 {
                sb.WriteString(`<p:timing>`)
                for _, anim := range s.animations {
                        effectXML := ""
                        switch anim.effect {
                        case "fade":
                                effectXML = `<p:fade/>`
                        case "fly":
                                effectXML = `<p:fly dir="l"/>`
                        case "zoom":
                                effectXML = `<p:zoom/>`
                        case "wipe":
                                effectXML = `<p:wipe dir="l"/>`
                        }
                        sb.WriteString(fmt.Sprintf(`<p:seq>%s</p:seq>`, effectXML))
                }
                sb.WriteString(`</p:timing>`)
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
