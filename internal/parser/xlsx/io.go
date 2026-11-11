package xlsx

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"math"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/xuri/excelize/v2"
)

// ---- 前端 ↔ 后端 的单元格数据格式 ----

type cellJSON struct {
	Value       string  `json:"value"`
	Formula     string  `json:"formula,omitempty"`
	Bold        bool    `json:"bold"`
	Italic      bool    `json:"italic"`
	Under       bool    `json:"under"`
	Strike      bool    `json:"strike"`
	Color       string  `json:"color"`
	Bg          string  `json:"bg"`
	Align       string  `json:"align"`
	FontSize    float64 `json:"fontSize"`
	FontFamily  string  `json:"fontFamily"`
	Border      string  `json:"border"`
	BorderColor string  `json:"borderColor"`
	MergeRange  *struct {
		RowSpan int `json:"rowSpan"`
		ColSpan int `json:"colSpan"`
	} `json:"mergeRange,omitempty"`
	HiddenBy string `json:"hiddenBy,omitempty"`
	// Valign 垂直对齐（"top"/"middle"/"bottom"），对应 excelize Alignment.Vertical
	Valign string `json:"valign,omitempty"`
	// Wrap 自动换行，对应 excelize Alignment.WrapText
	Wrap bool `json:"wrap,omitempty"`
	// Fmt 数字格式 token（"int"/"0.00"/"percent"/"percent2"/"thousands"/
	// "thousands2"/"date" 或自定义 "0.000" 形式），仅识别的格式才输出。
	Fmt string `json:"fmt,omitempty"`
	// Valid 下拉列表验证，逗号分隔字面列表（如 "yes,no,maybe"），无引号无前导 =。
	Valid string `json:"valid,omitempty"`
}

type sheetJSON struct {
	Name  string              `json:"name"`
	Rows  int                 `json:"rows"`
	Cols  int                 `json:"cols"`
	Cells map[string]cellJSON `json:"cells"`
	// ColWidths 列宽表：key 为 0 基列号字符串，value 为像素宽（前端约定默认 80px 不写入）
	ColWidths map[string]float64 `json:"colWidths,omitempty"`
	// Freeze 冻结窗格单元格（如 "C3" 表示冻结上方 2 行与左侧 2 列），空表示未冻结
	Freeze string `json:"freeze,omitempty"`
	// Images 浮动图片列表（base64 不含 data: 前缀）
	Images []imageJSON `json:"images,omitempty"`
}

