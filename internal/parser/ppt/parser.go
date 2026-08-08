// Package ppt 实现对旧版 PowerPoint 97-2003 (.ppt) 二进制格式（OLE2 复合文档）的解析。
//
// .ppt 文件是一个 OLE2 (CFB) 复合文档，核心数据流名为 "PowerPoint Document"。
// 流内是一串 PowerPoint 记录（record header: ver(4bit) instance(12bit) type(2) len(4) + body）。
//
// 本解析器参考 internal/parser/doc 对老版 Word .doc 的处理思路（同样基于 mscfb 读取
// OLE2 容器、遍历内部流并解析专有二进制结构），实用且容错地提取：
//   - 幻灯片顺序（按 SlideContainer(0x03EE) 出现顺序；标准文件也可经 SlideListWithText）
//   - 每页的文本（SlideContainer 内的 TextHeaderAtom + TextChars/TextBytes Atom）
//   - 备注文本（NotesContainer(0x03F0) 内的 textType==2 文本）
//   - 背景色（ColorSchemeAtom，尽力而为）
//
// 输出为标准 UDM core.Document，每张幻灯片存为一个 RawBlock{kind:"slide", Data:{...}}，
// 前端 rawBlocksToSlides() 会将其转为幻灯片编辑器数据。文本会被转换为文本形状（kind:"text"）
// 以保证在幻灯片编辑器中可见、可编辑。
package ppt

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"strings"

	"github.com/richardlehane/mscfb"
	"github.com/zai/samoffice/internal/core"
)

// Parser 实现 parser.Parser 接口
type Parser struct{}

func New() *Parser { return &Parser{} }

func (p *Parser) Supported() []string { return []string{".ppt"} }

func (p *Parser) CanParse(path string, header []byte) bool {
	lower := strings.ToLower(path)
	if !strings.HasSuffix(lower, ".ppt") {
		return false
	}
	// .pptx 是 ZIP（PK 头），需与 .ppt 区分
	if len(header) >= 2 && bytes.Equal(header[:2], []byte{0x50, 0x4B}) {
		return false
	}
	// OLE2 复合文档头标识
	if len(header) >= 8 && bytes.Equal(header[:8], []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}) {
		return true
	}
	return false
}

// 关键记录类型
const (
	rtDocumentContainer = 0x03F2
	rtSlideContainer    = 0x03EE
	rtNotesContainer    = 0x03F0
	rtTextHeaderAtom    = 0x0F9F
	rtTextCharsAtom     = 0x0FA0
	rtTextBytesAtom     = 0x0FA8
)

// Parse 解析 .ppt 字节流为 UDM
func (p *Parser) Parse(r io.Reader) (*core.Document, []core.Warning, error) {
	warnings := []core.Warning{}

	data, err := io.ReadAll(r)
	if err != nil {
		return nil, warnings, fmt.Errorf("read ppt: %w", err)
	}

	cfb, err := mscfb.New(bytes.NewReader(data))
	if err != nil {
		return nil, warnings, fmt.Errorf("open ole container: %w", err)
	}

	// 定位 "PowerPoint Document" 流
	var pd []byte
	for entry, err := cfb.Next(); err == nil; entry, err = cfb.Next() {
		if strings.EqualFold(entry.Name, "PowerPoint Document") {
			buf := make([]byte, entry.Size)
			if _, rerr := entry.ReadAt(buf, 0); rerr == nil || rerr == io.EOF {
				pd = buf
			}
		}
	}
	if len(pd) == 0 {
		return nil, warnings, fmt.Errorf("missing PowerPoint Document stream")
	}

	docBody, ok := findRecord(pd, rtDocumentContainer)
	if !ok {
		docBody = pd
		warnings = append(warnings, core.Warning{Level: "warn", Stage: "parse", Message: "未找到 DocumentContainer，按整条流扫描"})
	}

	// SlideContainer / NotesContainer 位于 PowerPoint Document 流顶层（与 DocumentContainer 平级），
	// 因此直接对整个流做递归收集。
	slides := collectSlides(pd)
	notesList := collectNotes(pd)
	bg := extractBg(docBody)

	if len(slides) == 0 {
		warnings = append(warnings, core.Warning{
			Level:   "warn",
			Stage:   "parse",
			Message: "未能从 .ppt 提取到幻灯片（可能是加密、模板或不支持的变体）",
		})
	}

	const (
		pageWEMU = int64(12192000)
		pageHEMU = int64(6858000)
	)

	doc := &core.Document{
		Meta:   core.Meta{},
		Blocks: []core.Block{},
		Raw:    make(map[string]any),
	}

	for i, st := range slides {
		notes := ""
		if i < len(notesList) {
			notes = strings.TrimSpace(notesList[i])
		}
		block := core.RawBlock{
			Kind: "slide",
			Data: map[string]any{
				"title":   st.title,
				"bullets": st.body,
				"notes":   notes,
				"bg":      bg,
				"pageW":   pageWEMU,
				"pageH":   pageHEMU,
				"shapes":  buildTextShapes(st),
			},
		}
		doc.Blocks = append(doc.Blocks, block)
	}
	return doc, warnings, nil
}

