// Package docx 将 UDM 渲染为 .docx 文件
// 生成最小可打开的 OOXML 结构，被 Word/WPS/LibreOffice 兼容
//
// 结构：
//   [Content_Types].xml
//   _rels/.rels
//   word/document.xml      ← 主要内容
//   word/_rels/document.xml.rels
//   word/media/image1.png  ← 嵌入的图片
//   docProps/core.xml      ← 元数据
package docx

import (
        "archive/zip"
        "bytes"
        "encoding/base64"
        "fmt"
        "io"
        "net/http"
        "strings"
        "time"

        "github.com/zai/samoffice/internal/core"
)

type Renderer struct{}

func New() *Renderer { return &Renderer{} }

func (r *Renderer) Supported() []string { return []string{".docx"} }

// Render 将 UDM 渲染为 docx 字节流
// Image.Src 支持：data:image/...;base64,... 或 http(s):// URL（暂不下载）或本地路径占位
func (r *Renderer) Render(doc *core.Document) ([]byte, error) {
        buf := &bytes.Buffer{}
        w := zip.NewWriter(buf)

        // 收集图片（data URI → imageN.ext）
        images := collectImages(doc)

        // [Content_Types].xml（包含图片 MIME 类型）
        if err := writeZip(w, "[Content_Types].xml", renderContentTypes(images)); err != nil {
                return nil, err
        }
        if err := writeZip(w, "_rels/.rels", rootRelsXML); err != nil {
                return nil, err
        }
        if err := writeZip(w, "docProps/core.xml", renderCoreProps(doc.Meta)); err != nil {
                return nil, err
        }
        // word/_rels/document.xml.rels（包含 image relationship）
        if err := writeZip(w, "word/_rels/document.xml.rels", renderDocRels(images)); err != nil {
                return nil, err
        }
        // word/document.xml
        if err := writeZip(w, "word/document.xml", renderDocumentXML(doc, images)); err != nil {
                return nil, err
        }

        // 写入图片文件
        for i, im := range images {
                if err := writeZipBytes(w, "word/media/"+im.FileName, im.Data); err != nil {
                        return nil, err
                }
                _ = i
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

// === 图片处理 ===

type embedImage struct {
        ID       int
        FileName string  // image1.png
        RelID    string  // rId100
        Ext      string  // png / jpg
        MIME     string  // image/png
        Data     []byte
        Width    int // EMU (914400 EMU = 1 inch)
        Height   int
}

// collectImages 扫描文档所有 Image block/inline，提取 data URI
func collectImages(doc *core.Document) []*embedImage {
        var out []*embedImage
        id := 0
        for _, b := range doc.Blocks {
                if im, ok := b.(*core.Image); ok {
                        if e := parseImage(im.Src, im.Width, im.Height, &id); e != nil {
                                out = append(out, e)
                        }
                }
                // 段落中也可能有 InlineImage
                if p, ok := b.(*core.Paragraph); ok {
                        for _, in := range p.Inline {
                                if iim, ok := in.(*core.InlineImage); ok {
                                        if e := parseImage(iim.Src, iim.Width, iim.Height, &id); e != nil {
                                                out = append(out, e)
                                        }
                                }
                        }
                }
        }
        return out
}

// parseImage 解析 data URI 或 http(s) URL，返回 embedImage
// 支持：
//   - data:image/png;base64,xxxx
//   - http://example.com/foo.png
//   - https://example.com/foo.jpg
func parseImage(src string, w, h float64, id *int) *embedImage {
        if strings.HasPrefix(src, "data:") {
                return parseDataURI(src, w, h, id)
        }
        if strings.HasPrefix(src, "http://") || strings.HasPrefix(src, "https://") {
                return parseURLImage(src, w, h, id)
        }
        // 本地路径或其他格式暂不支持
        return nil
}

// parseDataURI 解析 data:image/...;base64,xxxxx
func parseDataURI(src string, w, h float64, id *int) *embedImage {
        comma := strings.Index(src, ",")
        if comma < 0 {
                return nil
        }
        meta := src[5:comma] // image/png;base64
        b64 := src[comma+1:]

        parts := strings.Split(meta, ";")
        mime := parts[0] // image/png
        if !strings.HasPrefix(mime, "image/") {
                return nil
        }
        ext := mime[6:]

        isBase64 := false
        for _, p := range parts[1:] {
                if p == "base64" {
                        isBase64 = true
                }
        }
        if !isBase64 {
                return nil
        }

        data, err := base64.StdEncoding.DecodeString(b64)
        if err != nil {
                return nil
        }

        *id++
        return &embedImage{
                ID:       *id,
                FileName: fmt.Sprintf("image%d.%s", *id, ext),
                RelID:    fmt.Sprintf("rIdImg%d", *id),
                Ext:      ext,
                MIME:     mime,
                Data:     data,
                Width:    pxToEMU(w, 400),
                Height:   pxToEMU(h, 300),
        }
}

// parseURLImage 下载 http(s) URL 图片
// 限制：5 秒超时，5MB 大小限制，仅 image/* MIME
var httpClient = &http.Client{Timeout: 5 * time.Second}

func parseURLImage(url string, w, h float64, id *int) *embedImage {
        resp, err := httpClient.Get(url)
        if err != nil {
                return nil
        }
        defer resp.Body.Close()
        if resp.StatusCode != 200 {
                return nil
        }
        mime := resp.Header.Get("Content-Type")
        if !strings.HasPrefix(mime, "image/") {
                return nil
        }
        // 5MB 上限
        const maxSize = 5 * 1024 * 1024
        body, err := io.ReadAll(io.LimitReader(resp.Body, maxSize+1))
        if err != nil || len(body) > maxSize {
                return nil
        }

        ext := mime[6:]
        if ext == "jpeg" {
                ext = "jpg"
        }

        *id++
        return &embedImage{
                ID:       *id,
                FileName: fmt.Sprintf("image%d.%s", *id, ext),
                RelID:    fmt.Sprintf("rIdImg%d", *id),
                Ext:      ext,
                MIME:     mime,
                Data:     body,
                Width:    pxToEMU(w, 400),
                Height:   pxToEMU(h, 300),
        }
}

// pxToEMU 像素转 EMU (English Metric Unit)
// 914400 EMU = 1 inch = 96 px (默认 DPI)
// 空值用 defaultValue
func pxToEMU(px, defaultValue float64) int {
        if px <= 0 {
                px = defaultValue
        }
        return int(px * 914400 / 96)
}

// renderContentTypes 渲染 [Content_Types].xml（含图片扩展）
func renderContentTypes(images []*embedImage) string {
        var sb strings.Builder
        sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
`)
        // 收集图片扩展名
        exts := map[string]bool{}
        for _, im := range images {
                exts[im.Ext] = true
        }
        for ext := range exts {
                mime := "image/" + ext
                if ext == "jpg" || ext == "jpeg" {
                        mime = "image/jpeg"
                }
                sb.WriteString(fmt.Sprintf(`  <Default Extension="%s" ContentType="%s"/>`+"\n", ext, mime))
        }
        sb.WriteString(`  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`)
        return sb.String()
}

// renderDocRels 渲染 word/_rels/document.xml.rels
func renderDocRels(images []*embedImage) string {
        var sb strings.Builder
        sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
`)
        for _, im := range images {
                sb.WriteString(fmt.Sprintf(`  <Relationship Id="%s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/%s"/>`+"\n", im.RelID, im.FileName))
        }
        sb.WriteString("</Relationships>")
        return sb.String()
}

// renderDocumentXML 渲染 word/document.xml 主体
func renderDocumentXML(doc *core.Document, images []*embedImage) string {
        // 建立 src → image 映射（用于 renderImage 时查找 relId）
        imageMap := make(map[string]*embedImage, len(images))
        idx := 0
        for _, b := range doc.Blocks {
                if im, ok := b.(*core.Image); ok {
                        if idx < len(images) && strings.HasPrefix(im.Src, "data:") {
                                imageMap[im.Src] = images[idx]
                                idx++
                        }
                }
        }

        var sb strings.Builder
        sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<w:body>
`)
        for _, b := range doc.Blocks {
                renderBlock(&sb, b, imageMap)
        }
        sb.WriteString(`<w:sectPr>
<w:pgSz w:w="11906" w:h="16838"/>
<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
</w:sectPr>
`)
        sb.WriteString("</w:body>\n</w:document>")
        return sb.String()
}

// renderBlock 渲染单个 block
func renderBlock(sb *strings.Builder, b core.Block, images map[string]*embedImage) {
        switch v := b.(type) {
        case *core.Paragraph:
                renderParagraph(sb, v, images)
        case *core.Heading:
                renderHeading(sb, v)
        case *core.BulletList:
                renderBulletList(sb, v)
        case *core.CodeBlock:
                renderCodeBlock(sb, v)
        case *core.Image:
                renderImage(sb, v, images)
        case *core.RawBlock:
                // 跳过
        default:
                sb.WriteString("<w:p/>")
        }
}

func renderParagraph(sb *strings.Builder, p *core.Paragraph, images map[string]*embedImage) {
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
                // InlineImage 处理
                if iim, ok := in.(*core.InlineImage); ok {
                        renderInlineImage(sb, iim, images)
                        continue
                }
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

// renderImage 渲染块级 Image，使用 drawing 元素嵌入真实图片
func renderImage(sb *strings.Builder, im *core.Image, images map[string]*embedImage) {
        sb.WriteString("<w:p>")
        sb.WriteString(`<w:pPr><w:jc w:val="center"/></w:pPr>`)

        e, ok := images[im.Src]
        if ok {
                // 真实图片嵌入：drawing + blip
                sb.WriteString(`<w:r><w:drawing>
<wp:inline distT="0" distB="0" distL="0" distR="0">
<wp:extent cx="`)
                sb.WriteString(fmt.Sprintf("%d", e.Width))
                sb.WriteString(`" cy="`)
                sb.WriteString(fmt.Sprintf("%d", e.Height))
                sb.WriteString(`"/>
<wp:effectExtent l="0" t="0" r="0" b="0"/>
<wp:docPr id="`)
                sb.WriteString(fmt.Sprintf("%d", e.ID))
                sb.WriteString(`" name="Picture `)
                sb.WriteString(fmt.Sprintf("%d", e.ID))
                sb.WriteString(`"/>
<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:nvPicPr>
<pic:cNvPr id="`)
                sb.WriteString(fmt.Sprintf("%d", e.ID))
                sb.WriteString(`" name="image`)
                sb.WriteString(fmt.Sprintf("%d", e.ID))
                sb.WriteString(`."/>
<pic:cNvPicPr/>
</pic:nvPicPr>
<pic:blipFill>
<a:blip r:embed="`)
                sb.WriteString(e.RelID)
                sb.WriteString(`"/>
<a:stretch><a:fillRect/></a:stretch>
</pic:blipFill>
<pic:spPr>
<a:xfrm><a:off x="0" y="0"/><a:ext cx="`)
                sb.WriteString(fmt.Sprintf("%d", e.Width))
                sb.WriteString(`" cy="`)
                sb.WriteString(fmt.Sprintf("%d", e.Height))
                sb.WriteString(`"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
</pic:spPr>
</pic:pic>
</a:graphicData>
</a:graphic>
</wp:inline>
</w:drawing></w:r>`)
        } else {
                // 占位（URL 或本地路径，无法嵌入）
                sb.WriteString(`<w:r><w:t xml:space="preserve">[Image: `)
                sb.WriteString(escapeXML(im.Src))
                sb.WriteString(`]</w:t></w:r>`)
        }
        sb.WriteString("</w:p>\n")
}

