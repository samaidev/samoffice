// Package xlsx 实现 .xlsx 文件解析，基于 excelize 封装
// 容错策略：损坏单元格跳过，未知类型降级为字符串
package xlsx

import (
        "bytes"
        "fmt"
        "io"
        "strings"

        "github.com/xuri/excelize/v2"
        "github.com/zai/samoffice/internal/core"
)

type Parser struct{}

func New() *Parser { return &Parser{} }

func (p *Parser) Supported() []string { return []string{".xlsx"} }

func (p *Parser) CanParse(path string, header []byte) bool {
        return strings.HasSuffix(strings.ToLower(path), ".xlsx")
}

// Parse 解析 xlsx 为 UDM
// 每个 sheet 转换为一个 Table block
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

        doc := &core.Document{
                Meta:   core.Meta{Title: "Spreadsheet"},
                Blocks: []core.Block{},
        }

        sheets := f.GetSheetList()
        for _, sheetName := range sheets {
                rows, err := f.GetRows(sheetName)
                if err != nil {
                        warnings = append(warnings, core.Warning{
                                Level: "warn", Stage: "xml",
                                Message: fmt.Sprintf("read sheet %s: %v", sheetName, err),
                        })
                        continue
                }

                table := buildTable(rows, sheetName)
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

// buildTable 将 excelize 的 [][]string 转换为 UDM Table
func buildTable(rows [][]string, sheetName string) core.Table {
        maxRows := 1000
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
        for _, row := range rows {
                cells := make([]core.TableCell, 0, maxCols)
                for c := 0; c < maxCols; c++ {
                        var val string
                        if c < len(row) {
                                val = row[c]
                        }
                        cells = append(cells, core.TableCell{
                                Inline: []core.Inline{core.Text{Content: val}},
                        })
                }
                tableCells = append(tableCells, cells)
        }

        if len(tableCells) > 0 {
                for i := range tableCells[0] {
                        tableCells[0][i].IsHeader = true
                }
        }

        return core.Table{
                Rows:  tableCells,
                Style: sheetName,
        }
}
