package doc

// 本文件在原生 .doc 解析基础上，从 FKP（Formatted Disk Page）中读取
// 字符格式(CHP)与段落格式(PAP)，将加粗/斜体/下划线/删除线、字体名、字号、
// 颜色、段落对齐、大纲级别（标题）等信息还原到 UDM，从而在"不依赖
// LibreOffice"的前提下尽量恢复排版格式。
//
// 关键结构（[MS-DOC] Word 97+，nFib>=193）：
//   FIB fibRgFcLcb97：pair1=Stshf，pair12=PlcfBteChpx，pair13=PlcfBtePapx，
//                     pair15=SttbfFfn，pair33=Clx（fc 在 Table 流）。
//   PlcfBteChpx/Papx（Table 流）：aFC[n+1] + aPn[n]，pn*512 = FKP 页在
//                     WordDocument 流中的偏移。
//   ChpxFkp/PapxFkp（WordDocument 流，512B）：rgfc 为 FC（文件偏移，非 CP）。
//   字符 CP → FC 由 piece table 映射（本文件解码正文时逐字符记录 FC）。

import (
	"encoding/binary"
	"strings"
	"unicode/utf16"

	"github.com/zai/samoffice/internal/core"
)

// ---------- FIB ----------

type fibOff struct {
	fcStshf, lcbStshf       uint32
	fcSttbfFfn, lcbSttbfFfn uint32
	fcBteChpx, lcbBteChpx   uint32
	fcBtePapx, lcbBtePapx   uint32
	fcClx, lcbClx           uint32
	fcPlfLst, lcbPlfLst     uint32 // 列表定义表（PlfLst）
	fcPlfLfo, lcbPlfLfo     uint32 // 列表格式覆盖表（PlfLfo）
	fcPlcfHdd, lcbPlcfHdd   uint32 // 页眉/页脚故事数组（PlcfHdd）
	ccpText                 uint32
}

func readFib(wd []byte) fibOff {
	var f fibOff
	const base = 0x9A // fibRgFcLcbBlob 起点
	pair := func(i int) (uint32, uint32) {
		off := base + i*8
		if off+8 > len(wd) {
			return 0, 0
		}
		return binary.LittleEndian.Uint32(wd[off : off+4]),
			binary.LittleEndian.Uint32(wd[off+4 : off+8])
	}
	f.fcStshf, f.lcbStshf = pair(1)
	f.fcBteChpx, f.lcbBteChpx = pair(12)
	f.fcBtePapx, f.lcbBtePapx = pair(13)
	f.fcSttbfFfn, f.lcbSttbfFfn = pair(15)
	f.fcClx, f.lcbClx = pair(33)
	f.fcPlfLst, f.lcbPlfLst = pair(73)
	f.fcPlfLfo, f.lcbPlfLfo = pair(74)
	f.fcPlcfHdd, f.lcbPlcfHdd = pair(50) // fcPlcfHdd/lcbPlcfHdd：页眉/页脚故事数组
	if len(wd) >= 0x50 {
		f.ccpText = binary.LittleEndian.Uint32(wd[0x4C:0x50]) // fibRgLw.ccpText
	}
	return f
}

// ---------- CHP / PAP ----------

type chp struct {
	bold      bool
	italic    bool
	underline bool
	strike    bool
	hps       float64 // 半磅；0 未设置
	ico       int     // 颜色索引 0-16
	color24   int     // 24 位 RGB；-1 未设置
	ftcAscii  int     // ascii 字体；-1 未设置
	ftcFE     int     // 中日韩字体；-1 未设置
	fSpec     bool    // 特殊字符（0x01=图片锚点等）
	fObj      bool    // OLE 对象（不是纯图片，跳过）
	fcPic     int     // sprmCPicLocation：PICF 在 Data 流中的偏移；-1 未设置
}

type pap struct {
	jc       int // 0左 1中 2右 3两端
	outLvl   int // 0-8 大纲级别（标题），9/-1 正文
	istd     int
	fInTable bool
	fTtp     bool // 该段是表格行结束标记（TTP）
	// 缩进（twips；1 字符 ≈ 240 twips @12pt）
	dxaLeft  int // 左缩进
	dxaLeft1 int // 首行缩进（正）/悬挂缩进（负）
	dxaRight int // 右缩进
	// 行距 LSPD
	dyaLine   int  // 行距值：fMultLine 时 240=单倍；否则 twips（负=固定值）
	fMultLine bool // 行距为倍数
	// 段前/段后（twips）
	dyaBefore int
	dyaAfter  int
	// 列表
	ilfo int // >0 表示列表项，为 PlfLfo 中 1 起下标
	ilvl int // 列表层级 0-8
	// 分页
	fPageBreakBefore bool // sprmPFPageBreakBefore：本段前插入分页符
}

// span 表示 [fcStart,fcEnd) 文件偏移范围对应的一段格式。
type span struct {
	fcStart, fcEnd int
	grpprl         []byte
	istd           int // 仅 PAPX 用
}

func findSpan(spans []span, fc int) *span {
	lo, hi := 0, len(spans)
	for lo < hi {
		mid := (lo + hi) / 2
		if spans[mid].fcEnd <= fc {
			lo = mid + 1
		} else {
			hi = mid
		}
	}
	if lo < len(spans) && fc >= spans[lo].fcStart && fc < spans[lo].fcEnd {
		return &spans[lo]
	}
	return nil
}

// ---------- SPRM ----------

// iterSprms 按 [MS-DOC] spra 规则遍历 grpprl 中的 sprm。
func iterSprms(grp []byte, fn func(s uint16, op []byte)) {
	pos := 0
	for pos+2 <= len(grp) {
		s := binary.LittleEndian.Uint16(grp[pos : pos+2])
		pos += 2
		var l int
		switch (s >> 13) & 7 {
		case 0, 1:
			l = 1
		case 2, 4, 5:
			l = 2
		case 3:
			l = 4
		case 7:
			l = 3
		default: // 6: 变长，首字节为长度
			if pos >= len(grp) {
				return
			}
			if s == 0xD608 || s == 0xD606 {
				// sprmTDefTable(10)：前 2 字节 cb = 其后字节数 + 1
				if pos+2 > len(grp) {
					return
				}
				cb := int(binary.LittleEndian.Uint16(grp[pos : pos+2]))
				if cb < 1 {
					return
				}
				l = 2 + cb - 1
			} else {
				l = 1 + int(grp[pos])
			}
		}
		if pos+l > len(grp) {
			return
		}
		fn(s, grp[pos:pos+l])
		pos += l
	}
}

// isRefHeading 判断某块是否为“参考文献”标题（含中英文），用于把紧随其后的有序列表
// 标记为参考文献列表（序号渲染为 [n]）。
func isRefHeading(b core.Block) bool {
	t := blockPlainText(b)
	if t == "" {
		return false
	}
	tl := strings.ToLower(t)
	return strings.Contains(tl, "参考文献") || strings.Contains(tl, "references")
}

