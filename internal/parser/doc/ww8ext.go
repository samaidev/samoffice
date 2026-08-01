package doc

// 本文件对照 LibreOffice ww8 导入过滤器（sw/source/filter/ww8）的语义，
// 用 Go 原生实现 .doc 的三块进阶解析：
//   1. TAP（sprmTDefTable）：表格列宽、水平/垂直合并单元格；
//   2. PICF（Data 流）：内嵌图片提取为 data URI；
//   3. PlfLst/PlfLfo：列表定义（有序/无序判定）。
// 参考 [MS-DOC] 2.6.3（表 sprm）、2.9.191（PICF）、2.9.132/2.9.138（LSTF/LVLF）。

import (
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"strings"

	"github.com/zai/samoffice/internal/core"
)

func strconvFmt(v float64) string { return fmt.Sprintf("%.2f", v) }
func strconvPt(v float64) string  { return fmt.Sprintf("%.0fpt", v) }

// ---------- 表格 TAP ----------

// tapDef 是 sprmTDefTable(0xD608) 解析结果：一行的列宽与合并标记。
type tapDef struct {
	widths []int // 每格宽度（twips）
	hmerge []int // 0=不合并 1=水平合并起点 2/3=被合并（并入前格）
	vmerge []int // 0=不合并 1=垂直被合并（占位） 3=垂直合并起点
	border float64 // 表格边框线宽（pt），<=0 表示无
}

// parseTAP 从表格行结束段（TTP）的 grpprl 中解析 sprmTDefTable。
// TDefTableOperand：cb(2) + itcMac(1) + rgdxaCenter[(itcMac+1)*2] + rgTc80[itcMac*20]。
// TC80.tcgrf：bit0-1=horzMerge，bit5-6=vertMerge。
func parseTAP(grp []byte) *tapDef {
	var td *tapDef
	iterSprms(grp, func(s uint16, op []byte) {
		if s != 0xD608 || len(op) < 3 {
			return
		}
		d := op[2:] // 跳过 cb 前缀
		itc := int(d[0])
		if itc < 1 || itc > 63 {
			return
		}
		hdr := 1 + 2*(itc+1)
		if len(d) < hdr {
			return
		}
		bounds := make([]int, itc+1)
		for i := 0; i <= itc; i++ {
			bounds[i] = int(int16(binary.LittleEndian.Uint16(d[1+2*i:])))
		}
		t := &tapDef{
			widths: make([]int, itc),
			hmerge: make([]int, itc),
			vmerge: make([]int, itc),
		}
		for i := 0; i < itc; i++ {
			t.widths[i] = bounds[i+1] - bounds[i]
		}
		for i := 0; i < itc; i++ {
			off := hdr + i*20
			if off+2 > len(d) {
				break // TC80 数组可被截断，缺省视为不合并
			}
			tcgrf := binary.LittleEndian.Uint16(d[off:])
			t.hmerge[i] = int(tcgrf & 3)
			t.vmerge[i] = int((tcgrf >> 5) & 3)
		}
		td = t
	})
	return td
}

// applyTapToRow 将行 TAP 应用到当前行并返回（供表级网格推导用）：
//   - 垂直合并：把每格的 vmerge 状态（0/1/3）暂存到 cell.VMerge，由 applyTableGrid
//     统一计算 RowSpan 并删除占位格（这里不就地处理，因为需跨行信息）；
//   - 显式水平合并（TC80 horzMerge）：延续格并入起点格并同步合并宽度；
//   - 解析表格边框线宽（sprmTTableBorders 0xD620）。
func applyTapToRow(row *[]core.TableCell, ttpGrp []byte) *tapDef {
	td := parseTAP(ttpGrp)
	if td == nil {
		return nil
	}
	cells := *row
	for i := range cells {
		if i < len(td.vmerge) {
			cells[i].VMerge = td.vmerge[i] // 0=不合并 1=占位 3=起点
		}
	}
	if w, ok := scanTableBorder(ttpGrp); ok {
		td.border = w
	}
	// 显式水平合并：TC80 horzMerge 1=起点，2/3=延续（并入前格后删除）
	out := cells[:0:0]
	var widths []int
	for i, c := range cells {
		hm, w := 0, 0
		if i < len(td.hmerge) {
			hm = td.hmerge[i]
		}
		if i < len(td.widths) {
			w = td.widths[i]
		}
		if hm >= 2 && len(out) > 0 {
			out[len(out)-1].ColSpan = 0 // 交由网格推导重算
			widths[len(widths)-1] += w
			continue
		}
		out = append(out, c)
		widths = append(widths, w)
	}
	td.widths = widths
	*row = out
	return td
}

