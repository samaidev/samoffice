// Package markdown 实现轻量 Markdown 解析器
// 支持 CommonMark 子集：标题/段落/列表/代码块/引用/链接/图片/粗斜体
package markdown

import (
	"bufio"
	"io"
	"strings"

	"github.com/zai/samoffice/internal/core"
)

type Parser struct{}

func New() *Parser { return &Parser{} }

func (p *Parser) Supported() []string { return []string{".md", ".markdown"} }
func (p *Parser) CanParse(path string, header []byte) bool {
	return strings.HasSuffix(strings.ToLower(path), ".md") ||
		strings.HasSuffix(strings.ToLower(path), ".markdown")
}

func (p *Parser) Parse(r io.Reader) (*core.Document, []core.Warning, error) {
	doc := &core.Document{Blocks: []core.Block{}}
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 1024*1024), 10*1024*1024)

	var inCodeBlock bool
	var codeLang string
	var codeBuf strings.Builder

	for scanner.Scan() {
		line := scanner.Text()
		if inCodeBlock {
			if strings.HasPrefix(line, "```") {
				doc.Blocks = append(doc.Blocks, &core.CodeBlock{
					Language: codeLang, Code: codeBuf.String(),
				})
				inCodeBlock = false
				codeBuf.Reset()
				codeLang = ""
			} else {
				codeBuf.WriteString(line + "\n")
			}
			continue
		}
		if strings.HasPrefix(line, "```") {
			inCodeBlock = true
			codeLang = strings.TrimPrefix(line, "```")
			continue
		}
		if line == "" {
			continue
		}
		// 标题
		if h := parseHeading(line); h != nil {
			doc.Blocks = append(doc.Blocks, h)
			continue
		}
		// 列表
		if strings.HasPrefix(line, "- ") || strings.HasPrefix(line, "* ") {
			items := [][]core.Block{{
				&core.Paragraph{Inline: parseInline(strings.TrimPrefix(strings.TrimPrefix(line, "- "), "* "))},
			}}
			doc.Blocks = append(doc.Blocks, &core.BulletList{Items: items, Ordered: false})
			continue
		}
		if len(line) >= 2 && line[0] >= '0' && line[0] <= '9' && line[1] == '.' {
			items := [][]core.Block{{
				&core.Paragraph{Inline: parseInline(line[2:])},
			}}
			doc.Blocks = append(doc.Blocks, &core.BulletList{Items: items, Ordered: true})
			continue
		}
		// 引用
		if strings.HasPrefix(line, "> ") {
			doc.Blocks = append(doc.Blocks, &core.Paragraph{
				Inline: parseInline(strings.TrimPrefix(line, "> ")),
				Style:  "quote",
			})
			continue
		}
		// 普通段落
		doc.Blocks = append(doc.Blocks, &core.Paragraph{Inline: parseInline(line)})
	}

	if inCodeBlock { // 未闭合的代码块兜底
		doc.Blocks = append(doc.Blocks, &core.CodeBlock{Language: codeLang, Code: codeBuf.String()})
	}
	if err := scanner.Err(); err != nil {
		return doc, nil, err
	}
	return doc, nil, nil
}

// parseHeading 解析 # 标题
func parseHeading(line string) *core.Heading {
	level := 0
	for level < len(line) && line[level] == '#' {
		level++
	}
	if level == 0 || level >= len(line) || line[level] != ' ' {
		return nil
	}
	if level > 6 {
		level = 6
	}
	return &core.Heading{Level: level, Inline: parseInline(line[level+1:])}
}

// parseInline 解析行内：**bold** *italic* [text](url) `code` ![alt](src)
func parseInline(s string) []core.Inline {
	var inlines []core.Inline
	i := 0
	for i < len(s) {
		// **bold**
		if i+1 < len(s) && s[i] == '*' && s[i+1] == '*' {
			j := strings.Index(s[i+2:], "**")
			if j >= 0 {
				inlines = append(inlines, core.Text{Content: s[i+2 : i+2+j], Bold: true})
				i += j + 4
				continue
			}
		}
		// *italic*
		if s[i] == '*' {
			j := strings.Index(s[i+1:], "*")
			if j >= 0 {
				inlines = append(inlines, core.Text{Content: s[i+1 : i+1+j], Italic: true})
				i += j + 2
				continue
			}
		}
		// `code`
		if s[i] == '`' {
			j := strings.Index(s[i+1:], "`")
			if j >= 0 {
				inlines = append(inlines, core.Text{Content: s[i+1 : i+1+j], Style: "code"})
				i += j + 2
				continue
			}
		}
		// ![alt](src)
		if i+1 < len(s) && s[i] == '!' && s[i+1] == '[' {
			end := strings.Index(s[i:], "](")
			if end > 0 {
				alt := s[i+2 : i+end]
				close := strings.Index(s[i+end+2:], ")")
				if close >= 0 {
					src := s[i+end+2 : i+end+2+close]
					inlines = append(inlines, core.InlineImage{Src: src, Width: 200, Height: 100})
					_ = alt
					i += end + 2 + close + 1
					continue
				}
			}
		}
		// [text](url)
		if s[i] == '[' {
			end := strings.Index(s[i:], "](")
			if end > 0 {
				text := s[i+1 : i+end]
				close := strings.Index(s[i+end+2:], ")")
				if close >= 0 {
					url := s[i+end+2 : i+end+2+close]
					inlines = append(inlines, core.Hyperlink{
						URL:  url,
						Text: []core.Inline{core.Text{Content: text}},
					})
					i += end + 2 + close + 1
					continue
				}
			}
		}
		// 普通文本：累积到下一个特殊字符
		j := i
		for j < len(s) && s[j] != '*' && s[j] != '`' && s[j] != '[' && s[j] != '!' {
			j++
		}
		if j > i {
			inlines = append(inlines, core.Text{Content: s[i:j]})
			i = j
		} else {
			// 兜底：未识别的特殊字符直接当文本
			inlines = append(inlines, core.Text{Content: string(s[i])})
			i++
		}
	}
	if len(inlines) == 0 {
		return []core.Inline{core.Text{Content: s}}
	}
	return inlines
}
