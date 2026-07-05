// Package xlsgo 提供简洁的 .xlsx 文件读写 API
// 设计参考 openpyxl，基于 excelize 封装
//
// 快速开始：
//
//      // 创建工作簿
//      wb := xlsgo.New()
//      ws := wb.ActiveSheet()
//      ws.SetCell("A1", "姓名")
//      ws.SetCell("B1", "分数")
//      ws.SetCell("A2", "张三")
//      ws.SetCellNumber("B2", 95)
//      ws.SetCellFormula("C2", "=B2*0.9")
//      wb.Save("scores.xlsx")
//
//      // 读取工作簿
//      wb, err := xlsgo.Open("scores.xlsx")
//      ws := wb.ActiveSheet()
//      val, _ := ws.GetCell("A2")  // "张三"
//      num, _ := ws.GetNumber("B2") // 95
package xlsgo

import (
        "bytes"
        "fmt"
        "strings"

        "github.com/xuri/excelize/v2"
)

// Workbook 表示一个 Excel 工作簿
type Workbook struct {
        f        *excelize.File
        sheets   []string
        activeIdx int
}

// Sheet 表示一个工作表
type Sheet struct {
        wb     *Workbook
        name   string
}

// New 创建新工作簿
func New() *Workbook {
        f := excelize.NewFile()
        sheets := f.GetSheetList()
        return &Workbook{f: f, sheets: sheets, activeIdx: 0}
}

// Open 打开已有 xlsx 文件
func Open(path string) (*Workbook, error) {
        f, err := excelize.OpenFile(path)
        if err != nil {
                return nil, err
        }
        return &Workbook{f: f, sheets: f.GetSheetList(), activeIdx: 0}, nil
}

// Save 保存工作簿
func (wb *Workbook) Save(path string) error {
        return wb.f.SaveAs(path)
}

// Bytes 生成 xlsx 字节流
func (wb *Workbook) Bytes() ([]byte, error) {
        buf := &bytes.Buffer{}
        if _, err := wb.f.WriteTo(buf); err != nil {
                return nil, err
        }
        return buf.Bytes(), nil
}

// Close 关闭工作簿
func (wb *Workbook) Close() error {
        return wb.f.Close()
}

// Sheets 返回所有工作表名
func (wb *Workbook) Sheets() []string {
        return wb.f.GetSheetList()
}

// ActiveSheet 返回活动工作表
func (wb *Workbook) ActiveSheet() *Sheet {
        sheets := wb.f.GetSheetList()
        if len(sheets) == 0 {
                // 创建默认 Sheet
                wb.f.NewSheet("Sheet1")
                sheets = wb.f.GetSheetList()
        }
        return &Sheet{wb: wb, name: sheets[wb.activeIdx]}
}

// GetSheet 按名获取工作表
func (wb *Workbook) GetSheet(name string) *Sheet {
        return &Sheet{wb: wb, name: name}
}

// AddSheet 添加新工作表
func (wb *Workbook) AddSheet(name string) *Sheet {
        wb.f.NewSheet(name)
        return &Sheet{wb: wb, name: name}
}

// SetActive 设置活动工作表
func (wb *Workbook) SetActive(name string) {
        idx, _ := wb.f.GetSheetIndex(name)
        if idx >= 0 {
                wb.f.SetActiveSheet(idx)
                wb.activeIdx = idx
        }
}

// === Sheet 操作 ===

// SetCell 设置单元格字符串值
func (s *Sheet) SetCell(cell, value string) error {
        return s.wb.f.SetCellValue(s.name, cell, value)
}

// SetCellNumber 设置数字值
func (s *Sheet) SetCellNumber(cell string, value float64) error {
        return s.wb.f.SetCellValue(s.name, cell, value)
}

// SetCellInt 设置整数值
func (s *Sheet) SetCellInt(cell string, value int) error {
        return s.wb.f.SetCellValue(s.name, cell, value)
}

// SetCellFormula 设置公式
func (s *Sheet) SetCellFormula(cell, formula string) error {
        return s.wb.f.SetCellFormula(s.name, cell, formula)
}

