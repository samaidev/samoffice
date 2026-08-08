// Package pdf 将 UDM 渲染为 PDF 文件
// 基于 signintech/gopdf，嵌入 NotoSansSC 字体支持中文
package pdf

import (
	"bytes"
	"embed"
	"fmt"
	"os"
	"strings"

	"github.com/signintech/gopdf"
	"github.com/zai/samoffice/internal/core"
)

//go:embed fonts/NotoSerifSC-Regular.ttf
var fontSerifFS embed.FS

//go:embed fonts/LiberationSans-Regular.ttf
var fontSansFS embed.FS

//go:embed fonts/LiberationMono-Regular.ttf
var fontMonoFS embed.FS

const (
	// 已内嵌（可靠）的字体
	fontSerif = "NotoSerifSC"  // 内嵌文件族 id
	fontSans  = "LiberationSans"  // 内嵌文件族 id
	fontMono  = "LiberationMono"  // 内嵌文件族 id
	// 运行时注册的字体族（宋/楷/黑/仿宋/ Times New Roman）
	fontSong = "Song"
	fontKai  = "Kai"
	fontHei  = "Hei"
	fontFang = "Fang"
	fontTNR  = "TNR"

	marginTop    = 50.0
	marginBottom = 50.0
	marginLeft   = 50.0
	marginRight  = 50.0
	pageWidth    = 595.28 // A4 width in points
	pageHeight   = 841.89 // A4 height in points
	lineHeight   = 18.0
)

// diskFontCandidates 各字体族在常见系统上的 TTF 候选路径（按序尝试，首个存在者生效）
var diskFontCandidates = map[string][]string{
	fontKai:  {"C:\\Windows\\Fonts\\simkai.ttf", "/usr/share/fonts/truetype/simkai.ttf", "/Library/Fonts/Kaiti.ttc"},
	fontHei:  {"C:\\Windows\\Fonts\\simhei.ttf", "/usr/share/fonts/truetype/simhei.ttf"},
	fontFang: {"C:\\Windows\\Fonts\\simfang.ttf", "/usr/share/fonts/truetype/simfang.ttf"},
	fontTNR:  {"C:\\Windows\\Fonts\\times.ttf", "/usr/share/fonts/truetype/times.ttf"},
}

// fontBook 统一管理本渲染所需的字体族：内嵌字体 + 系统 CJK 字体，
// 并把文档中的字体名解析到已注册的族。
type fontBook struct {
	pdf *gopdf.GoPdf
	reg map[string]bool
}

func newFontBook(pdf *gopdf.GoPdf) *fontBook {
	fb := &fontBook{pdf: pdf, reg: map[string]bool{}}
	// 内嵌字体（始终可用）
	fb.addEmbed(fontSong, fontSerifFS, "fonts/NotoSerifSC-Regular.ttf")
	fb.addEmbed(fontSans, fontSansFS, "fonts/LiberationSans-Regular.ttf")
	fb.addEmbed(fontMono, fontMonoFS, "fonts/LiberationMono-Regular.ttf")
	// 系统 CJK 字体（缺失则回退到 Song）
	for fam, cands := range diskFontCandidates {
		fb.addDisk(fam, cands)
	}
	return fb
}

func (fb *fontBook) addEmbed(fam string, fs embed.FS, path string) {
	data, err := fs.ReadFile(path)
	if err == nil && fb.pdf.AddTTFFontData(fam, data) == nil {
		fb.reg[fam] = true
	}
}

func (fb *fontBook) addDisk(fam string, cands []string) {
	for _, p := range cands {
		data, err := os.ReadFile(p)
		if err == nil && fb.pdf.AddTTFFontData(fam, data) == nil {
			fb.reg[fam] = true
			return
		}
	}
}