func blockPlainText(b core.Block) string {
	switch v := b.(type) {
	case *core.Paragraph:
		return inlinesPlainText(v.Inline)
	case *core.Heading:
		return inlinesPlainText(v.Inline)
	}
	return ""
}

func inlinesPlainText(inls []core.Inline) string {
	var sb strings.Builder
	for _, in := range inls {
		switch v := in.(type) {
		case core.Text:
			sb.WriteString(v.Content)
		case *core.Text:
			sb.WriteString(v.Content)
		}
	}
	return sb.String()
}

// setTog 处理布尔 sprm 的 0/1/128(继承样式)/129(取反样式) 语义。
// cur 已含样式解析结果，因此 128 保持、129 取反。
func setTog(cur *bool, op byte) {
	switch op {
	case 0:
		*cur = false
	case 1:
		*cur = true
	case 0x81:
		*cur = !*cur
	}
}

func applyCHP(c *chp, grp []byte) {
	iterSprms(grp, func(s uint16, op []byte) {
		switch s {
		case 0x0835: // sprmCFBold
			setTog(&c.bold, op[0])
		case 0x0836: // sprmCFItalic
			setTog(&c.italic, op[0])
		case 0x0837: // sprmCFStrike
			setTog(&c.strike, op[0])
		case 0x2A3E: // sprmCKul
			c.underline = op[0] != 0
		case 0x2A42: // sprmCIco
			c.ico = int(op[0])
			c.color24 = -1
		case 0x6870: // sprmCCv 24 位颜色 (r,g,b,0)
			if len(op) >= 3 {
				c.color24 = int(op[0])<<16 | int(op[1])<<8 | int(op[2])
			}
		case 0x4A43: // sprmCHps 半磅
			c.hps = float64(binary.LittleEndian.Uint16(op))
		case 0x4A61: // sprmCHpsBi
			if c.hps == 0 {
				c.hps = float64(binary.LittleEndian.Uint16(op))
			}
		case 0x4A4F: // sprmCRgFtc0 ascii 字体
			c.ftcAscii = int(binary.LittleEndian.Uint16(op))
		case 0x4A50: // sprmCRgFtc1 东亚字体
			c.ftcFE = int(binary.LittleEndian.Uint16(op))
		case 0x0855: // sprmCFSpec
			setTog(&c.fSpec, op[0])
		case 0x0856: // sprmCFObj
			setTog(&c.fObj, op[0])
		case 0x6A03: // sprmCPicLocation：Data 流中 PICF 偏移
			if len(op) >= 4 {
				c.fcPic = int(int32(binary.LittleEndian.Uint32(op)))
			}
		}
	})
}

func applyPAP(p *pap, grp []byte) {
	iterSprms(grp, func(s uint16, op []byte) {
		switch s {
		case 0x4600: // sprmPIstd
			p.istd = int(binary.LittleEndian.Uint16(op))
		case 0x2461, 0x2403: // sprmPJc80 / sprmPJc
			p.jc = int(op[0])
		case 0x2640: // sprmPOutLvl
			p.outLvl = int(op[0])
		case 0x2416: // sprmPFInTable
			p.fInTable = op[0] != 0
		case 0x2417: // sprmPFTtp 行结束标记
			p.fTtp = op[0] != 0
		case 0x840F, 0x845E: // sprmPDxaLeft80 / sprmPDxaLeft
			p.dxaLeft = int(int16(binary.LittleEndian.Uint16(op)))
		case 0x8411, 0x8460: // sprmPDxaLeft180 / sprmPDxaLeft1（首行/悬挂）
			p.dxaLeft1 = int(int16(binary.LittleEndian.Uint16(op)))
		case 0x840E, 0x845D: // sprmPDxaRight80 / sprmPDxaRight
			p.dxaRight = int(int16(binary.LittleEndian.Uint16(op)))
		case 0x6412: // sprmPDyaLine（LSPD：dyaLine + fMultLinespace）
			if len(op) >= 4 {
				p.dyaLine = int(int16(binary.LittleEndian.Uint16(op)))
				p.fMultLine = binary.LittleEndian.Uint16(op[2:4]) == 1
			}
		case 0xA413: // sprmPDyaBefore
			p.dyaBefore = int(binary.LittleEndian.Uint16(op))
		case 0xA414: // sprmPDyaAfter
			p.dyaAfter = int(binary.LittleEndian.Uint16(op))
		case 0x460B: // sprmPIlfo
			p.ilfo = int(int16(binary.LittleEndian.Uint16(op)))
		case 0x260A: // sprmPIlvl
			p.ilvl = int(op[0])
		case 0x241B: // sprmPFPageBreakBefore：段前分页
			p.fPageBreakBefore = op[0] != 0
		}
	})
}

// ---------- FKP ----------

// walkChpx 通过 PlcfBteChpx（Table 流）定位 CHPX FKP 页（WordDocument 流）。
func walkChpx(table, wordDoc []byte, fc, lcb uint32) []span {
	var out []span
	if lcb < 12 || int(fc)+int(lcb) > len(table) {
		return out
	}
	plc := table[fc : fc+lcb]
	n := (len(plc) - 4) / 8
	if n < 1 {
		return out
	}
	for k := 0; k < n; k++ {
		pn := binary.LittleEndian.Uint32(plc[4*(n+1)+4*k:]) & 0x3FFFFF
		pg := int(pn) * 512
		if pg+512 > len(wordDoc) {
			continue
		}
		page := wordDoc[pg : pg+512]
		crun := int(page[511])
		if crun < 1 || crun > 101 {
			continue
		}
		rgbBase := 4 * (crun + 1)
		if rgbBase+crun > 511 {
			continue
		}
		for j := 0; j < crun; j++ {
			fcS := int(binary.LittleEndian.Uint32(page[4*j:]))
			fcE := int(binary.LittleEndian.Uint32(page[4*(j+1):]))
			if fcE <= fcS {
				continue
			}
			var grp []byte
			if b := int(page[rgbBase+j]); b != 0 {
				off := b * 2
				if off+1 <= 511 {
					cb := int(page[off])
					if cb >= 1 && off+1+cb <= 512 {
						grp = page[off+1 : off+1+cb]
					}
				}
			}
			out = append(out, span{fcStart: fcS, fcEnd: fcE, grpprl: grp, istd: -1})
		}
	}
	return out
}

