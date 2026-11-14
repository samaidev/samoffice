package main

// dumpxlsx 调用 xlsx.ReadXLSX（前端实际使用的路径）并汇总 bg/color 分布
import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/zai/samoffice/internal/parser/xlsx"
)

func main() {
	j, err := xlsx.ReadXLSX(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	var wb struct {
		Sheets []struct {
			Name  string `json:"name"`
			Cells map[string]struct {
				Value string `json:"value"`
				Color string `json:"color"`
				Bg    string `json:"bg"`
			} `json:"cells"`
		} `json:"sheets"`
	}
	if err := json.Unmarshal([]byte(j), &wb); err != nil {
		panic(err)
	}
	for _, s := range wb.Sheets {
		bgs, colors := map[string]int{}, map[string]int{}
		for _, c := range s.Cells {
			if c.Bg != "" {
				bgs[c.Bg]++
			}
			if c.Color != "" {
				colors[c.Color]++
			}
		}
		fmt.Printf("sheet=%s cells=%d bg分布=%v color分布=%v\n", s.Name, len(s.Cells), bgs, colors)
		// 打印前 8 个单元格明细
		n := 0
		for k, c := range s.Cells {
			if n >= 8 {
				break
			}
			fmt.Printf("  %s value=%q bg=%q color=%q\n", k, c.Value, c.Bg, c.Color)
			n++
		}
	}
}
