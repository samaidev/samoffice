// Package docx 将 UDM 渲染为 .docx 文件
// 生成最小可打开的 OOXML 结构，被 Word/WPS/LibreOffice 兼容
//
// 结构：
//   [Content_Types].xml
//   _rels/.rels
//   word/document.xml      ← 主要内容
//   word/_rels/document.xml.rels
//   docProps/core.xml      ← 元数据
package docx

import (
        "archive/zip"
        "bytes"
        "fmt"
        "io"
        "strings"
        "time"

        "github.com/zai/gooffice/internal/core"
)

type Renderer struct{}

func New() *Renderer { return &Renderer{} }

func (r *Renderer) Supported() []string { return []string{".docx"} }

// Render 将 UDM 渲染为 docx 字节流
func (r *Renderer) Render(doc *core.Document) ([]byte, error) {
        buf := &bytes.Buffer{}
        w := zip.NewWriter(buf)

        // [Content_Types].xml
        if err := writeZip(w, "[Content_Types].xml", contentTypesXML); err != nil {
                return nil, err
        }
        // _rels/.rels
        if err := writeZip(w, "_rels/.rels", rootRelsXML); err != nil {
                return nil, err
        }
        // docProps/core.xml
        if err := writeZip(w, "docProps/core.xml", renderCoreProps(doc.Meta)); err != nil {
                return nil, err
        }
        // word/_rels/document.xml.rels
        if err := writeZip(w, "word/_rels/document.xml.rels", docRelsXML); err != nil {
                return nil, err
        }
        // word/document.xml
        if err := writeZip(w, "word/document.xml", renderDocumentXML(doc)); err != nil {
                return nil, err
        }

        if err := w.Close(); err != nil {
                return nil, fmt.Errorf("close zip: %w", err)
        }
        return buf.Bytes(), nil
}

// RenderToWriter 渲染并写入 io.Writer
func (r *Renderer) RenderToWriter(doc *core.Document, out io.Writer) error {
        data, err := r.Render(doc)
        if err != nil {
                return err
        }
        _, err = out.Write(data)
        return err
}

// renderDocumentXML 渲染 word/document.xml 主体
func renderDocumentXML(doc *core.Document) string {
        var sb strings.Builder
        sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
`)
        for _, b := range doc.Blocks {
                renderBlock(&sb, b)
        }
        // Section properties (页面设置)
        sb.WriteString(`<w:sectPr>
<w:pgSz w:w="11906" w:h="16838"/>
<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
</w:sectPr>
`)
        sb.WriteString("</w:body>\n</w:document>")
        return sb.String()
}

// renderBlock 渲染单个 block
func renderBlock(sb *strings.Builder, b core.Block) {
        switch v := b.(type) {
        case *core.Paragraph:
                renderParagraph(sb, v)
        case *core.Heading:
                renderHeading(sb, v)
        case *core.BulletList:
                renderBulletList(sb, v)
        case *core.CodeBlock:
                renderCodeBlock(sb, v)
        case *core.Image:
                renderImage(sb, v)
        case *core.RawBlock:
                // 跳过原始块
        default:
                // 兜底：作为段落
                sb.WriteString("<w:p/>")
        }
}

func renderParagraph(sb *strings.Builder, p *core.Paragraph) {
        sb.WriteString("<w:p>")
        if p.Style != "" {
                sb.WriteString(`<w:pPr><w:pStyle w:val="`)
                sb.WriteString(escapeXML(p.Style))
                sb.WriteString(`"/>`)
                if p.Align != "" {
                        sb.WriteString(`<w:jc w:val="`)
                        sb.WriteString(escapeXML(p.Align))
                        sb.WriteString(`"/>`)
                }
                sb.WriteString("</w:pPr>")
        } else if p.Align != "" {
                sb.WriteString(`<w:pPr><w:jc w:val="`)
                sb.WriteString(escapeXML(p.Align))
                sb.WriteString(`"/></w:pPr>`)
        }
        for _, in := range p.Inline {
                renderInline(sb, in)
        }
        sb.WriteString("</w:p>\n")
}

func renderHeading(sb *strings.Builder, h *core.Heading) {
        level := h.Level
        if level < 1 {
                level = 1
        }
        if level > 6 {
                level = 6
        }
        sb.WriteString("<w:p>")
        sb.WriteString(`<w:pPr><w:pStyle w:val="Heading`)
        sb.WriteString(fmt.Sprintf("%d", level))
        sb.WriteString(`"/></w:pPr>`)
        for _, in := range h.Inline {
                renderInline(sb, in)
        }
        sb.WriteString("</w:p>\n")
}

func renderBulletList(sb *strings.Builder, l *core.BulletList) {
        for _, item := range l.Items {
                sb.WriteString("<w:p>")
                sb.WriteString(`<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="`)
                if l.Ordered {
                        sb.WriteString("2")
                } else {
                        sb.WriteString("1")
                }
                sb.WriteString(`"/></w:numPr></w:pPr>`)
                for _, b := range item {
                        if p, ok := b.(*core.Paragraph); ok {
                                for _, in := range p.Inline {
                                        renderInline(sb, in)
                                }
                        }
                }
                sb.WriteString("</w:p>\n")
        }
}

