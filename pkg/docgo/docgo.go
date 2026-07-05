// Package docgo 提供简洁的 .docx 文件读写 API
// 设计参考 python-docx，目标是让智能体和开发者能一行代码操作 Word 文档
//
// 快速开始：
//
//      // 创建文档
//      doc := docgo.New()
//      doc.AddHeading("报告标题", 1)
//      doc.AddParagraph("这是正文内容").Bold(true)
//      doc.AddList([]string{"项目一", "项目二"})
//      doc.Save("report.docx")
//
//      // 读取文档
//      doc, err := docgo.Open("report.docx")
//      if err != nil { panic(err) }
//      for _, p := range doc.Paragraphs() {
//          fmt.Println(p.Text())
//      }
package docgo

import (
        "archive/zip"
        "bytes"
        "fmt"
        "io"
        "os"
        "strings"
        "time"
)

// Document 表示一个 Word 文档
type Document struct {
        title    string
        author   string
        subject  string
        elements []Element
}

// Element 是文档元素的接口
type Element interface {
        elementType() string
}

// Heading 标题
type Heading struct {
        Level int    // 1-6
        Text  string
}

func (h *Heading) elementType() string { return "heading" }

// Paragraph 段落
type Paragraph struct {
        runs []Run
}

func (p *Paragraph) elementType() string { return "paragraph" }

// Run 是段落中的文本片段（可设置样式）
type Run struct {
        text    string
        bold    bool
        italic  bool
        underline bool
        strike  bool
        color   string
        size    int // pt
}

// Text 返回段落纯文本
func (p *Paragraph) Text() string {
        var sb strings.Builder
        for _, r := range p.runs {
                sb.WriteString(r.text)
        }
        return sb.String()
}

// Runs 返回所有 Run
func (p *Paragraph) Runs() []Run { return p.runs }

// List 列表
type List struct {
        items   []string
        ordered bool
}

func (l *List) elementType() string { return "list" }

// Table 表格
type Table struct {
        rows    [][]string
        header  bool // 第一行是否为表头
}

func (t *Table) elementType() string { return "table" }

// Image 图片
type Image struct {
        path   string // 本地路径
        data   []byte // 或字节数据
        width  int    // px
        height int    // px
        alt    string
}

func (i *Image) elementType() string { return "image" }

// CodeBlock 代码块
type CodeBlock struct {
        language string
        code     string
}

func (c *CodeBlock) elementType() string { return "code" }

// New 创建新文档
func New() *Document {
        return &Document{
                title: "Untitled",
        }
}

// SetTitle 设置标题
func (d *Document) SetTitle(title string) *Document {
        d.title = title
        return d
}

// SetAuthor 设置作者
func (d *Document) SetAuthor(author string) *Document {
        d.author = author
        return d
}

// SetSubject 设置主题
func (d *Document) SetSubject(subject string) *Document {
        d.subject = subject
        return d
}

// Title 获取标题
func (d *Document) Title() string { return d.title }

// Author 获取作者
func (d *Document) Author() string { return d.author }

// AddHeading 添加标题
// level: 1-6
func (d *Document) AddHeading(text string, level int) *Heading {
        if level < 1 { level = 1 }
        if level > 6 { level = 6 }
        h := &Heading{Level: level, Text: text}
        d.elements = append(d.elements, h)
        return h
}

// AddParagraph 添加段落
func (d *Document) AddParagraph(text string) *Paragraph {
        p := &Paragraph{runs: []Run{{text: text}}}
        d.elements = append(d.elements, p)
        return p
}

// AddParagraphStyled 添加带样式的段落
func (d *Document) AddParagraphStyled(text string, bold, italic bool) *Paragraph {
        p := &Paragraph{runs: []Run{{text: text, bold: bold, italic: italic}}}
        d.elements = append(d.elements, p)
        return p
}

// AddRun 添加文本片段到段落（链式调用）
func (p *Paragraph) AddRun(text string) *Run {
        r := Run{text: text}
        p.runs = append(p.runs, r)
        return &p.runs[len(p.runs)-1]
}

// Bold 设置加粗
func (r *Run) Bold(b bool) *Run { r.bold = b; return r }

// Italic 设置斜体
func (r *Run) Italic(b bool) *Run { r.italic = b; return r }

