package xlsx

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/xuri/excelize/v2"
)

// ---- 前端 ↔ 后端 的单元格数据格式 ----

type cellJSON struct {
	Value       string `json:"value"`
	Formula     string `json:"formula,omitempty"`
	Bold        bool   `json:"bold"`
	Italic      bool   `json:"italic"`
	Under       bool   `json:"under"`
	Strike      bool   `json:"strike"`
	Color       string `json:"color"`
	Bg          string `json:"bg"`
	Align       string `json:"align"`
	FontSize    float64 `json:"fontSize"`
	FontFamily  string `json:"fontFamily"`
	Border      string `json:"border"`
	BorderColor string `json:"borderColor"`
	MergeRange  *struct {
		RowSpan int `json:"rowSpan"`
		ColSpan int `json:"colSpan"`
	} `json:"mergeRange,omitempty"`
	HiddenBy string `json:"hiddenBy,omitempty"`
}

type sheetJSON struct {
	Name  string               `json:"name"`
	Rows  int                  `json:"rows"`
	Cols  int                  `json:"cols"`
	Cells map[string]cellJSON  `json:"cells"`
}

type workbookJSON struct {
	Sheets []sheetJSON `json:"sheets"`
}

// borderRank 把 excelize 的边框线型代码映射到前端抽象的细/中/粗。
func borderRank(style int) string {
	switch style {
	case 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13:
		return "medium"
	case 14, 15, 16, 17, 18, 19:
		return "thick"
	case 1:
		return "thin"
	default:
		return ""
	}
}

// ReadXLSX 读取 xlsx 为 JSON，完整保留值、字体色、填充、边框、对齐、合并等格式。
func ReadXLSX(path string) (string, error) {
	f, err := excelize.OpenFile(path)
	if err != nil {
		return "", fmt.Errorf("open xlsx: %w", err)
	}
	defer f.Close()

	// 收集每个 sheet 的合并区域
	mergeMap := map[string][][2][2]int{} // sheetName -> [][2]r,c  (start,end)
	for _, name := range f.GetSheetList() {
		merged, err := f.GetMergeCells(name)
		if err != nil || merged == nil {
			continue
		}
		for _, m := range merged {
			sr, sc, _ := excelize.CellNameToCoordinates(m.GetStartAxis())
			er, ec, _ := excelize.CellNameToCoordinates(m.GetEndAxis())
			mergeMap[name] = append(mergeMap[name], [2][2]int{{sr, sc}, {er, ec}})
		}
	}

	out := workbookJSON{}
	for _, name := range f.GetSheetList() {
		sj := sheetJSON{Name: name, Cells: map[string]cellJSON{}}
		rows, err := f.GetRows(name)
		if err != nil {
			out.Sheets = append(out.Sheets, sj)
			continue
		}
		maxR, maxC := 0, 0
		for ri, row := range rows {
			for ci, val := range row {
				if val == "" {
					continue
				}
			ref, _ := excelize.CoordinatesToCellName(ci+1, ri+1)
			cj := cellJSON{Value: val}
			applyCellFormat(f, name, ref, &cj)
			// 读取公式（若存在则作为纯公式单元格保存）
			if formula, ferr := f.GetCellFormula(name, ref); ferr == nil && formula != "" {
				cj.Formula = formula
			}
			sj.Cells[fmt.Sprintf("%d-%d", ri, ci)] = cj
			if ri > maxR {
				maxR = ri
			}
			if ci > maxC {
				maxC = ci
			}
		}
	}
	// 读取完成后，计算所有公式单元格的缓存值（用于前端直接展示计算结果）
	for key, cj := range sj.Cells {
		if cj.Formula == "" {
			continue
		}
		parts := strings.SplitN(key, "-", 2)
		var r, c int
		fmt.Sscanf(parts[0]+" "+parts[1], "%d %d", &r, &c)
		ref, _ := excelize.CoordinatesToCellName(c+1, r+1)
		if computed, cerr := f.CalcCellValue(name, ref); cerr == nil {
			cj.Value = computed
		}
		sj.Cells[key] = cj
	}
		// 标记合并区域：左上角写 mergeRange，被覆盖单元格写 hiddenBy
		for _, mm := range mergeMap[name] {
			r1, c1 := mm[0][0]-1, mm[0][1]-1
			r2, c2 := mm[1][0]-1, mm[1][1]-1
			if r2 < r1 {
				r1, r2 = r2, r1
			}
			if c2 < c1 {
				c1, c2 = c2, c1
			}
			key := fmt.Sprintf("%d-%d", r1, c1)
			if c, ok := sj.Cells[key]; ok {
				c.MergeRange = &struct {
					RowSpan int `json:"rowSpan"`
					ColSpan int `json:"colSpan"`
				}{RowSpan: r2 - r1 + 1, ColSpan: c2 - c1 + 1}
				sj.Cells[key] = c
			}
			for rr := r1; rr <= r2; rr++ {
				for cc := c1; cc <= c2; cc++ {
					if rr == r1 && cc == c1 {
						continue
					}
					sj.Cells[fmt.Sprintf("%d-%d", rr, cc)] = cellJSON{HiddenBy: key}
				}
			}
			if r2 > maxR {
				maxR = r2
			}
			if c2 > maxC {
				maxC = c2
			}
		}
		sj.Rows = maxR + 3
		sj.Cols = maxC + 3
		out.Sheets = append(out.Sheets, sj)
	}

	b, err := json.Marshal(out)
	if err != nil {
		return "", fmt.Errorf("marshal: %w", err)
	}
	return string(b), nil
}