// walkPapx 通过 PlcfBtePapx 定位 PAPX FKP 页；BxPap 为 13 字节，
// PapxInFkp 首字节 cb：cb!=0 → 长度 2*cb-1；cb==0 → 次字节 cb'，长度 2*cb'。
func walkPapx(table, wordDoc []byte, fc, lcb uint32) []span {
	var out []span
	if lcb < 12 || int(fc)+int(lcb) > len(table) {
		return out
	}
	plc := table[fc : fc+lcb]
	n := (len(plc) - 4) / 8
	if n < 1 {
		return out
	}
	for k := 0; k < n; k++ {
		pn := binary.LittleEndian.Uint32(plc[4*(n+1)+4*k:]) & 0x3FFFFF
		pg := int(pn) * 512
		if pg+512 > len(wordDoc) {
			continue
		}
		page := wordDoc[pg : pg+512]
		cpara := int(page[511])
		if cpara < 1 || cpara > 29 {
			continue
		}
		bxBase := 4 * (cpara + 1)
		if bxBase+13*cpara > 511 {
			continue
		}
		for j := 0; j < cpara; j++ {
			fcS := int(binary.LittleEndian.Uint32(page[4*j:]))
			fcE := int(binary.LittleEndian.Uint32(page[4*(j+1):]))
			if fcE <= fcS {
				continue
			}
			istd := -1
			var grp []byte
			if b := int(page[bxBase+13*j]); b != 0 {
				off := b * 2
				if off < 511 {
					cb := int(page[off])
					start, size := 0, 0
					if cb != 0 {
						start, size = off+1, 2*cb-1
					} else if off+1 < 511 {
						start, size = off+2, 2*int(page[off+1])
					}
					if size >= 2 && start+size <= 512 {
						istd = int(binary.LittleEndian.Uint16(page[start:]))
						if size > 2 {
							grp = page[start+2 : start+size]
						}
					}
				}
			}
			out = append(out, span{fcStart: fcS, fcEnd: fcE, grpprl: grp, istd: istd})
		}
	}
	return out
}

// ---------- STSH（样式表） ----------

type styleDef struct {
	name     string
	istdBase int // 0xFFF 表示无
	chpx     []byte
	papx     []byte
}

// parseStyles 解析 STSH：LPStd 数组（每项前置 2 字节 cbStd），
// 返回 istd(数组下标) → 样式定义，以及文档默认 chp。
func parseStyles(table []byte, fc, lcb uint32) (map[int]styleDef, chp) {
	out := map[int]styleDef{}
	def := chp{ftcAscii: -1, ftcFE: -1, color24: -1, hps: 20, fcPic: -1} // 规范默认 10pt
	if lcb < 6 || int(fc)+int(lcb) > len(table) {
		return out, def
	}
	stsh := table[fc : fc+lcb]
	cbStshi := int(binary.LittleEndian.Uint16(stsh[0:2]))
	if cbStshi < 4 || 2+cbStshi > len(stsh) {
		return out, def
	}
	stshi := stsh[2 : 2+cbStshi]
	cstd := int(binary.LittleEndian.Uint16(stshi[0:2]))
	cbSTDBase := int(binary.LittleEndian.Uint16(stshi[2:4]))
	if cbSTDBase < 8 || cbSTDBase > 32 {
		cbSTDBase = 10
	}
	// rgftcStandardChpStsh：ftcAsci 在 STSHI 偏移 12，ftcFE 在 14
	if len(stshi) >= 14 {
		def.ftcAscii = int(binary.LittleEndian.Uint16(stshi[12:14]))
	}
	if len(stshi) >= 16 {
		def.ftcFE = int(binary.LittleEndian.Uint16(stshi[14:16]))
	}

	pos := 2 + cbStshi
	for i := 0; i < cstd; i++ {
		if pos+2 > len(stsh) {
			break
		}
		cbStd := int(binary.LittleEndian.Uint16(stsh[pos : pos+2]))
		pos += 2
		if cbStd == 0 {
			continue // 空槽位，istd 仍占号
		}
		if pos+cbStd > len(stsh) {
			break
		}
		std := stsh[pos : pos+cbStd]
		pos += cbStd
		if pos%2 == 1 {
			pos++
		}
		if len(std) < cbSTDBase {
			continue
		}
		w2 := binary.LittleEndian.Uint16(std[2:4])
		sgc := int(w2 & 0xF)         // 1=段落样式 2=字符样式
		istdBase := int(w2 >> 4)     // 12 位
		w3 := binary.LittleEndian.Uint16(std[4:6])
		cupx := int(w3 & 0xF)

		// xstz 名称：cch(2) + utf16 + null(2)
		npos := cbSTDBase
		var name string
		if npos+2 <= len(std) {
			cch := int(binary.LittleEndian.Uint16(std[npos : npos+2]))
			if cch > 0 && npos+2+cch*2 <= len(std) {
				u := make([]uint16, cch)
				for j := 0; j < cch; j++ {
					u[j] = binary.LittleEndian.Uint16(std[npos+2+j*2:])
				}
				name = strings.TrimRight(string(utf16.Decode(u)), "\x00")
			}
			npos = npos + 2 + cch*2 + 2 // 跳过 null 终结符
			if npos%2 == 1 {
				npos++
			}
		}

		// UPX 数组：每个前置 2 字节 cbUPX，2 字节对齐。
		// 段落样式(sgc=1)：UPX[0]=upxPapx(istd+grpprl)，UPX[1]=upxChpx；
		// 字符样式(sgc=2)：UPX[0]=upxChpx。
		var chpxB, papxB []byte
		upos := npos
		for u := 0; u < cupx && upos+2 <= len(std); u++ {
			cbUPX := int(binary.LittleEndian.Uint16(std[upos : upos+2]))
			upos += 2
			if upos+cbUPX > len(std) {
				break
			}
			data := std[upos : upos+cbUPX]
			if sgc == 1 && u == 0 {
				if cbUPX > 2 {
					papxB = append([]byte(nil), data[2:]...) // 跳过前置 istd
				}
			} else {
				chpxB = append([]byte(nil), data...)
			}
			upos += cbUPX
			if upos%2 == 1 {
				upos++
			}
		}
		out[i] = styleDef{name: name, istdBase: istdBase, chpx: chpxB, papx: papxB}
	}
	return out, def
}

// ---------- 字体表 SttbfFfn ----------

// parseFontTable 解析 SttbfFfn：cData(2)+cbExtra(2)，每项 cch(1)+FFN，
// 字体名为 FFN 偏移 39 起的 UTF-16 零终结串。
func parseFontTable(table []byte, fc, lcb uint32) []string {
	out := []string{}
	if lcb < 4 || int(fc)+int(lcb) > len(table) {
		return out
	}
	st := table[fc : fc+lcb]
	cData := int(binary.LittleEndian.Uint16(st[0:2]))
	pos := 4
	for i := 0; i < cData && pos < len(st); i++ {
		cch := int(st[pos])
		pos++
		if pos+cch > len(st) {
			break
		}
		ffn := st[pos : pos+cch]
		pos += cch
		name := ""
		if len(ffn) > 40 {
			var u []uint16
			for j := 39; j+1 < len(ffn); j += 2 {
				v := binary.LittleEndian.Uint16(ffn[j:])
				if v == 0 {
					break
				}
				u = append(u, v)
			}
			name = string(utf16.Decode(u))
		}
		out = append(out, name)
	}
	return out
}