// applyTableGrid 对整表做网格推导（对照 LibreOffice ww8 的做法）：
// 各行列边界取并集构成全局网格，Table.Width 写入网格列宽百分比，
// 跨多个网格区间的单元格记 ColSpan。这样能还原
// "各行边界不一致"式的水平合并（Word/LibreOffice 常用表示）。
func applyTableGrid(tbl *core.Table, taps []*tapDef) {
	if tbl == nil || len(taps) == 0 {
		return
	}
	// 1. 边界并集
	set := map[int]struct{}{0: {}}
	for _, td := range taps {
		if td == nil {
			continue
		}
		b := 0
		for _, w := range td.widths {
			b += w
			set[b] = struct{}{}
		}
	}
	grid := make([]int, 0, len(set))
	for b := range set {
		grid = append(grid, b)
	}
	sortInts(grid)
	if len(grid) < 2 {
		return
	}
	total := grid[len(grid)-1] - grid[0]
	if total <= 0 {
		return
	}
	tbl.Width = tbl.Width[:0]
	for i := 1; i < len(grid); i++ {
		tbl.Width = append(tbl.Width, float64(grid[i]-grid[i-1])*100/float64(total))
	}
	// 2. 每格按覆盖的网格区间数计算 ColSpan
	for r, td := range taps {
		if td == nil || r >= len(tbl.Rows) {
			continue
		}
		cells := tbl.Rows[r]
		b := 0
		for i := range cells {
			if i >= len(td.widths) {
				break
			}
			span := gridIntervals(grid, b, b+td.widths[i])
			if span > 1 {
				cells[i].ColSpan = span
			}
			b += td.widths[i]
		}
	}
	// 3. 垂直合并：起点格(VMerge==3)向下吞并连续占位格(VMerge==1)
	for r := 0; r < len(tbl.Rows); r++ {
		for j := 0; j < len(tbl.Rows[r]); j++ {
			c := &tbl.Rows[r][j]
			if c.VMerge != 3 {
				continue
			}
			span := 1
			for rr := r + 1; rr < len(tbl.Rows); rr++ {
				if j < len(tbl.Rows[rr]) && tbl.Rows[rr][j].VMerge == 1 {
					span++
					tbl.Rows[rr][j].VMerge = -1 // 标记删除
				} else {
					break
				}
			}
			if span > 1 {
				c.RowSpan = span
			}
		}
	}
	// 4. 删除占位格，并清掉临时 VMerge 标记；整行被上方 rowspan 覆盖则删除该行，
	//    否则会产出没有任何单元格的空 table_row，导致前端 ProseMirror 校验失败。
	out := make([][]core.TableCell, 0, len(tbl.Rows))
	for r := range tbl.Rows {
		cleaned := make([]core.TableCell, 0, len(tbl.Rows[r]))
		for _, c := range tbl.Rows[r] {
			if c.VMerge == -1 {
				continue
			}
			c.VMerge = 0
			cleaned = append(cleaned, c)
		}
		if len(cleaned) == 0 {
			continue // 整行被上方 rowspan 覆盖，无需保留
		}
		out = append(out, cleaned)
	}
	tbl.Rows = out
}

// scanTableBorder 从表格行 grpprl 中解析 sprmTTableBorders(0xD620) 的边框线宽（pt）。
// 取四条边（上/左/下/右）与两条内边（横/纵）中的最大线宽。无边框 sprm 时返回 ok=false。
func scanTableBorder(grp []byte) (float64, bool) {
	var maxW float64
	ok := false
	iterSprms(grp, func(s uint16, op []byte) {
		if s != 0xD620 {
			return
		}
		// 变长 sprm：op[0] 为 cb（BRC 数据长度），真实数据从 op[1] 开始
		data := op
		if len(op) > 1 && int(op[0]) == len(op)-1 {
			data = op[1:]
		}
		if w, got := parseBRCWidth(data); got && w > maxW {
			maxW = w
			ok = true
		}
	})
	return maxW, ok
}

// parseBRCWidth 解析一组 BRC（Word 边框描述）。现代文档每 BRC 8 字节、旧文档 4 字节。
// 仅取前 6 条边（上/左/下/右/内横/内纵），返回其中的最大线宽（pt，1pt = 8 个 1/8 pt 单位）。
func parseBRCWidth(data []byte) (float64, bool) {
	var step int
	switch {
	case len(data) >= 80:
		step = 8
	case len(data) >= 40:
		step = 4
	default:
		return 0, false
	}
	maxW := 0.0
	got := false
	for k := 0; k < 6 && k*step+2 <= len(data); k++ {
		off := k * step
		dpt := binary.LittleEndian.Uint16(data[off : off+2])
		var typ uint16
		if step == 8 {
			typ = binary.LittleEndian.Uint16(data[off+2 : off+4])
		} else {
			typ = uint16(data[off+2])
		}
		if typ == 0 || dpt == 0 {
			continue
		}
		w := float64(dpt) / 8.0
		if w < 0.25 {
			w = 0.25
		}
		if w > maxW {
			maxW = w
		}
		got = true
	}
	if !got {
		return 0, false
	}
	return maxW, true
}

