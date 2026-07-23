// Package doc 实现旧版 Word 97-2003 (.doc) 二进制格式的解析器。
//
// .doc 是 OLE 复合文档（CFB）格式，内部以 WordDocument 流存储正文。
// 完整解析需要理解 FIB、Piece Table、Sprm 等结构。本解析器采用实用、容错的
// 文本提取策略：从 WordDocument 流中提取可打印文本并按段落切分，转换为 UDM
// 段落块，使文档可被"打开查看"。复杂排版（表格/图片/样式）暂不支持，仅保证
// 文本内容可读。
package doc

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"strings"
	"unicode"

	"github.com/richardlehane/mscfb"
	"github.com/zai/samoffice/internal/core"
)

// Parser 实现 parser.Parser 接口
type Parser struct{}

func New() *Parser { return &Parser{} }

func (p *Parser) Supported() []string { return []string{".doc"} }

func (p *Parser) CanParse(path string, header []byte) bool {
	lower := strings.ToLower(path)
	if !strings.HasSuffix(lower, ".doc") {
		return false
	}
	// .docx 是 ZIP（PK 头），要与 .doc 区分；.doc 通常 OLE 头为 D0 CF 11 E0
	if len(header) >= 8 {
		if bytes.Equal(header[:2], []byte{0x50, 0x4B}) { // PK -> docx
			return false
		}
		if bytes.Equal(header[:8], []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}) {
			return true
		}
	}
	return strings.HasSuffix(lower, ".doc")
}

// Parse 解析 .doc 字节流为 UDM
func (p *Parser) Parse(r io.Reader) (*core.Document, []core.Warning, error) {
	warnings := []core.Warning{}

	data, err := io.ReadAll(r)
	if err != nil {
		return nil, warnings, fmt.Errorf("read doc: %w", err)
	}

	cfb, err := mscfb.New(bytes.NewReader(data))
	if err != nil {
		return nil, warnings, fmt.Errorf("open ole container: %w", err)
	}

	// 1. 定位 WordDocument 流
	var wordDoc []byte
	hasSummary := false
	for entry, err := cfb.Next(); err == nil; entry, err = cfb.Next() {
		switch strings.ToLower(entry.Name) {
		case "worddocument":
			buf := make([]byte, entry.Size)
			if _, rerr := entry.ReadAt(buf, 0); rerr == nil || rerr == io.EOF {
				wordDoc = buf
			}
		case "\x05summaryinformation", "summaryinformation":
			hasSummary = true
		}
	}
	if len(wordDoc) == 0 {
		return nil, warnings, fmt.Errorf("missing WordDocument stream")
	}

	doc := &core.Document{
		Meta:   core.Meta{},
		Blocks: []core.Block{},
		Raw:    make(map[string]any),
	}
	if hasSummary {
		// 摘要信息解析未实现，仅标记
		doc.Raw["hasSummary"] = true
	}

	// 2. 尝试用 FIB 精确提取文本；失败则回退到扫描法
	text := extractTextFIB(wordDoc)
	if strings.TrimSpace(text) == "" {
		text = scanText(wordDoc)
	}
	if strings.TrimSpace(text) == "" {
		warnings = append(warnings, core.Warning{
			Level:   "warn",
			Stage:   "parse",
			Message: "未能从 .doc 提取到文本内容（可能是加密或使用了不支持的特性）",
		})
	}

	// 3. 按段落切分
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimRight(raw, "\r")
		if line == "" {
			continue
		}
		doc.Blocks = append(doc.Blocks, &core.Paragraph{
			Inline: []core.Inline{core.Text{Content: line}},
		})
	}

	warnings = append(warnings, core.Warning{
		Level:   "info",
		Stage:   "parse",
		Message: ".doc 为旧版二进制格式，已提取正文文本用于查看；表格/图片/样式等排版暂不支持",
	})

	return doc, warnings, nil
}