func renderCodeBlock(sb *strings.Builder, c *core.CodeBlock) {
        // 代码块作为等宽字体段落
        sb.WriteString(`<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr>`)
        for _, line := range strings.Split(c.Code, "\n") {
                if line == "" {
                        continue
                }
                sb.WriteString(`<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr><w:t xml:space="preserve">`)
                sb.WriteString(escapeXML(line))
                sb.WriteString("</w:t></w:r>")
        }
        sb.WriteString("</w:p>\n")
}

func renderImage(sb *strings.Builder, im *core.Image) {
        // 简化：占位段落（实际需要 media 文件 + drawing 元素）
        sb.WriteString(`<w:p><w:r><w:t>[Image: `)
        sb.WriteString(escapeXML(im.Src))
        sb.WriteString(`]</w:t></w:r></w:p>`)
}

func renderInline(sb *strings.Builder, in core.Inline) {
        switch v := in.(type) {
        case *core.Text:
                // 注意：UDM 的 Text 是值类型，但 Block 接口返回值
                // 实际上通过 JSON 反序列化后是指针
                // 这里处理两种情况
                renderText(sb, *v)
        case core.Text:
                renderText(sb, v)
        case *core.Hyperlink:
                sb.WriteString(`<w:hyperlink r:id="rId`)
                sb.WriteString(fmt.Sprintf("%d", hashString(v.URL)))
                sb.WriteString(`"><w:r><w:t xml:space="preserve">`)
                for _, t := range v.Text {
                        if tt, ok := t.(core.Text); ok {
                                sb.WriteString(escapeXML(tt.Content))
                        } else if tt, ok := t.(*core.Text); ok {
                                sb.WriteString(escapeXML(tt.Content))
                        }
                }
                sb.WriteString(`</w:t></w:r></w:hyperlink>`)
        case core.Hyperlink:
                sb.WriteString(`<w:hyperlink r:id="rId`)
                sb.WriteString(fmt.Sprintf("%d", hashString(v.URL)))
                sb.WriteString(`"><w:r><w:t xml:space="preserve">`)
                for _, t := range v.Text {
                        if tt, ok := t.(core.Text); ok {
                                sb.WriteString(escapeXML(tt.Content))
                        }
                }
                sb.WriteString(`</w:t></w:r></w:hyperlink>`)
        }
}

// renderText 渲染文本 run（含粗体/斜体等标记）
func renderText(sb *strings.Builder, t core.Text) {
        if t.Content == "" {
                return
        }
        sb.WriteString("<w:r>")
        if t.Bold || t.Italic || t.Under || t.Strike || t.Style == "code" {
                sb.WriteString("<w:rPr>")
                if t.Bold {
                        sb.WriteString("<w:b/>")
                }
                if t.Italic {
                        sb.WriteString("<w:i/>")
                }
                if t.Under {
                        sb.WriteString(`<w:u w:val="single"/>`)
                }
                if t.Strike {
                        sb.WriteString("<w:strike/>")
                }
                if t.Style == "code" {
                        sb.WriteString(`<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>`)
                }
                sb.WriteString("</w:rPr>")
        }
        sb.WriteString(`<w:t xml:space="preserve">`)
        sb.WriteString(escapeXML(t.Content))
        sb.WriteString("</w:t></w:r>")
}

func renderCoreProps(meta core.Meta) string {
        now := time.Now().UTC().Format(time.RFC3339)
        created := meta.CreatedAt
        if created == "" {
                created = now
        }
        modified := meta.ModifiedAt
        if modified == "" {
                modified = now
        }
        var sb strings.Builder
        sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>`)
        sb.WriteString(escapeXML(meta.Title))
        sb.WriteString("</dc:title><dc:creator>")
        sb.WriteString(escapeXML(meta.Author))
        sb.WriteString("</dc:creator><dc:subject>")
        sb.WriteString(escapeXML(meta.Subject))
        sb.WriteString("</dc:subject><dc:description>")
        sb.WriteString(escapeXML(meta.Description))
        sb.WriteString("</dc:description><dc:language>")
        sb.WriteString(escapeXML(meta.Language))
        sb.WriteString("</dc:language><dcterms:created xsi:type=\"dcterms:W3CDTF\">")
        sb.WriteString(escapeXML(created))
        sb.WriteString("</dcterms:created><dcterms:modified xsi:type=\"dcterms:W3CDTF\">")
        sb.WriteString(escapeXML(modified))
        sb.WriteString("</dcterms:modified></cp:coreProperties>")
        return sb.String()
}

func escapeXML(s string) string {
        s = strings.ReplaceAll(s, "&", "&amp;")
        s = strings.ReplaceAll(s, "<", "&lt;")
        s = strings.ReplaceAll(s, ">", "&gt;")
        s = strings.ReplaceAll(s, `"`, "&quot;")
        s = strings.ReplaceAll(s, `'`, "&apos;")
        return s
}

func hashString(s string) int {
        h := 0
        for _, r := range s {
                h = h*31 + int(r)
        }
        if h < 0 {
                h = -h
        }
        return h%1000 + 100
}

func writeZip(w *zip.Writer, name, content string) error {
        f, err := w.Create(name)
        if err != nil {
                return err
        }
        _, err = f.Write([]byte(content))
        return err
}

const contentTypesXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`

const rootRelsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`

const docRelsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`