// slideText 累积单页文本
type slideText struct {
	title string
	body  []string
}

// collectSlides 递归查找所有 SlideContainer(0x03EE)，每个容器内的第一个文本原子作为标题，
// 其余文本原子（按 \r 拆分为段落）作为正文要点。
func collectSlides(pd []byte) []*slideText {
	var out []*slideText
	var cur *slideText
	first := true

	var walk func(b []byte)
	walk = func(b []byte) {
		pos := 0
		for pos+8 <= len(b) {
			ver := b[pos] & 0x0F
			rt := binary.LittleEndian.Uint16(b[pos+2 : pos+4])
			rl := int(binary.LittleEndian.Uint32(b[pos+4 : pos+8]))
			if rl < 0 || rl > len(b)-pos-8 {
				break
			}
			body := b[pos+8 : pos+8+rl]
			if rt == rtSlideContainer {
				cur = &slideText{}
				out = append(out, cur)
				first = true
			} else if cur != nil {
				if t := textOf(rt, body); t != "" {
					if first {
						cur.title = t
						first = false
					} else {
						for _, line := range strings.Split(t, "\r") {
							line = strings.TrimRight(line, "\n")
							if line != "" {
								cur.body = append(cur.body, line)
							}
						}
					}
				}
			}
			if ver == 0x0F {
				walk(body)
			}
			pos += 8 + rl
		}
	}
	walk(pd)
	return out
}

// collectNotes 递归查找所有 NotesContainer(0x03F0)，仅收集 textType==2（备注）的文本。
func collectNotes(pd []byte) []string {
	var out []string
	var builders []*strings.Builder
	var cur *strings.Builder
	curType := uint16(1)

	var walk func(b []byte)
	walk = func(b []byte) {
		pos := 0
		for pos+8 <= len(b) {
			ver := b[pos] & 0x0F
			rt := binary.LittleEndian.Uint16(b[pos+2 : pos+4])
			rl := int(binary.LittleEndian.Uint32(b[pos+4 : pos+8]))
			if rl < 0 || rl > len(b)-pos-8 {
				break
			}
			body := b[pos+8 : pos+8+rl]
			if rt == rtNotesContainer {
				cur = &strings.Builder{}
				builders = append(builders, cur)
				out = append(out, "")
			} else if cur != nil {
				switch rt {
				case rtTextHeaderAtom:
					if len(body) >= 2 {
						curType = binary.LittleEndian.Uint16(body[0:2])
					}
				case rtTextCharsAtom:
					if curType == 2 {
						cur.WriteString(decodeUTF16LE(body))
					}
				case rtTextBytesAtom:
					if curType == 2 {
						cur.WriteString(decodeANSI(body))
					}
				}
			}
			if ver == 0x0F {
				walk(body)
			}
			pos += 8 + rl
		}
	}
	walk(pd)
	for i, sb := range builders {
		out[i] = strings.TrimSpace(sb.String())
	}
	return out
}

