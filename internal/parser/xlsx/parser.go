// Package xlsx 实现 .xlsx 文件解析，基于 excelize 封装
// 容错策略：损坏单元格跳过，未知类型降级为字符串
package xlsx

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"strings"

	"github.com/xuri/excelize/v2"
	"github.com/zai/samoffice/internal/core"
)

// ---- styles.xml 镜像结构（仅取填充色所需的字段）----
type styleColor struct {
	RGB     string `xml:"rgb,attr"`
	Theme   *int   `xml:"theme,attr"`
	Indexed int    `xml:"indexed,attr"`
}
type stylePatternFillEl struct {
	PatternType string      `xml:"patternType,attr"`
	FgColor     *styleColor `xml:"fgColor"`
	BgColor     *styleColor `xml:"bgColor"`
}
type styleFill struct {
	PatternFill *stylePatternFillEl `xml:"patternFill"`
}
type styleXf struct {
	FillID *int `xml:"fillId,attr"`
}
type styleSheetXML struct {
	XMLName xml.Name     `xml:"styleSheet"`
	CellXfs struct {
		Xf []styleXf `xml:"xf"`
	} `xml:"cellXfs"`
	Fills struct {
		Fill []styleFill `xml:"fill"`
	} `xml:"fills"`
}

// parseStylesXML 从 xlsx 字节中读取 xl/styles.xml 并解析出填充色映射。
func parseStylesXML(data []byte) *styleSheetXML {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil
	}
	for _, zf := range zr.File {
		if zf.Name == "xl/styles.xml" {
			rc, err := zf.Open()
			if err != nil {
				return nil
			}
			defer rc.Close()
			var ss styleSheetXML
			if xml.NewDecoder(rc).Decode(&ss) != nil {
				return nil
			}
			return &ss
		}
	}
	return nil
}

// styleFillID 返回某 style 索引对应的 fill 索引。
func styleFillID(f *excelize.File, styleID int) int {
	ss := stylesOf(f)
	if ss == nil || styleID < 0 || styleID >= len(ss.CellXfs.Xf) {
		return -1
	}
	if ss.CellXfs.Xf[styleID].FillID == nil {
		return -1
	}
	return *ss.CellXfs.Xf[styleID].FillID
}

// stylePatternFill 返回某 fill 索引的 patternFill（可能越界时返回 nil）。
func stylePatternFill(f *excelize.File, fillID int) *stylePatternFillEl {
	ss := stylesOf(f)
	if ss == nil || fillID < 0 || fillID >= len(ss.Fills.Fill) {
		return nil
	}
	return ss.Fills.Fill[fillID].PatternFill
}

// stylesCache 在解析期间缓存 styles.xml 解析结果，避免每个单元格重复解压。
var stylesCache = map[*excelize.File]*styleSheetXML{}

func stylesOf(f *excelize.File) *styleSheetXML {
	if v, ok := stylesCache[f]; ok {
		return v
	}
	return nil
}

type Parser struct{}

func New() *Parser { return &Parser{} }

func (p *Parser) Supported() []string { return []string{".xlsx"} }

func (p *Parser) CanParse(path string, header []byte) bool {
        return strings.HasSuffix(strings.ToLower(path), ".xlsx")
}

// Parse 解析 xlsx 为 UDM
// 每个 sheet 转换为一个 Table block，并保留单元格样式（粗体/颜色/对齐/填充）
func (p *Parser) Parse(r io.Reader) (*core.Document, []core.Warning, error) {
	warnings := []core.Warning{}

	data, err := io.ReadAll(r)
	if err != nil {
		return nil, warnings, fmt.Errorf("read xlsx: %w", err)
	}

	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		return nil, warnings, fmt.Errorf("open xlsx: %w", err)
	}
	defer f.Close()

	// 解析 styles.xml 用于可靠读取单元格填充色（绕过 excelize 对主题的依赖）
	stylesCache[f] = parseStylesXML(data)
	defer delete(stylesCache, f)

	doc := &core.Document{
		Meta:   core.Meta{Title: "Spreadsheet"},
		Blocks: []core.Block{},
	}

	sheets := f.GetSheetList()
	for _, sheetName := range sheets {
		table, warn := buildTable(f, sheetName)
		for _, w := range warn {
			warnings = append(warnings, w)
		}
		doc.Blocks = append(doc.Blocks, &table)
	}

	if len(sheets) == 0 {
		warnings = append(warnings, core.Warning{
			Level: "warn", Stage: "map",
			Message: "xlsx contains no sheets",
		})
	}

	return doc, warnings, nil
}

