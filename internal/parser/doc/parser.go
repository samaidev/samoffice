// Package doc 实现旧版 Word 97-2003 (.doc) 二进制格式的解析器。
//
// .doc 是 OLE 复合文档（CFB）格式，内部以 WordDocument 流存储正文。
// 完整解析需要理解 FIB、Piece Table、Sprm 等结构。本解析器采用实用、容错的
// 文本提取策略：通过 FIB + Piece Table（CLX/PlcPcd）精确提取正文文本，
// 依据每个 piece 的压缩标志与文档代码页正确解码（中文通常为 GBK/CP936，
// 也可能为 UTF-16LE），从而解决中文乱码问题。表格依据文本流中的单元格标记
// （0x07）与行/段落结束符（0x0D）拼出简易网格；图片/样式等复杂排版暂不支持。
package doc

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"strings"
	"unicode"
	"unicode/utf16"

	"github.com/richardlehane/mscfb"
	"github.com/zai/samoffice/internal/core"
	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/charmap"
	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/korean"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/traditionalchinese"
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

	// 兼容 SamOffice 自身导出的 .doc：实际写入的是 RTF 文本（见
	// internal/server/api/handler.go 的 generateRTF）。RTF（{\rtf...）不是 OLE
	// 容器，直接走 OLE 解析会失败。这里嗅探内容并分发到 RTF 解析路径，保证
	// "保存后重新打开" 的闭环一致；真实二进制 OLE .doc 仍走下方原路径。
	if isRTFContent(data) {
		doc, rtfWarnings := rtfToUDM(data)
		warnings = append(warnings, rtfWarnings...)
		return doc, warnings, nil
	}

	cfb, err := mscfb.New(bytes.NewReader(data))
	if err != nil {
		return nil, warnings, fmt.Errorf("open ole container: %w", err)
	}

	// 1. 定位 WordDocument 流、Table 流（1Table/0Table，含 CLX/Piece Table）
	//    与 Data 流（内嵌图片 PICF 数据所在）
	var wordDoc, tableStream, dataStrm []byte
	hasSummary := false
	for entry, err := cfb.Next(); err == nil; entry, err = cfb.Next() {
		switch strings.ToLower(entry.Name) {
		case "worddocument":
			buf := make([]byte, entry.Size)
			if _, rerr := entry.ReadAt(buf, 0); rerr == nil || rerr == io.EOF {
				wordDoc = buf
			}
		case "1table", "0table":
			buf := make([]byte, entry.Size)
			if _, rerr := entry.ReadAt(buf, 0); rerr == nil || rerr == io.EOF {
				// 优先 1Table；已读到 1Table 则不被 0Table 覆盖
				if len(tableStream) == 0 || strings.EqualFold(entry.Name, "1table") {
					tableStream = buf
				}
			}
		case "data":
			buf := make([]byte, entry.Size)
			if _, rerr := entry.ReadAt(buf, 0); rerr == nil || rerr == io.EOF {
				dataStrm = buf
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

	// 2. 尝试用 FIB + Piece Table 精确提取文本；失败则回退到扫描法
	text := extractTextFIB(wordDoc, tableStream)
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

	// 3. 按段落/表格切分，并尽量还原字符/段落格式（CHP/PAP）；
	//    同时解析页脚中的 PAGE 域以产出页码配置。
	var pn *core.PageNumberConfig
	doc.Blocks, pn = extractFormattedBlocks(wordDoc, tableStream, dataStrm)

	// 4. 页码：优先使用从页脚 PAGE 域解析出的真实页码；否则给出默认配置。
	if pn != nil {
		pn.Enabled = true
		doc.PageNumber = pn
	} else {
		doc.PageNumber = &core.PageNumberConfig{
			Enabled: true,
			Format:  "第 {n} 页",
			Align:   "center",
		}
	}

	warnings = append(warnings, core.Warning{
		Level:   "info",
		Stage:   "parse",
		Message: ".doc 为旧版二进制格式，已原生还原字体/字号/加粗/颜色/对齐、缩进/行距/段距、表格列宽/合并单元格、内嵌图片、列表、分页以及页脚页码；页眉/浮动图形等暂不支持，如需完全保真可另存为 .docx",
	})

	return doc, warnings, nil
}

// extractTextFIB 利用 FIB + Piece Table（CLX/PlcPcd）精确提取正文文本。
// 旧版 Word 正文按"片（piece）"存储：每个 piece 通过 FcCompressed 标志位
// 决定是单字节 ANSI（需按代码页解码，中文通常为 GBK/CP936）还是 UTF-16LE。
// table 为 Table 流（1Table/0Table），缺失时回退到简单解码/扫描法。
func extractTextFIB(wordDoc, table []byte) string {
	if len(wordDoc) < 0x50 {
		return scanText(wordDoc)
	}
	ccpText := binary.LittleEndian.Uint32(wordDoc[0x4C:0x50])
	fcMin := binary.LittleEndian.Uint32(wordDoc[0x18:0x1C])
	if ccpText == 0 || ccpText > uint32(len(wordDoc)) {
		return scanText(wordDoc)
	}

	var txt string
	if len(table) > 0 {
		txt = extractTextPieceTable(wordDoc, table, ccpText)
	}
	if txt == "" {
		// 回退：假定整段正文从 fcMin 起为 UTF-16LE（适用于单一未压缩片文档）
		end := int(fcMin) + int(ccpText*2)
		if end > len(wordDoc) {
			end = len(wordDoc)
		}
		if int(fcMin) < end {
			txt = utf16leToString(wordDoc[int(fcMin):end])
		}
		if txt == "" {
			txt = scanText(wordDoc)
		}
	}

	// 段落标记（0x0D）规范化为换行，并按 UDM 约定的段落切分
	txt = strings.ReplaceAll(txt, "\r", "\n")
	// 清理控制字符：分页/分节标记为空格，制表符保留
	txt = strings.ReplaceAll(txt, "\x0B", " ")
	txt = strings.ReplaceAll(txt, "\x0C", " ")
	// 表格单元格标记（0x07）转为制表符，行标记（0x08）转为换行，
	// 使 .doc 内嵌表格的纯文本内容至少按"行"可读（非网格排版）。
	txt = strings.ReplaceAll(txt, "\x07", "\t")
	txt = strings.ReplaceAll(txt, "\x08", "\n")
	return txt
}

// extractTextRaw 与 extractTextFIB 类似，但保留表格单元格标记（0x07）与段落
// 结束符（0x0D），仅将列/分页标记（0x0B/0x0C）规范为空格、行标记（0x08）去除。
// 供 extractBlocks 识别表格结构使用。
func extractTextRaw(wordDoc, table []byte) string {
	if len(wordDoc) < 0x50 {
		return scanText(wordDoc)
	}
	ccpText := binary.LittleEndian.Uint32(wordDoc[0x4C:0x50])
	fcMin := binary.LittleEndian.Uint32(wordDoc[0x18:0x1C])
	if ccpText == 0 || ccpText > uint32(len(wordDoc)) {
		return scanText(wordDoc)
	}

	var txt string
	if len(table) > 0 {
		txt = extractTextPieceTable(wordDoc, table, ccpText)
	}
	if txt == "" {
		// 回退：假定整段正文从 fcMin 起为 UTF-16LE（适用于单一未压缩片文档）
		end := int(fcMin) + int(ccpText*2)
		if end > len(wordDoc) {
			end = len(wordDoc)
		}
		if int(fcMin) < end {
			txt = utf16leToString(wordDoc[int(fcMin):end])
		}
		if txt == "" {
			txt = scanText(wordDoc)
		}
	}

	// 列/分页标记规范为空格；行标记去除；保留 0x0D 段落分隔与 0x07 单元格标记
	txt = strings.ReplaceAll(txt, "\x0B", " ")
	txt = strings.ReplaceAll(txt, "\x0C", " ")
	txt = strings.ReplaceAll(txt, "\x08", "")
	return txt
}

// extractBlocks 将 .doc 正文切分为段落与表格块。
//
// 结构依据：Word 文本流中，表格单元格以 0x07 结束，行以 0x0D 段落标记结束
// （其后通常紧跟一个空的"表尾"段落，同样以 0x0D 结束）。因此：
//   - 按 0x0D 分段；
//   - 含 0x07 的段 = 表格的一行，按 0x07 切出各单元格；
//   - 连续的表格行归并为同一张 core.Table；
//   - 段之间的空段（表尾段落）保持表格打开，普通正文段关闭当前表格。
//
// 这是"简易网格"：能还原行列结构与单元格文本，但不含列宽、合并单元格等高级属性。
func extractBlocks(wordDoc, table []byte) []core.Block {
	raw := extractTextRaw(wordDoc, table)
	aligns := extractAlignments(wordDoc, table)
	if aligns != nil {
		nSeg := len(strings.Split(raw, "\r"))
		// 段落索引可能对不齐（非标准 .doc 的 FKP 页数与文本段数差异大），
		// 此时放弃对齐，避免误判导致正文段落被错误居中。
		if nSeg == 0 || absInt(len(aligns)-nSeg) > nSeg/3 {
			aligns = nil
		}
	}
	return blocksFromRaw(raw, aligns)
}

// blocksFromRaw 将保留标记的原始文本（0x07 单元格、0x0D 段落）转换为
// 段落与表格块。单独抽出以便单元测试（避免依赖真实 .doc 文件）。
//
// 保留原始文本所有字符不变；仅将 0x02 脚注引用标记转为上标编号
// (core.FootnoteRef)，即"参考文献序号"。其它控制字符（0x01/0x03/0x05 等）
// 保持原样逐字保留（兼容原版行为，前端自行处理渲染）。
// aligns 为非标准 .doc 尽力从 PAPX FKP 提取的段落对齐（索引对齐时生效）。
func blocksFromRaw(raw string, aligns []string) []core.Block {
	segs := strings.Split(raw, "\r")
	var blocks []core.Block
	var cur *core.Table

	fnNum := 0
	// buildInlines 将段文字符串转为 Inline 列表，0x02 替换为 FootnoteRef。
	buildInlines := func(s string) []core.Inline {
		var inls []core.Inline
		var buf strings.Builder
		flushText := func() {
			if buf.Len() > 0 {
				inls = append(inls, core.Text{Content: buf.String()})
				buf.Reset()
			}
		}
		for _, r := range s {
			if r == 0x02 {
				flushText()
				fnNum++
				inls = append(inls, core.FootnoteRef{Type: "footnote", Num: fnNum})
			} else {
				buf.WriteRune(r)
			}
		}
		flushText()
		if len(inls) == 0 {
			return nil
		}
		return inls
	}

	flush := func() {
		if cur != nil && len(cur.Rows) > 0 {
			// 首行标记为表头（与 xlsx 解析一致）
			for i := range cur.Rows[0] {
				cur.Rows[0][i].IsHeader = true
			}
			blocks = append(blocks, *cur)
			cur = nil
		}
	}
	idx := 0
	for _, seg := range segs {
		if strings.Contains(seg, "\x07") {
			if cur == nil {
				cur = &core.Table{}
			}
			cells := strings.Split(seg, "\x07")
			// 去掉尾部因单元格结束符产生的空单元格
			for len(cells) > 0 && strings.TrimSpace(cells[len(cells)-1]) == "" {
				cells = cells[:len(cells)-1]
			}
			row := make([]core.TableCell, 0, len(cells))
			for _, c := range cells {
				row = append(row, core.TableCell{Inline: buildInlines(c)})
			}
			if len(row) > 0 {
				cur.Rows = append(cur.Rows, row)
			}
			idx++
			continue
		}
		// 非表格段
		if strings.TrimSpace(seg) == "" {
			idx++
			continue
		}
		flush()
		para := &core.Paragraph{Inline: buildInlines(seg)}
		if idx < len(aligns) && aligns[idx] != "" {
			para.Align = aligns[idx]
		}
		idx++
		blocks = append(blocks, para)
	}
	flush()
	return blocks
}

// extractAlignments 尽力从 PAPX FKP 提取段落对齐（居中/右/两端对齐）。
// 仅在能可靠解析的 FKP 页生效；非标准页（偏移表指向 rgfc 或越界）整页跳过，
// 对应段落保持默认左对齐，避免误判。Word 95 等非标准 .doc 大量页无法解析，
// 此时返回的对齐数组多为空，blocksFromRaw 仅对非空项生效。
func extractAlignments(wordDoc, table []byte) []string {
	if len(wordDoc) < 0xA0 || len(table) == 0 {
		return nil
	}
	const base = 0x9A // fibRgFcLcbBlob 起点（93 条目布局），覆盖 Word95/97+
	fcPapx := binary.LittleEndian.Uint32(wordDoc[base+13*8 : base+13*8+4])
	lcbPapx := binary.LittleEndian.Uint32(wordDoc[base+13*8+4 : base+13*8+8])
	if fcPapx == 0 || int(fcPapx)+int(lcbPapx) > len(table) {
		return nil
	}
	plcf := table[fcPapx : fcPapx+lcbPapx]
	n2 := (int(lcbPapx) - 4) / 8
	if n2 < 1 {
		return nil
	}
	aData := func(i int) uint32 {
		return binary.LittleEndian.Uint32(plcf[4*(n2+1)+4*i : 4*(n2+1)+4*i+4])
	}
	var aligns []string
	for i := 0; i < n2; i++ {
		pn := aData(i)
		fb := pn * 512
		if fb+512 > uint32(len(wordDoc)) {
			continue
		}
		cpara := int(wordDoc[fb+511])
		if cpara <= 0 || cpara > 250 {
			continue
		}
		rgfcEnd := 4 * (cpara + 1)
		tailOff := 511 - cpara
		// 先校验整页偏移表，任一 PAPX 非法则整页跳过（不误判）
		valid := true
		for k := 0; k < cpara; k++ {
			bOffset := uint32(wordDoc[fb+uint32(tailOff)+uint32(k)])
			bx := int(fb) + int(bOffset)
			if bOffset == 0 || bx < int(fb)+rgfcEnd || bx+1 >= int(fb)+512 {
				valid = false
				break
			}
			cb := int(wordDoc[bx])
			if cb < 2 || bx+cb > int(fb)+512 {
				valid = false
				break
			}
		}
		if !valid {
			for k := 0; k < cpara; k++ {
				aligns = append(aligns, "")
			}
			continue
		}
		for k := 0; k < cpara; k++ {
			bOffset := uint32(wordDoc[fb+uint32(tailOff)+uint32(k)])
			bx := int(fb) + int(bOffset)
			cb := int(wordDoc[bx])
			grp := wordDoc[bx+3 : bx+cb]
			jc := -1
			for m := 0; m+2 < len(grp); m++ {
				if grp[m] == 0x1C && grp[m+1] == 0x00 { // sprmPJc
					jc = int(grp[m+2])
				}
			}
			aligns = append(aligns, jcToAlign(jc))
		}
	}
	return aligns
}

func jcToAlign(jc int) string {
	switch jc {
	case 1:
		return "center"
	case 2:
		return "right"
	case 3:
		return "justify"
	case 4:
		return "distribute"
	default:
		return ""
	}
}

func absInt(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

// extractTextPieceTable 解析 CLX 中的 PlcPcd，逐 piece 提取正文。
// 每个 piece 的文本字节位于 WordDocument 流，编码由其 FcCompressed 决定。
func extractTextPieceTable(wordDoc, table []byte, ccpText uint32) string {
	if len(wordDoc) < 0x2AE+4 {
		return ""
	}
	fcClx := binary.LittleEndian.Uint32(wordDoc[0x2AA:0x2AE])
	lcbClx := binary.LittleEndian.Uint32(wordDoc[0x2AE:0x2B2])
	if lcbClx == 0 || int(fcClx)+int(lcbClx) > len(table) {
		return ""
	}
	clx := table[fcClx : fcClx+lcbClx]
	plcPcd := findPlcPcd(clx)
	if len(plcPcd) < 12 {
		return ""
	}

	// PlcPcd 结构：n = (lcb - 4) / 12；前 4*(n+1) 为 aCp 数组，其后为 n 个 Pcd（各 8 字节）
	n := (len(plcPcd) - 4) / 12
	if n < 1 {
		return ""
	}
	aCp := make([]uint32, n+1)
	for k := 0; k <= n; k++ {
		if 4*(k+1) > len(plcPcd) {
			return ""
		}
		aCp[k] = binary.LittleEndian.Uint32(plcPcd[4*k : 4*k+4])
	}

	codepage := detectDocCodepage(wordDoc, table)
	var sb strings.Builder
	for k := 0; k < n; k++ {
		cpStart := aCp[k]
		cpEnd := aCp[k+1]
		if cpEnd <= cpStart {
			continue
		}
		// 仅取正文区域 [0, ccpText)，排除脚注/页眉/尾注等附属文本
		lo := cpStart
		if lo > ccpText {
			lo = ccpText
		}
		hi := cpEnd
		if hi > ccpText {
			hi = ccpText
		}
		if hi <= lo {
			continue
		}
		pcdOff := 4*(n+1) + k*8
		if pcdOff+8 > len(plcPcd) {
			break
		}
		// Pcd 内 FcCompressed 位于偏移 2 起的 4 字节
		fcc := binary.LittleEndian.Uint32(plcPcd[pcdOff+2 : pcdOff+6])
		fCompressed := (fcc & 0x40000000) != 0
		fc := fcc & 0x3FFFFFFF
		// 本片字节起点
		var base int
		if fCompressed {
			base = int(fc / 2)
		} else {
			base = int(fc)
		}
		// 本片字节终点 = 下一片字节起点（跨压缩/非压缩均适用）
		var pieceEnd int
		if k+1 < n {
			nextPcdOff := 4*(n+1) + (k+1)*8
			if nextPcdOff+8 > len(plcPcd) {
				pieceEnd = len(wordDoc)
			} else {
				nextFcc := binary.LittleEndian.Uint32(plcPcd[nextPcdOff+2 : nextPcdOff+6])
				nextFc := nextFcc & 0x3FFFFFFF
				if (nextFcc & 0x40000000) != 0 {
					pieceEnd = int(nextFc / 2)
				} else {
					pieceEnd = int(nextFc)
				}
			}
		} else {
			pieceEnd = len(wordDoc)
		}
		if base < 0 || pieceEnd > len(wordDoc) || pieceEnd < base {
			continue
		}
		rawPiece := wordDoc[base:pieceEnd]
		if fCompressed {
			// 单字节 ANSI：按代码页解码为 rune 序列（每字符=1 个 CP，
			// 但 GBK 等双字节编码每字符占 2 字节），再按下标截取正文区间。
			runes := []rune(decodeANSI(rawPiece, codepage))
			sb.WriteString(clampRunes(runes, int(lo-cpStart), int(hi-cpStart)))
		} else {
			runes := []rune(utf16leToString(rawPiece))
			sb.WriteString(clampRunes(runes, int(lo-cpStart), int(hi-cpStart)))
		}
	}
	return sb.String()
}

// findPlcPcd 从 CLX 字节中解析出 clxtPcd(0x01) 条目所含的 PlcPcd。
func findPlcPcd(clx []byte) []byte {
	var plcPcd []byte
	i := 0
	for i < len(clx) {
		clxt := clx[i]
		i++
		switch clxt {
		case 0x01: // clxtPcd：后接 4 字节 lcb 与 PlcPcd
			if i+4 > len(clx) {
				return nil
			}
			lcb := binary.LittleEndian.Uint32(clx[i : i+4])
			i += 4
			if lcb == 0 || i+int(lcb) > len(clx) {
				return nil
			}
			plcPcd = clx[i : i+int(lcb)]
			i += int(lcb)
		case 0x02: // clxtGrpprl：后接 2 字节 cb 与 grpprl，跳过
			if i+2 > len(clx) {
				return nil
			}
			cb := int(binary.LittleEndian.Uint16(clx[i : i+2]))
			i += 2
			if cb < 0 || i+cb > len(clx) {
				return nil
			}
			i += cb
		default:
			i = len(clx) // 未知类型，停止
		}
	}
	return plcPcd
}

// extractPlcPcdText 根据 PlcPcd 逐 piece 提取 [cpLo, cpHi) 区间的文本。
// cpLo/cpHi 为字符位置（CP）区间；正文故事用 [0, ccpText)，各附属故事用其自身 CP 区间。
func extractPlcPcdText(wordDoc, table, plcPcd []byte, cpLo, cpHi uint32) string {
	if len(plcPcd) < 12 {
		return ""
	}
	// PlcPcd 结构：n = (lcb - 4) / 12；前 4*(n+1) 为 aCp 数组，其后为 n 个 Pcd（各 8 字节）
	n := (len(plcPcd) - 4) / 12
	if n < 1 {
		return ""
	}
	aCp := make([]uint32, n+1)
	for k := 0; k <= n; k++ {
		if 4*(k+1) > len(plcPcd) {
			return ""
		}
		aCp[k] = binary.LittleEndian.Uint32(plcPcd[4*k : 4*k+4])
	}

	codepage := detectDocCodepage(wordDoc, table)
	var sb strings.Builder
	for k := 0; k < n; k++ {
		cpStart := aCp[k]
		cpEnd := aCp[k+1]
		if cpEnd <= cpStart {
			continue
		}
		// 仅取 [cpLo, cpHi) 区间，排除其它附属故事文本
		lo := cpStart
		if lo < cpLo {
			lo = cpLo
		}
		hi := cpEnd
		if hi > cpHi {
			hi = cpHi
		}
		if hi <= lo {
			continue
		}
		pcdOff := 4*(n+1) + k*8
		if pcdOff+8 > len(plcPcd) {
			break
		}
		// Pcd 内 FcCompressed 位于偏移 2 起的 4 字节
		fcc := binary.LittleEndian.Uint32(plcPcd[pcdOff+2 : pcdOff+6])
		fCompressed := (fcc & 0x40000000) != 0
		fc := fcc & 0x3FFFFFFF
		// 本片字节起点
		var base int
		if fCompressed {
			base = int(fc / 2)
		} else {
			base = int(fc)
		}
		// 本片字节终点 = 下一片字节起点（跨压缩/非压缩均适用）
		var pieceEnd int
		if k+1 < n {
			nextPcdOff := 4*(n+1) + (k+1)*8
			if nextPcdOff+8 > len(plcPcd) {
				pieceEnd = len(wordDoc)
			} else {
				nextFcc := binary.LittleEndian.Uint32(plcPcd[nextPcdOff+2 : nextPcdOff+6])
				nextFc := nextFcc & 0x3FFFFFFF
				if (nextFcc & 0x40000000) != 0 {
					pieceEnd = int(nextFc / 2)
				} else {
					pieceEnd = int(nextFc)
				}
			}
		} else {
			pieceEnd = len(wordDoc)
		}
		if base < 0 || pieceEnd > len(wordDoc) || pieceEnd < base {
			continue
		}
		rawPiece := wordDoc[base:pieceEnd]
		if fCompressed {
			runes := []rune(decodeANSI(rawPiece, codepage))
			sb.WriteString(clampRunes(runes, int(lo-cpStart), int(hi-cpStart)))
		} else {
			runes := []rune(utf16leToString(rawPiece))
			sb.WriteString(clampRunes(runes, int(lo-cpStart), int(hi-cpStart)))
		}
	}
	return sb.String()
}

// extractFootnotes 从 .doc 的脚注（Footnote）附属文本故事中提取各条脚注正文，
// 返回顺序与正文中的脚注引用（0x02）顺序一致。脚注正文位于主 WordDocument 流的
// CP 区间 [ccpText, ccpText+ccpFtn)，与主文本共用同一 piece table（或同一 UTF-16LE 片段）。
func extractFootnotes(wordDoc, table []byte) []string {
	if len(wordDoc) < 0x68 {
		return nil
	}
	ccpText := binary.LittleEndian.Uint32(wordDoc[0x4C:0x50])
	ccpFtn := binary.LittleEndian.Uint32(wordDoc[0x50:0x54])
	if ccpFtn == 0 {
		return nil
	}
	fnEnd := ccpText + ccpFtn
	fcClx := binary.LittleEndian.Uint32(wordDoc[0x2AA:0x2AE])
	lcbClx := binary.LittleEndian.Uint32(wordDoc[0x2AE:0x2B2])

	// 优先走标准 piece table（处理压缩/多片段，且可用 PlcfFlnTxt 精确切分）
	if lcbClx != 0 && int(fcClx)+int(lcbClx) <= len(table) {
		if plcPcd := findPlcPcd(table[fcClx : fcClx+lcbClx]); len(plcPcd) >= 12 {
			if bounds := findFootnoteBounds(wordDoc, table, ccpText, fnEnd); bounds != nil {
				out := make([]string, 0, len(bounds)-1)
				for i := 0; i+1 < len(bounds); i++ {
					out = append(out, cleanFootnoteText(extractPlcPcdText(wordDoc, table, plcPcd, bounds[i], bounds[i+1])))
				}
				return out
			}
			blob := extractPlcPcdText(wordDoc, table, plcPcd, ccpText, fnEnd)
			if blob != "" {
				return splitFootnoteBlob(blob)
			}
		}
	}
	// 回退：单一未压缩 UTF-16LE 片段（CP i -> fcMin + i*2），本文档即为此情形
	fcMin := binary.LittleEndian.Uint32(wordDoc[0x18:0x1C])
	all := utf16leToString(wordDoc[fcMin:])
	lo, hi := int(ccpText), int(fnEnd)
	if lo < 0 {
		lo = 0
	}
	if hi > len(all) {
		hi = len(all)
	}
	if lo >= hi {
		return nil
	}
	blob := all[lo:hi]
	return splitFootnoteBlob(blob)
}

// findFootnoteBounds 遍历 FIB 的 fc/lcb 对，定位 PlcfFlnTxt。
// 脚注文本位于主 WordDocument 流的 CP 区间 [ccpText, ccpText+ccpFtn)，
// 且 PlcfFlnTxt 的 aCP 为绝对 CP：首元素==ccpText，末元素==ccpText+ccpFtn。
// 返回逐项脚注的 CP 边界（n+1 个），失败返回 nil。
func findFootnoteBounds(wordDoc, table []byte, ccpText, fnEnd uint32) []uint32 {
	const base = 0x9A
	for idx := 0; idx < 130; idx++ {
		if int(base)+idx*8+8 > len(wordDoc) {
			break
		}
		fc := binary.LittleEndian.Uint32(wordDoc[base+idx*8 : base+idx*8+4])
		lcb := binary.LittleEndian.Uint32(wordDoc[base+idx*8+4 : base+idx*8+8])
		if lcb == 0 || int(fc)+int(lcb) > len(table) {
			continue
		}
		plcf := table[fc : fc+lcb]
		n := (len(plcf) - 4) / 8
		if n < 1 {
			continue
		}
		aCp := make([]uint32, n+1)
		for k := 0; k <= n; k++ {
			if 4*(k+1) > len(plcf) {
				break
			}
			aCp[k] = binary.LittleEndian.Uint32(plcf[4*k : 4*k+4])
		}
		if aCp[0] == ccpText && aCp[n] == fnEnd {
			return aCp
		}
	}
	return nil
}

// splitFootnoteBlob 将脚注子文档文本切分为各条脚注。
// Word 的脚注子文档以单列表格存储：每条脚注为若干行，行间以单元格标记 0x07 分隔；
// 不同脚注之间通常以连续两个 0x07（单元格标记 + 行标记）分隔。
// 因此先按双 0x07 切分各条脚注，再将每条脚注内的多行用空格合并为一条正文。
func splitFootnoteBlob(blob string) []string {
	rawNotes := strings.Split(blob, "\x07\x07")
	out := make([]string, 0, len(rawNotes))
	for _, rn := range rawNotes {
		cells := strings.Split(rn, "\x07")
		joined := strings.Join(cells, " ")
		if t := cleanFootnoteText(joined); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// cleanFootnoteText 清理脚注正文：去除表格/段落/分页等控制字符并规整空白。
func cleanFootnoteText(s string) string {
	repl := strings.NewReplacer(
		"\x01", "", "\x02", "", "\x03", "", "\x05", "", "\x07", "",
		"\x08", "", "\x0B", " ", "\x0C", " ", "\x0D", " ", "\x14", "",
	)
	s = repl.Replace(s)
	s = strings.Join(strings.Fields(s), " ")
	return strings.TrimSpace(s)
}

// clampRunes 安全截取 rune 切片 [lo, hi)
func clampRunes(r []rune, lo, hi int) string {
	if lo < 0 {
		lo = 0
	}
	if hi > len(r) {
		hi = len(r)
	}
	if lo > hi {
		return ""
	}
	return string(r[lo:hi])
}

// utf16leToString 将 UTF-16LE 字节切片解码为字符串（自动处理代理对）。
func utf16leToString(b []byte) string {
	if len(b)%2 != 0 {
		b = b[:len(b)-1]
	}
	u := make([]uint16, len(b)/2)
	for i := 0; i < len(u); i++ {
		u[i] = binary.LittleEndian.Uint16(b[i*2 : i*2+2])
	}
	return string(utf16.Decode(u))
}

// decodeANSI 按代码页将单字节 ANSI 文本解码为 UTF-8 字符串。
func decodeANSI(b []byte, cp int) string {
	var dec encoding.Encoding
	switch cp {
	case 932:
		dec = japanese.ShiftJIS
	case 936, 10008, 10002: // 简体中文 GBK；Mac 简体中文
		dec = simplifiedchinese.GBK
	case 950, 10001: // 繁体中文 Big5
		dec = traditionalchinese.Big5
	case 949, 10003:
		dec = korean.EUCKR
	case 1250:
		dec = charmap.Windows1250
	case 1251:
		dec = charmap.Windows1251
	case 1252:
		dec = charmap.Windows1252
	case 1253:
		dec = charmap.Windows1253
	case 1254:
		dec = charmap.Windows1254
	case 1255:
		dec = charmap.Windows1255
	case 1256:
		dec = charmap.Windows1256
	case 1257:
		dec = charmap.Windows1257
	case 1258:
		dec = charmap.Windows1258
	case 65001:
		return string(b)
	default:
		// 未知/未配置代码页：默认按 GBK 解码（覆盖中文论文常见情形）
		dec = simplifiedchinese.GBK
	}
	out, err := dec.NewDecoder().Bytes(b)
	if err != nil {
		return string(b)
	}
	return string(out)
}

// detectDocCodepage 从 DOP（fcDop）读取文档默认代码页，供压缩片解码使用。
// 读取失败或值不可识别时默认返回 GBK（CP936），以适配中文文档。
func detectDocCodepage(wordDoc, table []byte) int {
	if len(wordDoc) >= 0x332 {
		fcDop := binary.LittleEndian.Uint32(wordDoc[0x32A:0x32E])
		lcbDop := binary.LittleEndian.Uint32(wordDoc[0x32E:0x332])
		if lcbDop > 0 && int(fcDop)+int(lcbDop) <= len(table) {
			dop := table[fcDop : fcDop+lcbDop]
			if len(dop) > 0x30 {
				cp := int(binary.LittleEndian.Uint16(dop[0x2E : 0x30]))
				if knownCodepage(cp) {
					return cp
				}
			}
		}
	}
	return 936
}

func knownCodepage(cp int) bool {
	switch cp {
	case 874, 932, 936, 949, 950, 10000, 10001, 10002, 10003, 10008,
		1250, 1251, 1252, 1253, 1254, 1255, 1256, 1257, 1258, 65001:
		return true
	}
	return false
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