// SetCellStyleBold 设置单元格加粗
func (s *Sheet) SetCellStyleBold(cell string) error {
        style, err := s.wb.f.NewStyle(&excelize.Style{
                Font: &excelize.Font{Bold: true},
        })
        if err != nil {
                return err
        }
        return s.wb.f.SetCellStyle(s.name, cell, cell, style)
}

// SetCellStyleHeader 设置表头样式（加粗+灰底）
func (s *Sheet) SetCellStyleHeader(cell string) error {
        style, err := s.wb.f.NewStyle(&excelize.Style{
                Font: &excelize.Font{Bold: true},
                Fill: excelize.Fill{
                        Type:    "pattern",
                        Pattern: 1,
                        Color:   []string{"#EEEEEE"},
                },
        })
        if err != nil {
                return err
        }
        return s.wb.f.SetCellStyle(s.name, cell, cell, style)
}

// GetCell 获取单元格字符串值
func (s *Sheet) GetCell(cell string) (string, error) {
        return s.wb.f.GetCellValue(s.name, cell)
}

// GetNumber 获取单元格数字值
func (s *Sheet) GetNumber(cell string) (float64, error) {
        val, err := s.wb.f.GetCellValue(s.name, cell, excelize.Options{RawCellValue: true})
        if err != nil {
                return 0, err
        }
        var num float64
        _, err = fmt.Sscanf(val, "%f", &num)
        return num, err
}

// GetFormula 获取单元格公式
func (s *Sheet) GetFormula(cell string) (string, error) {
        return s.wb.f.GetCellFormula(s.name, cell)
}

// Rows 返回所有行
func (s *Sheet) Rows() ([][]string, error) {
        return s.wb.f.GetRows(s.name)
}

// SetRow 设置整行数据
func (s *Sheet) SetRow(row int, values []string) error {
        cell, _ := excelize.CoordinatesToCellName(1, row)
        return s.wb.f.SetSheetRow(s.name, cell, &values)
}

// SetColWidth 设置列宽
func (s *Sheet) SetColWidth(col string, width float64) error {
        return s.wb.f.SetColWidth(s.name, col, col, width)
}

// MergeCell 合并单元格
func (s *Sheet) MergeCell(rangeStr string) error {
        return s.wb.f.MergeCell(s.name, rangeStr, rangeStr)
}

// Name 返回工作表名
func (s *Sheet) Name() string { return s.name }

// MaxRow 返回最大行数
func (s *Sheet) MaxRow() int {
        dim, err := s.wb.f.GetSheetDimension(s.name)
        if err != nil || dim == "" {
                return 0
        }
        // dim 格式 "A1:B10"，简单提取
        parts := strings.Split(dim, ":")
        if len(parts) < 2 { return 0 }
        // 提取数字
        var row int
        for _, c := range parts[1] {
                if c >= '0' && c <= '9' {
                        row = row*10 + int(c-'0')
                }
        }
        return row
}

// === 便捷方法 ===

// FillTable 从二维数组填充表格（含表头）
func (s *Sheet) FillTable(startCell string, data [][]string) error {
        col, row, err := excelize.CellNameToCoordinates(startCell)
        if err != nil {
                return err
        }
        for ri, rowData := range data {
                for ci, val := range rowData {
                        cell, _ := excelize.CoordinatesToCellName(col+ci, row+ri)
                        if err := s.wb.f.SetCellValue(s.name, cell, val); err != nil {
                                return err
                        }
                        // 第一行加表头样式
                        if ri == 0 {
                                s.SetCellStyleHeader(cell)
                        }
                }
        }
        return nil
}

// ReadAll 读取所有数据为二维数组
func (s *Sheet) ReadAll() ([][]string, error) {
        return s.wb.f.GetRows(s.name)
}

// === 高级功能 ===

// FreezePanes 冻结窗格
// cell: 冻结点，如 "B2" 表示冻结第一行和第一列
func (s *Sheet) FreezePanes(cell string) error {
        return s.wb.f.SetPanes(s.name, &excelize.Panes{
                Freeze:      true,
                Split:       false,
                XSplit:      0,
                YSplit:      0,
                TopLeftCell: cell,
                ActivePane:  "bottomRight",
        })
}

