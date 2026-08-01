package main

import (
	"fmt"
	"html"
	"os"
	"strings"

	"github.com/zai/samoffice/internal/core"
	"github.com/zai/samoffice/internal/parser/doc"
)

func esc(s string) string { return html.EscapeString(s) }

func spanStyle(t core.Text) string {
	var parts []string
	if t.Font != "" {
		parts = append(parts, fmt.Sprintf("font-family:'%s'", t.Font))
	}
	if t.FontSize > 0 {
		parts = append(parts, fmt.Sprintf("font-size:%.1fpt", t.FontSize))
	}
	if t.Bold {
		parts = append(parts, "font-weight:bold")
	}
	if t.Italic {
		parts = append(parts, "font-style:italic")
	}
	if t.Color != "" {
		parts = append(parts, fmt.Sprintf("color:%s", t.Color))
	}
	return strings.Join(parts, ";")
}

func inlineHTML(in []core.Inline) string {
	var sb strings.Builder
	for _, it := range in {
		switch v := it.(type) {
		case *core.Text:
			style := spanStyle(*v)
			sb.WriteString(fmt.Sprintf("<span style=\"%s\">%s</span>", style, esc(v.Content)))
		case core.Text:
			style := spanStyle(v)
			sb.WriteString(fmt.Sprintf("<span style=\"%s\">%s</span>", style, esc(v.Content)))
		case *core.Hyperlink:
			sb.WriteString("<a href=\"")
			sb.WriteString(esc(v.URL))
			sb.WriteString("\">")
			for _, t := range v.Text {
				if tt, ok := t.(core.Text); ok {
					sb.WriteString(fmt.Sprintf("<span style=\"%s\">%s</span>", spanStyle(tt), esc(tt.Content)))
				}
			}
			sb.WriteString("</a>")
		}
	}
	return sb.String()
}

func cellHTML(c core.TableCell) string {
	var sb strings.Builder
	sb.WriteString("<td>")
	sb.WriteString(inlineHTML(c.Inline))
	sb.WriteString("</td>")
	return sb.String()
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: dochtml <file.doc> [out.html]")
		os.Exit(1)
	}
	f, err := os.Open(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, "open:", err)
		os.Exit(1)
	}
	defer f.Close()
	docu, _, err := (&doc.Parser{}).Parse(f)
	if err != nil {
		fmt.Fprintln(os.Stderr, "parse:", err)
		os.Exit(1)
	}

	var sb strings.Builder
	sb.WriteString("<!doctype html><html><head><meta charset=\"utf-8\"><style>body{font-family:sans-serif}table{border-collapse:collapse}td{border:1px solid #999;padding:2px 4px}span{white-space:pre-wrap}</style></head><body>\n")
	fontset := map[string]int{}
	for _, b := range docu.Blocks {
		switch v := b.(type) {
		case *core.Heading:
			sb.WriteString(fmt.Sprintf("<h%d style=\"text-align:%s\">%s</h%d>\n", v.Level, align(v.Align), inlineHTML(v.Inline), v.Level))
		case core.Heading:
			sb.WriteString(fmt.Sprintf("<h%d style=\"text-align:%s\">%s</h%d>\n", v.Level, align(v.Align), inlineHTML(v.Inline), v.Level))
		case *core.Paragraph:
			sb.WriteString(fmt.Sprintf("<p style=\"text-align:%s\">%s</p>\n", align(v.Align), inlineHTML(v.Inline)))
		case core.Paragraph:
			sb.WriteString(fmt.Sprintf("<p style=\"text-align:%s\">%s</p>\n", align(v.Align), inlineHTML(v.Inline)))
		case *core.Table:
			sb.WriteString("<table>\n")
			for _, row := range v.Rows {
				sb.WriteString("<tr>")
				for _, cell := range row {
					sb.WriteString(cellHTML(cell))
				}
				sb.WriteString("</tr>\n")
			}
			sb.WriteString("</table>\n")
		}
		// 统计用到的字体
		collectFonts(b, fontset)
	}
	sb.WriteString("\n<hr><p>字体使用统计: ")
	for fn, n := range fontset {
		sb.WriteString(fmt.Sprintf("%s=%d  ", fn, n))
	}
	sb.WriteString("</p></body></html>\n")

	out := "out.html"
	if len(os.Args) >= 3 {
		out = os.Args[2]
	}
	if err := os.WriteFile(out, []byte(sb.String()), 0644); err != nil {
		fmt.Fprintln(os.Stderr, "write:", err)
		os.Exit(1)
	}
	fmt.Printf("wrote %s (%d blocks)\n", out, len(docu.Blocks))
}

func align(a string) string {
	if a == "" {
		return "left"
	}
	return a
}

func collectFonts(b core.Block, m map[string]int) {
	var inls []core.Inline
	switch v := b.(type) {
	case *core.Heading:
		inls = v.Inline
	case core.Heading:
		inls = v.Inline
	case *core.Paragraph:
		inls = v.Inline
	case core.Paragraph:
		inls = v.Inline
	case *core.Table:
		for _, row := range v.Rows {
			for _, cell := range row {
				inls = append(inls, cell.Inline...)
			}
		}
	}
	for _, it := range inls {
		if t, ok := it.(*core.Text); ok && t.Font != "" {
			m[t.Font]++
		} else if t, ok := it.(core.Text); ok && t.Font != "" {
			m[t.Font]++
		}
	}
}