// buildTable 将某 sheet 的单元格（含样式）转换为 UDM Table
func buildTable(f *excelize.File, sheetName string) (core.Table, []core.Warning) {
	warnings := []core.Warning{}
	maxRows := 1000

	rows, err := f.GetRows(sheetName)
	if err != nil {
		warnings = append(warnings, core.Warning{
			Level: "warn", Stage: "xml",
			Message: fmt.Sprintf("read sheet %s: %v", sheetName, err),
		})
		return core.Table{}, warnings
	}
	if len(rows) > maxRows {
		rows = rows[:maxRows]
	}

	maxCols := 0
	for _, row := range rows {
		if len(row) > maxCols {
			maxCols = len(row)
		}
	}

	tableCells := make([][]core.TableCell, 0, len(rows))
	for ri, row := range rows {
		cells := make([]core.TableCell, 0, maxCols)
		for c := 0; c < maxCols; c++ {
			cellRef, err := excelize.CoordinatesToCellName(c+1, ri+1)
			if err != nil {
				cellRef = ""
			}
			var val string
			if c < len(row) {
				val = row[c]
			}
			txt := core.Text{Content: val}
			// 仅对“有内容的单元格”读取样式：空单元格在 XML 中未物化，
			// excelize 的 GetCellStyle 会越界 panic，导致整个文件打不开。
			if cellRef != "" && val != "" {
				applyCellStyle(f, sheetName, cellRef, &txt)
			}
			cell := core.TableCell{Inline: []core.Inline{txt}}
			if ri == 0 {
				cell.IsHeader = true
			}
			// 公式：当单元格含公式时记录公式文本（与 .xls 解析对齐以便一致性对比）
			if cellRef != "" {
				if formula, ferr := f.GetCellFormula(sheetName, cellRef); ferr == nil && formula != "" {
					cell.Formula = normalizeFormula(formula)
				}
			}
			cells = append(cells, cell)
		}
		tableCells = append(tableCells, cells)
	}

	return core.Table{
		Rows:  tableCells,
		Style: sheetName,
	}, warnings
}

// normalizeFormula 标准化公式串：去掉跨表前缀里的单引号包裹、统一大小写无关。
func normalizeFormula(f string) string {
	f = strings.TrimSpace(f)
	// xlsx 的 3D 引用形如 '销售表'!C2:C6 或 销售表!C2:C6
	// .xls 侧输出为 SheetN!...，统一保留原样以供对比。
	return f
}

// applyCellStyle 读取单元格样式写入 UDM Text（粗体/斜体/颜色/对齐/填充）
func applyCellStyle(f *excelize.File, sheetName, cellRef string, txt *core.Text) {
	// 安全网：任何意外的越界/解析异常都不应导致整个文件打不开
	defer func() { _ = recover() }()
	styleID, err := f.GetCellStyle(sheetName, cellRef)
	if err != nil {
		return
	}
	style, err := f.GetStyle(styleID)
	if err != nil || style == nil {
		return
	}
	if style.Font != nil {
		txt.Bold = style.Font.Bold
		txt.Italic = style.Font.Italic
		if style.Font.Underline != "" && style.Font.Underline != "none" {
			txt.Under = true
		}
		if style.Font.Strike {
			txt.Strike = true
		}
		if style.Font.Color != "" {
			if c, ok := normalizeColor(style.Font.Color); ok {
				txt.Color = c
			}
		}
		if style.Font.Size > 0 {
			txt.FontSize = style.Font.Size
		}
		// 字体名：excelize 将 xlsx 的 <name> 映射到了 Font.Family 字段
		if style.Font.Family != "" {
			txt.FontFamily = style.Font.Family
		}
	}
	if style.Alignment != nil && style.Alignment.Horizontal != "" {
		switch strings.ToLower(style.Alignment.Horizontal) {
		case "center", "centercontinuous":
			txt.Align = "center"
		case "right":
			txt.Align = "right"
		case "left":
			txt.Align = "left"
		case "justify":
			txt.Align = "justify"
		}
	}
	if rgb, ok := fillRGBFromStyles(f, styleID); ok {
		txt.Bg = rgb
	}
}

// fillRGBFromStyles 从原始 styles.xml 读取单元格填充色（最可靠的方式）。
// excelize 解码后的 Style.Fill.Color 依赖主题（f.Theme），而本解析流程未加载
// 主题时它会返回 000000，因此这里直接解析 xl/styles.xml 的 patternFill。
// 纯色填充用 fgColor，带图案（如细条纹）的填充用 bgColor。
func fillRGBFromStyles(f *excelize.File, styleID int) (string, bool) {
	fillID := styleFillID(f, styleID)
	if fillID < 0 {
		return "", false
	}
	pf := stylePatternFill(f, fillID)
	if pf == nil {
		return "", false
	}
	useFg := pf.PatternType == "" || strings.EqualFold(pf.PatternType, "solid")
	var col *styleColor
	if useFg && pf.FgColor != nil {
		col = pf.FgColor
	} else if !useFg && pf.BgColor != nil {
		col = pf.BgColor
	} else if pf.FgColor != nil {
		col = pf.FgColor
	}
	if col == nil || col.RGB == "" {
		return "", false
	}
	return normalizeColor(col.RGB)
}

// normalizeColor 把颜色值规整为 #RRGGBB。支持 6 位 RGB、8 位 ARGB（去掉 alpha
// 前缀）、以及 excelize 偶发的 10 位（重复 alpha 前缀）情况。
func normalizeColor(c string) (string, bool) {
	c = strings.TrimPrefix(strings.TrimSpace(c), "0x")
	c = strings.TrimPrefix(c, "#")
	switch len(c) {
	case 10:
		c = c[4:] // 去掉重复的 alpha 前缀（如 FFFFFFFFFF00）
	case 8:
		c = c[2:] // 去掉 alpha 前缀（如 FFFF00 -> FF00? 实际 FFFFFF00 -> FFFF00）
	case 6:
		// 直接使用
	default:
		return "", false
	}
	if len(c) != 6 {
		return "", false
	}
	return "#" + strings.ToUpper(c), true
}

// (填充色改由 fillRGBFromStyles 从原始 styles.xml 读取，旧的 fillRGB 已废弃移除)
