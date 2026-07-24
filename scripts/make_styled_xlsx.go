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

	// A1: 粗体 + 红色 + 居中 + 黄底
	f.SetCellValue(sheet, "A1", "姓名")
	f.SetCellValue(sheet, "B1", "分数")
	styleID, err := f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Color: "FF0000"},
		Alignment: &excelize.Alignment{Horizontal: "center"},
		Fill: excelize.Fill{
			Type:  "pattern",
			Color: []string{"FFFF00"},
		},
	})
	if err == nil {
		_ = f.SetCellStyle(sheet, "A1", "B1", styleID)
	}

	// A2: 普通
	f.SetCellValue(sheet, "A2", "张三")
	f.SetCellValue(sheet, "B2", 95)
	// B2: 斜体 + 右对齐
	styleID2, err := f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Italic: true},
		Alignment: &excelize.Alignment{Horizontal: "right"},
	})
	if err == nil {
		_ = f.SetCellStyle(sheet, "B2", "B2", styleID2)
	}

	if err := f.SaveAs("test_styled.xlsx"); err != nil {
		fmt.Println("save:", err)
		os.Exit(1)
	}
	fmt.Println("written test_styled.xlsx")
}