func gridIntervals(grid []int, lo, hi int) int {
	n := 0
	for i := 1; i < len(grid); i++ {
		if grid[i-1] >= lo && grid[i] <= hi {
			n++
		}
	}
	if n < 1 {
		n = 1
	}
	return n
}

func sortInts(a []int) {
	for i := 1; i < len(a); i++ {
		for j := i; j > 0 && a[j] < a[j-1]; j-- {
			a[j], a[j-1] = a[j-1], a[j]
		}
	}
}

// ---------- 内嵌图片 PICF ----------

// extractPicture 按 [MS-DOC] PICF 结构从 Data 流提取图片：
// lcb(4) cbHeader(2) mfpf(8) innerHeader(14) picmid: dxaGoal(2) dyaGoal(2) mx(2) my(2)...
// 图片载荷位于 [fc+cbHeader, fc+lcb)。现代 .doc 中载荷通常是 OfficeArt
// 容器包裹的 PNG/JPEG blip，这里直接按魔数定位（浏览器/解码器容忍尾部冗余）。
func extractPicture(data []byte, fc int) (core.InlineImage, bool) {
	var img core.InlineImage
	if fc < 0 || fc+68 > len(data) {
		return img, false
	}
	lcb := int(int32(binary.LittleEndian.Uint32(data[fc:])))
	cbHeader := int(binary.LittleEndian.Uint16(data[fc+4:]))
	if cbHeader < 44 || lcb <= cbHeader || fc+lcb > len(data) {
		return img, false
	}
	dxaGoal := int(int16(binary.LittleEndian.Uint16(data[fc+28:])))
	dyaGoal := int(int16(binary.LittleEndian.Uint16(data[fc+30:])))
	mx := int(binary.LittleEndian.Uint16(data[fc+32:]))
	my := int(binary.LittleEndian.Uint16(data[fc+34:]))
	payload := data[fc+cbHeader : fc+lcb]
	mime, off := findImageMagic(payload)
	if mime == "" {
		return img, false // WMF/EMF 等浏览器不可显示的格式暂不提取
	}
	img.Src = "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(payload[off:])
	if mx == 0 {
		mx = 1000
	}
	if my == 0 {
		my = 1000
	}
	if dxaGoal > 0 {
		img.Width = float64(dxaGoal) / 20 * float64(mx) / 1000 // pt
	}
	if dyaGoal > 0 {
		img.Height = float64(dyaGoal) / 20 * float64(my) / 1000
	}
	return img, true
}

func findImageMagic(b []byte) (string, int) {
	for i := 0; i+8 <= len(b); i++ {
		switch {
		case b[i] == 0x89 && b[i+1] == 'P' && b[i+2] == 'N' && b[i+3] == 'G':
			return "image/png", i
		case b[i] == 0xFF && b[i+1] == 0xD8 && b[i+2] == 0xFF:
			return "image/jpeg", i
		case b[i] == 'G' && b[i+1] == 'I' && b[i+2] == 'F' && b[i+3] == '8':
			return "image/gif", i
		}
	}
	return "", 0
}

// ---------- 列表 PlfLst / PlfLfo ----------

// listTables 保存列表定义：ilfo → lsid → 各层 nfc（编号格式，23=项目符号）。
type listTables struct {
	lfoLsid []int32          // 下标 = ilfo-1
	nfc     map[int32][9]int // lsid → 每级 nfc；-1 未知
}

// nfcToStyle 将 Word 编号格式码(nfc)映射为 CSS list-style-type，
// 使预览中的列表序号与 Word 保持一致（如中文“一、二、三”）。
func nfcToStyle(n int) string {
	switch n {
	case 0:
		return "decimal"
	case 1:
		return "upper-roman"
	case 2:
		return "lower-roman"
	case 3:
		return "upper-alpha"
	case 4:
		return "lower-alpha"
	case 22, 24, 37: // 中文序号（一、二、三 / 壹贰叁）
		return "cjk-ideographic"
	default:
		return "decimal"
	}
}