// renderInlineImage 渲染行内图片（嵌在段落中的 drawing）
func renderInlineImage(sb *strings.Builder, iim *core.InlineImage, images map[string]*embedImage) {
        e, ok := images[iim.Src]
        if !ok {
                // 占位
                sb.WriteString(`<w:r><w:t xml:space="preserve">[img]</w:t></w:r>`)
                return
        }
        sb.WriteString(`<w:r><w:drawing>
<wp:inline distT="0" distB="0" distL="0" distR="0">
<wp:extent cx="`)
        sb.WriteString(fmt.Sprintf("%d", e.Width))
        sb.WriteString(`" cy="`)
        sb.WriteString(fmt.Sprintf("%d", e.Height))
        sb.WriteString(`"/>
<wp:docPr id="`)
        sb.WriteString(fmt.Sprintf("%d", e.ID))
        sb.WriteString(`" name="Picture `)
        sb.WriteString(fmt.Sprintf("%d", e.ID))
        sb.WriteString(`"/>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:nvPicPr><pic:cNvPr id="`)
        sb.WriteString(fmt.Sprintf("%d", e.ID))
        sb.WriteString(`" name="image"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="`)
        sb.WriteString(e.RelID)
        sb.WriteString(`"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="`)
        sb.WriteString(fmt.Sprintf("%d", e.Width))
        sb.WriteString(`" cy="`)
        sb.WriteString(fmt.Sprintf("%d", e.Height))
        sb.WriteString(`"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
</pic:pic>
</a:graphicData>
</a:graphic>
</wp:inline>
</w:drawing></w:r>`)
}

func renderInline(sb *strings.Builder, in core.Inline) {
        switch v := in.(type) {
        case *core.Text:
                renderText(sb, *v)
        case core.Text:
                renderText(sb, v)
        case *core.Hyperlink:
                sb.WriteString(`<w:hyperlink r:id="`)
                sb.WriteString(fmt.Sprintf("rId%d", hashString(v.URL)))
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
                sb.WriteString(`<w:hyperlink r:id="`)
                sb.WriteString(fmt.Sprintf("rId%d", hashString(v.URL)))
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

func writeZipBytes(w *zip.Writer, name string, data []byte) error {
        f, err := w.Create(name)
        if err != nil {
                return err
        }
        _, err = f.Write(data)
        return err
}

const rootRelsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`