// imageJSON 描述一张浮动图片：锚定单元格（0 基 row/col）、原始字节 base64、
// 扩展名（不含点，如 png/jpeg/gif）与显示像素尺寸。
type imageJSON struct {
	Row    int    `json:"row"`
	Col    int    `json:"col"`
	Base64 string `json:"base64"`
	Ext    string `json:"ext"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
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
	// 先读入字节：颜色解析需要原始 styles.xml / theme1.xml
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read file: %w", err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("open xlsx: %w", err)
	}
	defer f.Close()
	loadStyleCaches(f, data)
	defer clearStyleCaches(f)

	// 收集每个 sheet 的合并区域
	mergeMap := map[string][][2][2]int{} // sheetName -> [][2]r,c  (start,end)
	for _, name := range f.GetSheetList() {
		merged, err := f.GetMergeCells(name)
		if err != nil || merged == nil {
			continue
		}
		for _, m := range merged {
			// CellNameToCoordinates 返回 (列, 行)，注意不要颠倒行列
			sc, sr, _ := excelize.CellNameToCoordinates(m.GetStartAxis())
			ec, er, _ := excelize.CellNameToCoordinates(m.GetEndAxis())
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
		// 标记合并区域：左上角写 mergeRange，被覆盖单元格写 hiddenBy。
		// 注意：左上角单元格可能没有值（空合并区域），此时也必须生成
		// 带 mergeRange 的 cellJSON，否则保存后合并信息丢失、网格渲染错乱。
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
			c, ok := sj.Cells[key]
			if !ok {
				// 空左上角：补齐背景/边框/数字格式等样式，保证渲染一致
				c = cellJSON{}
				if ref, rerr := excelize.CoordinatesToCellName(c1+1, r1+1); rerr == nil {
					applyCellFormat(f, name, ref, &c)
				}
			}
			c.MergeRange = &struct {
				RowSpan int `json:"rowSpan"`
				ColSpan int `json:"colSpan"`
			}{RowSpan: r2 - r1 + 1, ColSpan: c2 - c1 + 1}
			sj.Cells[key] = c
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
		// 读取 list 类型数据验证，写入覆盖单元格的 valid 字段
		applyValidations(f, name, &sj)
		// 读取列宽 / 冻结窗格 / 浮动图片（新增的 sheet 级元数据）
		readSheetExtras(f, name, &sj)
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
		// 字体颜色从原始 styles.xml 读取（excelize 对主题色/10 位 ARGB 返回黑色）
		if c, ok := styleFontColor(f, styleID); ok {
			cj.Color = c
		} else if style.Font.Color != "" {
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
	// 填充色从原始 styles.xml 读取（excelize 对主题填充/WPS 10 位 ARGB 返回 FF000000 黑色，
	// 曾导致打开表格出现大片黑色背景）
	if c, ok := fillRGBFromStyles(f, styleID); ok {
		cj.Bg = c
	}
	// 边框：取任一边非空线型；颜色优先从原始 styles.xml 读取
	if len(style.Border) > 0 {
		for _, b := range style.Border {
			if b.Style != 0 && cj.Border == "" {
				if r := borderRank(b.Style); r != "" {
					cj.Border = r
				}
			}
		}
	}
	if c, ok := styleBorderColor(f, styleID); ok {
		cj.BorderColor = c
	} else if len(style.Border) > 0 {
		for _, b := range style.Border {
			if b.Color != "" && cj.BorderColor == "" {
				if c, ok := normalizeColor(b.Color); ok {
					cj.BorderColor = c
				}
			}
		}
	}
	// 数字格式：内置 id 或自定义格式串映射为前端 token（无法识别则不输出）
	custom := ""
	if style.CustomNumFmt != nil {
		custom = *style.CustomNumFmt
	}
	if tok := fmtTokenFromNumFmt(style.NumFmt, custom); tok != "" {
		cj.Fmt = tok
	}
	// 垂直对齐与自动换行（与前端 cell.valign / cell.wrap 对应）
	if style.Alignment != nil {
		switch strings.ToLower(style.Alignment.Vertical) {
		case "top":
			cj.Valign = "top"
		case "center", "middle":
			cj.Valign = "middle"
		case "bottom":
			cj.Valign = "bottom"
		}
		if style.Alignment.WrapText {
			cj.Wrap = true
		}
	}
}

// readSheetExtras 读取 sheet 级元数据：自定义列宽、冻结窗格与浮动图片。
// 列宽只记录与默认值不同的列（chars→px 近似 px=chars*7+5）；默认宽度的列
// 交给前端使用默认 80px，不写入 JSON，保持空 sheet 的快照简洁。
func readSheetExtras(f *excelize.File, sheet string, sj *sheetJSON) {
	// ---- 列宽：探测数据区外两列得到默认宽度，仅记录差异列 ----
	maxC := sj.Cols - 3 // sj.Cols = maxC + 3
	if maxC < 0 {
		maxC = 0
	}
	probeCol, _ := excelize.ColumnNumberToName(maxC + 4)
	defW, derr := f.GetColWidth(sheet, probeCol)
	if derr != nil || defW <= 0 {
		defW = defaultColWidthChars
	}
	cw := map[string]float64{}
	for c := 0; c <= maxC+1 && c < 256; c++ {
		colName, _ := excelize.ColumnNumberToName(c + 1)
		w, err := f.GetColWidth(sheet, colName)
		if err != nil || w <= 0 || math.Abs(w-defW) < 0.01 {
			continue
		}
		px := math.Round(w*7 + 5)
		if px < 20 || px > 2000 {
			continue
		}
		cw[strconv.Itoa(c)] = px
	}
	if len(cw) > 0 {
		sj.ColWidths = cw
	}
	// ---- 冻结窗格：GetPanes 返回冻结行列数，还原为锚点单元格名 ----
	if panes, err := f.GetPanes(sheet); err == nil && panes.Freeze && (panes.XSplit > 0 || panes.YSplit > 0) {
		if ref, cerr := excelize.CoordinatesToCellName(panes.XSplit+1, panes.YSplit+1); cerr == nil {
			sj.Freeze = ref
		}
	}
	// ---- 浮动图片：GetPictureCells 枚举锚点，GetPictures 取字节与显示尺寸 ----
	cells, err := f.GetPictureCells(sheet)
	if err != nil {
		return
	}
	for _, cellRef := range cells {
		pics, perr := f.GetPictures(sheet, cellRef)
		if perr != nil {
			continue
		}
		col, row, cerr := excelize.CellNameToCoordinates(cellRef)
		if cerr != nil {
			continue
		}
		for _, pic := range pics {
			if len(pic.File) == 0 {
				continue
			}
			ext := strings.TrimPrefix(strings.ToLower(pic.Extension), ".")
			if ext == "jpg" {
				ext = "jpeg"
			}
			// 显示尺寸 = 原始尺寸 × ScaleX/Y（excelize 读回时已算好缩放）
			w, h := 0, 0
			if cfg, _, derr := image.DecodeConfig(bytes.NewReader(pic.File)); derr == nil {
				w = cfg.Width
				h = cfg.Height
			}
			if w > 0 && pic.Format != nil && pic.Format.ScaleX > 0 {
				w = int(math.Round(float64(w) * pic.Format.ScaleX))
			}
			if h > 0 && pic.Format != nil && pic.Format.ScaleY > 0 {
				h = int(math.Round(float64(h) * pic.Format.ScaleY))
			}
			sj.Images = append(sj.Images, imageJSON{
				Row:    row - 1,
				Col:    col - 1,
				Base64: base64.StdEncoding.EncodeToString(pic.File),
				Ext:    ext,
				Width:  w,
				Height: h,
			})
		}
	}
}

// defaultColWidthChars 是 xlsx 未显式设置列宽时的默认字符宽（8.43 ≈ 64px）。
const defaultColWidthChars = 8.43

// writableImageExts 是 AddPictureFromBytes 支持的图片扩展名（与 excelize
// 内部 supportedImageTypes 对齐，避免引用其未导出符号）。
var writableImageExts = map[string]string{
	".bmp": ".bmp", ".emf": ".emf", ".emz": ".emz", ".gif": ".gif",
	".ico": ".ico", ".jpeg": ".jpeg", ".jpg": ".jpeg", ".png": ".png",
	".svg": ".svg", ".tif": ".tiff", ".tiff": ".tiff", ".wmf": ".wmf",
	".wmz": ".wmz",
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
					if verr := f.SetCellValue(sheetName, ref, cj.Value); verr != nil {
						return fmt.Errorf("set cell %s: %w", ref, verr)
					}
				}
			} else if cj.Value != "" {
				if err := f.SetCellValue(sheetName, ref, cj.Value); err != nil {
					return fmt.Errorf("set cell %s: %w", ref, err)
				}
			}
			// 构建样式签名（含数字格式 token、垂直对齐与自动换行）
			alignMap := map[string]string{"left": "left", "center": "center", "right": "right", "justify": "justify"}
			styleKey := fmt.Sprintf("%v|%v|%v|%v|%v|%v|%s|%v|%s|%s|%s|%s|%s|%v",
				cj.Bold, cj.Italic, cj.Under, cj.Strike, cj.Color, cj.Bg, alignMap[cj.Align], cj.FontSize, cj.FontFamily, cj.Border, cj.BorderColor, cj.Fmt, cj.Valign, cj.Wrap)
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

		// 数据验证（下拉列表）：valid 字段写为 list 类型 DataValidation
		writeValidations(f, sheetName, &sj)
		// 列宽 / 冻结窗格 / 浮动图片（sheet 级元数据）
		writeColWidths(f, sheetName, &sj)
		writeFreeze(f, sheetName, &sj)
		if err := writeImages(f, sheetName, &sj); err != nil {
			return err
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

// writeColWidths 把前端列宽表（key 为 0 基列号字符串，value 为 px）写回 xlsx。
// px→chars 近似 chars=(px-5)/7；px<=0 或超出合理范围的列直接跳过。
func writeColWidths(f *excelize.File, sheet string, sj *sheetJSON) {
	for key, px := range sj.ColWidths {
		c, err := strconv.Atoi(key)
		if err != nil || c < 0 || c >= 256 || px < 20 || px > 2000 {
			continue
		}
		colName, _ := excelize.ColumnNumberToName(c + 1)
		chars := (px - 5) / 7
		if chars < 1 {
			chars = 1
		}
		if serr := f.SetColWidth(sheet, colName, colName, chars); serr != nil {
			continue
		}
	}
}

// writeFreeze 把冻结窗格锚点（如 "C3"）写回 xlsx；空串表示未冻结不处理。
func writeFreeze(f *excelize.File, sheet string, sj *sheetJSON) {
	s := strings.TrimSpace(strings.ToUpper(sj.Freeze))
	if s == "" {
		return
	}
	col, row, err := excelize.CellNameToCoordinates(s)
	if err != nil {
		return
	}
	x, y := col-1, row-1
	if x < 0 {
		x = 0
	}
	if y < 0 {
		y = 0
	}
	if x == 0 && y == 0 {
		return
	}
	activePane := "bottomRight"
	if x == 0 {
		activePane = "bottomLeft"
	} else if y == 0 {
		activePane = "topRight"
	}
	_ = f.SetPanes(sheet, &excelize.Panes{
		Freeze:      true,
		XSplit:      x,
		YSplit:      y,
		TopLeftCell: s,
		ActivePane:  activePane,
	})
}

// writeImages 把前端浮动图片列表写回 xlsx：base64 解码后经 AddPictureFromBytes
// 写入，缩放比例按目标尺寸/原始尺寸计算。解码失败或扩展名不支持时跳过该图。
func writeImages(f *excelize.File, sheet string, sj *sheetJSON) error {
	for _, im := range sj.Images {
		if im.Base64 == "" || im.Row < 0 || im.Col < 0 {
			continue
		}
		raw, err := base64.StdEncoding.DecodeString(im.Base64)
		if err != nil || len(raw) == 0 {
			continue
		}
		ext := strings.ToLower(strings.TrimSpace(im.Ext))
		if ext == "" {
			ext = "png"
		}
		if !strings.HasPrefix(ext, ".") {
			ext = "." + ext
		}
		if _, ok := writableImageExts[ext]; !ok {
			continue // webp/svg 等当前不支持写入的格式
		}
		if ext == ".jpg" {
			ext = ".jpeg"
		}
		cfg, _, derr := image.DecodeConfig(bytes.NewReader(raw))
		scaleX, scaleY := 1.0, 1.0
		if derr == nil && cfg.Width > 0 && cfg.Height > 0 && im.Width > 0 && im.Height > 0 {
			scaleX = float64(im.Width) / float64(cfg.Width)
			scaleY = float64(im.Height) / float64(cfg.Height)
		}
		cellRef, cerr := excelize.CoordinatesToCellName(im.Col+1, im.Row+1)
		if cerr != nil {
			continue
		}
		pic := &excelize.Picture{
			Extension: ext,
			File:      raw,
			Format:    &excelize.GraphicOptions{ScaleX: scaleX, ScaleY: scaleY},
		}
		if err := f.AddPictureFromBytes(sheet, cellRef, pic); err != nil {
			return fmt.Errorf("add picture at %s: %w", cellRef, err)
		}
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
	// 数字格式：内置 token 用内置 numFmtId，自定义 "0.0…" 用 CustomNumFmt
	if cj.Fmt != "" {
		if id, custom, ok := numFmtFromToken(cj.Fmt); ok {
			if custom != "" {
				st.CustomNumFmt = &custom
			} else {
				st.NumFmt = id
			}
		}
	}
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
	if cj.Align != "" || cj.Valign != "" || cj.Wrap {
		align := &excelize.Alignment{}
		if cj.Align != "" {
			align.Horizontal = strings.Title(cj.Align)
		}
		if cj.Valign != "" {
			align.Vertical = strings.Title(cj.Valign)
		}
		align.WrapText = cj.Wrap
		st.Alignment = align
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

// ---- 数字格式（numFmt）映射 ----

// builtinDateNumFmtIDs 是 xlsx 内置的日期/时间格式 numFmtId 集合
// （14-22 标准日期时间、27-36 与 50-58 东亚语言日期、45-47 时间）。
var builtinDateNumFmtIDs = map[int]bool{
	14: true, 15: true, 16: true, 17: true, 18: true, 19: true, 20: true, 21: true, 22: true,
	27: true, 28: true, 29: true, 30: true, 31: true, 32: true, 33: true, 34: true, 35: true, 36: true,
	45: true, 46: true, 47: true,
	50: true, 51: true, 52: true, 53: true, 54: true, 55: true, 56: true, 57: true, 58: true,
}

// customNumFmtPattern 匹配 "0.0"、"0.00"、"0.000" 等纯小数自定义格式。
var customNumFmtPattern = regexp.MustCompile(`^0\.0+$`)

// fmtTokenFromNumFmt 把数字格式映射为前端 token：
// 内置 id：1→int、2→0.00、3→thousands、4→thousands2、9→percent、10→percent2、
// 日期/时间类→date；自定义格式（numFmts 表，通常 id>=164）仅识别 0.0… 形式。
// 无法识别时返回空串（cellJSON 不输出 fmt 字段）。
func fmtTokenFromNumFmt(numFmtID int, customNumFmt string) string {
	switch numFmtID {
	case 1:
		return "int"
	case 2:
		return "0.00"
	case 3:
		return "thousands"
	case 4:
		return "thousands2"
	case 9:
		return "percent"
	case 10:
		return "percent2"
	}
	if builtinDateNumFmtIDs[numFmtID] {
		return "date"
	}
	if customNumFmt != "" {
		// 货币格式：¥/￥ + 千分位 + 两位小数
		trimmed := strings.TrimSpace(customNumFmt)
		if trimmed == "¥#,##0.00" || trimmed == "￥#,##0.00" || trimmed == `"¥"#,##0.00` {
			return "currency"
		}
	}
	if customNumFmt != "" && customNumFmtPattern.MatchString(customNumFmt) {
		return customNumFmt // 直接以 "0.00"/"0.000" 等作为 token
	}
	return ""
}

