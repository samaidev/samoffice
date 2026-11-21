package main

// renderhtml.go — UDM → 富文本 HTML（微信 rich-text 兼容子集）。
// 供小程序 docview 页 <rich-text> 直接渲染解析结果：
// 只用 rich-text 白名单内的标签（p/h1-h6/ul/ol/li/table/tr/td/th/img/pre/code/
// blockquote/span/strong/em/u/s/sub/sup/br/hr/a/div），样式全部走 style 属性，
// 图片用解析器内嵌的 data URI，表格带 colgroup/colspan/rowspan。
// 导出函数 renderHTMLString(docJSON) 返回可直接放进 rich-text 的 html 字符串。

import (
	"encoding/json"
	"fmt"
	"html"
	"strings"
	"syscall/js"

	"github.com/zai/samoffice/internal/core"
)

// esc 文本转义（rich-text 的 HTML 字符串模式需要）
func esc(s string) string { return html.EscapeString(s) }

// hexColor 保证 #RRGGBB 形态（UDM 中颜色带不带 # 都出现过）
func hexColor(c string) string {
	if c == "" {
		return ""
	}
	if strings.HasPrefix(c, "#") || strings.HasPrefix(c, "rgb") {
		return c
	}
	return "#" + c
}

// renderInline 行内元素 → HTML 片段
// 值与指针形态都接（unmarshalInline 产出指针，解析器产出值）
func renderInline(in core.Inline) string {
	switch v := in.(type) {
	case *core.Text:
		return renderInline(*v)
	case *core.Track:
		return renderInline(*v)
	case *core.Hyperlink:
		return renderInline(*v)
	case *core.InlineImage:
		return renderInline(*v)
	case *core.InlineMath:
		return renderInline(*v)
	case *core.RawInline:
		return renderInline(*v)
	case core.Text:
		return renderTextAttrs(v.Content, v.Bold, v.Italic, v.Under, v.Strike,
			v.Color, v.FontSize, v.Highlight, v.Superscript, v.Subscript)
	case core.Track:
		if v.Track == "delete" {
			return `<span style="text-decoration:line-through;color:#999999">` +
				esc(v.Content) + "</span>"
		}
		return renderTextAttrs(v.Content, v.Bold, v.Italic, v.Under, v.Strike,
			v.Color, v.FontSize, v.Highlight, v.Superscript, v.Subscript)
	case core.Hyperlink:
		inner := &strings.Builder{}
		for _, t := range v.Text {
			inner.WriteString(renderInline(t))
		}
		return `<a href="` + esc(v.URL) + `" style="color:#1a56db">` + inner.String() + "</a>"
	case core.InlineImage:
		st := ""
		if v.Width > 0 {
			st += fmt.Sprintf("width:%gpx;", v.Width)
		}
		if v.Height > 0 {
			st += fmt.Sprintf("height:%gpx;", v.Height)
		}
		return `<img src="` + esc(v.Src) + `" style="` + st + `max-width:100%;vertical-align:middle">`
	case core.InlineMath:
		return `<span style="font-family:monospace;color:#7c3aed">` + esc(v.Formula) + "</span>"
	case core.RawInline:
		if v.Kind == "html" {
			if s, _ := v.Data["html"].(string); s != "" {
				return s
			}
		}
		return ""
	default:
		return ""
	}
}

func renderTextAttrs(content string, bold, italic, under, strike bool,
	color string, fontSize float64, highlight string, sup, sub bool) string {
	var st strings.Builder
	if color != "" {
		st.WriteString("color:" + hexColor(color) + ";")
	}
	if fontSize > 0 {
		st.WriteString(fmt.Sprintf("font-size:%gpt;", fontSize))
	}
	if highlight != "" {
		st.WriteString("background-color:" + hexColor(highlight) + ";")
	}
	tag := "span"
	if bold {
		tag = "strong"
	}
	body := esc(content)
	if italic {
		body = "<em>" + body + "</em>"
	}
	if under {
		body = "<u>" + body + "</u>"
	}
	if strike {
		body = "<s>" + body + "</s>"
	}
	if sup {
		body = "<sup>" + body + "</sup>"
	}
	if sub {
		body = "<sub>" + body + "</sub>"
	}
	if st.Len() == 0 {
		return "<" + tag + ">" + body + "</" + tag + ">"
	}
	return "<" + tag + ` style="` + st.String() + `">` + body + "</" + tag + ">"
}

// renderInlineSlice 批量行内
func renderInlineSlice(in []core.Inline) string {
	var b strings.Builder
	for _, t := range in {
		b.WriteString(renderInline(t))
	}
	return b.String()
}