// applyCellFormat 读取单元格的字体/填充/对齐/边框写入 cellJSON。
func applyCellFormat(f *excelize.File, sheet, ref string, cj *cellJSON) {
	styleID, err := f.GetCellStyle(sheet, ref)
	if err != nil {
		return
	}
	style, err := f.GetStyle(styleID)
	if err != nil || style == nil {
		return
	}
	if style.Font != nil {
		cj.Bold = style.Font.Bold
		cj.Italic = style.Font.Italic
		if style.Font.Underline != "" && style.Font.Underline != "none" {
			cj.Under = true
		}
		cj.Strike = style.Font.Strike
		if style.Font.Color != "" {
			if c, ok := normalizeColor(style.Font.Color); ok {
				cj.Color = c
			}
		}
		if style.Font.Size > 0 {
			cj.FontSize = style.Font.Size
		}
		if style.Font.Family != "" {
			cj.FontFamily = style.Font.Family
		}
	}
	if style.Alignment != nil && style.Alignment.Horizontal != "" {
		switch strings.ToLower(style.Alignment.Horizontal) {
		case "center", "centercontinuous":
			cj.Align = "center"
		case "right":
			cj.Align = "right"
		case "left":
			cj.Align = "left"
		case "justify":
			cj.Align = "justify"
		}
	}
	if len(style.Fill.Color) > 0 {
		if c, ok := normalizeColor(style.Fill.Color[0]); ok {
			cj.Bg = c
		}
	}
	// 边框：取任一边非空线型；颜色取第一个有颜色的边
	if len(style.Border) > 0 {
		for _, b := range style.Border {
			if b.Style != 0 && cj.Border == "" {
				if r := borderRank(b.Style); r != "" {
					cj.Border = r
				}
			}
			if b.Color != "" && cj.BorderColor == "" {
				if c, ok := normalizeColor(b.Color); ok {
					cj.BorderColor = c
				}
			}
		}
	}
}