// numFmtFromToken 把前端 fmt token 映射回 excelize 样式的数字格式：
// 内置 token 返回内置 numFmtId；"0.0…" 形式的自定义 token 返回 CustomNumFmt 字符串。
func numFmtFromToken(token string) (builtinID int, custom string, ok bool) {
	switch token {
	case "int":
		return 1, "", true
	case "0.00":
		return 2, "", true
	case "thousands":
		return 3, "", true
	case "thousands2":
		return 4, "", true
	case "percent":
		return 9, "", true
	case "percent2":
		return 10, "", true
	case "date":
		return 14, "", true
	case "currency":
		// 货币格式使用自定义格式串（人民币符号 + 千分位 + 两位小数）
		return 0, "¥#,##0.00", true
	}
	if customNumFmtPattern.MatchString(token) {
		return 0, token, true
	}
	return 0, "", false
}

// ---- 数据验证（下拉列表）----

// applyValidations 读取 sheet 的 list 类型数据验证，把字面列表写入每个覆盖
// 单元格 cellJSON 的 valid 字段（不带引号、不带前导 =）。
// 引用单元格区域的列表（如 =$E$1:$E$3）无法还原为字面列表，跳过。
func applyValidations(f *excelize.File, sheet string, sj *sheetJSON) {
	dvs, err := f.GetDataValidations(sheet)
	if err != nil {
		return
	}
	for _, dv := range dvs {
		if dv == nil || !strings.EqualFold(dv.Type, "list") {
			continue
		}
		list := literalList(dv.Formula1)
		if list == "" {
			continue
		}
		for _, rc := range expandSqref(dv.Sqref, sj.Rows, sj.Cols) {
			key := fmt.Sprintf("%d-%d", rc[0], rc[1])
			c, ok := sj.Cells[key]
			if !ok {
				c = cellJSON{}
			}
			c.Valid = list
			sj.Cells[key] = c
		}
	}
}