// resolve 把文档字体名映射到已注册族；未注册或未知一律回退到 Song（含中文）。
func (fb *fontBook) resolve(name string) string {
	var fam string
	switch name {
	case "宋体", "serif", "Noto Serif SC", "Songti SC", "SimSun", "宋":
		fam = fontSong
	case "楷体", "华文新魏", "KaiTi", "STXinwei", "楷", "华文行楷", "STXingkai":
		fam = fontKai
	case "黑体", "SimHei", "黑", "微软雅黑", "Microsoft YaHei":
		fam = fontHei
	case "仿宋", "FangSong", "仿":
		fam = fontFang
	case "Times New Roman", "Times", "TNR", "Calibri", "Arial":
		fam = fontTNR
	case "等宽", "mono", "monospace", "Consolas", "Courier":
		fam = fontMono
	default:
		fam = fontSong
	}
	if fb.reg[fam] {
		return fam
	}
	return fontSong
}

func (fb *fontBook) set(fam string, size float64) {
	_ = fb.pdf.SetFont(fam, "", size)
}

type Renderer struct{}

func New() *Renderer { return &Renderer{} }

func (r *Renderer) Supported() []string { return []string{".pdf"} }

// Render 将 UDM 渲染为 PDF 字节流
func (r *Renderer) Render(doc *core.Document) ([]byte, error) {
        pdf := gopdf.GoPdf{}
        pdf.Start(gopdf.Config{
                PageSize: *gopdf.PageSizeA4,
        })

	// 统一构建字体簿（内嵌 + 系统 CJK）
	fb := newFontBook(&pdf)
	// 默认用宋体
	if err := pdf.SetFont(fontSong, "", 14); err != nil {
		return nil, fmt.Errorf("set font: %w", err)
	}

        pdf.SetMargins(marginLeft, marginTop, marginRight, marginBottom)
        pdf.AddPage()
        x := marginLeft
        y := marginTop

        for _, b := range doc.Blocks {
                if y > pageHeight-marginBottom {
                        pdf.AddPage()
                        y = marginTop
                }
                if _, ok := b.(*core.PageBreak); ok {
                        pdf.AddPage()
                        y = marginTop
                        x = marginLeft
                        continue
                }
                x, y = renderBlock(fb, &pdf, b, x, y)
        }

        // 文档全部画出后，逐页绘制页脚页码
        if doc.PageNumber != nil && doc.PageNumber.Enabled {
                // gopdf 不暴露总页数；渲染结束已知实际页数，回写每页页脚。
                total := pdf.GetNumberOfPages()
                if total < 1 {
                        total = 1
                }
                for pg := 1; pg <= total; pg++ {
                        pdf.SetPage(pg)
                        renderFooter(&pdf, doc.PageNumber, pg, total)
                }
        }

        var buf bytes.Buffer
        if err := pdf.Write(&buf); err != nil {
                return nil, fmt.Errorf("write pdf: %w", err)
        }
        return buf.Bytes(), nil
}

// renderFooter 在当前页底部绘制页码（参考 {n}=当前页，{total}=总页数）。
func renderFooter(pdf *gopdf.GoPdf, pn *core.PageNumberConfig, cur, total int) {
        fb := newFontBook(pdf)
        fb.set(fontSong, 10)
        var txt string
        if pn.Format != "" {
                txt = strings.ReplaceAll(pn.Format, "{n}", fmt.Sprintf("%d", cur))
                if total > 0 {
                        txt = strings.ReplaceAll(txt, "{total}", fmt.Sprintf("%d", total))
                } else {
                        txt = strings.ReplaceAll(txt, "{total}", "-")
                }
        } else {
                txt = fmt.Sprintf("%d", cur)
        }
        w, _ := pdf.MeasureTextWidth(txt)
        y := pageHeight - marginBottom + 18
        var x float64
        switch pn.Align {
        case "right":
                x = pageWidth - marginRight - w
        case "left":
                x = marginLeft
        default: // center
                x = (pageWidth - w) / 2
        }
        pdf.SetXY(x, y)
        pdf.Text(txt)
}