// textOf 返回文本原子（TextChars/TextBytes）的解码内容，非文本原子返回 ""。
func textOf(rt uint16, body []byte) string {
	switch rt {
	case rtTextCharsAtom:
		return strings.TrimRight(decodeUTF16LE(body), "\x00")
	case rtTextBytesAtom:
		return strings.TrimRight(decodeANSI(body), "\x00")
	}
	return ""
}

// findRecord 在 buf 中查找第一个指定类型的记录，返回其 body（递归搜索容器）。
func findRecord(buf []byte, want uint16) ([]byte, bool) {
	pos := 0
	for pos+8 <= len(buf) {
		ver := buf[pos] & 0x0F
		recType := binary.LittleEndian.Uint16(buf[pos+2 : pos+4])
		recLen := int(binary.LittleEndian.Uint32(buf[pos+4 : pos+8]))
		body := buf[pos+8:]
		if recLen > len(body) {
			break
		}
		body = body[:recLen]
		if recType == want {
			return body, true
		}
		if ver == 0x0F {
			if sub, ok := findRecord(body, want); ok {
				return sub, true
			}
		}
		pos += 8 + recLen
	}
	return nil, false
}

// buildTextShapes 将每页文本转换为文本形状，保证在前端幻灯片编辑器中可见/可编辑。
// 坐标系为 EMU（slide canvas = 12192000 x 6858000）。
func buildTextShapes(st *slideText) []map[string]any {
	if st == nil {
		return []map[string]any{}
	}
	shapes := []map[string]any{}
	if st.title != "" {
		shapes = append(shapes, map[string]any{
			"kind":    "text",
			"x":       int64(914400),
			"y":       int64(457200),
			"cx":      int64(10372320),
			"cy":      int64(1371600),
			"fill":    "none",
			"text":    st.title,
			"color":   "#1a1a2e",
			"sizePt":  36,
			"bold":    true,
			"align":   "center",
			"vanchor": "center",
		})
	}
	body := strings.Join(st.body, "\n")
	if body != "" {
		shapes = append(shapes, map[string]any{
			"kind":    "text",
			"x":       int64(914400),
			"y":       int64(2108200),
			"cx":      int64(10372320),
			"cy":      int64(3962400),
			"fill":    "none",
			"text":    body,
			"color":   "#333333",
			"sizePt":  20,
			"bold":    false,
			"align":   "left",
			"vanchor": "top",
		})
	}
	return shapes
}

// extractBg 尽力从 DocumentContainer 内提取背景色（ColorSchemeAtom）。容错返回 ""。
func extractBg(buf []byte) string {
	const rtColorSchemeAtom = 0x07FB
	pos := 0
	for pos+8 <= len(buf) {
		ver := buf[pos] & 0x0F
		recType := binary.LittleEndian.Uint16(buf[pos+2 : pos+4])
		recLen := int(binary.LittleEndian.Uint32(buf[pos+4 : pos+8]))
		body := buf[pos+8:]
		if recLen > len(body) {
			break
		}
		body = body[:recLen]
		if recType == rtColorSchemeAtom && len(body) >= 24 {
			c := body[4:8]
			return fmt.Sprintf("#%02X%02X%02X", c[2], c[1], c[0])
		}
		if ver == 0x0F {
			if bg := extractBg(body); bg != "" {
				return bg
			}
		}
		pos += 8 + recLen
	}
	return ""
}

func decodeUTF16LE(b []byte) string {
	n := len(b) / 2
	var sb strings.Builder
	for i := 0; i < n; i++ {
		r := rune(binary.LittleEndian.Uint16(b[i*2 : i*2+2]))
		if r == 0 {
			continue
		}
		sb.WriteRune(r)
	}
	return sb.String()
}

// decodeANSI 退化的 ANSI 解码（覆盖常见 Latin1，中文等容错）。
func decodeANSI(b []byte) string {
	r := make([]rune, len(b))
	for i, c := range b {
		if c == 0 {
			continue
		}
		r[i] = rune(c)
	}
	return strings.TrimRight(string(r), "\x00")
}