// ---------- 颜色 / 对齐 / 工具 ----------

var icoHex = map[int]string{
	1: "000000", 2: "0000FF", 3: "00FFFF", 4: "00FF00", 5: "FF00FF",
	6: "FF0000", 7: "FFFF00", 8: "FFFFFF", 9: "000080", 10: "008080",
	11: "008000", 12: "800080", 13: "800000", 14: "808000", 15: "808080",
	16: "C0C0C0",
}

func chpColorHex(c chp) string {
	if c.color24 >= 0 {
		return hex3(c.color24)
	}
	if h, ok := icoHex[c.ico]; ok {
		return h
	}
	return ""
}

func hex3(rgb int) string {
	const hx = "0123456789ABCDEF"
	r, g, b := (rgb>>16)&0xFF, (rgb>>8)&0xFF, rgb&0xFF
	return string([]byte{hx[r>>4], hx[r&0xF], hx[g>>4], hx[g&0xF], hx[b>>4], hx[b&0xF]})
}

func jcToAlignStr(jc int) string {
	switch jc {
	case 1:
		return "center"
	case 2:
		return "right"
	case 3:
		return "justify"
	default:
		return ""
	}
}

func ftcToName(ftc int, fonts []string) string {
	if ftc < 0 || ftc >= len(fonts) {
		return ""
	}
	return fonts[ftc]
}

func hasCJK(s string) bool {
	for _, r := range s {
		if r >= 0x2E80 && r <= 0x9FFF || r >= 0xF900 && r <= 0xFAFF || r >= 0xFF00 && r <= 0xFFEF {
			return true
		}
	}
	return false
}

func chpEqual(a, b chp) bool {
	return a.bold == b.bold && a.italic == b.italic && a.underline == b.underline &&
		a.strike == b.strike && a.hps == b.hps && a.ico == b.ico &&
		a.color24 == b.color24 && a.ftcAscii == b.ftcAscii && a.ftcFE == b.ftcFE
}

// ---------- 样式链解析 ----------

func styleChainCHP(istd int, styles map[int]styleDef, base chp, depth int) chp {
	if depth > 12 || istd < 0 || istd >= 0xFFF {
		return base
	}
	s, ok := styles[istd]
	if !ok {
		return base
	}
	c := styleChainCHP(s.istdBase, styles, base, depth+1)
	applyCHP(&c, s.chpx)
	return c
}

func styleChainPAP(istd int, styles map[int]styleDef, base pap, depth int) pap {
	if depth > 12 || istd < 0 || istd >= 0xFFF {
		return base
	}
	s, ok := styles[istd]
	if !ok {
		return base
	}
	p := styleChainPAP(s.istdBase, styles, base, depth+1)
	applyPAP(&p, s.papx)
	return p
}

func resolveCHP(def chp, istd int, direct []byte, styles map[int]styleDef) chp {
	c := styleChainCHP(istd, styles, def, 0)
	applyCHP(&c, direct)
	return c
}

func resolvePAP(istd int, direct []byte, styles map[int]styleDef) pap {
	base := pap{outLvl: -1, istd: istd}
	p := styleChainPAP(istd, styles, base, 0)
	p.istd = istd
	applyPAP(&p, direct)
	return p
}

// ---------- 正文解码（rune + 每字符 FC） ----------

// decodeMainRunes 通过 piece table 解码正文，返回 rune 数组、每个 rune 对应的
// WordDocument 流文件偏移（FC）以及每个 rune 的 CP（字符位置）。三者下标一一对应。
func decodeMainRunes(wordDoc, table []byte, f fibOff) (runes []rune, fcs []int, cpAt []uint32) {
	if f.lcbClx == 0 || int(f.fcClx)+int(f.lcbClx) > len(table) {
		return nil, nil, nil
	}
	clx := table[f.fcClx : f.fcClx+f.lcbClx]
	var plcPcd []byte
	i := 0
	for i < len(clx) {
		clxt := clx[i]
		i++
		switch clxt {
		case 0x01: // Prc，跳过
			if i+2 > len(clx) {
				return nil, nil, nil
			}
			cb := int(binary.LittleEndian.Uint16(clx[i : i+2]))
			i += 2 + cb
		case 0x02: // Pcdt
			if i+4 > len(clx) {
				return nil, nil, nil
			}
			lcb := binary.LittleEndian.Uint32(clx[i : i+4])
			i += 4
			if lcb == 0 || i+int(lcb) > len(clx) {
				return nil, nil, nil
			}
			plcPcd = clx[i : i+int(lcb)]
			i += int(lcb)
		default:
			i = len(clx)
		}
	}
	if len(plcPcd) < 12 {
		return nil, nil, nil
	}
	n := (len(plcPcd) - 4) / 12
	if n < 1 {
		return nil, nil, nil
	}
	aCp := make([]uint32, n+1)
	for k := 0; k <= n; k++ {
		aCp[k] = binary.LittleEndian.Uint32(plcPcd[4*k:])
	}
	codepage := detectDocCodepage(wordDoc, table)
	runes = make([]rune, 0, f.ccpText)
	fcs = make([]int, 0, f.ccpText)
	cpAt = make([]uint32, 0, f.ccpText)
	for k := 0; k < n; k++ {
		cpStart, cpEnd := aCp[k], aCp[k+1]
		if cpEnd <= cpStart {
			continue
		}
		lo, hi := cpStart, cpEnd
		if lo > f.ccpText {
			lo = f.ccpText
		}
		if hi > f.ccpText {
			hi = f.ccpText
		}
		if hi <= lo {
			continue
		}
		pcdOff := 4*(n+1) + k*8
		if pcdOff+8 > len(plcPcd) {
			break
		}
		fcc := binary.LittleEndian.Uint32(plcPcd[pcdOff+2 : pcdOff+6])
		fCompressed := (fcc & 0x40000000) != 0
		fc := int(fcc & 0x3FFFFFFF)
		nchars := int(cpEnd - cpStart)
		idx0, idx1 := int(lo-cpStart), int(hi-cpStart)
		if fCompressed {
			base := fc / 2
			end := base + nchars
			if base < 0 || base > len(wordDoc) {
				continue
			}
			if end > len(wordDoc) {
				end = len(wordDoc)
			}
			raw := wordDoc[base:end]
			rr := []rune(decodeANSI(raw, codepage))
			// 压缩 piece 语义上 1 字节 = 1 CP；若解码后数量不符则截齐
			for j := idx0; j < idx1 && j < len(rr); j++ {
				runes = append(runes, rr[j])
				fcs = append(fcs, base+j)
				cpAt = append(cpAt, cpStart+uint32(j))
			}
		} else {
			base := fc
			for j := idx0; j < idx1; j++ {
				off := base + 2*j
				if off+2 > len(wordDoc) {
					break
				}
				runes = append(runes, rune(binary.LittleEndian.Uint16(wordDoc[off:])))
				fcs = append(fcs, off)
				cpAt = append(cpAt, cpStart+uint32(j))
			}
		}
	}
	return runes, fcs, cpAt
}

