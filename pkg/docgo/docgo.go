// Package docgo 提供简洁的 .docx 文件读写 API
// 设计参考 python-docx，目标是让智能体和开发者能一行代码操作 Word 文档
//
// 快速开始：
//
//	doc := docgo.New()
//	doc.AddHeading("报告标题", 1)
//	doc.AddParagraph("正文内容").Bold(true)
//	doc.AddList([]string{"项目一", "项目二"})
//	doc.Save("report.docx")
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
	// 高级功能
	template   string // 模板名
	header     string // 页眉
	footer     string // 页脚
	pageNum    bool   // 是否显示页码
	tocEnabled bool   // 是否生成目录
	margins    PageMargins
	pageSize   PageSize
}

// PageMargins 页边距（EMU，默认 1 inch = 914400）
type PageMargins struct {
	Top, Bottom, Left, Right, Header, Footer int
}

// PageSize 页面尺寸（twips，默认 A4）
type PageSize struct {
	Width, Height int
}

// Element 是文档元素的接口
type Element interface {
	elementType() string
}

// DefaultPageSize A4
func DefaultPageSize() PageSize {
	return PageSize{Width: 11906, Height: 16838}
}

// DefaultPageMargins 1 inch margins
func DefaultPageMargins() PageMargins {
	return PageMargins{Top: 1440, Bottom: 1440, Left: 1440, Right: 1440, Header: 720, Footer: 720}
}

// Heading 标题
type Heading struct {
	Level int
	Text  string
}

func (h *Heading) elementType() string { return "heading" }

// Paragraph 段落
type Paragraph struct {
	runs []Run
}

func (p *Paragraph) elementType() string { return "paragraph" }

// Run 文本片段
type Run struct {
	text      string
	bold      bool
	italic    bool
	underline bool
	strike    bool
	color     string
	size      int
	font      string
	highlight string // 高亮色：yellow/green/cyan/magenta
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
	rows   [][]string
	header bool
	// 高级：列宽（twips）
	colWidths []int
	// 高级：单元格样式
	borderStyle string // single/dashed/double
}

func (t *Table) elementType() string { return "table" }

// Image 图片
type Image struct {
	path   string
	data   []byte
	width  int
	height int
	alt    string
}

func (i *Image) elementType() string { return "image" }

// CodeBlock 代码块
type CodeBlock struct {
	language string
	code     string
}

func (c *CodeBlock) elementType() string { return "code" }

// TableOfContents 目录（自动生成）
type TableOfContents struct {
	maxLevel int
}

func (t *TableOfContents) elementType() string { return "toc" }

// New 创建新文档
func New() *Document {
	return &Document{
		title:     "Untitled",
		pageSize:  DefaultPageSize(),
		margins:   DefaultPageMargins(),
	}
}

// SetTitle 设置标题
func (d *Document) SetTitle(title string) *Document { d.title = title; return d }

// SetAuthor 设置作者
func (d *Document) SetAuthor(author string) *Document { d.author = author; return d }

// SetSubject 设置主题
func (d *Document) SetSubject(subject string) *Document { d.subject = subject; return d }

// SetTemplate 设置样式模板
// 可选："default" / "report" / "letter" / "resume"
func (d *Document) SetTemplate(t string) *Document { d.template = t; return d }

// SetHeader 设置页眉
func (d *Document) SetHeader(text string) *Document { d.header = text; return d }

// SetFooter 设置页脚
func (d *Document) SetFooter(text string) *Document { d.footer = text; return d }

// SetPageNumber 显示页码
func (d *Document) SetPageNumber(show bool) *Document { d.pageNum = show; return d }

// SetMargins 设置页边距（EMU）
func (d *Document) SetMargins(m PageMargins) *Document { d.margins = m; return d }

// SetPageSize 设置页面尺寸（twips）
func (d *Document) SetPageSize(s PageSize) *Document { d.pageSize = s; return d }

// AddTableOfContents 添加自动目录
// maxLevel: 目录包含的最大标题层级（1-6）
func (d *Document) AddTableOfContents(maxLevel int) *TableOfContents {
	if maxLevel < 1 { maxLevel = 3 }
	if maxLevel > 6 { maxLevel = 6 }
	toc := &TableOfContents{maxLevel: maxLevel}
	d.elements = append(d.elements, toc)
	d.tocEnabled = true
	return toc
}

// Title 获取标题
func (d *Document) Title() string { return d.title }

// Author 获取作者
func (d *Document) Author() string { return d.author }

// AddHeading 添加标题
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

// AddRun 添加文本片段到段落
func (p *Paragraph) AddRun(text string) *Run {
	r := Run{text: text}
	p.runs = append(p.runs, r)
	return &p.runs[len(p.runs)-1]
}

// Bold 加粗
func (r *Run) Bold(b bool) *Run { r.bold = b; return r }

// Italic 斜体
func (r *Run) Italic(b bool) *Run { r.italic = b; return r }

// Underline 下划线
func (r *Run) Underline(b bool) *Run { r.underline = b; return r }

