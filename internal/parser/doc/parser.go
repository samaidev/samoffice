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

	cfb, err := mscfb.New(bytes.NewReader(data))
	if err != nil {
		return nil, warnings, fmt.Errorf("open ole container: %w", err)
	}

	// 1. 定位 WordDocument 流与 Table 流（1Table/0Table，含 CLX/Piece Table）
	var wordDoc, tableStream []byte
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

	// 3. 按段落/表格切分（表格依据单元格标记 0x07 拼出简易网格）
	doc.Blocks = extractBlocks(wordDoc, tableStream)

	// 4. 页码：.doc 为连续文本流，文件层面不含分页/页脚定义（见下方 warning）。
	//    此处产出默认页码配置，使前端页脚显示页码占位符（与 .docx 一致的预览行为）。
	doc.PageNumber = &core.PageNumberConfig{
		Enabled: true,
		Format:  "第 {n} 页",
		Align:   "center",
	}

	warnings = append(warnings, core.Warning{
		Level:   "info",
		Stage:   "parse",
		Message: ".doc 为旧版二进制格式，已提取正文文本（含简易表格网格）用于查看；该文件不含列宽/合并单元格/页脚页码等排版信息，仅能提供页码占位符，精确排版需另存为 .docx",
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
	return blocksFromRaw(raw)
}

// blocksFromRaw 将保留标记的原始文本（0x07 单元格、0x0D 段落）转换为
// 段落与表格块。单独抽出以便单元测试（避免依赖真实 .doc 文件）。
func blocksFromRaw(raw string) []core.Block {
	segs := strings.Split(raw, "\r")
	var blocks []core.Block
	var cur *core.Table
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
				row = append(row, core.TableCell{
					Inline: []core.Inline{core.Text{Content: strings.TrimSpace(c)}},
				})
			}
			if len(row) > 0 {
				cur.Rows = append(cur.Rows, row)
			}
			continue
		}
		// 非表格段
		if strings.TrimSpace(seg) == "" {
			// 可能是表尾空段落（保持表格打开）或正文空行（忽略）
			continue
		}
		flush()
		blocks = append(blocks, &core.Paragraph{
			Inline: []core.Inline{core.Text{Content: strings.TrimSpace(seg)}},
		})
	}
	flush()
	return blocks
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

	// 解析 Pcdt：CLX 由若干 clxt 条目组成，文本提取需要 clxtPcd(0x01)
	var plcPcd []byte
	i := 0
	for i < len(clx) {
		clxt := clx[i]
		i++
		switch clxt {
		case 0x01: // clxtPcd：后接 4 字节 lcb 与 PlcPcd
			if i+4 > len(clx) {
				return ""
			}
			lcb := binary.LittleEndian.Uint32(clx[i : i+4])
			i += 4
			if lcb == 0 || i+int(lcb) > len(clx) {
				return ""
			}
			plcPcd = clx[i : i+int(lcb)]
			i += int(lcb)
		case 0x02: // clxtGrpprl：后接 2 字节 cb 与 grpprl，跳过
			if i+2 > len(clx) {
				return ""
			}
			cb := int(binary.LittleEndian.Uint16(clx[i : i+2]))
			i += 2
			if cb < 0 || i+cb > len(clx) {
				return ""
			}
			i += cb
		default:
			i = len(clx) // 未知类型，停止
		}
	}
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