func renderBlock(fb *fontBook, pdf *gopdf.GoPdf, b core.Block, x, y float64) (float64, float64) {
	switch v := b.(type) {
	case *core.Paragraph:
		return renderParagraph(fb, pdf, v, x, y)
	case *core.Heading:
		return renderHeading(fb, pdf, v, x, y)
	case *core.BulletList:
		return renderBulletList(fb, pdf, v, x, y)
	case *core.CodeBlock:
		return renderCodeBlock(pdf, v, x, y)
	case *core.Image:
		return renderImage(pdf, v, x, y)
	case *core.Table:
		return renderTable(fb, pdf, v, x, y)
	case *core.Textbox:
		return renderTextbox(fb, pdf, v, x, y)
	}
        return x, y
}

// hexRGB 解析 #RRGGBB 为 RGB，失败返回 false
func hexRGB(hex string) (uint8, uint8, uint8, bool) {
	c := strings.TrimPrefix(hex, "#")
	if len(c) < 6 {
		return 0, 0, 0, false
	}
	var r, g, b uint8
	if _, err := fmt.Sscanf(c[0:2], "%02x", &r); err != nil {
		return 0, 0, 0, false
	}
	if _, err := fmt.Sscanf(c[2:4], "%02x", &g); err != nil {
		return 0, 0, 0, false
	}
	if _, err := fmt.Sscanf(c[4:6], "%02x", &b); err != nil {
		return 0, 0, 0, false
	}
	return r, g, b, true
}

// renderTextbox 在 PDF 中绘制文本框/形状：边框（线宽/线型）、填充、圆角，并渲染内部块。
func renderTextbox(fb *fontBook, pdf *gopdf.GoPdf, tb *core.Textbox, x, y float64) (float64, float64) {
	const pxToPt = 0.75
	wpt := tb.Width * pxToPt
	if wpt <= 0 {
		wpt = 342.0 // 约 9.5cm
	}
	// 估算框高：按内部块数量 * 行高，最小 60pt
	const lineH = 18.0
	boxH := float64(len(tb.Blocks)) * lineH * 1.2
	if boxH < 50 {
		boxH = 50
	}
	if tb.H > 0 {
		boxH = tb.H * 28.35 * 0.04 // 粗略：cm 转 pt（H 通常小）
		if boxH < 50 {
			boxH = 50
		}
	}
	isRound := tb.Shape == "roundRect"
	// 填充
	fr, fg, fb_, hasFill := hexRGB(tb.FillColor)
	// 边框色
	br, bg, bb, hasBorder := hexRGB(tb.BorderColor)
	if !hasBorder {
		br, bg, bb = 0, 0, 0
	}
	pdf.SetStrokeColor(br, bg, bb)
	// 线型
	switch tb.LineStyle {
	case "dash":
		pdf.SetLineType("dashed")
	case "dot":
		pdf.SetLineType("dotted")
	case "dashDot":
		pdf.SetCustomLineType([]float64{5, 2, 1, 2}, 0)
	default:
		pdf.SetLineType("")
	}
	pdf.SetLineWidth(tb.BorderW)
	if hasFill {
		pdf.SetFillColor(fr, fg, fb_)
	}
	style := "D"
	if hasFill {
		style = "DF"
	}
	if isRound {
		radius := tb.Radius * pxToPt
		if radius <= 0 {
			radius = 8
		}
		_ = pdf.Rectangle(x, y, x+wpt, y+boxH, style, radius, 8)
	} else {
		_ = pdf.Rectangle(x, y, x+wpt, y+boxH, style, 0, 0)
	}
	pdf.SetLineType("")
	// 内部文本
	inY := y + 6
	for _, blk := range tb.Blocks {
		switch v := blk.(type) {
		case *core.Paragraph:
			runs := collectRuns(v.Inline)
			_, inY = drawRuns(fb, pdf, runs, x+4, inY, x+wpt-4)
		case core.Paragraph:
			runs := collectRuns(v.Inline)
			_, inY = drawRuns(fb, pdf, runs, x+4, inY, x+wpt-4)
		case *core.Heading:
			// 简化：把标题当普通段落文本
			runs := collectRuns(v.Inline)
			_, inY = drawRuns(fb, pdf, runs, x+4, inY, x+wpt-4)
		}
	}
	return x, y + boxH + 8
}