// renderBlock 块级元素 → HTML 片段（表格/列表递归）
// 同时接受值与指针形态：解析器产出值类型，JSON 反序列化产出指针类型
func renderBlock(bl core.Block) string {
	switch v := bl.(type) {
	case *core.Paragraph:
		return renderBlock(*v)
	case *core.Heading:
		return renderBlock(*v)
	case *core.BulletList:
		return renderBlock(*v)
	case *core.Table:
		return renderBlock(*v)
	case *core.Image:
		return renderBlock(*v)
	case *core.CodeBlock:
		return renderBlock(*v)
	case *core.Math:
		return renderBlock(*v)
	case *core.Textbox:
		return renderBlock(*v)
	case *core.RawBlock:
		return renderBlock(*v)
	case core.Paragraph:
		st := ""
		if v.Align != "" && v.Align != "left" {
			st = fmt.Sprintf(` style="text-align:%s"`, v.Align)
		}
		return "<p" + st + ">" + renderInlineSlice(v.Inline) + "</p>"
	case core.Heading:
		lv := v.Level
		if lv < 1 || lv > 6 {
			lv = 1
		}
		st := ""
		if v.Align != "" && v.Align != "left" {
			st = fmt.Sprintf(` style="text-align:%s"`, v.Align)
		}
		return fmt.Sprintf("<h%d%s>", lv, st) + renderInlineSlice(v.Inline) + fmt.Sprintf("</h%d>", lv)
	case core.BulletList:
		tag := "ul"
		if v.Ordered {
			tag = "ol"
		}
		var b strings.Builder
		b.WriteString("<" + tag + ">")
		for _, item := range v.Items {
			b.WriteString("<li>")
			for _, ib := range item {
				b.WriteString(renderBlock(ib))
			}
			b.WriteString("</li>")
		}
		b.WriteString("</" + tag + ">")
		return b.String()
	case core.Table:
		return renderTable(v)
	case core.Image:
		st := "max-width:100%"
		if v.Width > 0 {
			st = fmt.Sprintf("max-width:100%%;width:%gpx", v.Width)
		}
		var b strings.Builder
		b.WriteString(`<p style="text-align:center"><img src="` + esc(v.Src) + `" style="` + st + `"></p>`)
		if len(v.Caption) > 0 {
			b.WriteString(`<p style="text-align:center;color:#888888;font-size:12px">` +
				renderInlineSlice(v.Caption) + "</p>")
		}
		return b.String()
	case core.CodeBlock:
		return `<pre style="background-color:#f6f8fa;padding:10px;border-radius:6px;font-family:monospace;font-size:13px;white-space:pre-wrap"><code>` +
			esc(v.Code) + "</code></pre>"
	case core.Math:
		return `<p style="text-align:center;font-family:monospace;color:#7c3aed">` + esc(v.Formula) + "</p>"
	case core.Textbox:
		var b strings.Builder
		b.WriteString(`<div style="border:1px solid #cbd5e1;padding:8px">`)
		for _, tb := range v.Blocks {
			b.WriteString(renderBlock(tb))
		}
		b.WriteString("</div>")
		return b.String()
	case core.RawBlock:
		if v.Kind == "html" {
			if s, _ := v.Data["html"].(string); s != "" {
				return s
			}
		}
		// slide/脚注等其它 raw 块在阅读视图不渲染（pptx 由编辑页专用 UI 处理）
		return ""
	default:
		return ""
	}
}

func renderTable(v core.Table) string {
	var b strings.Builder
	b.WriteString(`<table style="border-collapse:collapse;width:100%;margin:8px 0">`)
	if len(v.Width) > 0 {
		b.WriteString("<colgroup>")
		for _, w := range v.Width {
			b.WriteString(fmt.Sprintf(`<col style="width:%gpx">`, w))
		}
		b.WriteString("</colgroup>")
	}
	for _, row := range v.Rows {
		b.WriteString("<tr>")
		for _, cell := range row {
			tag := "td"
			st := "border:1px solid #cbd5e1;padding:4px 6px;vertical-align:top"
			if cell.IsHeader {
				tag = "th"
				st += ";background-color:#f1f5f9"
			}
			if cell.Align != "" {
				st += fmt.Sprintf(";text-align:%s", cell.Align)
			}
			attrs := ""
			if cell.ColSpan > 1 {
				attrs += fmt.Sprintf(` colspan="%d"`, cell.ColSpan)
			}
			if cell.RowSpan > 1 {
				attrs += fmt.Sprintf(` rowspan="%d"`, cell.RowSpan)
			}
			b.WriteString("<" + tag + attrs + ` style="` + st + `">`)
			if len(cell.Blocks) > 0 {
				for _, cb := range cell.Blocks {
					b.WriteString(renderBlock(cb))
				}
			} else {
				b.WriteString(renderInlineSlice(cell.Inline))
			}
			b.WriteString("</" + tag + ">")
		}
		b.WriteString("</tr>")
	}
	b.WriteString("</table>")
	return b.String()
}

// renderHTMLString Document → rich-text HTML
func renderHTMLString(doc *core.Document) string {
	var b strings.Builder
	for _, bl := range doc.Blocks {
		b.WriteString(renderBlock(bl))
	}
	return b.String()
}

// renderHTMLFn(docJSON) — UDM JSON → {ok, html, error}，rich-text 直接可用
func renderHTMLFn(this js.Value, args []js.Value) any {
	if len(args) < 1 {
		return errResult(fmt.Errorf("缺少 docJSON 参数"))
	}
	var doc core.Document
	if err := json.Unmarshal([]byte(argStr0(args)), &doc); err != nil {
		return errResult(err)
	}
	return okResult(map[string]any{"html": renderHTMLString(&doc)})
}

// argStr0 取第一个参数的字符串值
func argStr0(args []js.Value) string {
	if len(args) == 0 {
		return ""
	}
	return args[0].String()
}