// AddChart 添加图表
// chartType: "bar" / "line" / "pie" / "scatter"
// rangeStr: 数据范围，如 "A1:B5"
// cell: 图表锚点单元格，如 "D1"
func (s *Sheet) AddChart(chartType, rangeStr, cell string) error {
        var ct excelize.ChartType
        switch chartType {
        case "bar":
                ct = excelize.Bar
        case "line":
                ct = excelize.Line
        case "pie":
                ct = excelize.Pie
        case "scatter":
                ct = excelize.Scatter
        default:
                ct = excelize.Bar
        }
        return s.wb.f.AddChart(s.name, "Chart1", &excelize.Chart{
                Type: ct,
                Series: []excelize.ChartSeries{
                        {
                                Name:       "Series 1",
                                Categories: fmt.Sprintf("%s!%s", s.name, rangeStr),
                                Values:     fmt.Sprintf("%s!%s", s.name, rangeStr),
                        },
                },
                Format: excelize.GraphicOptions{
                        LockAspectRatio: false,
                        OffsetX:         15,
                        OffsetY:         10,
                },
        })
}

// SetConditionalFormat 条件格式：高于阈值高亮
// rangeStr: 应用范围，如 "B2:B10"
// rule: "greaterThan:90" / "lessThan:60" / "between:60,90"
func (s *Sheet) SetConditionalFormat(rangeStr, rule string) error {
        var format excelize.ConditionalFormatOptions

        if strings.HasPrefix(rule, "greaterThan:") {
                val := strings.TrimPrefix(rule, "greaterThan:")
                v := val
                format.Type = "cellIs"
                format.Criteria = "greaterThan"
                format.Value = val
                _ = v
        } else if strings.HasPrefix(rule, "lessThan:") {
                val := strings.TrimPrefix(rule, "lessThan:")
                format.Type = "cellIs"
                format.Criteria = "lessThan"
                format.Value = val
        } else if strings.HasPrefix(rule, "between:") {
                vals := strings.Split(strings.TrimPrefix(rule, "between:"), ",")
                if len(vals) == 2 {
                        format.Type = "cellIs"
                        format.Criteria = "between"
                        format.MinValue = strings.TrimSpace(vals[0])
                        format.MaxValue = strings.TrimSpace(vals[1])
                }
        }

        return s.wb.f.SetConditionalFormat(s.name, rangeStr, []excelize.ConditionalFormatOptions{format})
}

// AutoFilter 设置自动筛选
// rangeStr: 筛选范围，如 "A1:D10"
func (s *Sheet) AutoFilter(rangeStr string) error {
        return s.wb.f.AutoFilter(s.name, rangeStr, []excelize.AutoFilterOptions{})
}

// SetColumnColor 设置列字体颜色
func (s *Sheet) SetColumnColor(col, hexColor string) error {
        style, err := s.wb.f.NewStyle(&excelize.Style{
                Font: &excelize.Font{Color: hexColor},
        })
        if err != nil {
                return err
        }
        return s.wb.f.SetColStyle(s.name, col, style)
}

// SetRowHeight 设置行高
func (s *Sheet) SetRowHeight(row int, height float64) error {
        return s.wb.f.SetRowHeight(s.name, row, height)
}

// AddDataValidation 添加数据验证（下拉列表）
// rangeStr: 应用范围
// list: 下拉选项，如 `"Yes,No,Maybe"`
func (s *Sheet) AddDataValidation(rangeStr, list string) error {
        dv := excelize.NewDataValidation(true)
        dv.ShowDropDown = true
        dv.SetDropList(strings.Split(list, ","))
        dv.Sqref = rangeStr
        return s.wb.f.AddDataValidation(s.name, dv)
}

// MustCellName 坐标转单元格名（忽略错误）
func MustCellName(col, row int) string {
        name, _ := excelize.CoordinatesToCellName(col, row)
        return name
}
