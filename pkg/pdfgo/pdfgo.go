// Package pdfgo 提供简洁的 .pdf 文件生成 API
// 设计参考 docgo，目标是让智能体和开发者能一行代码生成 PDF 文档
//
// 快速开始：
//
//      doc := pdfgo.New()
//      doc.AddHeading("报告标题", 1)
//      doc.AddParagraph("正文内容").Bold(true)
//      doc.AddList([]string{"项目一", "项目二"})
//      doc.Save("report.pdf")
//
// 支持功能：
//   - 多级标题 (1-6 级)
//   - 段落 (粗体/斜体/下划线/颜色/字体/字号)
//   - 有序/无序列表
//   - 表格 (含表头)
//   - 图片 (路径或字节)
//   - 代码块 (等宽字体 + 灰底)
//   - 分隔线 / 分页符
//   - 页面设置 (A4/Letter, 页边距)
//   - 中文字体 (Noto Serif SC)
//   - 页码 (页脚)
package pdfgo

import (
        "bytes"
        "embed"
        "fmt"
        "image"
        "image/color"
        _ "image/jpeg"
        _ "image/png"
        "io"
        "os"
        "strings"

        "github.com/signintech/gopdf"
)

//go:embed fonts/NotoSerifSC-Regular.ttf
var fontSerifFS embed.FS

//go:embed fonts/LiberationSans-Regular.ttf
var fontSansFS embed.FS

//go:embed fonts/LiberationMono-Regular.ttf
var fontMonoFS embed.FS

const (
        fontSerif = "NotoSerifSC"     // 宋体 (中文正文)
        fontSans  = "LiberationSans"  // 黑体 (标题)
        fontMono  = "LiberationMono"  // 等宽 (代码)

        // A4 尺寸 (point, 1pt = 1/72 inch)
        pageWidthA4  = 595.28
        pageHeightA4 = 841.89
        // Letter 尺寸
        pageWidthLetter  = 612.0
        pageHeightLetter = 792.0
)

// PageSize 页面尺寸预设
type PageSize struct {
        Width, Height float64
}

// 预设页面尺寸
var (
        PageSizeA4     = PageSize{Width: pageWidthA4, Height: pageHeightA4}
        PageSizeLetter = PageSize{Width: pageWidthLetter, Height: pageHeightLetter}
        PageSizeLegal  = PageSize{Width: 612.0, Height: 1008.0}
        // A3 用于海报/大文档
        PageSizeA3 = PageSize{Width: 841.89, Height: 1190.55}
)

// Margins 页边距 (point)
type Margins struct {
        Top, Bottom, Left, Right float64
}

// DefaultMargins 默认页边距 (50pt ≈ 1.76cm)
var DefaultMargins = Margins{Top: 50, Bottom: 50, Left: 50, Right: 50}

// Document 表示一个 PDF 文档
type Document struct {
        title     string
        author    string
        subject   string
        creator   string
        elements  []Element
        pageSize  PageSize
        margins   Margins
        pageNum   bool   // 是否显示页码
        header    string // 页眉
        footer    string // 页脚
        fontSize  int    // 默认正文字号 (pt)
        lineHeight float64 // 默认行高 (倍数)
}

// Element 文档元素接口
type Element interface {
        elementType() string
}

// New 创建新 PDF 文档
func New() *Document {
        return &Document{
                title:     "Untitled",
                creator:   "pdfgo",
                pageSize:  PageSizeA4,
                margins:   DefaultMargins,
                fontSize:  12,
                lineHeight: 1.5,
        }
}

// === Document 设置方法 (链式) ===

