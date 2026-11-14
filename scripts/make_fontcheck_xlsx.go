package main

import (
	"path/filepath"

	"github.com/xuri/excelize/v2"
)

func main() {
	f := excelize.NewFile()
	defer func() { _ = f.Close() }()

	type cellSpec struct {
		coord string
		val   string
		font  *excelize.Font
		fill  string
		align string
	}
	specs := []cellSpec{
		{"A1", "宋体标题", &excelize.Font{Family: "宋体", Bold: true, Size: 18, Color: "FFFF0000"}, "FFFFFF00", "center"},
		{"B1", "微软雅黑", &excelize.Font{Family: "微软雅黑", Italic: true, Size: 12}, "FFC6EFCE", "left"},
		{"A2", "下划线红字", &excelize.Font{Family: "宋体", Underline: "single", Color: "FFFF0000"}, "", "right"},
		{"B2", "删除线", &excelize.Font{Family: "等线", Strike: true}, "", "center"},
		{"A3", "大字号黄底", &excelize.Font{Family: "黑体", Size: 22}, "FFFFFF00", "center"},
		{"B3", "普通 Calibri", &excelize.Font{Family: "Calibri", Size: 11}, "", "left"},
	}
	for _, s := range specs {
		_ = f.SetCellValue("Sheet1", s.coord, s.val)
		if s.font != nil {
			style := &excelize.Style{Font: s.font}
			if s.align != "" {
				h := "left"
				if s.align == "center" {
					h = "center"
				} else if s.align == "right" {
					h = "right"
				}
				style.Alignment = &excelize.Alignment{Horizontal: h}
			}
			if s.fill != "" {
				style.Fill = excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{s.fill}}
			}
			id, err := f.NewStyle(style)
			if err == nil {
				_ = f.SetCellStyle("Sheet1", s.coord, s.coord, id)
			}
		}
	}

	out := filepath.Join("scripts", "fixtures", "fontcheck.xlsx")
	if err := f.SaveAs(out); err != nil {
		panic(err)
	}
}
