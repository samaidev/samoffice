// CSV/TSV 解析为 UDM：每行一个 TableRow，每个字段一个 TableCell（inline 文本）。
// 这样前端 tablesToSheets() 能直接把它当作一个 sheet 处理，并在表格视图中打开。
package csv

import (
	"bytes"
	"encoding/csv"
	"io"
	"strings"

	"github.com/zai/samoffice/internal/core"
)

type Parser struct{}

// New 创建一个 CSV/TSV 解析器
func New() *Parser { return &Parser{} }

// Supported 返回支持的扩展名
func (x *Parser) Supported() []string { return []string{".csv", ".tsv"} }

// CanParse 按扩展名判断
func (x *Parser) CanParse(path string, header []byte) bool {
	p := strings.ToLower(path)
	return strings.HasSuffix(p, ".csv") || strings.HasSuffix(p, ".tsv")
}

// Parse 把 CSV/TSV 流解析为 UDM 文档（单个 Table 块）
func (x *Parser) Parse(r io.Reader) (*core.Document, []core.Warning, error) {
	raw, err := io.ReadAll(r)
	if err != nil {
		return nil, nil, err
	}

	// 通过首行是否含制表符自动判定分隔符（tsv/csv）
	delim := ','
	if firstLine := strings.SplitN(string(raw), "\n", 2)[0]; strings.Contains(firstLine, "\t") {
		delim = '\t'
	}

	cr := csv.NewReader(bytes.NewReader(raw))
	cr.Comma = delim
	cr.FieldsPerRecord = -1
	cr.LazyQuotes = true

	rows := [][]core.TableCell{}
	for {
		rec, rerr := cr.Read()
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			// 跳过无法解析的行，继续读取后续内容
			continue
		}
		row := make([]core.TableCell, 0, len(rec))
		for _, f := range rec {
			row = append(row, core.TableCell{
				Inline: []core.Inline{core.Text{Content: f}},
			})
		}
		rows = append(rows, row)
	}
	if len(rows) == 0 {
		rows = append(rows, []core.TableCell{})
	}

	doc := &core.Document{
		Meta: core.Meta{Title: "Sheet1"},
		Blocks: []core.Block{
			&core.Table{Rows: rows, Style: "Sheet1"},
		},
	}
	return doc, nil, nil
}