// Strike 删除线
func (r *Run) Strike(b bool) *Run { r.strike = b; return r }

// Color 颜色（hex，如 "FF0000"）
func (r *Run) Color(hex string) *Run { r.color = hex; return r }

// Size 字号（pt）
func (r *Run) Size(pt int) *Run { r.size = pt; return r }

// Font 字体
func (r *Run) Font(name string) *Run { r.font = name; return r }

// Highlight 高亮（yellow/green/cyan/magenta）
func (r *Run) Highlight(color string) *Run { r.highlight = color; return r }

// AddList 无序列表
func (d *Document) AddList(items []string) *List {
	l := &List{items: items, ordered: false}
	d.elements = append(d.elements, l)
	return l
}

// AddOrderedList 有序列表
func (d *Document) AddOrderedList(items []string) *List {
	l := &List{items: items, ordered: true}
	d.elements = append(d.elements, l)
	return l
}

// Ordered 是否有序
func (l *List) Ordered(b bool) *List { l.ordered = b; return l }

// AddTable 添加表格
func (d *Document) AddTable(rows [][]string) *Table {
	t := &Table{rows: rows, header: true, borderStyle: "single"}
	d.elements = append(d.elements, t)
	return t
}

// SetHeader 设置表头
func (t *Table) SetHeader(b bool) *Table { t.header = b; return t }

// SetColWidths 设置列宽（twips）
func (t *Table) SetColWidths(widths []int) *Table { t.colWidths = widths; return t }

// SetBorderStyle 设置边框样式：single/dashed/double
func (t *Table) SetBorderStyle(style string) *Table { t.borderStyle = style; return t }

// AddImage 添加图片（路径）
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

// Save 保存
func (d *Document) Save(path string) error {
	data, err := d.Bytes()
	if err != nil { return err }
	return os.WriteFile(path, data, 0644)
}

// Bytes 生成 docx 字节流
func (d *Document) Bytes() ([]byte, error) {
	buf := &bytes.Buffer{}
	w := zip.NewWriter(buf)

	writeFile(w, "[Content_Types].xml", contentTypesXML())
	writeFile(w, "_rels/.rels", rootRelsXML)
	writeFile(w, "docProps/core.xml", d.corePropsXML())
	writeFile(w, "word/document.xml", d.documentXML())
	writeFile(w, "word/_rels/document.xml.rels", d.docRelsXML())

	// 页眉页脚
	if d.header != "" {
		writeFile(w, "word/header1.xml", d.headerXML())
	}
	if d.footer != "" || d.pageNum {
		writeFile(w, "word/footer1.xml", d.footerXML())
	}

	// 图片
	imgID := 0
	for _, e := range d.elements {
		if im, ok := e.(*Image); ok {
			imgID++
			imgPath := fmt.Sprintf("word/media/image%d.png", imgID)
			if len(im.data) > 0 {
				writeFileBytes(w, imgPath, im.data)
			} else if im.path != "" {
				data, err := os.ReadFile(im.path)
				if err == nil { writeFileBytes(w, imgPath, data) }
			}
		}
	}

	if err := w.Close(); err != nil { return nil, err }
	return buf.Bytes(), nil
}

// WriteTo 写入 io.Writer
func (d *Document) WriteTo(w io.Writer) (int64, error) {
	data, err := d.Bytes()
	if err != nil { return 0, err }
	n, err := w.Write(data)
	return int64(n), err
}

// Open 打开 docx
func Open(path string) (*Document, error) {
	data, err := os.ReadFile(path)
	if err != nil { return nil, err }
	return ParseBytes(data)
}