type runStyle struct {
	text   string
	family string
	bold   bool
	italic bool
	under  bool
	strike bool
	size   float64
	color  string
}

// collectRuns 把 Inline 列表拆成带格式片段
func collectRuns(inline []core.Inline) []runStyle {
	var runs []runStyle
	for _, in := range inline {
		switch v := in.(type) {
		case *core.Text:
			runs = append(runs, runStyle{text: v.Content, family: v.Font, bold: v.Bold, italic: v.Italic, under: v.Under, size: v.FontSize, color: v.Color})
		case core.Text:
			runs = append(runs, runStyle{text: v.Content, family: v.Font, bold: v.Bold, italic: v.Italic, under: v.Under, size: v.FontSize, color: v.Color})
		case *core.Hyperlink:
			for _, t := range v.Text {
				if tt, ok := t.(*core.Text); ok {
					runs = append(runs, runStyle{text: tt.Content, family: tt.Font, bold: tt.Bold, italic: tt.Italic, under: true, size: tt.FontSize, color: tt.Color})
				} else if tt, ok := t.(core.Text); ok {
					runs = append(runs, runStyle{text: tt.Content, family: tt.Font, bold: tt.Bold, italic: tt.Italic, under: true, size: tt.FontSize, color: tt.Color})
				}
			}
		case *core.Track:
			runs = append(runs, runStyle{text: v.Content, family: v.Font, bold: v.Bold, italic: v.Italic, under: v.Track == "insert", strike: v.Track == "delete", size: v.FontSize, color: v.Color})
		case core.Track:
			runs = append(runs, runStyle{text: v.Content, family: v.Font, bold: v.Bold, italic: v.Italic, under: v.Track == "insert", strike: v.Track == "delete", size: v.FontSize, color: v.Color})
		}
	}
	return runs
}

// setStyle 按片段字体名设置字体族与字号（粗体/斜体在 drawRuns 中以描边伪造，
// 因为系统 CJK 字体大多没有独立的粗体 TTF，直接传 "B" 会导致缺字或报错）
func setStyle(fb *fontBook, family string, size float64) {
	if size <= 0 {
		size = 12
	}
	fb.set(fb.resolve(family), size)
}

// setColor 解析 #RRGGBB 并设置文字颜色（空则黑色）
func setColor(pdf *gopdf.GoPdf, color string) {
	if color == "" {
		pdf.SetTextColor(0, 0, 0)
		return
	}
	c := strings.TrimPrefix(color, "#")
	if len(c) >= 6 {
		var r, g, b uint8
		fmt.Sscanf(c[0:2], "%02x", &r)
		fmt.Sscanf(c[2:4], "%02x", &g)
		fmt.Sscanf(c[4:6], "%02x", &b)
		pdf.SetTextColor(r, g, b)
		return
	}
	pdf.SetTextColor(0, 0, 0)
}

// charWidth 估算单个字符宽度（CJK 取全角，其余取半角）
func charWidth(ch rune, size float64) float64 {
	if ch == '\n' {
		return 0
	}
	if ch > 0x2E80 {
		return size
	}
	return size * 0.5
}