// Underline 设置下划线
func (r *Run) Underline(b bool) *Run { r.underline = b; return r }

// Strike 设置删除线
func (r *Run) Strike(b bool) *Run { r.strike = b; return r }

// Color 设置颜色（hex，如 "FF0000"）
func (r *Run) Color(hex string) *Run { r.color = hex; return r }

// Size 设置字号（pt）
func (r *Run) Size(pt int) *Run { r.size = pt; return r }

// AddList 添加列表
func (d *Document) AddList(items []string) *List {
        l := &List{items: items, ordered: false}
        d.elements = append(d.elements, l)
        return l
}

// AddOrderedList 添加有序列表
func (d *Document) AddOrderedList(items []string) *List {
        l := &List{items: items, ordered: true}
        d.elements = append(d.elements, l)
        return l
}

// Ordered 设置是否有序
func (l *List) Ordered(b bool) *List { l.ordered = b; return l }

// AddTable 添加表格
// rows: 二维字符串数组，第一行可作为表头
func (d *Document) AddTable(rows [][]string) *Table {
        t := &Table{rows: rows, header: true}
        d.elements = append(d.elements, t)
        return t
}

// SetHeader 设置第一行是否为表头
func (t *Table) SetHeader(b bool) *Table { t.header = b; return t }

// AddImage 添加图片（本地路径）
func (d *Document) AddImage(path string, width, height int) *Image {
        im := &Image{path: path, width: width, height: height}
        d.elements = append(d.elements, im)
        return im
}

// AddImageBytes 添加图片（字节数据）
func (d *Document) AddImageBytes(data []byte, width, height int) *Image {
        im := &Image{data: data, width: width, height: height}
        d.elements = append(d.elements, im)
        return im
}

// SetAlt 设置图片替代文本
func (i *Image) SetAlt(alt string) *Image { i.alt = alt; return i }

// AddCodeBlock 添加代码块
func (d *Document) AddCodeBlock(language, code string) *CodeBlock {
        c := &CodeBlock{language: language, code: code}
        d.elements = append(d.elements, c)
        return c
}

// Elements 返回所有元素
func (d *Document) Elements() []Element { return d.elements }

// Paragraphs 返回所有段落
func (d *Document) Paragraphs() []*Paragraph {
        var ps []*Paragraph
        for _, e := range d.elements {
                if p, ok := e.(*Paragraph); ok {
                        ps = append(ps, p)
                }
        }
        return ps
}

// Save 保存为 docx 文件
func (d *Document) Save(path string) error {
        data, err := d.Bytes()
        if err != nil {
                return err
        }
        return os.WriteFile(path, data, 0644)
}

// Bytes 生成 docx 字节流
func (d *Document) Bytes() ([]byte, error) {
        buf := &bytes.Buffer{}
        w := zip.NewWriter(buf)

        // [Content_Types].xml
        writeFile(w, "[Content_Types].xml", contentTypesXML())

        // _rels/.rels
        writeFile(w, "_rels/.rels", rootRelsXML)

        // docProps/core.xml
        writeFile(w, "docProps/core.xml", d.corePropsXML())

        // word/document.xml
        writeFile(w, "word/document.xml", d.documentXML())

        // word/_rels/document.xml.rels（含图片关系）
        writeFile(w, "word/_rels/document.xml.rels", d.docRelsXML())

        // 写入图片文件
        imgID := 0
        for _, e := range d.elements {
                if im, ok := e.(*Image); ok {
                        imgID++
                        imgPath := fmt.Sprintf("word/media/image%d.png", imgID)
                        if len(im.data) > 0 {
                                writeFileBytes(w, imgPath, im.data)
                        } else if im.path != "" {
                                data, err := os.ReadFile(im.path)
                                if err == nil {
                                        writeFileBytes(w, imgPath, data)
                                }
                        }
                }
        }

        if err := w.Close(); err != nil {
                return nil, err
        }
        return buf.Bytes(), nil
}

// WriteTo 写入 io.Writer
func (d *Document) WriteTo(w io.Writer) (int64, error) {
        data, err := d.Bytes()
        if err != nil {
                return 0, err
        }
        n, err := w.Write(data)
        return int64(n), err
}

// Open 从文件打开 docx
func Open(path string) (*Document, error) {
        data, err := os.ReadFile(path)
        if err != nil {
                return nil, err
        }
        return ParseBytes(data)
}

