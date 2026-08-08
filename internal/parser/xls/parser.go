// Package xls 实现对旧版 Excel 97-2003 (.xls) 二进制格式（BIFF8 / OLE 复合文档）的解析。
//
// .xls 文件是一个 OLE2 (CFB) 复合文档，核心数据流名为 "Workbook"（旧版也叫 "Book"）。
// 流内是一串 BIFF 记录（opcode(2) + len(2) + data(len)）。本解析器实用、容错地提取：
//   - 各工作表名称（BOUNDSHEET 记录）
//   - 共享字符串表（SST 记录）
//   - 单元格值（NUMBER / RK / MULRK / LABEL / LABELSST / FORMULA / BLANK 等）
//   - 单元格样式（FONT / XF / PALETTE / PATTERN：粗体/斜体/颜色/对齐/填充）
//   - 合并单元格（MERGEDCELLS 0x00E5）
//   - 公式（FORMULA 0x0006 + 后续 STRING 0x0207，或缓存数值结果）
//
// 输出为标准 UDM core.Document（每个工作表对应一个 core.Table 块）。
// 样式写入 core.Text（Bold/Italic/Under/Strike/Color/Align/Bg/FontSize/FontFamily），
// 公式写入 core.TableCell.Formula，以便与 .xlsx 解析输出做一致性对比。
package xls

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"os"
	"strconv"
	"strings"

	"github.com/richardlehane/mscfb"
	"github.com/zai/samoffice/internal/core"
)

// Parser 实现 parser.Parser 接口
type Parser struct{}

func New() *Parser { return &Parser{} }

func (p *Parser) Supported() []string { return []string{".xls"} }

func (p *Parser) CanParse(path string, header []byte) bool {
	lower := strings.ToLower(path)
	if !strings.HasSuffix(lower, ".xls") {
		return false
	}
	// .xlsx 是 ZIP（PK 头），需与 .xls 区分
	if len(header) >= 2 && bytes.Equal(header[:2], []byte{0x50, 0x4B}) {
		return false
	}
	// OLE2 复合文档头标识
	if len(header) >= 8 && bytes.Equal(header[:8], []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}) {
		return true
	}
	return false
}

// cell 是中间结构（含样式与公式）
type cell struct {
	row int
	col int
	val string
}

// xfStyle 由 XF 记录解析出的单元格样式
type xfStyle struct {
	fontIdx  int
	fillIdx  int
	parent   int // ixfeParent：指向父（样式）XF，用于继承字体/填充/对齐
	align    string // left|center|right
	wrapText bool
}

// fontStyle 由 FONT 记录解析出的字体样式
type fontStyle struct {
	bold   bool
	italic bool
	under  bool
	strike bool
	color  string // #RRGGBB
	size   float64
	family string
}

// sheetData 累积单张工作表的解析结果
type sheetData struct {
	name   string
	cells  map[[2]int]*cellData
	maxRow int
	maxCol int
	// 合并单元格：以 (r,c) 起点为 key，值为 {rowSpan, colSpan}
	merges map[[2]int][2]int
	// 被合并覆盖的占位单元格（不单独输出）
	mergedCovered map[[2]int]bool
}

// cellData 携带值、样式与公式
type cellData struct {
	val    string
	bold   bool
	italic bool
	under  bool
	strike bool
	color  string
	bg     string
	align  string
	size   float64
	family string
	formula string
}

func (s *sheetData) set(r, c int, cd *cellData) {
	if cd == nil {
		return
	}
	if _, ok := s.cells[[2]int{r, c}]; !ok {
		s.cells[[2]int{r, c}] = cd
	} else {
		// 已存在则合并（例如先有公式缓存值后补样式）
		existing := s.cells[[2]int{r, c}]
		if cd.val != "" {
			existing.val = cd.val
		}
		if cd.formula != "" {
			existing.formula = cd.formula
		}
		existing.bold = existing.bold || cd.bold
		existing.italic = existing.italic || cd.italic
		existing.under = existing.under || cd.under
		existing.strike = existing.strike || cd.strike
		if cd.color != "" {
			existing.color = cd.color
		}
		if cd.bg != "" {
			existing.bg = cd.bg
		}
		if cd.align != "" {
			existing.align = cd.align
		}
		if cd.size != 0 {
			existing.size = cd.size
		}
		if cd.family != "" {
			existing.family = cd.family
		}
	}
	if cd.val != "" {
		if r > s.maxRow {
			s.maxRow = r
		}
		if c > s.maxCol {
			s.maxCol = c
		}
	}
}

func (s *sheetData) newCell(v string) *cellData {
	return &cellData{val: v}
}

// Parse 解析 .xls 字节流为 UDM
func (p *Parser) Parse(r io.Reader) (*core.Document, []core.Warning, error) {
	warnings := []core.Warning{}

	data, err := io.ReadAll(r)
	if err != nil {
		return nil, warnings, fmt.Errorf("read xls: %w", err)
	}

	cfb, err := mscfb.New(bytes.NewReader(data))
	if err != nil {
		return nil, warnings, fmt.Errorf("open ole container: %w", err)
	}

	// 定位 Workbook / Book 流
	var wb []byte
	for entry, err := cfb.Next(); err == nil; entry, err = cfb.Next() {
		name := strings.ToLower(entry.Name)
		if name == "workbook" || name == "book" {
			buf := make([]byte, entry.Size)
			if _, rerr := entry.ReadAt(buf, 0); rerr == nil || rerr == io.EOF {
				wb = buf
			}
		}
	}
	if len(wb) == 0 {
		return nil, warnings, fmt.Errorf("missing Workbook stream")
	}

	sheets, warns := parseWorkbookWrap(wb)
	warnings = append(warnings, warns...)

	if len(sheets) == 0 {
		warnings = append(warnings, core.Warning{
			Level:   "warn",
			Stage:   "parse",
			Message: "未能从 .xls 提取到工作表（可能是加密或不支持的变体）",
		})
	}

	doc := &core.Document{
		Meta:   core.Meta{},
		Blocks: []core.Block{},
		Raw:    make(map[string]any),
	}
	for _, sh := range sheets {
		rows := buildRows(sh)
		doc.Blocks = append(doc.Blocks, core.Table{
			Style: sh.name,
			Rows:  rows,
		})
	}
	return doc, warnings, nil
}