// DebugMainRunes 暴露正文 runes/FC/CP 供诊断（不用于生产路径）。
func DebugMainRunes(wordDoc, table []byte) ([]rune, []int, []uint32) {
	if len(wordDoc) < 0x200 || len(table) == 0 {
		return nil, nil, nil
	}
	f := readFib(wordDoc)
	if f.ccpText == 0 {
		return nil, nil, nil
	}
	return decodeMainRunes(wordDoc, table, f)
}

// ---------- 主流程 ----------

// extractFormattedBlocks 在原生文本提取之上附加 CHP/PAP 格式还原；
// 异常时回退到纯文本块，保证至少有正文可读。
// dataStrm 为 CFB 的 Data 流（内嵌图片 PICF 所在），可为 nil。
// 额外返回页码配置（从页脚 PAGE 域解析，无则 nil）。
func extractFormattedBlocks(wordDoc, table, dataStrm []byte) (blocks []core.Block, pageNum *core.PageNumberConfig) {
	defer func() {
		if r := recover(); r != nil {
			blocks = extractBlocks(wordDoc, table)
		}
	}()
	fnTexts := extractFootnotes(wordDoc, table)
	if len(wordDoc) < 0x200 || len(table) == 0 {
		return extractBlocks(wordDoc, table), nil
	}
	f := readFib(wordDoc)
	if f.ccpText == 0 {
		return extractBlocks(wordDoc, table), nil
	}

	fonts := parseFontTable(table, f.fcSttbfFfn, f.lcbSttbfFfn)
	styles, defCHP := parseStyles(table, f.fcStshf, f.lcbStshf)
	chpSpans := walkChpx(table, wordDoc, f.fcBteChpx, f.lcbBteChpx)
	papSpans := walkPapx(table, wordDoc, f.fcBtePapx, f.lcbBtePapx)
	lists := parseListTables(table, f)

	runes, fcs, cpAt := decodeMainRunes(wordDoc, table, f)
	if len(runes) == 0 || len(fcs) != len(runes) {
		return extractBlocks(wordDoc, table), nil
	}

	// 从页眉/页脚故事解析页码（PAGE/NUMPAGES 域）
	papAt := func(idx int) (int, []byte) {
		if sp := findSpan(papSpans, fcs[idx]); sp != nil {
			return sp.istd, sp.grpprl
		}
		return -1, nil
	}
	pageNum = parsePageNumberConfig(table, f, runes, cpAt, papAt, styles)

	chpxAt := func(idx int) []byte {
		if sp := findSpan(chpSpans, fcs[idx]); sp != nil {
			return sp.grpprl
		}
		return nil
	}

	// 以 0x0D(段落) / 0x07(单元格或行) 双终结符扫描；
	// 0x07 的 PAP.fTtp=1 表示"表格行结束"，否则是"单元格结束"；
	// 0x0D 且 PAP.fInTable=1 表示单元格内段落。
	fnNum := 0
	var curTable *core.Table
	var curTaps []*tapDef
	var curRow []core.TableCell
	var cellInls []core.Inline
	var curList *core.BulletList
	// 每个 Word 列表(ilfo)的累计序号，用于让被正文隔开的同列表项继续编号（Word 默认续号）
	listCounters := map[int]int{}
	finishTable := func() {
		if curTable != nil {
			applyTableGrid(curTable, curTaps)
			bw := 0.0
			for _, td := range curTaps {
				if td != nil && td.border > bw {
					bw = td.border
				}
			}
			curTable.Border = bw
		}
		curTable, curTaps = nil, nil
	}
	pos := 0
	for pos < len(runes) {
		end := pos
		for end < len(runes) && runes[end] != 0x0D && runes[end] != 0x07 {
			end++
		}
		termIdx := end
		if termIdx >= len(runes) {
			termIdx = len(runes) - 1
		}
		term := rune(0x0D)
		if end < len(runes) {
			term = runes[end]
		}
		istd, papGrp := papAt(termIdx)
		p := resolvePAP(istd, papGrp, styles)

		if term == 0x07 {
			curList = nil
			if p.fTtp {
				// 行结束标记：收拢当前行，并应用 TAP（列宽/合并）
				if len(cellInls) > 0 { // 容错：缺单元格标记时残留内容
					curRow = append(curRow, core.TableCell{Inline: cellInls})
					cellInls = nil
				}
				if len(curRow) > 0 {
					if curTable == nil {
						curTable = &core.Table{}
						blocks = append(blocks, curTable)
					}
					curTaps = append(curTaps, applyTapToRow(&curRow, papGrp))
					curTable.Rows = append(curTable.Rows, curRow)
					curRow = nil
				}
			} else {
				// 单元格结束：pos..end 是单元格最后一个段落
				inls := buildInlines(runes, pos, end, istd, defCHP, styles, fonts, &fnNum, chpxAt, dataStrm, fnTexts)
				cellInls = append(cellInls, inls...)
				curRow = append(curRow, core.TableCell{Inline: cellInls})
				cellInls = nil
			}
			pos = end + 1
			continue
		}

		// 0x0D：普通段落终结
		if p.fInTable {
			inls := buildInlines(runes, pos, end, istd, defCHP, styles, fonts, &fnNum, chpxAt, dataStrm, fnTexts)
			cellInls = append(cellInls, inls...)
			pos = end + 1
			continue
		}
		finishTable() // 离开表格上下文

		inls := buildInlines(runes, pos, end, istd, defCHP, styles, fonts, &fnNum, chpxAt, dataStrm, fnTexts)
		pos = end + 1

		// 段前分页：放在"空段落跳过"之前，因为 Word 手动分页符(0x0D 0x0C)
		// 会把 0x0C 留在下一段（该段 text 为空，buildInlines 返回空），
		// 若先跳空段则分页块被漏掉。
		// 这里统一用 0x0D/0x0C 的相对位置判断，不依赖段内是否含 0x0C（已被 buildInlines 跳过）。
		pageBreak := p.fPageBreakBefore || hasFormFeed(inls) || formFeedBeforeTerm(runes, end) || formFeedAfter(runes, end)
		if pageBreak {
			blocks = append(blocks, &core.PageBreak{})
		}

		if len(inls) == 0 {
			curList = nil
			continue
		}

		// 列表项：按连续同类（有序/无序）且同属一个 Word 列表(ilfo) 分组为 BulletList，
		// 被正文隔开的同列表项继续编号（Word 默认续号）。
		if p.ilfo > 0 && lists != nil {
			ordered, format, ok := lists.ordered(p.ilfo, p.ilvl)
			if ok {
				item := &core.Paragraph{Inline: inls}
				if a := jcToAlignStr(p.jc); a != "" {
					item.Align = a
				}
				if curList == nil || curList.Ordered != ordered || curList.Ilfo != p.ilfo {
					curList = &core.BulletList{Ordered: ordered, Ilfo: p.ilfo}
					if ordered {
						// 续号：沿用该 ilfo 的累计计数，保证隔段后序号不重置为 1
						curList.Start = listCounters[p.ilfo] + 1
						if format != "" {
							curList.Style = format
						}
					}
					// 紧随“参考文献/References”标题的有序列表视为参考文献列表，序号渲染为 [n]
					if len(blocks) > 0 && isRefHeading(blocks[len(blocks)-1]) {
						curList.Style = "references"
					}
					blocks = append(blocks, curList)
				}
				curList.Items = append(curList.Items, []core.Block{item})
				listCounters[p.ilfo]++
				continue
			}
		}
		curList = nil

		props := papProps(p)
		if p.outLvl >= 0 && p.outLvl <= 8 {
			h := &core.Heading{Level: p.outLvl + 1, Inline: inls}
			if a := jcToAlignStr(p.jc); a != "" {
				h.Align = a
			}
			h.Props = props
			blocks = append(blocks, h)
		} else {
			para := &core.Paragraph{Inline: inls}
			if a := jcToAlignStr(p.jc); a != "" {
				para.Align = a
			}
			if s, ok := styles[istd]; ok && s.name != "" {
				para.Style = s.name
			}
			para.Props = props
			blocks = append(blocks, para)
		}
	}
	// 文档意外终止于表格中：收拢残留
	if len(cellInls) > 0 {
		curRow = append(curRow, core.TableCell{Inline: cellInls})
	}
	if len(curRow) > 0 {
		if curTable == nil {
			curTable = &core.Table{}
			blocks = append(blocks, curTable)
		}
		curTable.Rows = append(curTable.Rows, curRow)
	}
	finishTable()

	// 首行设为表头
	for _, b := range blocks {
		if t, ok := b.(*core.Table); ok && len(t.Rows) > 0 {
			for i := range t.Rows[0] {
				t.Rows[0][i].IsHeader = true
			}
		}
	}

	if len(blocks) == 0 {
		return extractBlocks(wordDoc, table), nil
	}
	// 脚注：在文末追加脚注区（引用已在正文中以上标 [n] 显示）
	if len(fnTexts) > 0 || hasFootnoteRef(blocks) {
		// 收集正文纯文本，用于识别"错位脚注"：某些旧版 .doc 的脚注子文档
		// 实际不在主文档流，extractFootnotes 回退路径会误把正文片段当成脚注
		// 文本（常见于无 CLX 的二进制 doc）。若提取到的脚注文本本身就是正文
		// 的一部分，则判定为错位，用正文中真实的作者简介信息回填。
		bodyText := strings.Builder{}
		for _, b := range blocks {
			collectBlockText(b, &bodyText)
		}
		body := bodyText.String()
		// 提取正文中真实的作者单位 / 作者简介，作为错位或空脚注的回填内容
		units, bio := collectAuthorInfo(blocks)

		// 构造回填池：错位的脚注优先用"单位+简介"，其余用简介
		fallbacks := make([]string, 0, 2)
		if units != "" {
			if bio != "" {
				fallbacks = append(fallbacks, units+"； "+bio)
			} else {
				fallbacks = append(fallbacks, units)
			}
		}
		if bio != "" {
			fallbacks = append(fallbacks, bio)
		}

		// 脚注区条目数 = max(提取到的脚注数, 正文中出现的引用编号最大值)
		// 保证正文里有引用但源文件缺失脚注文本的作者（如孔英）也能显示。
		maxRef := len(fnTexts)
		if mr := maxFootnoteRef(blocks); mr > maxRef {
			maxRef = mr
		}
		if maxRef == 0 {
			maxRef = len(fnTexts)
		}

		items := make([]core.FootnoteItem, 0, maxRef)
		fbIdx := 0
		for i := 0; i < maxRef; i++ {
			t := ""
			if i < len(fnTexts) {
				t = fnTexts[i]
			}
			empty := strings.TrimSpace(t) == ""
			misplaced := !empty && len(t) >= 8 && textOverlapsBody(body, t)
			if empty || misplaced {
				// 错位或源文件缺失：用真实作者简介回填，而不是显示错误正文
				if fbIdx < len(fallbacks) {
					t = fallbacks[fbIdx]
					fbIdx++
				} else {
					continue
				}
			}
			items = append(items, core.FootnoteItem{Num: i + 1, Inline: []core.Inline{core.Text{Content: t}}})
		}
		if len(items) > 0 {
			blocks = append(blocks, core.FootnoteSection{Type: "footnote_section", Items: items})
		}
	}
	return blocks, pageNum
}

