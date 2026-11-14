package main

import (
	"fmt"
	"os"

	"github.com/xuri/excelize/v2"
)

func main() {
	f := excelize.NewFile()
	sheet := "Sheet1"
	idx, _ := f.NewSheet(sheet)
	f.SetActiveSheet(idx)

	// 稀疏数据：表头 3 列，但数据行只在 A 列有值，B/C 列为空（会触发越界）
	f.SetCellValue(sheet, "A1", "姓名")
	f.SetCellValue(sheet, "B1", "分数")
	f.SetCellValue(sheet, "A2", "张三") // B2/C2 留空
	f.SetCellValue(sheet, "A5", "李四") // 跳行，中间为空
	// 给 A1 加粗
	styleID, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
	_ = f.SetCellStyle(sheet, "A1", "A1", styleID)

	if err := f.SaveAs("test_sparse.xlsx"); err != nil {
		fmt.Println("save:", err)
		os.Exit(1)
	}
	fmt.Println("written test_sparse.xlsx")
}