// ParseBytes 解析 docx 字节流
func ParseBytes(data []byte) (*Document, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil { return nil, fmt.Errorf("open zip: %w", err) }

	doc := New()
	files := make(map[string]*zip.File)
	for _, f := range zr.File { files[f.Name] = f }

	if coreFile, ok := files["docProps/core.xml"]; ok {
		if rc, err := coreFile.Open(); err == nil {
			parseCoreProps(rc, doc)
			rc.Close()
		}
	}

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
	for _, e := range d.elements {
		switch v := e.(type) {
		case *Heading: renderHeadingXML(&sb, v)
		case *Paragraph: renderParagraphXML(&sb, v)
		case *List: renderListXML(&sb, v)
		case *Table: renderTableXML(&sb, v)
		case *Image: renderImageXML(&sb, v, 0)
		case *CodeBlock: renderCodeBlockXML(&sb, v)
		case *TableOfContents: renderTOCXML(&sb, v)
		}
	}

	// Section properties（含页眉页脚引用、页面设置）
	sb.WriteString(fmt.Sprintf(`<w:sectPr>
<w:pgSz w:w="%d" w:h="%d"/>
<w:pgMar w:top="%d" w:right="%d" w:bottom="%d" w:left="%d" w:header="%d" w:footer="%d" w:gutter="0"/>`,
		d.pageSize.Width, d.pageSize.Height,
		d.margins.Top, d.margins.Right, d.margins.Bottom, d.margins.Left, d.margins.Header, d.margins.Footer))
	if d.header != "" {
		sb.WriteString(`<w:headerReference w:type="default" r:id="rIdHdr"/>`)
	}
	if d.footer != "" || d.pageNum {
		sb.WriteString(`<w:footerReference w:type="default" r:id="rIdFtr"/>`)
	}
	sb.WriteString("</w:sectPr>\n</w:body>\n</w:document>")
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
		if r.bold || r.italic || r.underline || r.strike || r.color != "" || r.size > 0 || r.font != "" || r.highlight != "" {
			sb.WriteString("<w:rPr>")
			if r.bold { sb.WriteString("<w:b/>") }
			if r.italic { sb.WriteString("<w:i/>") }
			if r.underline { sb.WriteString(`<w:u w:val="single"/>`) }
			if r.strike { sb.WriteString("<w:strike/>") }
			if r.color != "" { sb.WriteString(fmt.Sprintf(`<w:color w:val="%s"/>`, r.color)) }
			if r.size > 0 { sb.WriteString(fmt.Sprintf(`<w:sz w:val="%d"/>`, r.size*2)) }
			if r.font != "" { sb.WriteString(fmt.Sprintf(`<w:rFonts w:ascii="%s" w:hAnsi="%s"/>`, r.font, r.font)) }
			if r.highlight != "" { sb.WriteString(fmt.Sprintf(`<w:highlight w:val="%s"/>`, r.highlight)) }
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
	// 列宽
	if len(t.colWidths) > 0 {
		sb.WriteString("<w:tblGrid>")
		for _, w := range t.colWidths {
			sb.WriteString(fmt.Sprintf(`<w:gridCol w:w="%d"/>`, w))
		}
		sb.WriteString("</w:tblGrid>")
	}
	borderXML := `<w:tcBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/></w:tcBorders>`
	if t.borderStyle == "dashed" {
		borderXML = `<w:tcBorders><w:top w:val="dashed" w:sz="4"/><w:left w:val="dashed" w:sz="4"/><w:bottom w:val="dashed" w:sz="4"/><w:right w:val="dashed" w:sz="4"/></w:tcBorders>`
	} else if t.borderStyle == "double" {
		borderXML = `<w:tcBorders><w:top w:val="double" w:sz="4"/><w:left w:val="double" w:sz="4"/><w:bottom w:val="double" w:sz="4"/><w:right w:val="double" w:sz="4"/></w:tcBorders>`
	}
	for ri, row := range t.rows {
		sb.WriteString("<w:tr>")
		for _, cell := range row {
			isHeader := t.header && ri == 0
			sb.WriteString("<w:tc><w:tcPr>")
			if isHeader {
				sb.WriteString(`<w:shd w:val="clear" w:color="auto" w:fill="EEEEEE"/>`)
			}
			sb.WriteString(borderXML)
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
	width := im.width; if width == 0 { width = 400 }
	height := im.height; if height == 0 { height = 300 }
	cx := width * 9525
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

func renderTOCXML(sb *strings.Builder, t *TableOfContents) {
	// Word 会自动生成 TOC，这里放置 TOC 字段
	sb.WriteString(fmt.Sprintf(`<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>目录</w:t></w:r></w:p>
<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">TOC \o "1-%d" \h \z \u</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>右键更新域以生成目录</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`, t.maxLevel))
}

func (d *Document) headerXML() string {
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">%s</w:t></w:r></w:p>
</w:hdr>`, escapeXML(d.header))
}

func (d *Document) footerXML() string {
	content := d.footer
	if d.pageNum {
		content += ` <w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`
	}
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">%s</w:t></w:r></w:p>
</w:ftr>`, escapeXML(content))
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
	if d.header != "" {
		sb.WriteString(`<Relationship Id="rIdHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>`)
	}
	if d.footer != "" || d.pageNum {
		sb.WriteString(`<Relationship Id="rIdFtr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>`)
	}
	imgID := 0
	for _, e := range d.elements {
		if im, ok := e.(*Image); ok {
			imgID++
			_ = im
			sb.WriteString(fmt.Sprintf(`  <Relationship Id="rIdImg%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image%d.png"/>`+"\n", imgID, imgID))
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
	if m := extractTag(s, "dc:title"); m != "" { doc.title = m }
	if m := extractTag(s, "dc:creator"); m != "" { doc.author = m }
	if m := extractTag(s, "dc:subject"); m != "" { doc.subject = m }
}

func parseDocumentXML(r io.Reader, doc *Document) {
	data, _ := io.ReadAll(r)
	s := string(data)
	lines := extractParagraphs(s)
	for _, line := range lines {
		if line != "" { doc.AddParagraph(line) }
	}
}

func extractParagraphs(xml string) []string {
	var lines []string
	inT := false
	var cur strings.Builder
	for i := 0; i < len(xml)-5; i++ {
		if xml[i:i+4] == "<w:t" {
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
