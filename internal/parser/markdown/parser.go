// Package markdown 实现轻量 Markdown 解析器
// 支持 CommonMark 子集：标题/段落/列表/代码块/引用/链接/图片/粗斜体
package markdown

import (
	"bufio"
	"io"
	"regexp"
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

// isTableSep 判断一行是否为 GFM 表格分隔行（如 | --- | :--: | ---: |）
func isTableSep(line string) bool {
	line = strings.TrimSpace(line)
	if !strings.HasPrefix(line, "|") && !strings.HasSuffix(line, "|") && !strings.Contains(line, "|") {
		return false
	}
	parts := strings.Split(line, "|")
	ok := false
	for _, p := range parts {
		sp := strings.TrimSpace(p)
		if sp == "" {
			continue
		}
		// 分隔符只允许 - 与对齐冒号
		if !regexp.MustCompile(`^:?-+:?$`).MatchString(sp) {
			return false
		}
		ok = true
	}
	return ok
}

// parseMDTable 从 lines[start] 开始解析 GFM 表格，返回表格行与消费到的行下标（含分隔行）。
func parseMDTable(lines []string, start int) ([][]core.TableCell, int) {
	splitRow := func(s string) []string {
		s = strings.TrimSpace(s)
		s = strings.TrimPrefix(s, "|")
		s = strings.TrimSuffix(s, "|")
		parts := strings.Split(s, "|")
		for i := range parts {
			parts[i] = strings.TrimSpace(parts[i])
		}
		return parts
	}
	header := splitRow(lines[start])
	// 跳过分隔行
	sepIdx := start + 1
	for sepIdx < len(lines) && strings.TrimSpace(lines[sepIdx]) == "" {
		sepIdx++
	}
	if sepIdx >= len(lines) || !isTableSep(lines[sepIdx]) {
		return nil, start
	}
	rows := [][]core.TableCell{}
	headerRow := []core.TableCell{}
	for _, h := range header {
		headerRow = append(headerRow, core.TableCell{Inline: parseInline(h), IsHeader: true})
	}
	rows = append(rows, headerRow)
	last := sepIdx
	for j := sepIdx + 1; j < len(lines); j++ {
		l := strings.TrimSpace(lines[j])
		if l == "" {
			break
		}
		if !strings.Contains(l, "|") {
			break
		}
		cells := splitRow(lines[j])
		row := []core.TableCell{}
		for _, c := range cells {
			row = append(row, core.TableCell{Inline: parseInline(c)})
		}
		rows = append(rows, row)
		last = j
	}
	return rows, last
}

func (p *Parser) Parse(r io.Reader) (*core.Document, []core.Warning, error) {
	doc := &core.Document{Blocks: []core.Block{}}

	// 先完整读入所有行，便于表格做前瞻（下一行是否为分隔行）。
	var lines []string
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 1024*1024), 10*1024*1024)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	if err := scanner.Err(); err != nil {
		return doc, nil, err
	}

	var inCodeBlock bool
	var codeLang string
	var codeBuf strings.Builder

	for i := 0; i < len(lines); i++ {
		line := lines[i]
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
		// GFM 表格：当前行以 | 开头，且下一行是 | --- | --- | 分隔行
		if strings.HasPrefix(line, "|") {
			sepLine := ""
			for k := i + 1; k < len(lines); k++ {
				if strings.TrimSpace(lines[k]) == "" {
					continue
				}
				sepLine = lines[k]
				break
			}
			if isTableSep(sepLine) {
				rows, consumed := parseMDTable(lines, i)
				if len(rows) > 0 {
					doc.Blocks = append(doc.Blocks, &core.Table{Rows: rows})
					i = consumed
					continue
				}
			}
		}
		// 普通段落
		doc.Blocks = append(doc.Blocks, &core.Paragraph{Inline: parseInline(line)})
	}

	if inCodeBlock { // 未闭合的代码块兜底
		doc.Blocks = append(doc.Blocks, &core.CodeBlock{Language: codeLang, Code: codeBuf.String()})
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