func (d *Document) SetTitle(s string) *Document       { d.title = s; return d }
func (d *Document) SetAuthor(s string) *Document      { d.author = s; return d }
func (d *Document) SetSubject(s string) *Document     { d.subject = s; return d }
func (d *Document) SetCreator(s string) *Document     { d.creator = s; return d }
func (d *Document) SetPageSize(s PageSize) *Document  { d.pageSize = s; return d }
func (d *Document) SetMargins(m Margins) *Document    { d.margins = m; return d }
func (d *Document) SetPageNumber(b bool) *Document    { d.pageNum = b; return d }
func (d *Document) SetHeader(s string) *Document      { d.header = s; return d }
func (d *Document) SetFooter(s string) *Document      { d.footer = s; return d }
func (d *Document) SetFontSize(pt int) *Document      { d.fontSize = pt; return d }
func (d *Document) SetLineHeight(lh float64) *Document { d.lineHeight = lh; return d }

func (d *Document) Title() string     { return d.title }
func (d *Document) Author() string    { return d.author }
func (d *Document) Elements() []Element { return d.elements }

// === 添加元素 ===

// AddHeading 添加标题
// level: 1-6, 1=最大
func (d *Document) AddHeading(text string, level int) *Heading {
        h := &Heading{Level: level, Text: text}
        d.elements = append(d.elements, h)
        return h
}

// AddParagraph 添加段落 (空文本，链式 AddRun 添加文本片段)
func (d *Document) AddParagraph(text string) *Paragraph {
        p := &Paragraph{fontSize: d.fontSize}
        if text != "" {
                p.AddRun(text)
        }
        d.elements = append(d.elements, p)
        return p
}

// AddParagraphStyled 添加带样式的段落
func (d *Document) AddParagraphStyled(text string, bold, italic bool) *Paragraph {
        p := d.AddParagraph("")
        if len(p.runs) > 0 {
                p.runs[0].bold = bold
                p.runs[0].italic = italic
        }
        return p
}

// AddList 添加无序列表
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

// AddTable 添加表格
// rows[0] 默认作为表头
func (d *Document) AddTable(rows [][]string) *Table {
        t := &Table{rows: rows, header: true, borderStyle: "single"}
        d.elements = append(d.elements, t)
        return t
}

// AddImage 添加图片 (路径)
func (d *Document) AddImage(path string, width, height int) *Image {
        im := &Image{path: path, width: width, height: height}
        d.elements = append(d.elements, im)
        return im
}

// AddImageBytes 添加图片 (字节数据)
func (d *Document) AddImageBytes(data []byte, width, height int) *Image {
        im := &Image{data: data, width: width, height: height}
        d.elements = append(d.elements, im)
        return im
}

// AddCodeBlock 添加代码块
func (d *Document) AddCodeBlock(language, code string) *CodeBlock {
        c := &CodeBlock{language: language, code: code}
        d.elements = append(d.elements, c)
        return c
}

// AddDivider 添加分隔线
func (d *Document) AddDivider() *Divider {
        dv := &Divider{}
        d.elements = append(d.elements, dv)
        return dv
}

// AddPageBreak 添加分页符
func (d *Document) AddPageBreak() *PageBreak {
        pb := &PageBreak{}
        d.elements = append(d.elements, pb)
        return pb
}

// === 元素类型定义 ===

// Heading 标题
type Heading struct {
        Level int
        Text  string
        Align string // left/center/right
}

func (h *Heading) elementType() string { return "heading" }

// SetAlign 设置对齐
func (h *Heading) SetAlign(a string) *Heading { h.Align = a; return h }

// Paragraph 段落
type Paragraph struct {
        runs        []Run
        align       string  // left/center/right/justify
        lineSpacing float64 // 行距倍数
        fontSize    int     // 段落默认字号
        spaceBefore float64 // 段前间距 pt
        spaceAfter  float64 // 段后间距 pt
        indent      float64 // 首行缩进 pt
}

func (p *Paragraph) elementType() string { return "paragraph" }

// Paragraph 链式方法
func (p *Paragraph) SetAlign(a string) *Paragraph         { p.align = a; return p }
func (p *Paragraph) SetLineSpacing(ls float64) *Paragraph { p.lineSpacing = ls; return p }
func (p *Paragraph) SetFontSize(pt int) *Paragraph       { p.fontSize = pt; return p }
func (p *Paragraph) SetSpaceBefore(pt float64) *Paragraph { p.spaceBefore = pt; return p }
func (p *Paragraph) SetSpaceAfter(pt float64) *Paragraph  { p.spaceAfter = pt; return p }
func (p *Paragraph) SetIndent(pt float64) *Paragraph     { p.indent = pt; return p }