// drawRuns 按样式绘制片段，遇右边界自动换行。返回绘制结束后的 (x, y)
func drawRuns(fb *fontBook, pdf *gopdf.GoPdf, runs []runStyle, x0, y, rightBoundary float64) (float64, float64) {
	if rightBoundary <= 0 {
		rightBoundary = pageWidth - marginRight
	}
	curX := x0
	curY := y
	maxSize := 12.0
	for _, run := range runs {
		if run.size > maxSize {
			maxSize = run.size
		}
		if run.text == "" {
			continue
		}
		setStyle(fb, run.family, run.size)
		setColor(pdf, run.color)
		rs := []rune(run.text)
		buf := ""
		bufW := 0.0
		// 伪粗体：在基线右移一个像素再描一次，使字形变粗
		drawLine := func(x float64) {
			pdf.SetXY(x, curY)
			pdf.Cell(nil, buf)
		}
		for _, ch := range rs {
			if ch == '\n' {
				if buf != "" {
					if run.bold {
						drawLine(curX + 0.6)
					}
					drawLine(curX)
				}
				curX = x0
				curY += run.size * 1.4
				buf = ""
				bufW = 0
				continue
			}
			w := charWidth(ch, run.size)
			if curX+bufW+w > rightBoundary && buf != "" {
				if run.bold {
					drawLine(curX + 0.6)
				}
				drawLine(curX)
				curX = x0
				curY += run.size * 1.4
				buf = ""
				bufW = 0
			}
			buf += string(ch)
			bufW += w
		}
		if buf != "" {
			if run.bold {
				drawLine(curX + 0.6)
			}
			drawLine(curX)
			curX += bufW
		}
	}
	curY += maxSize * 1.4
	pdf.SetTextColor(0, 0, 0)
	return x0, curY
}

// blockStartX 根据对齐计算段落首行起始 X（居中/右对齐整体偏移）
func blockStartX(runs []runStyle, align string) float64 {
	x0 := marginLeft
	if align == "center" || align == "right" {
		total := 0.0
		for _, r := range runs {
			for _, ch := range r.text {
				total += charWidth(ch, r.size)
			}
		}
		if align == "center" {
			x0 = (pageWidth - total) / 2
			if x0 < marginLeft {
				x0 = marginLeft
			}
		} else {
			x0 = (pageWidth - marginRight) - total
			if x0 < marginLeft {
				x0 = marginLeft
			}
		}
	}
	return x0
}

func renderParagraph(fb *fontBook, pdf *gopdf.GoPdf, p *core.Paragraph, x, y float64) (float64, float64) {
	runs := collectRuns(p.Inline)
	if len(runs) == 0 {
		return x, y + lineHeight
	}
	x0 := blockStartX(runs, p.Align)
	return drawRuns(fb, pdf, runs, x0, y, pageWidth-marginLeft-marginRight)
}

func renderHeading(fb *fontBook, pdf *gopdf.GoPdf, h *core.Heading, x, y float64) (float64, float64) {
	runs := collectRuns(h.Inline)
	if len(runs) == 0 {
		return x, y + lineHeight
	}
	size := runs[0].size
	if size <= 0 {
		size = 24.0 - float64(h.Level)*3.0
		if size < 12 {
			size = 12
		}
	}
	// 标题强制加粗，未指定字号则统一样式字号
	for i := range runs {
		runs[i].bold = true
		if runs[i].size <= 0 {
			runs[i].size = size
		}
	}
	x0 := blockStartX(runs, h.Align)
	return drawRuns(fb, pdf, runs, x0, y, pageWidth-marginLeft-marginRight)
}

func renderBulletList(fb *fontBook, pdf *gopdf.GoPdf, l *core.BulletList, x, y float64) (float64, float64) {
	for i, item := range l.Items {
		var runs []runStyle
		if l.Ordered {
			if l.Style == "references" {
				runs = append(runs, runStyle{text: fmt.Sprintf("[%d] ", i+1), bold: true, size: 12})
			} else {
				runs = append(runs, runStyle{text: fmt.Sprintf("%d. ", i+1), bold: true, size: 12})
			}
		} else {
			runs = append(runs, runStyle{text: "• ", bold: true, size: 12})
		}
		for _, b := range item {
			if p, ok := b.(*core.Paragraph); ok {
				runs = append(runs, collectRuns(p.Inline)...)
			}
		}
		_, ny := drawRuns(fb, pdf, runs, x+20, y, pageWidth-marginLeft-marginRight)
		y = ny
	}
	return x, y
}