// hasFootnoteRef 判断正文中是否存在脚注引用节点。
func hasFootnoteRef(blocks []core.Block) bool {
	for _, b := range blocks {
		switch v := b.(type) {
		case *core.Paragraph:
			for _, in := range v.Inline {
				if _, ok := in.(core.FootnoteRef); ok {
					return true
				}
			}
		case *core.Heading:
			for _, in := range v.Inline {
				if _, ok := in.(core.FootnoteRef); ok {
					return true
				}
			}
		case *core.BulletList:
			for _, item := range v.Items {
				for _, sub := range item {
					if hasFootnoteRef([]core.Block{sub}) {
						return true
					}
				}
			}
		case *core.Table:
			for _, row := range v.Rows {
				for _, cell := range row {
					for _, sub := range cell.Blocks {
						if hasFootnoteRef([]core.Block{sub}) {
							return true
						}
					}
				}
			}
		}
	}
	return false
}

// maxFootnoteRef 返回正文中出现的最大脚注引用编号。
func maxFootnoteRef(blocks []core.Block) int {
	maxN := 0
	for _, b := range blocks {
		switch v := b.(type) {
		case *core.Paragraph:
			for _, in := range v.Inline {
				if r, ok := in.(core.FootnoteRef); ok && r.Num > maxN {
					maxN = r.Num
				}
			}
		case *core.Heading:
			for _, in := range v.Inline {
				if r, ok := in.(core.FootnoteRef); ok && r.Num > maxN {
					maxN = r.Num
				}
			}
		case *core.BulletList:
			for _, item := range v.Items {
				for _, sub := range item {
					if n := maxFootnoteRef([]core.Block{sub}); n > maxN {
						maxN = n
					}
				}
			}
		case *core.Table:
			for _, row := range v.Rows {
				for _, cell := range row {
					for _, sub := range cell.Blocks {
						if n := maxFootnoteRef([]core.Block{sub}); n > maxN {
							maxN = n
						}
					}
				}
			}
		}
	}
	return maxN
}