// ParseBytes 从字节流解析 docx
func ParseBytes(data []byte) (*Document, error) {
        zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
        if err != nil {
                return nil, fmt.Errorf("open zip: %w", err)
        }

        doc := &Document{title: "Untitled"}

        files := make(map[string]*zip.File)
        for _, f := range zr.File {
                files[f.Name] = f
        }

        // 元数据
        if coreFile, ok := files["docProps/core.xml"]; ok {
                if rc, err := coreFile.Open(); err == nil {
                        parseCoreProps(rc, doc)
                        rc.Close()
                }
        }

        // document.xml
        if docFile, ok := files["word/document.xml"]; ok {
                if rc, err := docFile.Open(); err == nil {
                        parseDocumentXML(rc, doc)
                        rc.Close()
                }
        }

        return doc, nil
}

// === XML 生成 ===

func (d *Document) documentXML() string {
        var sb strings.Builder
        sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<w:body>
`)
        imgID := 0
        for _, e := range d.elements {
                switch v := e.(type) {
                case *Heading:
                        renderHeadingXML(&sb, v)
                case *Paragraph:
                        renderParagraphXML(&sb, v)
                case *List:
                        renderListXML(&sb, v)
                case *Table:
                        renderTableXML(&sb, v)
                case *Image:
                        imgID++
                        renderImageXML(&sb, v, imgID)
                case *CodeBlock:
                        renderCodeBlockXML(&sb, v)
                }
        }
        sb.WriteString(`<w:sectPr>
<w:pgSz w:w="11906" w:h="16838"/>
<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
</w:sectPr>
</w:body>
</w:document>`)
        return sb.String()
}

func renderHeadingXML(sb *strings.Builder, h *Heading) {
        sb.WriteString(fmt.Sprintf(`<w:p><w:pPr><w:pStyle w:val="Heading%d"/></w:pPr>`, h.Level))
        sb.WriteString(fmt.Sprintf(`<w:r><w:t xml:space="preserve">%s</w:t></w:r>`, escapeXML(h.Text)))
        sb.WriteString("</w:p>\n")
}

func renderParagraphXML(sb *strings.Builder, p *Paragraph) {
        sb.WriteString("<w:p>")
        for _, r := range p.runs {
                sb.WriteString("<w:r>")
                if r.bold || r.italic || r.underline || r.strike || r.color != "" || r.size > 0 {
                        sb.WriteString("<w:rPr>")
                        if r.bold { sb.WriteString("<w:b/>") }
                        if r.italic { sb.WriteString("<w:i/>") }
                        if r.underline { sb.WriteString(`<w:u w:val="single"/>`) }
                        if r.strike { sb.WriteString("<w:strike/>") }
                        if r.color != "" { sb.WriteString(fmt.Sprintf(`<w:color w:val="%s"/>`, r.color)) }
                        if r.size > 0 { sb.WriteString(fmt.Sprintf(`<w:sz w:val="%d"/>`, r.size*2)) }
                        sb.WriteString("</w:rPr>")
                }
                sb.WriteString(fmt.Sprintf(`<w:t xml:space="preserve">%s</w:t></w:r>`, escapeXML(r.text)))
        }
        sb.WriteString("</w:p>\n")
}

func renderListXML(sb *strings.Builder, l *List) {
        numID := "1"
        if l.ordered { numID = "2" }
        for _, item := range l.items {
                sb.WriteString(fmt.Sprintf(`<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="%s"/></w:numPr></w:pPr>`, numID))
                sb.WriteString(fmt.Sprintf(`<w:r><w:t xml:space="preserve">%s</w:t></w:r>`, escapeXML(item)))
                sb.WriteString("</w:p>\n")
        }
}

func renderTableXML(sb *strings.Builder, t *Table) {
        sb.WriteString(`<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/></w:tblPr>`)
        for ri, row := range t.rows {
                sb.WriteString("<w:tr>")
                for _, cell := range row {
                        isHeader := t.header && ri == 0
                        sb.WriteString("<w:tc><w:tcPr>")
                        if isHeader {
                                sb.WriteString(`<w:shd w:val="clear" w:color="auto" w:fill="EEEEEE"/>`)
                        }
                        sb.WriteString("</w:tcPr>")
                        sb.WriteString(fmt.Sprintf(`<w:p><w:r><w:rPr>%s</w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>`,
                                func() string { if isHeader { return "<w:b/>" }; return "" }(),
                                escapeXML(cell)))
                        sb.WriteString("</w:tc>")
                }
                sb.WriteString("</w:tr>")
        }
        sb.WriteString("</w:tbl>\n")
}

func renderImageXML(sb *strings.Builder, im *Image, id int) {
        width := im.width
        if width == 0 { width = 400 }
        height := im.height
        if height == 0 { height = 300 }
        cx := width * 9525 // px to EMU
        cy := height * 9525
        relID := fmt.Sprintf("rIdImg%d", id)
        sb.WriteString(fmt.Sprintf(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing>
<wp:inline distT="0" distB="0" distL="0" distR="0">
<wp:extent cx="%d" cy="%d"/>
<wp:docPr id="%d" name="Picture %d"/>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:nvPicPr><pic:cNvPr id="%d" name="image%d."/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="%s"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="%d" cy="%d"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
</pic:pic>
</a:graphicData>
</a:graphic>
</wp:inline>
</w:drawing></w:r></w:p>`, cx, cy, id, id, id, id, relID, cx, cy))
}

