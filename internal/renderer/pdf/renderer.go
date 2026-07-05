// Package pdf 将 UDM 渲染为 PDF 文件
// 基于 signintech/gopdf，嵌入 NotoSansSC 字体支持中文
package pdf

import (
	"bytes"
	"embed"
	"fmt"
	"strings"

	"github.com/signintech/gopdf"
	"github.com/zai/gooffice/internal/core"
)

//go:embed fonts/NotoSansSC.ttf
var fontFS embed.FS

const (
	fontRegular = "NotoSansSC"

	marginTop    = 50.0
	marginBottom = 50.0
	marginLeft   = 50.0
	marginRight  = 50.0
	pageWidth    = 595.28 // A4 width in points
	pageHeight   = 841.89 // A4 height in points
	lineHeight   = 18.0
)

type Renderer struct{}

func New() *Renderer { return &Renderer{} }

func (r *Renderer) Supported() []string { return []string{".pdf"} }

// Render 将 UDM 渲染为 PDF 字节流
func (r *Renderer) Render(doc *core.Document) ([]byte, error) {
	pdf := gopdf.GoPdf{}
	pdf.Start(gopdf.Config{
		PageSize: *gopdf.PageSizeA4,
	})

	// 注册字体
	fontBytes, err := fontFS.ReadFile("fonts/NotoSansSC.ttf")
	if err != nil {
		return nil, fmt.Errorf("read font: %w", err)
	}
	if err := pdf.AddTTFFontData(fontRegular, fontBytes); err != nil {
		return nil, fmt.Errorf("add font: %w", err)
	}
	if err := pdf.SetFont(fontRegular, "", 14); err != nil {
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
		x, y = renderBlock(&pdf, b, x, y)
	}

	var buf bytes.Buffer
	if err := pdf.Write(&buf); err != nil {
		return nil, fmt.Errorf("write pdf: %w", err)
	}
	return buf.Bytes(), nil
}

func renderBlock(pdf *gopdf.GoPdf, b core.Block, x, y float64) (float64, float64) {
	switch v := b.(type) {
	case *core.Paragraph:
		return renderParagraph(pdf, v, x, y)
	case *core.Heading:
		return renderHeading(pdf, v, x, y)
	case *core.BulletList:
		return renderBulletList(pdf, v, x, y)
	case *core.CodeBlock:
		return renderCodeBlock(pdf, v, x, y)
	case *core.Image:
		return renderImage(pdf, v, x, y)
	case *core.Table:
		return renderTable(pdf, v, x, y)
	}
	return x, y
}

func renderParagraph(pdf *gopdf.GoPdf, p *core.Paragraph, x, y float64) (float64, float64) {
	pdf.SetY(y)
	pdf.SetX(x)

	var sb strings.Builder
	for _, in := range p.Inline {
		switch v := in.(type) {
		case *core.Text:
			sb.WriteString(v.Content)
		case core.Text:
			sb.WriteString(v.Content)
		case *core.Hyperlink:
			for _, t := range v.Text {
				if tt, ok := t.(core.Text); ok {
					sb.WriteString(tt.Content)
				} else if tt, ok := t.(*core.Text); ok {
					sb.WriteString(tt.Content)
				}
			}
		}
	}
	text := sb.String()
	if text == "" {
		return x, y + lineHeight
	}

	if p.Align == "center" {
		pdf.SetX((pageWidth - estimateWidth(text, 14)) / 2)
	} else if p.Align == "right" {
		pdf.SetX(pageWidth - marginRight - estimateWidth(text, 14))
	}

	wrapAndDraw(pdf, text, pageWidth-marginLeft-marginRight, 14)
	return x, pdf.GetY() + lineHeight
}

func renderHeading(pdf *gopdf.GoPdf, h *core.Heading, x, y float64) (float64, float64) {
	pdf.SetY(y)
	pdf.SetX(x)

	size := 24.0 - float64(h.Level)*3.0
	if size < 12 {
		size = 12
	}
	pdf.SetFontSize(size)
	// 用 style "B" 模拟粗体
	pdf.SetFont(fontRegular, "B", size)

	var sb strings.Builder
	for _, in := range h.Inline {
		if t, ok := in.(*core.Text); ok {
			sb.WriteString(t.Content)
		} else if t, ok := in.(core.Text); ok {
			sb.WriteString(t.Content)
		}
	}
	text := sb.String()
	pdf.Cell(nil, text)

	// 恢复默认字体
	pdf.SetFont(fontRegular, "", 14)
	return x, y + size + 8
}

func renderBulletList(pdf *gopdf.GoPdf, l *core.BulletList, x, y float64) (float64, float64) {
	for i, item := range l.Items {
		pdf.SetY(y)
		pdf.SetX(x + 20)

		var sb strings.Builder
		if l.Ordered {
			sb.WriteString(fmt.Sprintf("%d. ", i+1))
		} else {
			sb.WriteString("• ")
		}

		for _, b := range item {
			if p, ok := b.(*core.Paragraph); ok {
				for _, in := range p.Inline {
					if t, ok := in.(*core.Text); ok {
						sb.WriteString(t.Content)
					} else if t, ok := in.(core.Text); ok {
						sb.WriteString(t.Content)
					}
				}
			}
		}
		text := sb.String()
		pdf.Cell(nil, text)
		y += lineHeight
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

func renderTable(pdf *gopdf.GoPdf, t *core.Table, x, y float64) (float64, float64) {
	if len(t.Rows) == 0 {
		return x, y
	}
	cols := len(t.Rows[0])
	if cols == 0 {
		cols = 1
	}
	colWidth := (pageWidth - marginLeft - marginRight) / float64(cols)

	for _, row := range t.Rows {
		pdf.SetY(y)
		for ci, cell := range row {
			cx := x + float64(ci)*colWidth
			pdf.SetX(cx)
			_ = pdf.Rectangle(cx, y, cx+colWidth, y+lineHeight, "D", 0, 0)
			pdf.SetX(cx + 2)
			var text string
			for _, in := range cell.Inline {
				if t, ok := in.(*core.Text); ok {
					text += t.Content
				} else if t, ok := in.(core.Text); ok {
					text += t.Content
				}
			}
			if len(text) > 25 {
				text = text[:22] + "..."
			}
			pdf.Cell(nil, text)
		}
		y += lineHeight
	}
	return x, y
}

func wrapAndDraw(pdf *gopdf.GoPdf, text string, maxWidth float64, fontSize float64) {
	runes := []rune(text)
	avgCharWidth := fontSize * 0.5
	maxChars := int(maxWidth / avgCharWidth)
	if maxChars < 1 {
		maxChars = 1
	}

	for len(runes) > 0 {
		end := maxChars
		if end > len(runes) {
			end = len(runes)
		}
		line := string(runes[:end])
		_ = pdf.Cell(nil, line)
		pdf.SetY(pdf.GetY() + fontSize*1.2)
		pdf.SetX(marginLeft)
		runes = runes[end:]
	}
}

func estimateWidth(text string, fontSize float64) float64 {
	return float64(len([]rune(text))) * fontSize * 0.5
}