// parseWorkbook 单遍扫描 BIFF 记录，提取工作表与单元格及样式。
func parseWorkbook(wb []byte) ([]*sheetData, []core.Warning) {
	warnings := []core.Warning{}
	var sheets []*sheetData
	var sst []string

	// 样式表
	xfStyles := []*xfStyle{} // 索引与文件中 XF 记录顺序一致（0 基）
	palette := map[int]string{} // 索引 -> #RRGGBB

	active := -1 // 当前活动工作表索引（按遇到的 sheet BOF 顺序）
	seenSheetBOF := 0

	// 公式待补全：FORMULA 记录后跟 STRING 记录携带公式串。记录最近一次 FORMULA 坐标。
	lastFormula := struct {
		sheet int
		row   int
		col   int
	}{sheet: -1}

	i := 0
	for i+4 <= len(wb) {
		opcode := binary.LittleEndian.Uint16(wb[i : i+2])
		length := int(binary.LittleEndian.Uint16(wb[i+2 : i+4]))
		i += 4
		if i+length > len(wb) {
			warnings = append(warnings, core.Warning{Level: "warn", Stage: "parse", Message: "工作簿记录长度越界，已截断解析"})
			break
		}
		d := wb[i : i+length]
		i += length

		switch opcode {
		case 0x0809: // BOF
			if len(d) >= 4 {
				ft := binary.LittleEndian.Uint16(d[2:4])
				if ft == 0x0010 { // worksheet
					active = seenSheetBOF
					seenSheetBOF++
					if active >= len(sheets) {
						sh := &sheetData{
							name:           fmt.Sprintf("Sheet%d", len(sheets)+1),
							cells:          map[[2]int]*cellData{},
							merges:         map[[2]int][2]int{},
							mergedCovered:  map[[2]int]bool{},
						}
						sheets = append(sheets, sh)
					}
				}
			}
		case 0x000A: // EOF
		case 0x0085: // BOUNDSHEET
			if len(d) >= 6 {
				cch := int(d[5])
				nameOff := 6
				if cch == 0 && len(d) > 7 {
					cch = int(d[6])
					nameOff = 8
				}
				grbit := byte(0)
				if nameOff-1 < len(d) {
					grbit = d[nameOff-1]
				}
				nameBytes := d[nameOff:]
				if cch > 0 && cch*2 <= len(nameBytes) {
					var name string
					if grbit&0x01 != 0 {
						name = decodeUTF16LE(nameBytes[:cch*2])
					} else {
						name = decodeANSI(nameBytes[:cch])
					}
					globalSheetNames = append(globalSheetNames, name)
					sh := &sheetData{
						name:          name,
						cells:         map[[2]int]*cellData{},
						merges:        map[[2]int][2]int{},
						mergedCovered: map[[2]int]bool{},
					}
					sheets = append(sheets, sh)
				}
			}
		case 0x0092: // PALETTE：颜色索引表
			if len(d) >= 2 {
				n := int(binary.LittleEndian.Uint16(d[0:2]))
				pos := 2
				for k := 0; k < n; k++ {
					if pos+4 > len(d) {
						break
					}
					// b(1) g(1) r(1) a(1)
					rC := d[pos+2]
					gC := d[pos+1]
					bC := d[pos]
					idx := k + 8 // BIFF 调色板索引从 8 开始
					palette[idx] = rgbHex(rC, gC, bC)
					pos += 4
				}
			}
		case 0x0031: // FONT
			fs := parseFont(d)
			globalFonts = append(globalFonts, fs)
		case 0x00E0, 0x00E1: // XF（单元格 / 样式）
			xs := parseXF(d)
			xfStyles = append(xfStyles, xs)
		case 0x0293: // STYLE：将 XF 索引映射到内置样式（用于识别 Heading/Title 等粗体样式）
			if len(d) >= 2 {
				styXf := int(binary.LittleEndian.Uint16(d[0:2]))
				// 高位 0x8000 表示内置样式
				if styXf&0x8000 != 0 {
					styXf &= 0x7FFF
					builtinID := 0
					if len(d) >= 4 {
						builtinID = int(d[3]) // d[2]=flags, d[3]=iBuiltIn
					}
					if styXf >= 0 && styXf < len(xfStyles) {
						globalStyleBuiltin[styXf] = builtinID
					}
				}
			}
		case 0x00E9: // FILL（BIFF8 填充：前景色/背景色）
			if len(d) >= 6 {
				fgIdx := int(binary.LittleEndian.Uint16(d[2:4])) // icvFore 前景色索引
				fillCount++
				if c, ok := paletteLookup(palette, fgIdx); ok {
					globalFillFg[fillCount] = c
				} else {
					globalFillFg[fillCount] = "" // 索引 0=无填充；非空填充记录才记色
				}
			}
		case 0x0209: // PATTERN（填充前景色/背景色，旧版 BIFF）
			if len(d) >= 4 {
				fillIdx := int(binary.LittleEndian.Uint16(d[0:2]))
				fgIdx := int(d[2]) // 前景色索引（图案色）
				if c, ok := paletteLookup(palette, fgIdx); ok {
					globalFillFg[fillIdx] = c
				}
			}
		case 0x00FC: // SST
			sst = parseSST(d)
		case 0x0017: // EXTERNSHEET：3D 引用的工作表表名
			if len(d) >= 2 {
				cRefs := int(binary.LittleEndian.Uint16(d[0:2]))
				pos := 2
				for k := 0; k < cRefs; k++ {
					if pos+6 > len(d) {
						break
					}
					// sti（6 字节）：iSupBook(2) + ixti(2) + 细节(2)
					iSupBook := binary.LittleEndian.Uint16(d[pos : pos+2])
					pos += 6
					name := ""
					// iSupBook==0x0001 表示同一工作簿内部引用，其后紧跟 cch(2)+名称
					if iSupBook == 0x0001 && pos+2 <= len(d) {
						cch := int(binary.LittleEndian.Uint16(d[pos : pos+2]))
						pos += 2
						unicode := cch&0x8000 != 0
						cchLen := cch & 0x7FFF
						if unicode {
							if pos+2*cchLen <= len(d) {
								name = decodeUTF16LE(d[pos : pos+2*cchLen])
								pos += 2 * cchLen
							}
						} else {
							if pos+cchLen <= len(d) {
								name = string(d[pos : pos+cchLen])
								pos += cchLen
							}
						}
					}
					globalExtRefs = append(globalExtRefs, name)
				}
			}
		case 0x00FD: // LABELSST
			if len(d) >= 10 && active >= 0 && active < len(sheets) {
				row := int(binary.LittleEndian.Uint16(d[0:2]))
				col := int(binary.LittleEndian.Uint16(d[2:4]))
				ixfe := int(binary.LittleEndian.Uint16(d[4:6]))
				idx := binary.LittleEndian.Uint32(d[6:10])
				var v string
				if int(idx) < len(sst) {
					v = sst[idx]
				}
				cd := &cellData{val: v}
				applyXF(cd, xfStyles, ixfe)
				sheets[active].set(row, col, cd)
			}
		case 0x0204: // LABEL
			if len(d) >= 6 && active >= 0 && active < len(sheets) {
				row := int(binary.LittleEndian.Uint16(d[0:2]))
				col := int(binary.LittleEndian.Uint16(d[2:4]))
				ixfe := int(binary.LittleEndian.Uint16(d[4:6]))
				cd := &cellData{val: readLabel(d[6:])}
				applyXF(cd, xfStyles, ixfe)
				sheets[active].set(row, col, cd)
			}
		case 0x0203: // NUMBER
			if len(d) >= 14 && active >= 0 && active < len(sheets) {
				row := int(binary.LittleEndian.Uint16(d[0:2]))
				col := int(binary.LittleEndian.Uint16(d[2:4]))
				ixfe := int(binary.LittleEndian.Uint16(d[4:6]))
				f := math.Float64frombits(binary.LittleEndian.Uint64(d[6:14]))
				cd := &cellData{val: formatNumber(f)}
				applyXF(cd, xfStyles, ixfe)
				sheets[active].set(row, col, cd)
			}
		case 0x0007, 0x027E: // RK / RSTRING+RK
			if len(d) >= 10 && active >= 0 && active < len(sheets) {
				row := int(binary.LittleEndian.Uint16(d[0:2]))
				col := int(binary.LittleEndian.Uint16(d[2:4]))
				ixfe := int(binary.LittleEndian.Uint16(d[4:6]))
				rk := binary.LittleEndian.Uint32(d[6:10])
				cd := &cellData{val: formatNumber(decodeRK(rk))}
				applyXF(cd, xfStyles, ixfe)
				sheets[active].set(row, col, cd)
			}
		case 0x00BD: // MULRK
			if len(d) >= 6 && active >= 0 && active < len(sheets) {
				row := int(binary.LittleEndian.Uint16(d[0:2]))
				firstCol := int(binary.LittleEndian.Uint16(d[2:4]))
				pos := 4
				col := firstCol
				for pos+6 <= len(d) {
					ixfe := int(binary.LittleEndian.Uint16(d[pos : pos+2]))
					rk := binary.LittleEndian.Uint32(d[pos+2 : pos+6])
					cd := &cellData{val: formatNumber(decodeRK(rk))}
					applyXF(cd, xfStyles, ixfe)
					sheets[active].set(row, col, cd)
					col++
					pos += 6
				}
			}
		case 0x0006: // FORMULA
			if len(d) >= 16 && active >= 0 && active < len(sheets) {
				row := int(binary.LittleEndian.Uint16(d[0:2]))
				col := int(binary.LittleEndian.Uint16(d[2:4]))
				ixfe := int(binary.LittleEndian.Uint16(d[4:6]))
				// BIFF8 FORMULA 布局：rw(2) col(2) ixfe(2) res(8) grbit(1) chn(4) cce(2) rgce
				// 结果值（num）位于偏移 6，长 8 字节。
				res := d[6:14]
				cd := &cellData{}
				if len(d) >= 14 {
					// valType: 0x00=数值, 0xFF=字符串, 0x01=布尔, 0xFFFF=错误
					valType := res[6]
					if valType == 0x00 {
						f := math.Float64frombits(binary.LittleEndian.Uint64(res[:8]))
						if !math.IsNaN(f) {
							cd.val = formatNumber(f)
						}
					}
					// 字符串/布尔/错误结果：值由后续 STRING 记录补全
				}
				// 解析公式 ptg（cce 在偏移 20，rgce 在偏移 22；chn 字段占 5 字节）
				if len(d) >= 22 {
					cce := int(binary.LittleEndian.Uint16(d[20:22]))
					if 22+cce <= len(d) {
						cd.formula = DecodeFormulaPtg(d[22 : 22+cce])
					}
					{
						dbgF, _ := os.OpenFile("c:\\tmp\\formula_dbg3.txt", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
						fmt.Fprintf(dbgF, "F r%d c%d lenD=%d cce=%d rgce(20:34)=% X -> %q\n", row, col, len(d), cce, d[20:34], cd.formula)
						dbgF.Close()
					}
				}
				applyXF(cd, xfStyles, ixfe)
				sheets[active].set(row, col, cd)
				lastFormula.sheet = active
				lastFormula.row = row
				lastFormula.col = col
			}
		case 0x0207: // STRING：FORMULA 的字符串结果值
			if active >= 0 && active < len(sheets) {
				if lastFormula.sheet == active {
					if cd, ok := sheets[active].cells[[2]int{lastFormula.row, lastFormula.col}]; ok {
						if cd.val == "" {
							cd.val = readLabel(d)
						}
					}
					lastFormula.sheet = -1
				}
			}
		case 0x0201, 0x00BE: // BLANK / MULBLANK：无值，仅样式
			if active >= 0 && active < len(sheets) {
				if opcode == 0x0201 && len(d) >= 6 {
					row := int(binary.LittleEndian.Uint16(d[0:2]))
					col := int(binary.LittleEndian.Uint16(d[2:4]))
					ixfe := int(binary.LittleEndian.Uint16(d[4:6]))
					cd := &cellData{}
					applyXF(cd, xfStyles, ixfe)
					sheets[active].set(row, col, cd)
				} else if opcode == 0x00BE && len(d) >= 4 {
					row := int(binary.LittleEndian.Uint16(d[0:2]))
					firstCol := int(binary.LittleEndian.Uint16(d[2:4]))
					pos := 4
					col := firstCol
					for pos+2 <= len(d) {
						ixfe := int(binary.LittleEndian.Uint16(d[pos : pos+2]))
						cd := &cellData{}
						applyXF(cd, xfStyles, ixfe)
						sheets[active].set(row, col, cd)
						col++
						pos += 2
					}
				}
			}
		case 0x00E5: // MERGEDCELLS
			// data: count(2) 然后每组 (r1,c1,r2,c2) 各 2 字节
			if len(d) >= 2 && active >= 0 && active < len(sheets) {
				cnt := int(binary.LittleEndian.Uint16(d[0:2]))
				pos := 2
				for k := 0; k < cnt; k++ {
					if pos+8 > len(d) {
						break
					}
					r1 := int(binary.LittleEndian.Uint16(d[pos : pos+2]))
					c1 := int(binary.LittleEndian.Uint16(d[pos+2 : pos+4]))
					r2 := int(binary.LittleEndian.Uint16(d[pos+4 : pos+6]))
					c2 := int(binary.LittleEndian.Uint16(d[pos+6 : pos+8]))
					rs := r2 - r1 + 1
					cs := c2 - c1 + 1
					sh := sheets[active]
					sh.merges[[2]int{r1, c1}] = [2]int{rs, cs}
					for rr := r1; rr <= r2; rr++ {
						for cc := c1; cc <= c2; cc++ {
							if rr == r1 && cc == c1 {
								continue
							}
							sh.mergedCovered[[2]int{rr, cc}] = true
						}
					}
					pos += 8
				}
			}
		}
	}
	return sheets, warnings
}

// parseFont 解析 FONT 记录（BIFF8）
func parseFont(d []byte) *fontStyle {
	fs := &fontStyle{}
	if len(d) < 14 {
		return fs
	}
	// dyHeight(2, 1/20 pt) options(2) colorIndex(2) weight(2) ...
	height := binary.LittleEndian.Uint16(d[0:2])
	fs.size = float64(height) / 20.0
	options := binary.LittleEndian.Uint16(d[2:4])
	fs.italic = options&0x02 != 0
	fs.strike = options&0x08 != 0
	fs.under = options&0x04 != 0
	colorIdx := int(binary.LittleEndian.Uint16(d[4:6]))
	// 0 / 0x7FFF 为自动色（默认黑），不显式输出，与 xlsx 行为一致
	if colorIdx != 0 && colorIdx != 0x7FFF {
		if c, ok := paletteLookup(nil, colorIdx); ok {
			fs.color = c
		}
	}
	weight := binary.LittleEndian.Uint16(d[6:8])
	fs.bold = weight >= 700
	return fs
}

// parseXF 解析 XF 记录（BIFF8）
// 布局：ixfeParent(2) iNumFmt(2) iFont(2) iFill(2) iXFAlign(1) iXFVertAlign(1) ...
func parseXF(d []byte) *xfStyle {
	xs := &xfStyle{}
	if len(d) < 14 {
		return xs
	}
	parent := int(binary.LittleEndian.Uint16(d[0:2]))
	fontIdx := int(binary.LittleEndian.Uint16(d[4:6]))
	fillIdx := int(binary.LittleEndian.Uint16(d[6:8]))
	alignByte := byte(0)
	if len(d) >= 9 {
		alignByte = d[8] // BIFF8 XF：d[8] 低 3 位为水平对齐 + 第 3 位 wrap
	}
	xs.parent = parent
	xs.fontIdx = fontIdx
	xs.fillIdx = fillIdx
	// 水平对齐：d[8] 低 3 位（0=常规 1=左 2=居中 3=右 4=填充 5=两端 6=跨列居中 7=分散）
	switch alignByte & 0x07 {
	case 1:
		xs.align = "left"
	case 2:
		xs.align = "center"
	case 3:
		xs.align = "right"
	}
	if alignByte&0x08 != 0 {
		xs.wrapText = true
	}
	return xs
}

// applyXF 把 XF 样式应用到单元格
// resolveXF 沿 ixfeParent 链解析出最终生效的 XF，并标记是否为粗体内置样式。
func resolveXF(xfStyles []*xfStyle, ixfe int) (xs *xfStyle, builtinBold bool) {
	if ixfe < 0 || ixfe >= len(xfStyles) {
		return nil, false
	}
	visited := map[int]bool{}
	cur := ixfe
	for {
		if cur < 0 || cur >= len(xfStyles) || visited[cur] {
			break
		}
		visited[cur] = true
		x := xfStyles[cur]
		if x == nil {
			break
		}
		// 内置样式（Heading/Title/Total 等）强制粗体
		if id, ok := globalStyleBuiltin[cur]; ok && isBoldBuiltin(id) {
			builtinBold = true
		}
		if xs == nil {
			xs = x
		}
		parent := x.parent
		if parent == cur || parent < 0 || parent >= len(xfStyles) {
			break
		}
		cur = parent
	}
	return xs, builtinBold
}

func applyXF(cd *cellData, xfStyles []*xfStyle, ixfe int) {
	xs, builtinBold := resolveXF(xfStyles, ixfe)
	if xs == nil {
		return
	}
	// 字体索引：0xFFF5 等哨兵表示使用默认字体（索引 0）
	fontIdx := xs.fontIdx
	if fontIdx == 0xFFF5 || fontIdx < 0 || fontIdx >= len(globalFonts) {
		fontIdx = 0
	}
	if fontIdx < len(globalFonts) {
		f := globalFonts[fontIdx]
		cd.bold = cd.bold || f.bold || builtinBold
		cd.italic = cd.italic || f.italic
		cd.under = cd.under || f.under
		cd.strike = cd.strike || f.strike
		if f.color != "" {
			cd.color = f.color
		}
		if f.size != 0 {
			cd.size = f.size
		}
		if f.family != "" {
			cd.family = f.family
		}
	} else {
		cd.bold = cd.bold || builtinBold
	}
	if xs.align != "" {
		cd.align = xs.align
	}
	if xs.fillIdx > 0 && xs.fillIdx != 0xFFF5 {
		if c, ok := globalFillFg[xs.fillIdx]; ok && c != "" {
			cd.bg = c
		}
	}
}

// isBoldBuiltin 判断 BIFF 内置样式是否为粗体样式（Heading1-6 / Title / Total 等）
func isBoldBuiltin(id int) bool {
	switch id {
	case 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, // Heading 1-9
		0x0C, // Title
		0x0D, // Total
		0x0F, 0x10, 0x11, 0x12, 0x13, 0x14: // 其他层级
		return true
	}
	return false
}

// decodeFormulaPtg 解析 BIFF 公式字节码（ptg 序列），尽量还原为可读的公式字符串。
// 支持常用的：引用(2D/3D)、范围、数值、字符串、函数(SUM/AVERAGE 等)、
// 四则运算与括号。无法识别的 ptg 以占位符保留，保证不破坏后续字节对齐。
func DecodeFormulaPtg(b []byte) string {
	var sb strings.Builder
	stack := []string{}
	i := 0
	for i < len(b) {
		ptg := b[i]
		i++
		if os.Getenv("XLS_PTG_DEBUG") != "" {
			fmt.Fprintf(os.Stderr, "ptg=0x%02X i=%d stack=%v\n", ptg, i, stack)
		}
		switch ptg {
		case 0x03: // ptgAdd
			if len(stack) >= 2 {
				b := stack[len(stack)-1]
				a := stack[len(stack)-2]
				stack = stack[:len(stack)-2]
				stack = append(stack, "("+a+"+"+b+")")
			}
		case 0x04: // ptgSub
			if len(stack) >= 2 {
				b := stack[len(stack)-1]
				a := stack[len(stack)-2]
				stack = stack[:len(stack)-2]
				stack = append(stack, "("+a+"-"+b+")")
			}
		case 0x05: // ptgMul
			if len(stack) >= 2 {
				b := stack[len(stack)-1]
				a := stack[len(stack)-2]
				stack = stack[:len(stack)-2]
				stack = append(stack, "("+a+"*"+b+")")
			}
		case 0x06: // ptgDiv
			if len(stack) >= 2 {
				b := stack[len(stack)-1]
				a := stack[len(stack)-2]
				stack = stack[:len(stack)-2]
				stack = append(stack, "("+a+"/"+b+")")
			}
		case 0x07: // ptgPower
			if len(stack) >= 2 {
				b := stack[len(stack)-1]
				a := stack[len(stack)-2]
				stack = stack[:len(stack)-2]
				stack = append(stack, "("+a+"^"+b+")")
			}
		case 0x08: // ptgConcat
			if len(stack) >= 2 {
				b := stack[len(stack)-1]
				a := stack[len(stack)-2]
				stack = stack[:len(stack)-2]
				stack = append(stack, "("+a+"&"+b+")")
			}
		case 0x09, 0x0A, 0x0B, 0x0C: // ptgLt/Gt/Le/Ge
			op := map[byte]string{0x09: "<", 0x0A: ">", 0x0B: "<=", 0x0C: ">="}[ptg]
			if len(stack) >= 2 {
				b := stack[len(stack)-1]
				a := stack[len(stack)-2]
				stack = stack[:len(stack)-2]
				stack = append(stack, "("+a+op+b+")")
			}
		case 0x0D: // ptgEq
			if len(stack) >= 2 {
				b := stack[len(stack)-1]
				a := stack[len(stack)-2]
				stack = stack[:len(stack)-2]
				stack = append(stack, "("+a+"="+b+")")
			}
		case 0x0E: // ptgNe
			if len(stack) >= 2 {
				b := stack[len(stack)-1]
				a := stack[len(stack)-2]
				stack = stack[:len(stack)-2]
				stack = append(stack, "("+a+"<>"+b+")")
			}
		case 0x11: // ptgUminus
			if len(stack) >= 1 {
				a := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				stack = append(stack, "(-"+a+")")
			}
		case 0x12: // ptgUplus
		case 0x13: // ptgPercent
			if len(stack) >= 1 {
				a := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				stack = append(stack, "("+a+"%)")
			}
		case 0x14: // ptgParen
		case 0x15: // ptgMissArg
			stack = append(stack, "")
		case 0x16: // ptgStr
			if i+1 <= len(b) {
				l := int(b[i])
				i++
				if i+l <= len(b) {
					s := decodeANSI(b[i : i+l])
					i += l
					stack = append(stack, "\""+s+"\"")
				}
			}
		case 0x17: // ptgAttr（含空格/SUM 等优化）
			if i+3 <= len(b) {
				grbit := binary.LittleEndian.Uint16(b[i : i+2])
				i += 3 // grbit(2) + 1 字节保留/数据
				if grbit&0x10 != 0 && len(stack) >= 1 {
					a := stack[len(stack)-1]
					stack = stack[:len(stack)-1]
					stack = append(stack, "SUM("+strings.TrimPrefix(strings.TrimSuffix(a, ")"), "(")+")")
				}
			}
		case 0x19: // ptgFuncVar / ptgFuncVarV
			if i+3 <= len(b) {
				cargs := int(b[i] & 0x7F) // 高位置位表示自定义名称跟随
				funcIdx := binary.LittleEndian.Uint16(b[i+1 : i+3])
				i += 4
				args := []string{}
				for j := 0; j < cargs && len(stack) > 0; j++ {
					args = append([]string{stack[len(stack)-1]}, args...)
					stack = stack[:len(stack)-1]
				}
				stack = append(stack, funcNameV(funcIdx)+"("+strings.Join(args, ",")+")")
				}
				case 0x21, 0x41, 0x61: // ptgFunc (2D/3D/V)
				if i+2 <= len(b) {
				funcIdx := binary.LittleEndian.Uint16(b[i : i+2])
				i += 2
				stack = append(stack, funcNameF(funcIdx)+"()")
				}
		case 0x1C: // ptgInt
			if i+2 <= len(b) {
				v := int(int16(binary.LittleEndian.Uint16(b[i : i+2])))
				i += 2
				stack = append(stack, strconv.Itoa(v))
			}
		case 0x1D: // ptgNum
			if i+8 <= len(b) {
				f := math.Float64frombits(binary.LittleEndian.Uint64(b[i : i+8]))
				i += 8
				stack = append(stack, formatNumber(f))
			}
		case 0x24, 0x44, 0x64: // ptgRef (2D/3D/V)
			if i+4 <= len(b) {
				rw := int(binary.LittleEndian.Uint16(b[i : i+2]))
				cl := int(binary.LittleEndian.Uint16(b[i+2 : i+4]))
				i += 4
				if ptg == 0x64 && i+2 <= len(b) {
					i += 2 // 3D：跳过 ixti
				}
				stack = append(stack, cellRef(rw, cl))
			}
		case 0x2C, 0x4C, 0x6C: // ptgRefN
			if i+4 <= len(b) {
				i += 4
				stack = append(stack, "REF")
			}
		case 0x25, 0x45, 0x65: // ptgArea (2D/3D/V)
			if i+8 <= len(b) {
				r1 := int(binary.LittleEndian.Uint16(b[i : i+2]))
				r2 := int(binary.LittleEndian.Uint16(b[i+2 : i+4]))
				c1 := int(binary.LittleEndian.Uint16(b[i+4 : i+6]))
				c2 := int(binary.LittleEndian.Uint16(b[i+6 : i+8]))
				i += 8
				if ptg == 0x65 && i+2 <= len(b) {
					i += 2 // 3D：跳过 ixti
				}
				// 列含相对/绝对标志位（高 2 位），需掩码
				c1 &= 0x3FFF
				c2 &= 0x3FFF
				stack = append(stack, cellRef(r1, c1)+":"+cellRef(r2, c2))
			}
		case 0x2D, 0x4D, 0x6D: // ptgAreaN
			if i+8 <= len(b) {
				i += 8
				stack = append(stack, "AREA")
			}
		case 0x3A, 0x5A, 0x7A: // ptgRef3d
			if i+6 <= len(b) {
				ixti := binary.LittleEndian.Uint16(b[i : i+2])
				rw := int(binary.LittleEndian.Uint16(b[i+2 : i+4]))
				cl := int(binary.LittleEndian.Uint16(b[i+4 : i+6]))
				i += 6
				stack = append(stack, sheetRef(ixti)+"!"+cellRef(rw, cl))
			}
		case 0x3B, 0x5B, 0x7B: // ptgArea3d
			if i+10 <= len(b) {
				ixti := binary.LittleEndian.Uint16(b[i : i+2])
				r1 := int(binary.LittleEndian.Uint16(b[i+2 : i+4]))
				r2 := int(binary.LittleEndian.Uint16(b[i+4 : i+6]))
				c1 := int(binary.LittleEndian.Uint16(b[i+6 : i+8]))
				c2 := int(binary.LittleEndian.Uint16(b[i+8 : i+10]))
				i += 10
				c1 &= 0x3FFF
				c2 &= 0x3FFF
				stack = append(stack, sheetRef(ixti)+"!"+cellRef(r1, c1)+":"+cellRef(r2, c2))
			}
		case 0x3C, 0x5C, 0x7C: // ptgRefErr3d / 等
			if i+6 <= len(b) {
				i += 6
				stack = append(stack, "#REF!")
			}
		case 0x29, 0x49, 0x69: // ptgMemFunc 等
			if i+2 <= len(b) {
				cce := int(binary.LittleEndian.Uint16(b[i : i+2]))
				i += 2 + cce
				stack = append(stack, "(...)")
			}
		default:
			// 未知 ptg：跳过 1 字节以避免无限推进（部分带数据的 ptg 可能未覆盖）
			break
		}
	}
	for _, s := range stack {
		sb.WriteString(s)
	}
	return sb.String()
}

// cellRef 列号转字母 + 行号（0-based -> A1）
func cellRef(rw, cl int) string {
	col := cl
	var letters string
	for col >= 0 {
		letters = string(rune('A'+col%26)) + letters
		col = col/26 - 1
	}
	return letters + strconv.Itoa(rw+1)
}

// sheetRef 3D 引用的工作表名
// 优先使用工作簿自身的工作表名（内部引用，ixti 即 BOUNDSHEET 顺序索引）；
// 其次回退到 EXTERNSHEET 中记录的名称（外部引用）。
func sheetRef(ixti uint16) string {
	idx := int(ixti)
	if idx >= 0 && idx < len(globalSheetNames) && globalSheetNames[idx] != "" {
		return globalSheetNames[idx]
	}
	if idx >= 0 && idx < len(globalExtRefs) && globalExtRefs[idx] != "" {
		return globalExtRefs[idx]
	}
	return "Sheet" + strconv.Itoa(idx+1)
}

// funcNameF 常见 BIFF 内置函数索引 -> 名称（ptgFunc / ftab 表）
func funcNameF(idx uint16) string {
	names := map[uint16]string{
		0x00:   "COUNT",
		0x01:   "IF",
		0x02:   "ISNA",
		0x03:   "ISERROR",
		0x04:   "SUM",
		0x05:   "AVERAGE",
		0x06:   "MIN",
		0x07:   "MAX",
		0x08:   "ROW",
		0x09:   "COLUMN",
		0x0A:   "NPV",
		0x0B:   "STDEV",
		0x0C:   "DOLLAR",
		0x0D:   "VAR",
		0x0E:   "STDEVA",
		0x0F:   "VARA",
		0x10:   "STDEVP",
		0x11:   "PRODUCT",
		0x12:   "POWER",
		0x13:   "MOD",
		0x14:   "LEN",
		0x15:   "VALUE",
		0x16:   "TRUE",
		0x17:   "FALSE",
		0x18:   "ROUND",
		0x19:   "REPT",
		0x1A:   "MID",
		0x1B:   "ABS",
		0x1C:   "SQRT",
		0x1D:   "INT",
		0x1E:   "SIGN",
		0x1F:   "LOWER",
		0x20:   "UPPER",
		0x21:   "PROPER",
		0x22:   "TRIM",
		0x23:   "LEFT",
		0x24:   "RIGHT",
		0x25:   "EXACT",
		0x26:   "REPLACE",
		0x27:   "SUBSTITUTE",
		0x28:   "CODE",
		0x29:   "FIND",
		0x2A:   "CELL",
		0x2B:   "ISERR",
		0x2C:   "ISTEXT",
		0x2D:   "ISNUMBER",
		0x2E:   "ISBLANK",
		0x2F:   "TEXT",
		0x30:   "LOCATE",
		0x47:   "T",
		0x48:   "COUNTA",
		0x58:   "AVERAGEA",
		0x64:   "LOOKUP",
		0x7B:   "SUBTOTAL",
		0x9E:   "SUMIF",
		0xA3:   "COUNTBLANK",
		0xB1:   "COUNTIF",
		0xCE:   "MEDIAN",
		0xD5:   "CONCATENATE",
		0xE4:   "IFERROR",
		0x100:  "ISBLANK",
		0x11C:  "MAXA",
		0x11D:  "MINA",
		0x12A:  "AVERAGEIF",
	}
	if n, ok := names[idx]; ok {
		return n
	}
	return "FUNC" + strconv.Itoa(int(idx))
}

// funcNameV 常见 BIFF 内置函数索引 -> 名称（ptgFuncVar / iftab 表，变参函数）
func funcNameV(idx uint16) string {
	names := map[uint16]string{
		0x00: "SUM",
		0x01: "AVERAGE",
		0x02: "COUNT",
		0x03: "MAX",
		0x04: "MIN",
		0x05: "PRODUCT",
		0x06: "VARP",
		0x07: "STDEVP",
		0x08: "VAR",
		0x09: "VARA",
		0x0A: "STDEV",
		0x0B: "STDEVA",
		0x0C: "MODE",
		0x0D: "MEDIAN",
		0x0E: "LARGE",
		0x0F: "SMALL",
		0x10: "PERCENTILE",
		0x11: "QUARTILE",
		0x12: "PERCENTRANK",
		0x13: "RANK",
		0x14: "AVEDEV",
		0x15: "TRIMMEAN",
		0x16: "GEOMEAN",
		0x17: "HARMEAN",
		0x18: "SUMSQ",
		0x19: "DEVSQ",
		0x1A: "FISHER",
		0x1B: "FISHERINV",
		0x1C: "NORMDIST",
		0x1D: "NORMINV",
		0x1E: "NORMSDIST",
		0x1F: "NORMSINV",
		0x20: "LOGINV",
		0x21: "LOGNORMDIST",
		0x22: "CONFIDENCE",
		0x23: "CRITBINOM",
		0x24: "CORREL",
		0x25: "COVAR",
		0x26: "FORECAST",
		0x27: "INTERCEPT",
		0x28: "PEARSON",
		0x29: "RSQ",
		0x2A: "SLOPE",
		0x2B: "STEYX",
		0x2C: "TDIST",
		0x2D: "TINV",
		0x2E: "ERF",
		0x2F: "ERFC",
		0x30: "CHIDIST",
		0x31: "CHIINV",
		0x32: "FDIST",
		0x33: "FINV",
		0x34: "GAMMADIST",
		0x35: "GAMMAINV",
		0x36: "GAMMALN",
		0x37: "GAMMA",
		0x38: "BETADIST",
		0x39: "BETAINV",
		0x3A: "BINOMDIST",
		0x3B: "EXPONDIST",
		0x3C: "POISSON",
		0x3D: "NEGBINOMDIST",
		0x3E: "HYPGEOMDIST",
		0x3F: "LOGEST",
		0x40: "GROWTH",
		0x41: "LINEST",
		0x42: "TREND",
		0x43: "MAXA",
		0x44: "MINA",
		0x45: "AVERAGEA",
		0x46: "STDEVA",
		0x47: "STDEVPA",
		0x48: "VARA",
		0x49: "VARPA",
		0x4A: "SUMXMY2",
		0x4B: "SUMX2MY2",
		0x4C: "SUMX2PY2",
		0x4D: "FLOOR",
		0x4E: "CEILING",
		0x4F: "COUNTIFS",
		0x50: "SUMIFS",
		0x51: "AVERAGEIF",
		0x52: "AVERAGEIFS",
		0x53: "CONCAT",
		0x54: "TEXTJOIN",
		0x55: "MINIFS",
		0x56: "MAXIFS",
		0x57: "SWITCH",
		0x58: "IFS",
		0x59: "XOR",
		0x5A: "BITAND",
		0x5B: "BITOR",
		0x5C: "BITXOR",
		0x5D: "BITLSHIFT",
		0x5E: "BITRSHIFT",
		0x5F: "UNIQUEX",
		0x60: "FILTER",
		0x61: "SORT",
		0x62: "SORTBY",
		0x63: "SEQUENCE",
		0x64: "RANDARRAY",
	}
	if n, ok := names[idx]; ok {
		return n
	}
	return "FUNC" + strconv.Itoa(int(idx))
}

// parseSST 解析共享字符串表
func parseSST(d []byte) []string {
	if len(d) < 8 {
		return nil
	}
	unique := binary.LittleEndian.Uint32(d[4:8])
	out := make([]string, 0, unique)
	pos := 8
	for uint32(len(out)) < unique && pos+2 <= len(d) {
		slen := int(binary.LittleEndian.Uint16(d[pos : pos+2]))
		pos += 2
		flags := byte(0)
		if pos < len(d) {
			flags = d[pos]
		}
		pos += 1
		if flags&0x08 != 0 {
			pos += 2
		}
		if flags&0x01 != 0 {
			if pos+slen*2 > len(d) {
				break
			}
			out = append(out, decodeUTF16LE(d[pos:pos+slen*2]))
			pos += slen * 2
		} else {
			if pos+slen > len(d) {
				break
			}
			out = append(out, decodeANSI(d[pos:pos+slen]))
			pos += slen
		}
		if flags&0x02 != 0 {
			if pos+2 <= len(d) {
				cRun := int(binary.LittleEndian.Uint16(d[pos : pos+2]))
				pos += 2 + cRun*4
			}
		}
		if flags&0x04 != 0 {
			if pos+4 <= len(d) {
				cbExt := int(binary.LittleEndian.Uint32(d[pos : pos+4]))
				pos += 4 + cbExt
			}
		}
		if flags&0x08 != 0 {
			pos += 8
		}
	}
	return out
}

// readLabel 解析 LABEL 记录中的内联字符串（d 从第 6 字节起：ixfe(2) cch(2) grbit(1) rgb）
func readLabel(d []byte) string {
	if len(d) < 4 {
		return ""
	}
	cch := int(binary.LittleEndian.Uint16(d[2:4]))
	if cch == 0 {
		return ""
	}
	grbit := byte(0)
	if len(d) >= 5 {
		grbit = d[4]
	}
	strPos := 5
	if strPos+cch > len(d) {
		cch = len(d) - strPos
		if cch < 0 {
			return ""
		}
	}
	if grbit&0x01 != 0 {
		return decodeANSI(d[strPos : strPos+cch])
	}
	if strPos+cch*2 > len(d) {
		cch = (len(d) - strPos) / 2
	}
	return decodeUTF16LE(d[strPos : strPos+cch*2])
}

// decodeRK 解码 RK 数值（4 字节）
func decodeRK(rk uint32) float64 {
	if rk&0x02 == 0 {
		bits := uint64(rk&0xFFFFFFFC) << 32
		v := math.Float64frombits(bits)
		if rk&0x01 != 0 {
			v /= 100
		}
		return v
	}
	n := int32(rk) >> 2
	v := float64(n)
	if rk&0x01 != 0 {
		v /= 100
	}
	return v
}

func formatNumber(f float64) string {
	if f == math.Trunc(f) && !math.IsInf(f, 0) && math.Abs(f) < 1e15 {
		return strconv.FormatInt(int64(f), 10)
	}
	return strconv.FormatFloat(f, 'g', -1, 64)
}

func decodeUTF16LE(b []byte) string {
	n := len(b) / 2
	r := make([]rune, n)
	for i := 0; i < n; i++ {
		r[i] = rune(binary.LittleEndian.Uint16(b[i*2 : i*2+2]))
	}
	return strings.ReplaceAll(string(r), "\x00", "")
}

func decodeANSI(b []byte) string {
	r := make([]rune, len(b))
	for i, c := range b {
		r[i] = rune(c)
	}
	return string(r)
}

func rgbHex(r, g, b byte) string {
	return fmt.Sprintf("#%02X%02X%02X", r, g, b)
}

// paletteLookup 解析颜色索引为 #RRGGBB。当 palette 为 nil 时仅用系统默认索引。
func paletteLookup(palette map[int]string, idx int) (string, bool) {
	if palette != nil {
		if c, ok := palette[idx]; ok {
			return c, true
		}
	}
	// 默认调色板（BIFF 标准索引 0-7 为系统色）
	switch idx {
	case 0x08:
		return "#000000", true // 黑
	case 0x09:
		return "#FFFFFF", true // 白
	case 0x0A:
		return "#FF0000", true // 红
	case 0x0B:
		return "#00FF00", true // 绿
	case 0x0C:
		return "#0000FF", true // 蓝
	case 0x0D:
		return "#FFFF00", true // 黄
	case 0x0E:
		return "#FF00FF", true // 品红
	case 0x0F:
		return "#00FFFF", true // 青
	case 0x10:
		return "#800000", true
	case 0x11:
		return "#008000", true
	case 0x12:
		return "#000080", true
	case 0x13:
		return "#808000", true
	case 0x14:
		return "#800080", true
	case 0x15:
		return "#008080", true
	case 0x16:
		return "#C0C0C0", true // 银
	case 0x17:
		return "#808080", true // 灰
	case 0x18:
		return "#9999FF", true
	case 0x19:
		return "#993366", true
	case 0x1A:
		return "#FFFFCC", true
	case 0x1B:
		return "#CCFFFF", true
	case 0x1C:
		return "#660066", true
	case 0x1D:
		return "#FF8080", true
	case 0x1E:
		return "#0066CC", true
	case 0x1F:
		return "#CCCCFF", true
	case 0x20:
		return "#000080", true
	case 0x21:
		return "#FF00FF", true
	case 0x22:
		return "#FFFF00", true
	case 0x23:
		return "#00FFFF", true
	case 0x24:
		return "#800080", true
	case 0x25:
		return "#800000", true
	case 0x26:
		return "#008080", true
	case 0x27:
		return "#0000FF", true
	case 0x28:
		return "#00CCFF", true
	case 0x29:
		return "#CCFFFF", true
	case 0x2A:
		return "#CCFFCC", true
	case 0x2B:
		return "#FFFF99", true
	case 0x2C:
		return "#99CCFF", true
	case 0x2D:
		return "#FF99CC", true
	case 0x2E:
		return "#CC99FF", true
	case 0x2F:
		return "#FFCC99", true
	case 0x30:
		return "#3366FF", true
	case 0x31:
		return "#33CCCC", true
	case 0x32:
		return "#99CC00", true
	case 0x33:
		return "#FFCC00", true
	case 0x34:
		return "#FF9900", true
	case 0x35:
		return "#FF6600", true
	case 0x36:
		return "#666699", true
	case 0x37:
		return "#969696", true
	case 0x38:
		return "#003366", true
	case 0x39:
		return "#339966", true
	case 0x3A:
		return "#003300", true
	case 0x3B:
		return "#333300", true
	case 0x3C:
		return "#993300", true
	case 0x3D:
		return "#993366", true
	case 0x3E:
		return "#333399", true
	case 0x3F:
		return "#333333", true
	}
	return "", false
}

// buildRows 将工作表单元格组装为 UDM 二维行结构。
func buildRows(sh *sheetData) [][]core.TableCell {
	rows := make([][]core.TableCell, sh.maxRow+1)
	for r := 0; r <= sh.maxRow; r++ {
		rowCells := make([]core.TableCell, sh.maxCol+1)
		for c := 0; c <= sh.maxCol; c++ {
			cd, ok := sh.cells[[2]int{r, c}]
			if !ok || sh.mergedCovered[[2]int{r, c}] {
				continue
			}
			txt := core.Text{
				Content: cd.val,
			}
			if cd.bold {
				txt.Bold = true
			}
			if cd.italic {
				txt.Italic = true
			}
			if cd.under {
				txt.Under = true
			}
			if cd.strike {
				txt.Strike = true
			}
			if cd.color != "" {
				txt.Color = cd.color
			}
			if cd.align != "" {
				txt.Align = cd.align
			}
			if cd.bg != "" {
				txt.Bg = cd.bg
			}
			if cd.size != 0 {
				txt.FontSize = cd.size
			}
			if cd.family != "" {
				txt.FontFamily = cd.family
			}
			cell := core.TableCell{
				Inline: []core.Inline{txt},
			}
			if r == 0 {
				cell.IsHeader = true
			}
			if cd.formula != "" {
				cell.Formula = cd.formula
			}
			if ms, ok := sh.merges[[2]int{r, c}]; ok {
				if ms[0] > 1 {
					cell.RowSpan = ms[0]
				}
				if ms[1] > 1 {
					cell.ColSpan = ms[1]
				}
			}
			rowCells[c] = cell
		}
		rows[r] = rowCells
	}
	return rows
}

// 全局样式表（在 parseWorkbook 内被填充，applyXF 通过包级变量访问，
// 简化跨记录传递；每次 Parse 调用都会重新赋值）。
var (
	globalFonts        []*fontStyle
	globalFillFg       map[int]string
	globalExtRefs      []string // EXTERNSHEET 中记录的 3D 引用 sheet 名（按 ixti 顺序）
	globalStyleBuiltin map[int]int // XF 索引 -> 内置样式 id（STYLE 记录）
	globalSheetNames   []string // BOUNDSHEET 顺序记录的工作表名（用于内部 3D 引用）
	fillCount          int      // FILL 记录计数（1-based，对应 XF.iFill）
)

// 包装 parseWorkbook 以初始化全局样式表
func parseWorkbookWrap(wb []byte) ([]*sheetData, []core.Warning) {
	globalFonts = []*fontStyle{}
	globalFillFg = map[int]string{}
	globalExtRefs = []string{}
	globalStyleBuiltin = map[int]int{}
	globalSheetNames = []string{}
	fillCount = 0
	return parseWorkbook(wb)
}