// literalList 把验证 formula1 规整为字面列表：去掉前导 = 与成对包裹引号。
// 未加引号且形如单元格区域引用（A1、$A$1:$B$2、Sheet1!$A$1:$A$3）的视为引用
// 公式而非字面列表，返回空串。
func literalList(formula1 string) string {
	s := strings.TrimSpace(formula1)
	s = strings.TrimPrefix(s, "=")
	s = strings.TrimSpace(s)
	if len(s) >= 2 && strings.HasPrefix(s, `"`) && strings.HasSuffix(s, `"`) {
		s = s[1 : len(s)-1]
	} else if isCellRangeRef(s) {
		return ""
	}
	s = strings.TrimSpace(s)
	if s == "" || s == `""` {
		return ""
	}
	return s
}

// cellRangeRefPattern 匹配单元格/区域引用（$A$1、A1:B2、$C$3:$D$4）。
var cellRangeRefPattern = regexp.MustCompile(`^\$?[A-Za-z]{1,3}\$?[0-9]+(:\$?[A-Za-z]{1,3}\$?[0-9]+)?$`)

// isCellRangeRef 判断 s 是否为单元格区域引用。
func isCellRangeRef(s string) bool {
	if strings.Contains(s, "!") { // 跨表引用 Sheet1!$A$1:$A$3
		return true
	}
	return cellRangeRefPattern.MatchString(s)
}