func renderCodeBlockXML(sb *strings.Builder, c *CodeBlock) {
        sb.WriteString(`<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr>`)
        for _, line := range strings.Split(c.code, "\n") {
                if line == "" { continue }
                sb.WriteString(fmt.Sprintf(`<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r>`, escapeXML(line)))
        }
        sb.WriteString("</w:p>\n")
}

func (d *Document) corePropsXML() string {
        now := time.Now().UTC().Format(time.RFC3339)
        return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>%s</dc:title><dc:creator>%s</dc:creator><dc:subject>%s</dc:subject>
  <dcterms:created xsi:type="dcterms:W3CDTF">%s</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">%s</dcterms:modified>
</cp:coreProperties>`, escapeXML(d.title), escapeXML(d.author), escapeXML(d.subject), now, now)
}

func (d *Document) docRelsXML() string {
        var sb strings.Builder
        sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
`)
        imgID := 0
        for _, e := range d.elements {
                if im, ok := e.(*Image); ok {
                        imgID++
                        ext := "png"
                        _ = im
                        sb.WriteString(fmt.Sprintf(`  <Relationship Id="rIdImg%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image%d.%s"/>`+"\n", imgID, imgID, ext))
                }
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
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`
}

const rootRelsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`

// === 解析 ===

func parseCoreProps(r io.Reader, doc *Document) {
        data, _ := io.ReadAll(r)
        s := string(data)
        // 简单正则提取
        if m := extractTag(s, "dc:title"); m != "" { doc.title = m }
        if m := extractTag(s, "dc:creator"); m != "" { doc.author = m }
        if m := extractTag(s, "dc:subject"); m != "" { doc.subject = m }
}

func parseDocumentXML(r io.Reader, doc *Document) {
        // 简化解析：用现有的 docx parser
        // 这里直接复用 internal/parser/docx 的逻辑
        // 为保持包独立性，简化实现
        data, _ := io.ReadAll(r)
        s := string(data)
        // 提取段落文本
        lines := extractParagraphs(s)
        for _, line := range lines {
                if line != "" {
                        doc.AddParagraph(line)
                }
        }
}

func extractParagraphs(xml string) []string {
        var lines []string
        // 简化：<w:t>...</w:t> 内容拼接
        inT := false
        var cur strings.Builder
        for i := 0; i < len(xml)-5; i++ {
                if xml[i:i+4] == "<w:t" {
                        // 找到 >
                        j := strings.Index(xml[i:], ">")
                        if j < 0 { break }
                        inT = true
                        i += j
                } else if xml[i:i+6] == "</w:t>" && inT {
                        inT = false
                        lines = append(lines, cur.String())
                        cur.Reset()
                } else if inT {
                        cur.WriteByte(xml[i])
                }
        }
        return lines
}

func extractTag(xml, tag string) string {
        start := strings.Index(xml, "<"+tag+">")
        if start < 0 { return "" }
        start += len(tag) + 2
        end := strings.Index(xml[start:], "</"+tag+">")
        if end < 0 { return "" }
        return xml[start : start+end]
}

// === 工具 ===

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