// ordered 判定 (ilfo, ilvl) 对应的列表是否有序，并返回其编号格式（CSS list-style-type）。
// 第二返回值 format 仅在有序且可判定时有效；第三返回值表示是否可判定。
func (lt *listTables) ordered(ilfo, ilvl int) (ordered bool, format string, ok bool) {
	if lt == nil || ilfo < 1 || ilfo > len(lt.lfoLsid) {
		return false, "", false
	}
	lvls, ok := lt.nfc[lt.lfoLsid[ilfo-1]]
	if !ok {
		return false, "", false
	}
	if ilvl < 0 || ilvl > 8 {
		ilvl = 0
	}
	n := lvls[ilvl]
	if n < 0 {
		return false, "", false
	}
	if n == 23 {
		return false, "", true // nfc 23 = bullet（无序）
	}
	return true, nfcToStyle(n), true
}

// parseListTables 解析 PlfLst（cLst + LSTF[]，其后紧跟各列表的 LVL 数组，
// 注意 LVL 不计入 lcbPlfLst）与 PlfLfo（lfoMac + LFO[]）。
func parseListTables(table []byte, f fibOff) *listTables {
	if f.lcbPlfLst == 0 || f.lcbPlfLfo == 0 {
		return nil
	}
	if int(f.fcPlfLst) >= len(table) || int(f.fcPlfLfo)+int(f.lcbPlfLfo) > len(table) {
		return nil
	}
	lt := &listTables{nfc: map[int32][9]int{}}

	// ---- PlfLst + LVL 数组 ----
	p := table[f.fcPlfLst:]
	if len(p) < 2 {
		return nil
	}
	cLst := int(binary.LittleEndian.Uint16(p))
	if cLst <= 0 || cLst > 2048 || 2+28*cLst > len(p) {
		return nil
	}
	type lstEnt struct {
		lsid   int32
		simple bool
	}
	ents := make([]lstEnt, 0, cLst)
	for i := 0; i < cLst; i++ {
		off := 2 + 28*i // LSTF 28 字节：lsid(4) tplc(4) rgistdPara(18) flags(1) grfhic(1)
		ents = append(ents, lstEnt{
			lsid:   int32(binary.LittleEndian.Uint32(p[off:])),
			simple: p[off+26]&1 != 0, // fSimpleList
		})
	}
	pos := 2 + 28*cLst
	for _, e := range ents {
		nl := 9
		if e.simple {
			nl = 1
		}
		var lv [9]int
		for i := range lv {
			lv[i] = -1
		}
		truncated := false
		for l := 0; l < nl; l++ {
			// LVLF 28 字节：iStartAt(4) nfc(1) info(1) rgbxchNums(9) ixchFollow(1)
			//              dxaIndentSav(4) unused(4) cbGrpprlChpx(1) cbGrpprlPapx(1)
			//              ilvlRestartLim(1) grfhic(1)
			if pos+28 > len(p) {
				truncated = true
				break
			}
			nfc := int(p[pos+4])
			cbChpx := int(p[pos+24])
			cbPapx := int(p[pos+25])
			pos += 28 + cbPapx + cbChpx
			if pos+2 > len(p) {
				truncated = true
				break
			}
			cch := int(binary.LittleEndian.Uint16(p[pos:])) // xst：编号文本
			pos += 2 + cch*2
			if l < 9 {
				lv[l] = nfc
			}
		}
		if e.simple { // 单层列表：各层沿用第 0 层
			for i := 1; i < 9; i++ {
				lv[i] = lv[0]
			}
		}
		lt.nfc[e.lsid] = lv
		if truncated {
			break
		}
	}

	// ---- PlfLfo ----
	q := table[f.fcPlfLfo : f.fcPlfLfo+f.lcbPlfLfo]
	if len(q) < 4 {
		return lt
	}
	lfoMac := int(binary.LittleEndian.Uint32(q))
	if lfoMac < 0 || 4+16*lfoMac > len(q) {
		lfoMac = (len(q) - 4) / 16
	}
	for i := 0; i < lfoMac; i++ {
		// LFO 16 字节：lsid(4) unused(8) clfolvl(1) ibstFltAutoNum(1) grfhic(1) unused(1)
		lt.lfoLsid = append(lt.lfoLsid, int32(binary.LittleEndian.Uint32(q[4+16*i:])))
	}
	return lt
}

// ---------- 页码（页眉/页脚中的 PAGE 域） ----------

// hsed 是 PlcfHdd 中的一条页眉/页脚故事描述（含 CP 区间与类型）。
type hsed struct {
	cpStart, cpEnd uint32
	cls            uint8 // 0=正文 1=偶数页眉 2=奇数页眉 3=首页眉 4=偶数页脚 5=奇数页脚 6=首页脚
}