// expandSqref 把 sqref（如 "A1"、"A1:B3"，可空格分隔多个区域）展开为
// 0 基 (row, col) 列表。maxRows/maxCols 为网格边界（不含），超出部分直接跳过，
// 避免整列验证（如 A1:A1048576）展开爆内存。
func expandSqref(sqref string, maxRows, maxCols int) [][2]int {
	var out [][2]int
	for _, part := range strings.Fields(sqref) {
		bounds := strings.SplitN(part, ":", 2)
		c1, r1, err := excelize.CellNameToCoordinates(strings.TrimSpace(bounds[0]))
		if err != nil {
			continue
		}
		r2, c2 := r1, c1
		if len(bounds) == 2 {
			if c2, r2, err = excelize.CellNameToCoordinates(strings.TrimSpace(bounds[1])); err != nil {
				continue
			}
		}
		if r2 < r1 {
			r1, r2 = r2, r1
		}
		if c2 < c1 {
			c1, c2 = c2, c1
		}
		for r := r1; r <= r2; r++ {
			if r-1 >= maxRows {
				break
			}
			for c := c1; c <= c2; c++ {
				if c-1 >= maxCols {
					break
				}
				out = append(out, [2]int{r - 1, c - 1})
			}
		}
	}
	return out
}

// writeValidations 把 cellJSON 的 valid（逗号分隔列表）写为 list 类型
// DataValidation：同一列表的单元格按行分组为连续区间，每个区间一条验证；
// 列表总长超过 Excel 上限 255 字符时跳过（无法完整还原）。
func writeValidations(f *excelize.File, sheet string, sj *sheetJSON) {
	byList := map[string][]validCellPos{}
	lists := []string{}
	for key, cj := range sj.Cells {
		if cj.Valid == "" || cj.HiddenBy != "" {
			continue // 被合并覆盖的单元格不单独挂验证
		}
		parts := strings.SplitN(key, "-", 2)
		if len(parts) != 2 {
			continue
		}
		var r, c int
		if _, err := fmt.Sscanf(parts[0]+" "+parts[1], "%d %d", &r, &c); err != nil {
			continue
		}
		if _, ok := byList[cj.Valid]; !ok {
			lists = append(lists, cj.Valid)
		}
		byList[cj.Valid] = append(byList[cj.Valid], validCellPos{r, c})
	}
	sort.Strings(lists) // 稳定输出顺序
	for _, list := range lists {
		cells := byList[list]
		sort.Slice(cells, func(i, j int) bool {
			if cells[i].r != cells[j].r {
				return cells[i].r < cells[j].r
			}
			return cells[i].c < cells[j].c
		})
		items := splitList(list)
		joined := strings.Join(items, ",")
		if len(joined) >= 255 {
			continue
		}
		for _, run := range groupContiguousRuns(cells) {
			startRef, err1 := excelize.CoordinatesToCellName(run[0].c+1, run[0].r+1)
			endRef, err2 := excelize.CoordinatesToCellName(run[len(run)-1].c+1, run[len(run)-1].r+1)
			if err1 != nil || err2 != nil {
				continue
			}
			sqref := startRef
			if startRef != endRef {
				sqref = startRef + ":" + endRef
			}
			dv := excelize.NewDataValidation(true)
			dv.SetSqref(sqref)
			if err := dv.SetDropList(items); err != nil {
				continue
			}
			_ = f.AddDataValidation(sheet, dv)
		}
	}
}

// validCellPos 是带验证单元格的 0 基坐标。
type validCellPos struct{ r, c int }

// groupContiguousRuns 把已排序的单元格按行、按列连续性分组为若干连续区间
// （同一行且列号依次 +1 的归为一段）。
func groupContiguousRuns(cells []validCellPos) [][]validCellPos {
	var runs [][]validCellPos
	var cur []validCellPos
	for _, p := range cells {
		if len(cur) > 0 && (p.r != cur[len(cur)-1].r || p.c != cur[len(cur)-1].c+1) {
			runs = append(runs, cur)
			cur = nil
		}
		cur = append(cur, p)
	}
	if len(cur) > 0 {
		runs = append(runs, cur)
	}
	return runs
}

// splitList 把逗号分隔的验证列表拆分为条目（去首尾空白、去空项）。
func splitList(list string) []string {
	var items []string
	for _, s := range strings.Split(list, ",") {
		s = strings.TrimSpace(s)
		if s != "" {
			items = append(items, s)
		}
	}
	return items
}