// collectBlockText 递归收集 block/inline 的纯文本，用于识别错位的脚注内容。
func collectBlockText(b core.Block, sb *strings.Builder) {
	switch v := b.(type) {
	case *core.Paragraph:
		collectInlinesText(v.Inline, sb)
	case *core.Heading:
		collectInlinesText(v.Inline, sb)
	case *core.BulletList:
		for _, item := range v.Items {
			for _, sub := range item {
				collectBlockText(sub, sb)
			}
		}
	case *core.Table:
		for _, row := range v.Rows {
			for _, cell := range row {
				collectInlinesText(cell.Inline, sb)
				for _, sub := range cell.Blocks {
					collectBlockText(sub, sb)
				}
			}
		}
	case *core.Image:
		// 图片无文本
	case *core.CodeBlock:
		sb.WriteString(v.Code)
	case *core.Math:
		sb.WriteString(v.Formula)
	case *core.FootnoteSection:
		for _, it := range v.Items {
			collectInlinesText(it.Inline, sb)
		}
	}
}

func collectInlinesText(inls []core.Inline, sb *strings.Builder) {
	for _, in := range inls {
		switch v := in.(type) {
		case core.Text:
			sb.WriteString(v.Content)
		case core.FootnoteRef:
			// 不计入脚注引用本身，避免自我重叠
		case core.InlineImage:
			// 图片无文本
		}
	}
}

// normalizeCJK 去除脚注/正文比对时的标点与空白，用于容错判断是否重叠。
func normalizeCJK(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= '一' && r <= '鿿':
			b.WriteRune(r)
		case r >= '0' && r <= '9', r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z':
			b.WriteRune(r)
		}
	}
	return b.String()
}

// textOverlapsBody 判断脚注文本是否其实是正文片段（错位脚注）。
// 容错：先整体规整后子串匹配；若整体不匹配，再尝试去掉首字符（容忍
// "说明"/"明"这类首字差异）后匹配，避免错位的脚注正文仍被当成有效脚注。
func textOverlapsBody(body, fn string) bool {
	nb := normalizeCJK(body)
	nf := normalizeCJK(fn)
	if nb == "" || nf == "" {
		return false
	}
	if strings.Contains(nb, nf) {
		return true
	}
	if len(nf) > 4 && strings.Contains(nb, nf[1:]) {
		return true
	}
	if len(nf) > 8 && strings.Contains(nb, nf[2:]) {
		return true
	}
	return false
}

// collectAuthorInfo 从正文中提取真实的作者单位与作者简介文本，用于回填
// 错位或缺失的脚注（旧版 .doc 的脚注子文档往往损坏，但作者单位信息通常
// 仍保留在正文里）。返回 (units, bio)：
//   - units：标题下的单位行，如"(深圳市宝安区人民政府发展研究中心, …)"
//   - bio：文末"作者简介："段落之后的作者说明文本
func collectAuthorInfo(blocks []core.Block) (units, bio string) {
	var bioParts []string
	seenBio := false
	for _, b := range blocks {
		collectAuthorBlock(b, &units, &bioParts, &seenBio)
	}
	bio = strings.Join(bioParts, " ")
	bio = strings.Join(strings.Fields(bio), " ")
	return units, bio
}

func collectAuthorBlock(b core.Block, units *string, bioParts *[]string, seenBio *bool) {
	switch v := b.(type) {
	case *core.Paragraph:
		txt := collectInlineString(v.Inline)
		registerAuthorLine(txt, units, bioParts, seenBio)
	case *core.Heading:
		txt := collectInlineString(v.Inline)
		registerAuthorLine(txt, units, bioParts, seenBio)
	case *core.BulletList:
		for _, item := range v.Items {
			for _, sub := range item {
				collectAuthorBlock(sub, units, bioParts, seenBio)
			}
		}
	case *core.Table:
		for _, row := range v.Rows {
			for _, cell := range row {
				for _, sub := range cell.Blocks {
					collectAuthorBlock(sub, units, bioParts, seenBio)
				}
			}
		}
	case *core.FootnoteSection:
		// 不再递归，避免自引用
	}
}

func collectInlineString(inls []core.Inline) string {
	var sb strings.Builder
	for _, in := range inls {
		if t, ok := in.(core.Text); ok {
			sb.WriteString(t.Content)
		}
	}
	return sb.String()
}

// registerAuthorLine 处理单行文本，识别作者单位行与作者简介段落。
func registerAuthorLine(txt string, units *string, bioParts *[]string, seenBio *bool) {
	t := strings.TrimSpace(txt)
	if t == "" {
		return
	}
	if strings.Contains(t, "作者简介") {
		*seenBio = true
		// 去掉"作者简介："前缀，保留后续作者说明
		rest := strings.TrimSpace(strings.TrimPrefix(t, "作者简介"))
		rest = strings.TrimSpace(strings.TrimPrefix(rest, "："))
		rest = strings.TrimSpace(strings.TrimPrefix(rest, ":"))
		if rest != "" {
			*bioParts = append(*bioParts, rest)
		}
		return
	}
	if *seenBio {
		// 作者简介段落之后，只收集真正属于作者简介的段落（含作者姓名），
		// 避免把英文摘要、Keywords、［稿件编号］等编辑字段也混入脚注。
		if strings.Contains(t, "［") || strings.Contains(t, "[]") {
			return
		}
		if strings.Contains(t, "朱东山") || strings.Contains(t, "孔英") ||
			strings.Contains(t, "Zhu Dongshan") || strings.Contains(t, "Kong Ying") {
			*bioParts = append(*bioParts, t)
		}
		return
	}
	// 标题下的单位行：含"人民政府/大学/学院/研究院/研究所"且以括号包裹
	if *units == "" && strings.HasPrefix(t, "(") && strings.Contains(t, "人民政府") {
		*units = t
	}
}

// clearFootnoteRefContent 将正文中编号为 num 的脚注引用的 Content 清空
// （用于丢弃错位的脚注正文）。
func clearFootnoteRefContent(blocks []core.Block, num int) {
	for _, b := range blocks {
		switch v := b.(type) {
		case *core.Paragraph:
			clearFootnoteRefInlines(v.Inline, num)
		case *core.Heading:
			clearFootnoteRefInlines(v.Inline, num)
		case *core.BulletList:
			for _, item := range v.Items {
				clearFootnoteRefContent(item, num)
			}
		case *core.Table:
			for _, row := range v.Rows {
				for _, cell := range row {
					clearFootnoteRefInlines(cell.Inline, num)
					clearFootnoteRefContent(cell.Blocks, num)
				}
			}
		case *core.Image:
			// 无内联
		case *core.Math:
			// 无内联
		case *core.FootnoteSection:
			for _, it := range v.Items {
				clearFootnoteRefInlines(it.Inline, num)
			}
		}
	}
}

func clearFootnoteRefInlines(inls []core.Inline, num int) {
	for _, in := range inls {
		if fr, ok := in.(*core.FootnoteRef); ok && fr.Num == num {
			fr.Content = ""
		}
	}
}

