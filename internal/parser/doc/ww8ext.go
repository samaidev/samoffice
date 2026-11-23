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

// brcCell 是 TC80 内一条边框（BRC）的解码：on=false 表示该边无框。
type brcCell struct {
	on  bool
	dpt float64 // 线宽（pt）
}

// tapDef 是 sprmTDefTable(0xD608) 解析结果：一行的列宽/合并标记/逐格边框。
type tapDef struct {
	widths []int // 每格宽度（twips）
	hmerge []int // 0=不合并 1=水平合并起点 2/3=被合并（并入前格）
	vmerge []int // 0=不合并 1=垂直被合并（占位） 2/3=垂直合并起点
	border float64 // 表格边框线宽（pt），<=0 表示无
	brds [][]brcCell // 每格四边（上/左/下/右）边框，TC80 rgTc80 解码
	hasBrd bool // 本行 TC80 携带边框信息（全无线也 true —— 显式无框）
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
			// TC80：tcgrf(2) + wWidth(2) + BRC×4（上/左/下/右，各 4 字节）。
			// BRC 首 u16：低字节 = 线宽（1/8 pt），高字节 = 线型；0 与 0xFFFF 均为无框
			//（round56 实测用户 .doc 三线表：0x0112=2.25pt 单线、0x0104=0.5pt 单线、
			// 0xFFFF=无）。全零四边也是有效信息（显式无框表）—— hasBrd=true。
			if off+20 <= len(d) {
				bs := make([]brcCell, 4)
				anyOn := false
				for k := 0; k < 4; k++ {
					code := binary.LittleEndian.Uint16(d[off+4+4*k:])
					if code != 0 && code != 0xFFFF {
						bs[k] = brcCell{on: true, dpt: float64(code&0xFF) / 8}
						anyOn = true
					}
				}
				t.brds = append(t.brds, bs)
				t.hasBrd = true
				_ = anyOn
			} else {
				t.brds = append(t.brds, nil)
			}
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
			cells[i].VMerge = td.vmerge[i] // 0=不合并 1=占位 2/3=起点
		}
		// round56：TC80 逐格边框 → 前端四边开关串（上/右/下/左）+ 线宽/线色。
		// 对照 MS Office：.doc 单元格边框 auto 色 = 黑；此前完全忽略 TC80 BRC，
		// 三线表被渲染成默认全网格（用户报告与 MS 有差别）。
		if td.hasBrd && i < len(td.brds) && td.brds[i] != nil {
			bs := td.brds[i] // 上/左/下/右
			cells[i].Borders = encodeCorners(bs[0], bs[3], bs[2], bs[1]) // 上/右/下/左
			maxW := 0.0
			for _, b := range bs {
				if b.on && b.dpt > maxW {
					maxW = b.dpt
				}
			}
			if maxW > 0 {
				cells[i].BorderW = maxW
				cells[i].BorderColor = "000000" // auto = 黑
			}
		}
	}
	if w, ok := scanTableBorder(ttpGrp); ok {
		td.border = w
	}
	// 显式水平合并：TC80 horzMerge 1=起点，2/3=延续（并入前格后删除）
	out := cells[:0:0]
	var widths []int
	var vmerges []int
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
		if i < len(td.vmerge) {
			vmerges = append(vmerges, td.vmerge[i])
		} else {
			vmerges = append(vmerges, 0)
		}
	}
	td.widths = widths
	td.vmerge = vmerges // 与折叠后的格序列对齐（供 applyTableGrid 垂直合并）
	*row = out
	return td
}