// AddRun 添加文本片段
func (p *Paragraph) AddRun(text string) *Run {
        r := &Run{text: text, size: p.fontSize}
        p.runs = append(p.runs, *r)
        return &p.runs[len(p.runs)-1]
}

// Text 返回纯文本
func (p *Paragraph) Text() string {
        var sb strings.Builder
        for _, r := range p.runs {
                sb.WriteString(r.text)
        }
        return sb.String()
}

// Runs 返回所有 Run
func (p *Paragraph) Runs() []Run { return p.runs }

// Run 文本片段
type Run struct {
        text      string
        bold      bool
        italic    bool
        underline bool
        strike    bool
        color     string // hex, 如 "FF0000"
        size      int    // pt
        font      string // 字体名
        highlight string // yellow/green/cyan/magenta
}

func (r *Run) Text() string             { return r.text }
func (r *Run) Bold(b bool) *Run         { r.bold = b; return r }
func (r *Run) Italic(b bool) *Run       { r.italic = b; return r }
func (r *Run) Underline(b bool) *Run    { r.underline = b; return r }
func (r *Run) Strike(b bool) *Run       { r.strike = b; return r }
func (r *Run) Color(hex string) *Run    { r.color = hex; return r }
func (r *Run) Size(pt int) *Run         { r.size = pt; return r }
func (r *Run) Font(name string) *Run    { r.font = name; return r }
func (r *Run) Highlight(c string) *Run  { r.highlight = c; return r }

// List 列表
type List struct {
        items   []string
        ordered bool
}

func (l *List) elementType() string { return "list" }
func (l *List) Items() []string     { return l.items }
func (l *List) IsOrdered() bool     { return l.ordered }
func (l *List) Ordered(b bool) *List { l.ordered = b; return l }

// Table 表格
type Table struct {
        rows        [][]string
        header      bool
        colWidths   []float64 // 列宽 (pt)
        borderStyle string    // single/dashed/double
}

func (t *Table) elementType() string { return "table" }
func (t *Table) Rows() [][]string    { return t.rows }
func (t *Table) HasHeader() bool     { return t.header }
func (t *Table) SetHeader(b bool) *Table      { t.header = b; return t }
func (t *Table) SetColWidths(w []float64) *Table { t.colWidths = w; return t }
func (t *Table) SetBorderStyle(s string) *Table { t.borderStyle = s; return t }

// Image 图片
type Image struct {
        path          string
        data          []byte
        width, height int // pt (0=自动)
        alt           string
}

func (i *Image) elementType() string { return "image" }
func (i *Image) SetAlt(alt string) *Image { i.alt = alt; return i }

// CodeBlock 代码块
type CodeBlock struct {
        language string
        code     string
}

func (c *CodeBlock) elementType() string { return "code" }

// Divider 分隔线
type Divider struct{}

func (d *Divider) elementType() string { return "divider" }

// PageBreak 分页符
type PageBreak struct{}

func (p *PageBreak) elementType() string { return "pagebreak" }

// === 输出 ===

// Save 保存到文件
func (d *Document) Save(path string) error {
        data, err := d.Bytes()
        if err != nil {
                return err
        }
        return os.WriteFile(path, data, 0644)
}