// parsePlcfHdd 从 Table 流的 PlcfHdd 解出所有页眉/页脚故事描述。
func parsePlcfHdd(table []byte, fc, lcb uint32) []hsed {
	if lcb < 16 || int(fc)+int(lcb) > len(table) {
		return nil
	}
	b := table[fc : fc+lcb]
	n := (len(b) - 4) / 12 // 每个故事 1 个 CP + 1 个 Hsed(8B)
	if n < 1 {
		return nil
	}
	aCP := make([]uint32, n+1)
	for k := 0; k <= n; k++ {
		aCP[k] = binary.LittleEndian.Uint32(b[4*k:])
	}
	var out []hsed
	for k := 0; k < n; k++ {
		off := 4*(n+1) + 8*k
		if off+8 > len(b) {
			break
		}
		out = append(out, hsed{
			cpStart: aCP[k],
			cpEnd:   aCP[k+1],
			cls:     b[off+4],
		})
	}
	return out
}

// runeRangeForCP 把 [cpStart,cpEnd) 映射到 runes 子串 [lo,hi)。
func runeRangeForCP(cpAt []uint32, runes []rune, cpStart, cpEnd uint32) (int, int) {
	lo, hi := -1, -1
	for i, cp := range cpAt {
		if cp >= cpStart && lo < 0 {
			lo = i
		}
		if cp >= cpEnd {
			hi = i
			break
		}
	}
	if lo < 0 {
		return -1, -1
	}
	if hi < 0 {
		hi = len(runes)
	}
	return lo, hi
}

// buildPageFormat 扫描一段页脚 rune，识别 PAGE/NUMPAGES 域，
// 返回格式化模板（{n}=当前页，{total}=总页数）与模板是否含 PAGE 域。
func buildPageFormat(rs []rune) (string, bool) {
	var sb strings.Builder
	has := false
	inField := false
	var instr []rune
	for i := 0; i < len(rs); i++ {
		c := rs[i]
		switch c {
		case 0x13: // 域开始
			inField = true
			instr = instr[:0]
		case 0x14: // 域分隔（指令→结果）
			t := strings.ToUpper(string(instr))
			if strings.Contains(t, "NUMPAGES") {
				sb.WriteString("{total}")
			} else if strings.Contains(t, "PAGE") {
				sb.WriteString("{n}")
				has = true
			} else {
				sb.WriteString("«") // 其它域：占位，避免吞掉上下文
			}
			inField = false
		case 0x15: // 域结束
			inField = false
		default:
			if inField {
				instr = append(instr, c)
			} else if c != 0x07 && c != 0x0B && c != 0x0C {
				// 0x0D 段标记作换行；其它控制字符丢弃
				sb.WriteRune(c)
			}
		}
	}
	return sb.String(), has
}

// parsePageNumberConfig 从页眉/页脚故事里提取页码格式。
// papAt 传入可定位页脚段落的 PAP（取对齐方式）；不支持时传 nil。
func parsePageNumberConfig(table []byte, f fibOff, runes []rune, cpAt []uint32,
	papAt func(int) (int, []byte), styles map[int]styleDef) *core.PageNumberConfig {
	if f.lcbPlcfHdd == 0 {
		return nil
	}
	stories := parsePlcfHdd(table, f.fcPlcfHdd, f.lcbPlcfHdd)
	if len(stories) == 0 {
		return nil
	}
	// 优先页脚（奇数页脚/偶数页脚/首页脚），其次所有故事兜底
	prefer := func(cls uint8) bool { return cls == 5 || cls == 4 || cls == 6 }
	for _, pass := range []bool{true, false} {
		for _, s := range stories {
			if pass && !prefer(s.cls) {
				continue
			}
			if !pass && prefer(s.cls) {
				continue
			}
			lo, hi := runeRangeForCP(cpAt, runes, s.cpStart, s.cpEnd)
			if lo < 0 || hi <= lo {
				continue
			}
			seg := runes[lo:hi]
			// 去掉段落分隔后的尾随空段，至多保留一个换行
			fmtStr, has := buildPageFormat(seg)
			if !has {
				continue
			}
			fmtStr = strings.TrimSpace(fmtStr)
			if fmtStr == "" {
				fmtStr = "{n}"
			}
			align := "center"
			if papAt != nil && lo < len(runes) {
				istd, grp := papAt(lo)
				p := resolvePAP(istd, grp, styles)
				if a := jcToAlignStr(p.jc); a != "" {
					align = a
				}
			}
			return &core.PageNumberConfig{Format: fmtStr, Align: align}
		}
	}
	return nil
}