// encodeCorners 编码四边开关串（上/右/下/左，'1'=有线 '0'=无线）。
func encodeCorners(top, right, bottom, left brcCell) string {
	b2i := func(b brcCell) byte {
		if b.on {
			return '1'
		}
		return '0'
	}
	return string([]byte{b2i(top), b2i(right), b2i(bottom), b2i(left)})
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
	// 3. 垂直合并（vMerge）：真合并（round56，对齐 MS Office 显示）。
	// 起点（VMerge>=2，实测 0x60=2 与 0xE0=3 均为起点）向下吞并 VMerge==1
	// 延续格：起点格 RowSpan=n，延续格从所在行【物理删除】（仅删格不删行）。
	// 前端 rowspan 语义即如此（prosemirror 表格形状）；此前实现是『占位格清空
	// 内容、保留网格』—— MS Office 里合并区是整块大单元格，无内部空行/边框，
	// 用户报告表格样式与 MS 有差别。旧版曾删【整行】导致行内其余格丢失——
	// 本实现只删被覆盖的格，行内其他格保留（列位由行内格序列顺序决定，
	// table-layout 语义下行首格=第一列，删除延续格后列位恰好前移补位）。
	// 两阶段（先算后删，避免删除导致列位漂移串列）：
	// 阶段1 只读扫描每个起点格的连续延续行数；阶段2 统一从覆盖行删除格。
	type spanMark struct{ r, j, span int }
	var marks []spanMark
	remove := map[int][]int{} // 行 → 待删格序号
	for r := 0; r < len(tbl.Rows); r++ {
		for j := 0; j < len(tbl.Rows[r]); j++ {
			if tbl.Rows[r][j].VMerge < 2 {
				continue // 非起点
			}
			span := 1
			for rr := r + 1; rr < len(tbl.Rows); rr++ {
				if j >= len(tbl.Rows[rr]) || tbl.Rows[rr][j].VMerge != 1 {
					break
				}
				span++
			}
			if span > 1 {
				marks = append(marks, spanMark{r, j, span})
				for k := r + 1; k < r+span; k++ {
					remove[k] = append(remove[k], j)
				}
			}
		}
	}
	for _, m := range marks {
		tbl.Rows[m.r][m.j].RowSpan = m.span
	}
	// 阶段2：每行按序号降序删除（降序保证低序号格位不受移位影响）
	for k, js := range remove {
		sortInts(js)
		for x := len(js) - 1; x >= 0; x-- {
			j := js[x]
			if j < len(tbl.Rows[k]) {
				tbl.Rows[k] = append(tbl.Rows[k][:j:j], tbl.Rows[k][j+1:]...)
			}
		}
	}
	// 残余延续格（无起点的孤儿，容错）：清空内容保留网格
	for r := range tbl.Rows {
		for j := range tbl.Rows[r] {
			c := &tbl.Rows[r][j]
			if c.VMerge == 1 {
				c.Inline = nil
			}
			c.VMerge = 0
		}
	}
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
	// payload 起点必须用 PICF 自带的 cbHeader（44/68 均存在；Word 内嵌 OLE 对象如
	// MathType/Equation 公式图常见 68），不能写死 44 —— 否则从头中间读起，
	// 魔数永远匹配不到，图片被静默丢弃。
	payload := data[fc+cbHeader : fc+lcb]
	mime, off := findImageMagic(payload)
	if mime == "" {
		// WMF/EMF 矢量图（MathType/Equation 公式对象、旧图表等）：浏览器不可直接显示。
		// 保底输出 1px 透明 PNG 占位 + 实测尺寸，前端按占位图渲染出
		// 正确大小的图文框（比静默丢弃好 —— 至少保留版式空间且内容位置可见）。
		png1px, _ := base64.StdEncoding.DecodeString(placeholderPNG)
		img.Src = "data:image/png;base64," + base64.StdEncoding.EncodeToString(png1px)
		if img.Width == 0 && dxaGoal > 0 {
			img.Width = float64(dxaGoal) / 20
		}
		if img.Height == 0 && dyaGoal > 0 {
			img.Height = float64(dyaGoal) / 20
		}
		if img.Width == 0 {
			img.Width = 100
		}
		if img.Height == 0 {
			img.Height = 40
		}
		return img, true
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

// placeholderPNG：1x1 透明 PNG（iVBORw0... 是标准最小 PNG 的 base64）。
// 用于 WMF/EMF 矢量图占位：前端按 Width/Height 拉伸显示图文框。
const placeholderPNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