func renderCodeBlock(pdf *gopdf.GoPdf, c *core.CodeBlock, x, y float64) (float64, float64) {
        pdf.SetY(y)
        pdf.SetX(x)
        lines := strings.Split(c.Code, "\n")
        boxH := float64(len(lines))*14 + 10
        // 灰色背景
        pdf.SetFillColor(240, 240, 240)
        _ = pdf.Rectangle(x, y, pageWidth-marginRight, y+boxH, "F", 0, 0)
        pdf.SetY(y + 5)
        pdf.SetX(x + 5)

        for _, line := range lines {
                pdf.Cell(nil, line)
                pdf.SetY(pdf.GetY() + 14)
                pdf.SetX(x + 5)
        }
        return x, pdf.GetY() + 5
}

func renderImage(pdf *gopdf.GoPdf, im *core.Image, x, y float64) (float64, float64) {
        pdf.SetY(y)
        pdf.SetX(x)
        pdf.SetFillColor(220, 220, 220)
        w := im.Width
        if w == 0 {
                w = 200
        }
        h := im.Height
        if h == 0 {
                h = 100
        }
        _ = pdf.Rectangle(x, y, x+w, y+h, "F", 0, 0)
        pdf.SetY(y + h/2)
        pdf.SetX(x + 10)
        pdf.Cell(nil, fmt.Sprintf("[Image: %s]", im.Src))
        return x, y + h + 10
}

func renderTable(fb *fontBook, pdf *gopdf.GoPdf, t *core.Table, x, y float64) (float64, float64) {
	if len(t.Rows) == 0 {
		return x, y
	}
	cols := len(t.Rows[0])
	if cols == 0 {
		cols = 1
	}
	// 表格边框线宽（pt）：未解析到则用 0.5pt 默认
	borderW := t.Border
	if borderW <= 0 {
		borderW = 0.5
	}
	pdf.SetLineWidth(borderW)
	// 支持显式列宽，否则均分
	var colWidths []float64
	totalW := pageWidth - marginLeft - marginRight
	if len(t.Width) == cols {
		for _, w := range t.Width {
			colWidths = append(colWidths, w/100.0*totalW)
		}
	} else {
		cw := totalW / float64(cols)
		for i := 0; i < cols; i++ {
			colWidths = append(colWidths, cw)
		}
	}

	const cellSize = 9.0
	for _, row := range t.Rows {
		// 先把每个单元格的片段收好，并估算行高
		cellRunss := make([][]runStyle, len(row))
		maxLines := 1
		for ci, cell := range row {
			runs := collectRuns(cell.Inline)
			for i := range runs {
				if runs[i].size <= 0 {
					runs[i].size = cellSize
				}
			}
			cellRunss[ci] = runs
			cw := colWidths[ci] - 4
			tw := 0.0
			nl := 1
			for _, r := range runs {
				for _, ch := range r.text {
					if ch == '\n' {
						nl++
						tw = 0
						continue
					}
					tw += charWidth(ch, r.size)
					if tw > cw && tw > 0 {
						nl++
						tw = 0
					}
				}
			}
			if nl > maxLines {
				maxLines = nl
			}
		}
		rowH := float64(maxLines)*cellSize*1.4 + 4
		cy := y
		for ci, cell := range row {
			cx := x + float64(ci)*colWidths[ci]
			if cell.IsHeader {
				pdf.SetFillColor(225, 230, 240)
				_ = pdf.Rectangle(cx, cy, cx+colWidths[ci], cy+rowH, "FD", 0, 0)
			} else {
				_ = pdf.Rectangle(cx, cy, cx+colWidths[ci], cy+rowH, "D", 0, 0)
			}
			if ci < len(cellRunss) {
				drawRuns(fb, pdf, cellRunss[ci], cx+2, cy+2, cx+colWidths[ci]-2)
			}
		}
		y += rowH
	}
	return x, y
}

// registerFont 注册单个字体到 gopdf
func registerFont(pdf *gopdf.GoPdf, family string, fs embed.FS, path string) error {
        data, err := fs.ReadFile(path)
        if err != nil {
                return fmt.Errorf("read font %s: %w", family, err)
        }
        if err := pdf.AddTTFFontData(family, data); err != nil {
                return fmt.Errorf("add font %s: %w", family, err)
        }
        return nil
}


// selectFont 已废弃：字体名解析统一由 fontBook.resolve 处理