// WriteXLSX 把前端传来的 JSON 写回 xlsx，完整保留格式与合并。
func WriteXLSX(path string, jsonStr string) error {
	var wb workbookJSON
	if err := json.Unmarshal([]byte(jsonStr), &wb); err != nil {
		return fmt.Errorf("unmarshal: %w", err)
	}
	f := excelize.NewFile()
	defer f.Close()

	if len(wb.Sheets) == 0 {
		return fmt.Errorf("empty workbook")
	}

	// 删除默认 Sheet1（后面会按数据重建）
	f.SetSheetName("Sheet1", "__tmp__")

	sheetNames := f.GetSheetList()
	first := true
	for _, sj := range wb.Sheets {
		name := sj.Name
		if name == "" {
			name = "Sheet1"
		}
		var sIdx int
		if first {
			// 复用现有的 __tmp__ 表
			sIdx, _ = f.GetSheetIndex("__tmp__")
			if sIdx >= 0 {
				f.SetSheetName("__tmp__", name)
			} else {
				sIdx, _ = f.NewSheet(name)
			}
			first = false
		} else {
			if contains(sheetNames, name) {
				sIdx, _ = f.GetSheetIndex(name)
				if sIdx < 0 {
					sIdx, _ = f.NewSheet(name)
				}
			} else {
				sIdx, _ = f.NewSheet(name)
				sheetNames = append(sheetNames, name)
			}
		}
		sheetName := f.GetSheetName(sIdx)

		// 预创建样式缓存，按签名复用
		styleCache := map[string]int{}
		for key, cj := range sj.Cells {
			if cj.HiddenBy != "" {
				continue // 被合并覆盖，无需写入
			}
			parts := strings.SplitN(key, "-", 2)
			if len(parts) != 2 {
				continue
			}
			var r, c int
			fmt.Sscanf(parts[0]+" "+parts[1], "%d %d", &r, &c)
			ref, _ := excelize.CoordinatesToCellName(c+1, r+1)
			formulaExpr := cj.Formula
			if formulaExpr == "" && strings.HasPrefix(cj.Value, "=") {
				formulaExpr = cj.Value
			}
			if formulaExpr != "" {
				// 去掉开头可能的 "=" 号（SetCellFormula 不接受前导等号）
				expr := strings.TrimPrefix(formulaExpr, "=")
				if err := f.SetCellFormula(sheetName, ref, expr); err != nil {
					// 公式写入失败时退回普通值
					f.SetCellValue(sheetName, ref, cj.Value)
				}
			} else if cj.Value != "" {
				f.SetCellValue(sheetName, ref, cj.Value)
			}
			// 构建样式签名
			alignMap := map[string]string{"left": "left", "center": "center", "right": "right", "justify": "justify"}
			styleKey := fmt.Sprintf("%v|%v|%v|%v|%v|%v|%s|%v|%s|%s|%s",
				cj.Bold, cj.Italic, cj.Under, cj.Strike, cj.Color, cj.Bg, alignMap[cj.Align], cj.FontSize, cj.FontFamily, cj.Border, cj.BorderColor)
			sid, ok := styleCache[styleKey]
			if !ok {
				sid = newStyle(f, cj)
				styleCache[styleKey] = sid
			}
			if sid >= 0 {
				f.SetCellStyle(sheetName, ref, ref, sid)
			}
		}

		// 合并单元格
		for key, cj := range sj.Cells {
			if cj.MergeRange == nil {
				continue
			}
			parts := strings.SplitN(key, "-", 2)
			if len(parts) != 2 {
				continue
			}
			var r, c int
			fmt.Sscanf(parts[0]+" "+parts[1], "%d %d", &r, &c)
			er, ec := r+cj.MergeRange.RowSpan-1, c+cj.MergeRange.ColSpan-1
			startRef, _ := excelize.CoordinatesToCellName(c+1, r+1)
			endRef, _ := excelize.CoordinatesToCellName(ec+1, er+1)
			f.MergeCell(sheetName, startRef, endRef)
		}
	}

	// 若仍有空的 __tmp__ 残留则删除
	if idx, _ := f.GetSheetIndex("__tmp__"); idx >= 0 {
		f.DeleteSheet("__tmp__")
	}

	if err := f.SaveAs(path); err != nil {
		return fmt.Errorf("save: %w", err)
	}
	return nil
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// newStyle 根据 cellJSON 创建一个 excelize 样式并返回 styleID。
func newStyle(f *excelize.File, cj cellJSON) int {
	st := &excelize.Style{}
	if cj.Bold || cj.Italic || cj.Under || cj.Strike || cj.Color != "" || cj.FontSize > 0 || cj.FontFamily != "" {
		font := &excelize.Font{}
		font.Bold = cj.Bold
		font.Italic = cj.Italic
		if cj.Under {
			font.Underline = "single"
		}
		font.Strike = cj.Strike
		if cj.Color != "" {
			font.Color = excelizeRGB(cj.Color)
		}
		if cj.FontSize > 0 {
			font.Size = cj.FontSize
		}
		if cj.FontFamily != "" {
			font.Family = cj.FontFamily
		}
		st.Font = font
	}
	if cj.Align != "" {
		st.Alignment = &excelize.Alignment{Horizontal: strings.Title(cj.Align)}
	}
	if cj.Bg != "" {
		st.Fill = excelize.Fill{
			Type:    "pattern",
			Pattern: 1,
			Color:   []string{excelizeRGB(cj.Bg)},
		}
	}
	if cj.Border != "" {
		bcode := excelizeBorderStyle(cj.Border)
		color := excelizeRGB(cj.BorderColor)
		if color == "" {
			color = "FF000000"
		}
		st.Border = []excelize.Border{
			{Type: "left", Style: bcode, Color: color},
			{Type: "right", Style: bcode, Color: color},
			{Type: "top", Style: bcode, Color: color},
			{Type: "bottom", Style: bcode, Color: color},
		}
	}
	sid, err := f.NewStyle(st)
	if err != nil {
		return -1
	}
	return sid
}

// excelizeBorderStyle 把抽象边框类型映射回 excelize 线型代码（int）。
func excelizeBorderStyle(b string) int {
	switch b {
	case "medium":
		return 2
	case "thick":
		return 5
	default:
		return 1
	}
}

// excelizeRGB 把 #RRGGBB 转换为 excelize 需要的 AARRGGBB（alpha=FF）。
func excelizeRGB(c string) string {
	c = strings.TrimPrefix(strings.TrimSpace(c), "#")
	c = strings.TrimPrefix(c, "0x")
	switch len(c) {
	case 8:
		c = c[2:]
	case 6:
	default:
		return ""
	}
	if len(c) != 6 {
		return ""
	}
	return "FF" + strings.ToUpper(c)
}
