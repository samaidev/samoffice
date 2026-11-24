// mkfixture r61 —— 生成 e2e 探针用的 fixtures/r61.xlsx：3×4 水果季度数据表。
// 跑法：go run ./scripts/mkfixture/r61/main.go
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/zai/samoffice/internal/parser/xlsx"
)

type cellJ struct {
	Value string `json:"value"`
}
type sheetJ struct {
	Name  string           `json:"name"`
	Rows  int              `json:"rows"`
	Cols  int              `json:"cols"`
	Cells map[string]cellJ `json:"cells"`
}
type workbookJ struct {
	Sheets []sheetJ `json:"sheets"`
}

func main() {
	out := filepath.Join("scripts", "e2e-web", "fixtures", "r61.xlsx")
	if len(os.Args) > 1 {
		out = os.Args[1]
	}
	cells := map[string]cellJ{}
	grid := [][]string{
		{"水果", "Q1", "Q2", "Q3"},
		{"苹果", "10", "20", "30"},
		{"香蕉", "15", "25", "35"},
	}
	for r, row := range grid {
		for c, v := range row {
			cells[fmt.Sprintf("%d-%d", r, c)] = cellJ{Value: v}
		}
	}
	wb := workbookJ{Sheets: []sheetJ{{Name: "S1", Rows: 24, Cols: 14, Cells: cells}}}
	b, err := json.Marshal(wb)
	if err != nil {
		panic(err)
	}
	data, err := xlsx.WriteXLSXBytes(string(b))
	if err != nil {
		panic(err)
	}
	if err := os.WriteFile(out, data, 0o644); err != nil {
		panic(err)
	}
	fmt.Println("written:", out, len(data), "bytes")
}