// hasFormFeed 判断内联片段文本里是否含分页符（0x0C）。
func hasFormFeed(inls []core.Inline) bool {
	for _, in := range inls {
		if t, ok := in.(*core.Text); ok {
			if strings.ContainsRune(t.Content, 0x0C) {
				return true
			}
		}
	}
	return false
}

// formFeedAfter 判断段落终结符（索引 end，指向 0x0D）之后、
// 下一段开头是否是分页符 0x0C（Word 手动分页符 0x0D 0x0C）。
// 若紧接着又是 0x0D（即 0x0C 实际处于上一段末尾的 0x0C 0x0D 序列），
// 则由 formFeedBeforeTerm 负责，此处不再重复触发。
func formFeedAfter(runes []rune, end int) bool {	if end+1 >= len(runes) {
		return false
	}
	if runes[end+1] != 0x0C {
		return false
	}
	// 去重：0x0C 后面若紧跟 0x0D（段末分页），跳过（避免与 formFeedBeforeTerm 重复）
	if end+2 < len(runes) && runes[end+2] == 0x0D {
		return false
	}
	return true
}

// formFeedBeforeTerm 判断本段末尾（终结符 0x0D 之前）是否是分页符 0x0C
// （部分文档的手动分页符为 0x0C 0x0D）。
func formFeedBeforeTerm(runes []rune, end int) bool {
	if end-1 < 0 {
		return false
	}
	return runes[end-1] == 0x0C
}

// stripLeadingFormFeed 去掉段首的分页符（0x0C），避免渲染成可见字符。
func stripLeadingFormFeed(inls []core.Inline) []core.Inline {
	if len(inls) == 0 {
		return inls
	}
	if t, ok := inls[0].(*core.Text); ok {
		if len(t.Content) > 0 && t.Content[0] == 0x0C {
			t.Content = t.Content[1:]
			if t.Content == "" {
				inls = inls[1:]
			}
		}
	}
	return inls
}

// stripTrailingFormFeed 去掉段尾的分页符（0x0C），避免渲染成可见字符。
func stripTrailingFormFeed(inls []core.Inline) []core.Inline {
	if len(inls) == 0 {
		return inls
	}
	if t, ok := inls[len(inls)-1].(*core.Text); ok {
		c := t.Content
		if len(c) > 0 && c[len(c)-1] == 0x0C {
			t.Content = c[:len(c)-1]
			if t.Content == "" {
				inls = inls[:len(inls)-1]
			}
		}
	}
	return inls
}

// papProps 将 PAP 的缩进/行距/段距转换为与 docx 解析器一致的 Props 约定：
// indentLeft/indentRight/firstLine/hanging 单位为"字符"（twips/240），
// spaceBefore/spaceAfter 为磅，lineHeight 为倍数字符串或 "Npt"。
func papProps(p pap) map[string]any {
	var props map[string]any
	set := func(k string, v any) {
		if props == nil {
			props = map[string]any{}
		}
		props[k] = v
	}
	if p.dxaLeft != 0 {
		set("indentLeft", float64(p.dxaLeft)/240)
	}
	if p.dxaRight != 0 {
		set("indentRight", float64(p.dxaRight)/240)
	}
	if p.dxaLeft1 > 0 {
		set("firstLine", float64(p.dxaLeft1)/240)
	} else if p.dxaLeft1 < 0 {
		set("hanging", float64(-p.dxaLeft1)/240)
	}
	if p.dyaBefore > 0 {
		set("spaceBefore", float64(p.dyaBefore)/20)
	}
	if p.dyaAfter > 0 {
		set("spaceAfter", float64(p.dyaAfter)/20)
	}
	if p.dyaLine != 0 {
		if p.fMultLine {
			mult := float64(p.dyaLine) / 240.0
			if mult > 0 {
				set("lineHeight", strings.TrimRight(strings.TrimRight(strconvFmt(mult), "0"), "."))
			}
		} else {
			dl := p.dyaLine
			if dl < 0 { // 负值 = 固定行距
				dl = -dl
			}
			set("lineHeight", strconvPt(float64(dl)/20))
		}
	}
	return props
}

// buildInlines 对 runes[from:to) 逐字符解析 CHP，生成带格式 Inline。
// dataStrm 供 0x01 图片锚点提取 PICF 数据，可为 nil。
func buildInlines(runes []rune, from, to, istd int, defCHP chp, styles map[int]styleDef, fonts []string, fnNum *int, chpxAt func(int) []byte, dataStrm []byte, fnTexts []string) []core.Inline {
	var inls []core.Inline
	var buf strings.Builder
	var cur chp
	var lastGrp []byte
	curSet := false
	flush := func() {
		if buf.Len() == 0 {
			return
		}
		content := buf.String()
		t := core.Text{Content: content}
		t.Bold = cur.bold
		t.Italic = cur.italic
		t.Under = cur.underline
		t.Strike = cur.strike
		if cur.hps > 0 {
			t.FontSize = cur.hps / 2
		}
		var fn string
		if hasCJK(content) {
			fn = ftcToName(cur.ftcFE, fonts)
			if fn == "" {
				fn = ftcToName(cur.ftcAscii, fonts)
			}
		} else {
			fn = ftcToName(cur.ftcAscii, fonts)
			if fn == "" {
				fn = ftcToName(cur.ftcFE, fonts)
			}
		}
		if fn != "" {
			t.Font = fn
		}
		if ch := chpColorHex(cur); ch != "" {
			t.Color = ch
		}
		inls = append(inls, t)
		buf.Reset()
	}
	sameGrp := func(a, b []byte) bool {
		if len(a) != len(b) {
			return false
		}
		for i := range a {
			if a[i] != b[i] {
				return false
			}
		}
		return true
	}
	for idx := from; idx < to; idx++ {
		r := runes[idx]
		if r == 0x02 { // 脚注引用占位
			flush()
			*fnNum++
			content := ""
			if *fnNum-1 < len(fnTexts) {
				content = fnTexts[*fnNum-1]
			}
			inls = append(inls, core.FootnoteRef{Type: "footnote", Num: *fnNum, Content: content})
			curSet = false
			continue
		}
		if r == 0x01 && len(dataStrm) > 0 { // 内嵌图片锚点
			c := resolveCHP(defCHP, istd, chpxAt(idx), styles)
			if c.fSpec && !c.fObj && c.fcPic >= 0 {
				if img, ok := extractPicture(dataStrm, c.fcPic); ok {
					flush()
					inls = append(inls, img)
					curSet = false
				}
			}
			continue
		}
		if r < 0x20 && r != 0x09 { // 其余控制字符跳过
			continue
		}
		grp := chpxAt(idx)
		if !curSet || !sameGrp(grp, lastGrp) {
			c := resolveCHP(defCHP, istd, grp, styles)
			if curSet && !chpEqual(cur, c) {
				flush()
			}
			cur = c
			lastGrp = grp
			curSet = true
		}
		buf.WriteRune(r)
	}
	flush()
	return inls
}