// extractTextFIB 利用 FIB 头中的 ccpText / fcMin 精确提取正文文本。
// 返回 UTF-8 文本（按段落用 \n 连接）。
func extractTextFIB(wd []byte) string {
	// FIB.fibRgLw97.ccpText 位于 FIB 头 0x004C 起的 4 字节（自 Word 8 起稳定）
	if len(wd) < 0x50 {
		return ""
	}
	ccpText := binary.LittleEndian.Uint32(wd[0x4C:0x50])
	if ccpText == 0 || ccpText > uint32(len(wd)) {
		return ""
	}
	// 文本起始 CPs 在 FIB 的 fcMin（0x0018 起 4 字节）
	fcMin := binary.LittleEndian.Uint32(wd[0x18:0x1C])

	var sb strings.Builder
	var run strings.Builder
	// 经典 WordDocument 流布局：正文紧接 fcMin 之后，按 CP 顺序存储。
	// 注意 piecetable 可能会分片，但这里对常见单段正文足够。
	i := int(fcMin)
	end := int(fcMin + ccpText*2) // 假设 UTF-16LE
	if end > len(wd) {
		end = len(wd)
	}
	for i+1 < end {
		ch := uint16(wd[i]) | uint16(wd[i+1])<<8
		i += 2
		switch {
		case ch == 0x000D: // 段落标记
			sb.WriteString(run.String())
			sb.WriteString("\n")
			run.Reset()
		case ch == 0x0007 || ch == 0x000B || ch == 0x000C: // 制表/分栏/分页
			run.WriteRune('\t')
		case ch == 0x0000: // 段内分隔，忽略
		case unicode.IsPrint(rune(ch)) || ch == 0x000A || ch == 0x0009:
			run.WriteRune(rune(ch))
		default:
			// 非打印控制字符（< 0x20 且非上述），跳过以避免乱码
			if ch >= 0x20 {
				run.WriteRune(rune(ch))
			}
		}
	}
	if run.Len() > 0 {
		sb.WriteString(run.String())
	}
	return sb.String()
}

// scanText 回退方案：扫描整个 WordDocument 流，提取可打印字符序列。
// 把 0x0D/0x0A 当作段落分隔。
func scanText(wd []byte) string {
	var sb strings.Builder
	var run strings.Builder
	isUTF16 := detectUTF16(wd)
	i := 0
	if isUTF16 && len(wd) >= 2 {
		// 跳过可能的 BOM
		if wd[0] == 0xFF && wd[1] == 0xFE {
			i = 2
		}
	}
	for i < len(wd) {
		var ch rune
		if isUTF16 {
			if i+1 >= len(wd) {
				break
			}
			ch = rune(wd[i]) | rune(wd[i+1])<<8
			i += 2
		} else {
			ch = rune(wd[i])
			i++
		}
		switch {
		case ch == 0x0D || ch == 0x0A:
			if run.Len() > 0 {
				sb.WriteString(run.String())
				sb.WriteString("\n")
				run.Reset()
			}
		case ch == 0x09:
			run.WriteRune('\t')
		case ch == 0x0B || ch == 0x0C || ch == 0x07:
			// 分栏/分页/制表，视为空格
			run.WriteRune(' ')
		case unicode.IsPrint(ch):
			run.WriteRune(ch)
		default:
			// 不可打印且非控制符，结束当前 run（避免二进制噪音）
			if run.Len() > 0 {
				sb.WriteString(run.String())
				sb.WriteString("\n")
				run.Reset()
			}
		}
	}
	if run.Len() > 0 {
		sb.WriteString(run.String())
	}
	return sb.String()
}

// detectUTF16 粗略判断 WordDocument 流是否为 UTF-16LE 文本为主。
func detectUTF16(wd []byte) bool {
	if len(wd) < 4 {
		return false
	}
	// 统计"高位字节常为零且低位为可打印 ASCII"的情况
	printable := 0
	nonzeroHigh := 0
	for i := 0; i+1 < len(wd) && i < 4096; i += 2 {
		lo := wd[i]
		hi := wd[i+1]
		if hi != 0 {
			nonzeroHigh++
		}
		if lo >= 0x20 && lo < 0x7F {
			printable++
		}
	}
	if printable == 0 {
		return false
	}
	return nonzeroHigh < printable/2
}