// Bytes 返回 PDF 字节流
func (d *Document) Bytes() ([]byte, error) {
        pdf := &gopdf.GoPdf{}
        pdf.Start(gopdf.Config{
                PageSize: gopdf.Rect{W: d.pageSize.Width, H: d.pageSize.Height},
        })

        // 注册字体
        if err := registerEmbeddedFonts(pdf); err != nil {
                return nil, fmt.Errorf("register fonts: %w", err)
        }

        // 设置元数据
        pdf.SetInfo(gopdf.PdfInfo{
                Title:   d.title,
                Author:  d.author,
                Subject: d.subject,
                Creator: d.creator,
        })

        // 设置默认字体
        if err := pdf.SetFont(fontSerif, "", d.fontSize); err != nil {
                return nil, fmt.Errorf("set font: %w", err)
        }

        pdf.SetMargins(d.margins.Left, d.margins.Top, d.margins.Right, d.margins.Bottom)
        pdf.AddPage()

        // 渲染所有元素
        ctx := &renderContext{
                pdf:        pdf,
                doc:        d,
                x:          d.margins.Left,
                y:          d.margins.Top,
                pageWidth:  d.pageSize.Width,
                pageHeight: d.pageSize.Height,
                contentW:   d.pageSize.Width - d.margins.Left - d.margins.Right,
        }

        for _, e := range d.elements {
                ctx.renderElement(e)
        }

        // 如果启用页码，渲染所有页的页脚
        if d.pageNum {
                ctx.renderPageNumbers()
        }

        var buf bytes.Buffer
        if err := pdf.Write(&buf); err != nil {
                return nil, fmt.Errorf("write pdf: %w", err)
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

// === 渲染上下文 ===

type renderContext struct {
        pdf        *gopdf.GoPdf
        doc        *Document
        x, y       float64
        pageWidth  float64
        pageHeight float64
        contentW   float64
        totalPages int
}

func (ctx *renderContext) ensureSpace(needed float64) {
        if ctx.y+needed > ctx.pageHeight-ctx.doc.margins.Bottom {
                ctx.pdf.AddPage()
                ctx.y = ctx.doc.margins.Top
        }
}

func (ctx *renderContext) renderElement(e Element) {
        switch v := e.(type) {
        case *Heading:
                ctx.renderHeading(v)
        case *Paragraph:
                ctx.renderParagraph(v)
        case *List:
                ctx.renderList(v)
        case *Table:
                ctx.renderTable(v)
        case *Image:
                ctx.renderImage(v)
        case *CodeBlock:
                ctx.renderCodeBlock(v)
        case *Divider:
                ctx.renderDivider()
        case *PageBreak:
                ctx.pdf.AddPage()
                ctx.y = ctx.doc.margins.Top
        }
}

// renderHeading 渲染标题
func (ctx *renderContext) renderHeading(h *Heading) {
        // 字号: H1=24, H2=20, H3=16, H4=14, H5=12, H6=11
        size := 24 - (h.Level-1)*4
        if h.Level > 4 {
                size = 12 - (h.Level - 5)
        }
        if size < 10 {
                size = 10
        }

        // 段前段后
        ctx.ensureSpace(float64(size) * 2.5)
        if ctx.y > ctx.doc.margins.Top {
                ctx.y += float64(size) * 0.6
        }

        // 黑体
        if err := ctx.pdf.SetFont(fontSans, "", size); err != nil {
                _ = ctx.pdf.SetFont(fontSerif, "", size)
        }
        ctx.pdf.SetTextColor(0, 0, 0)

        // 渲染
        ctx.renderTextLine(h.Text, size, h.Align)
        ctx.y += float64(size) * 0.4

        // 恢复字体
        _ = ctx.pdf.SetFont(fontSerif, "", ctx.doc.fontSize)
}

// renderParagraph 渲染段落
func (ctx *renderContext) renderParagraph(p *Paragraph) {
        if len(p.runs) == 0 {
                ctx.y += 14 * ctx.doc.lineHeight
                return
        }

        // 段前间距
        if p.spaceBefore > 0 {
                ctx.y += p.spaceBefore
        }

        fontSize := p.fontSize
        if fontSize == 0 {
                fontSize = ctx.doc.fontSize
        }
        lineH := float64(fontSize) * p.lineSpacing
        if p.lineSpacing == 0 {
                lineH = float64(fontSize) * ctx.doc.lineHeight
        }

        // 拼接文本 (简化: 单一字体处理)
        text := p.Text()
        if text == "" {
                return
        }

        // 设置字体 (取第一个 run 的字体，或默认)
        fontName := fontSerif
        if len(p.runs) > 0 && p.runs[0].font != "" {
                fontName = selectFont(p.runs[0].font)
        }
        _ = ctx.pdf.SetFont(fontName, "", fontSize)
        ctx.pdf.SetTextColor(0, 0, 0)

        // 缩进
        indent := p.indent
        x := ctx.doc.margins.Left + indent
        maxW := ctx.contentW - indent

        // 自动换行
        lines := ctx.splitText(text, maxW, fontSize)
        for _, line := range lines {
                ctx.ensureSpace(lineH)
                align := p.align
                if align == "" {
                        align = "left"
                }
                ctx.pdf.SetY(ctx.y)
                ctx.pdf.SetX(x)
                lineWidth, _ := ctx.pdf.MeasureTextWidth(line)
                switch align {
                case "center":
                        ctx.pdf.SetX(ctx.doc.margins.Left + (ctx.contentW-lineWidth)/2)
                case "right":
                        ctx.pdf.SetX(ctx.doc.margins.Left + ctx.contentW - lineWidth)
                }
                _ = ctx.pdf.Text(line)
                ctx.y += lineH
        }

        // 段后间距
        if p.spaceAfter > 0 {
                ctx.y += p.spaceAfter
        } else {
                ctx.y += 4
        }
}

// renderList 渲染列表
func (ctx *renderContext) renderList(l *List) {
        fontSize := ctx.doc.fontSize
        lineH := float64(fontSize) * 1.5
        _ = ctx.pdf.SetFont(fontSerif, "", fontSize)
        ctx.pdf.SetTextColor(0, 0, 0)

        for i, item := range l.items {
                ctx.ensureSpace(lineH)
                ctx.pdf.SetY(ctx.y)
                ctx.pdf.SetX(ctx.doc.margins.Left + 20)
                marker := "•"
                if l.ordered {
                        marker = fmt.Sprintf("%d.", i+1)
                }
                _ = ctx.pdf.Text(marker)
                ctx.pdf.SetX(ctx.doc.margins.Left + 40)
                // 简化: 不自动换行
                _ = ctx.pdf.Text(item)
                ctx.y += lineH
        }
        ctx.y += 4
}

// renderTable 渲染表格
func (ctx *renderContext) renderTable(t *Table) {
        if len(t.rows) == 0 {
                return
        }

        colCount := 0
        for _, row := range t.rows {
                if len(row) > colCount {
                        colCount = len(row)
                }
        }
        if colCount == 0 {
                return
        }

        // 列宽
        colW := ctx.contentW / float64(colCount)
        if len(t.colWidths) > 0 {
                colW = t.colWidths[0]
        }

        cellH := 24.0
        fontSize := 10
        _ = ctx.pdf.SetFont(fontSerif, "", fontSize)
        ctx.pdf.SetTextColor(0, 0, 0)

        for rowIdx, row := range t.rows {
                ctx.ensureSpace(cellH)
                y := ctx.y
                x := ctx.doc.margins.Left

                for colIdx := 0; colIdx < colCount; colIdx++ {
                        cellText := ""
                        if colIdx < len(row) {
                                cellText = row[colIdx]
                        }

                        // 表头加粗 + 灰底
                        if t.header && rowIdx == 0 {
                                _ = ctx.pdf.SetFont(fontSans, "", fontSize)
                                ctx.pdf.SetFillColor(240, 240, 240)
                                ctx.pdf.RectFromUpperLeftWithStyle(x, y, colW, cellH, "F")
                        } else {
                                _ = ctx.pdf.SetFont(fontSerif, "", fontSize)
                        }

                        // 边框
                        ctx.pdf.SetLineWidth(0.5)
                        ctx.pdf.SetStrokeColor(200, 200, 200)
                        ctx.pdf.RectFromUpperLeftWithStyle(x, y, colW, cellH, "D")

                        // 文字
                        ctx.pdf.SetY(y + 6)
                        ctx.pdf.SetX(x + 4)
                        ctx.pdf.SetTextColor(0, 0, 0)
                        _ = ctx.pdf.Text(cellText)

                        x += colW
                }

                ctx.y += cellH
        }
        ctx.y += 8
        _ = ctx.pdf.SetFont(fontSerif, "", ctx.doc.fontSize)
}

// renderImage 渲染图片
func (ctx *renderContext) renderImage(im *Image) {
        var imgHolder gopdf.ImageHolder
        var err error
        if len(im.data) > 0 {
                imgHolder, err = gopdf.ImageHolderByBytes(im.data)
        } else if im.path != "" {
                imgHolder, err = gopdf.ImageHolderByPath(im.path)
        }
        if err != nil {
                return
        }

        // 自动计算尺寸
        w := float64(im.width)
        h := float64(im.height)
        if w == 0 || h == 0 {
                // 从图片字节解码获取真实尺寸
                var img image.Image
                if len(im.data) > 0 {
                        img, _, _ = image.Decode(bytes.NewReader(im.data))
                } else if im.path != "" {
                        f, _ := os.Open(im.path)
                        if f != nil {
                                img, _, _ = image.Decode(f)
                                f.Close()
                        }
                }
                if img != nil {
                        bounds := img.Bounds()
                        origW := float64(bounds.Dx())
                        origH := float64(bounds.Dy())
                        // 限制最大宽度为内容宽度
                        if w == 0 {
                                w = origW
                                if w > ctx.contentW {
                                        w = ctx.contentW
                                        h = origH * (w / origW)
                                }
                        }
                        if h == 0 {
                                h = origH * (w / origW)
                        }
                } else {
                        w = 300
                        h = 200
                }
        }

        ctx.ensureSpace(h)
        if err := ctx.pdf.ImageByHolder(imgHolder, ctx.doc.margins.Left, ctx.y, &gopdf.Rect{W: w, H: h}); err == nil {
                ctx.y += h + 8
        }
}

// renderCodeBlock 渲染代码块
func (ctx *renderContext) renderCodeBlock(c *CodeBlock) {
        fontSize := 10
        lineH := float64(fontSize) * 1.4
        lines := strings.Split(c.code, "\n")

        // 灰底
        blockH := float64(len(lines)) * lineH + 12
        ctx.ensureSpace(blockH)
        ctx.pdf.SetFillColor(245, 245, 245)
        ctx.pdf.RectFromUpperLeftWithStyle(ctx.doc.margins.Left, ctx.y, ctx.contentW, blockH, "F")

        // 等宽字体
        _ = ctx.pdf.SetFont(fontMono, "", fontSize)
        ctx.pdf.SetTextColor(30, 30, 30)

        startY := ctx.y + 6
        for _, line := range lines {
                ctx.pdf.SetY(startY)
                ctx.pdf.SetX(ctx.doc.margins.Left + 8)
                _ = ctx.pdf.Text(line)
                startY += lineH
        }

        ctx.y += blockH + 8
        _ = ctx.pdf.SetFont(fontSerif, "", ctx.doc.fontSize)
}

// renderDivider 渲染分隔线
func (ctx *renderContext) renderDivider() {
        ctx.ensureSpace(20)
        ctx.y += 8
        ctx.pdf.SetLineWidth(1)
        ctx.pdf.SetStrokeColor(200, 200, 200)
        ctx.pdf.Line(ctx.doc.margins.Left, ctx.y, ctx.doc.margins.Left+ctx.contentW, ctx.y)
        ctx.y += 12
}

// renderTextLine 渲染单行文本
func (ctx *renderContext) renderTextLine(text string, fontSize int, align string) {
        lineH := float64(fontSize) * 1.4
        ctx.ensureSpace(lineH)
        ctx.pdf.SetY(ctx.y)
        ctx.pdf.SetX(ctx.doc.margins.Left)

        lineWidth, _ := ctx.pdf.MeasureTextWidth(text)
        switch align {
        case "center":
                ctx.pdf.SetX(ctx.doc.margins.Left + (ctx.contentW-lineWidth)/2)
        case "right":
                ctx.pdf.SetX(ctx.doc.margins.Left + ctx.contentW - lineWidth)
        default:
                ctx.pdf.SetX(ctx.doc.margins.Left)
        }
        _ = ctx.pdf.Text(text)
        ctx.y += lineH
}

// splitText 按宽度拆分文本 (支持中文)
func (ctx *renderContext) splitText(text string, maxWidth float64, fontSize int) []string {
        if text == "" {
                return []string{""}
        }
        // 用 gopdf 的 SplitText
        lines, err := ctx.pdf.SplitTextWithWordWrap(text, maxWidth)
        if err != nil || len(lines) == 0 {
                return []string{text}
        }
        return lines
}

// renderPageNumbers 渲染所有页的页码
func (ctx *renderContext) renderPageNumbers() {
        totalPages := ctx.pdf.GetNumberOfPages()
        for i := 1; i <= totalPages; i++ {
                ctx.pdf.SetPage(i)
                _ = ctx.pdf.SetFont(fontSerif, "", 9)
                ctx.pdf.SetTextColor(128, 128, 128)
                pageStr := fmt.Sprintf("- %d -", i)
                textW, _ := ctx.pdf.MeasureTextWidth(pageStr)
                ctx.pdf.SetY(ctx.pageHeight - 30)
                ctx.pdf.SetX(ctx.doc.margins.Left + (ctx.contentW-textW)/2)
                _ = ctx.pdf.Text(pageStr)
        }
}

// === 字体注册 ===

func registerEmbeddedFonts(pdf *gopdf.GoPdf) error {
        // 宋体 (中文正文)
        serifData, err := fontSerifFS.ReadFile("fonts/NotoSerifSC-Regular.ttf")
        if err != nil {
                return fmt.Errorf("read serif font: %w", err)
        }
        if err := pdf.AddTTFFontData(fontSerif, serifData); err != nil {
                return fmt.Errorf("add serif font: %w", err)
        }

        // 黑体 (标题)
        sansData, err := fontSansFS.ReadFile("fonts/LiberationSans-Regular.ttf")
        if err != nil {
                return fmt.Errorf("read sans font: %w", err)
        }
        if err := pdf.AddTTFFontData(fontSans, sansData); err != nil {
                return fmt.Errorf("add sans font: %w", err)
        }

        // 等宽 (代码)
        monoData, err := fontMonoFS.ReadFile("fonts/LiberationMono-Regular.ttf")
        if err != nil {
                return fmt.Errorf("read mono font: %w", err)
        }
        if err := pdf.AddTTFFontData(fontMono, monoData); err != nil {
                return fmt.Errorf("add mono font: %w", err)
        }

        return nil
}

// selectFont 根据字体名选择内置字体
func selectFont(fontName string) string {
        lower := strings.ToLower(fontName)
        switch {
        case strings.Contains(lower, "sans") || strings.Contains(lower, "黑体") || strings.Contains(lower, "hei"):
                return fontSans
        case strings.Contains(lower, "mono") || strings.Contains(lower, "consol") || strings.Contains(lower, "code") || strings.Contains(lower, "等宽"):
                return fontMono
        default:
                // 仿宋/宋体/serif/默认 → 宋体
                return fontSerif
        }
}

// === 辅助: 颜色解析 ===

func parseHexColor(hex string) (uint8, uint8, uint8) {
        hex = strings.TrimPrefix(hex, "#")
        if len(hex) != 6 {
                return 0, 0, 0
        }
        var r, g, b uint8
        fmt.Sscanf(hex, "%02x%02x%02x", &r, &g, &b)
        return r, g, b
}

// 颜色接口兼容
var _ color.Color = nil
