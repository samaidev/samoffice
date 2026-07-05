// xlsgo 示例：创建成绩表
package main

import (
	"fmt"
	"log"

	"github.com/zai/gooffice/pkg/xlsgo"
)

func main() {
	wb := xlsgo.New()
	ws := wb.ActiveSheet()

	// 表头
	ws.SetCell("A1", "姓名")
	ws.SetCell("B1", "语文")
	ws.SetCell("C1", "数学")
	ws.SetCell("D1", "总分")
	ws.SetCellStyleHeader("A1")
	ws.SetCellStyleHeader("B1")
	ws.SetCellStyleHeader("C1")
	ws.SetCellStyleHeader("D1")

	// 数据
	students := []struct {
		name string
		chinese, math int
	}{
		{"张三", 85, 92},
		{"李四", 78, 88},
		{"王五", 90, 95},
	}

	for i, s := range students {
		row := i + 2
		ws.SetCell(fmt.Sprintf("A%d", row), s.name)
		ws.SetCellInt(fmt.Sprintf("B%d", row), s.chinese)
		ws.SetCellInt(fmt.Sprintf("C%d", row), s.math)
		ws.SetCellFormula(fmt.Sprintf("D%d", row), fmt.Sprintf("=B%d+C%d", row, row))
	}

	ws.SetColWidth("A", 15)
	ws.SetColWidth("B", 10)
	ws.SetColWidth("C", 10)
	ws.SetColWidth("D", 10)

	err := wb.Save("/tmp/xlsgo-example.xlsx")
	if err != nil { log.Fatal(err) }
	fmt.Println("✅ 已保存 /tmp/xlsgo-example.xlsx")

	// 读取验证
	wb2, _ := xlsgo.Open("/tmp/xlsgo-example.xlsx")
	ws2 := wb2.ActiveSheet()
	rows, _ := ws2.ReadAll()
	for _, row := range rows {
		fmt.Println(row)
	}
	wb2.Close()
}
