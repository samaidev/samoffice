package main

import (
	"fmt"
	"log"

	"github.com/zai/samoffice/pkg/pdfgo"
)

func main() {
	doc := pdfgo.New()
	doc.SetTitle("pdfgo 演示报告").SetAuthor("SamAI Group").SetSubject("API 能力展示")
	doc.SetPageSize(pdfgo.PageSizeA4)
	doc.SetMargins(pdfgo.Margins{Top: 60, Bottom: 60, Left: 60, Right: 60})
	doc.SetPageNumber(true)
	doc.SetFontSize(12)

	// 大标题
	doc.AddHeading("pdfgo 演示报告", 1).SetAlign("center")

	// 副标题
	p := doc.AddParagraph("基于 signintech/gopdf 构建，提供与 docgo 一致的链式 API")
	p.SetAlign("center").SetFontSize(11)
	run := p.AddRun("")
	_ = run
	// 简化: 直接添加新段落
	doc.AddParagraph("")

	// 分隔线
	doc.AddDivider()

	// 一级标题
	doc.AddHeading("一、功能概览", 2)

	// 正文段落 (首行缩进)
	p = doc.AddParagraph("")
	p.AddRun("pdfgo 是 samoffice 办公套件的 PDF 生成库，设计与 docgo / pptgo / xlsgo 保持一致的链式 API 风格。支持多级标题、段落、列表、表格、图片、代码块、分隔线、分页符等元素，内置 Noto Serif SC 中文字体，无需外部字体文件即可生成支持中文的 PDF 文档。").Font("宋体")
	p.SetIndent(24) // 首行缩进 24pt (约2字符)
	p.SetLineSpacing(1.6)

	// 二级标题
	doc.AddHeading("二、核心 API", 3)

	// 无序列表
	doc.AddList([]string{
		"AddHeading(text, level) — 多级标题 (1-6 级)",
		"AddParagraph(text).AddRun(text).Bold(true) — 富文本段落",
		"AddList(items) / AddOrderedList(items) — 列表",
		"AddTable(rows) — 表格 (含表头)",
		"AddImage(path, w, h) — 图片 (自动尺寸)",
		"AddCodeBlock(lang, code) — 代码块 (等宽字体)",
		"AddDivider() — 分隔线",
		"AddPageBreak() — 分页符",
	})

	// 二级标题
	doc.AddHeading("三、表格示例", 3)

	// 表格
	doc.AddTable([][]string{
		{"元素", "API", "说明"},
		{"标题", "AddHeading", "1-6 级，自动字号"},
		{"段落", "AddParagraph", "支持富文本 Run"},
		{"列表", "AddList", "有序/无序"},
		{"表格", "AddTable", "自动列宽 + 表头"},
		{"图片", "AddImage", "路径或字节"},
		{"代码", "AddCodeBlock", "等宽字体 + 灰底"},
	})

	// 分页
	doc.AddPageBreak()

	// 二级标题
	doc.AddHeading("四、代码块示例", 3)

	doc.AddParagraph("以下是一个 Go 代码块示例，展示 pdfgo 的链式 API 用法：")

	// 代码块
	doc.AddCodeBlock("go", `// 创建 PDF 文档
doc := pdfgo.New()
doc.SetTitle("报告标题")
doc.SetPageNumber(true)

// 添加标题和正文
doc.AddHeading("第一章", 1)
doc.AddParagraph("正文内容").SetIndent(24)

// 保存
doc.Save("report.pdf")`)

	// 二级标题
	doc.AddHeading("五、政府公文支持", 3)

	p = doc.AddParagraph("")
	p.AddRun("pdfgo 同样支持政府公文 GB/T 9704-2012 标准排版需求：")
	p.SetIndent(24)

	doc.AddList([]string{
		"固定行距: SetLineSpacing(1.4) 或固定 28pt",
		"首行缩进: SetIndent(24) (2 字符)",
		"两端对齐: SetAlign(\"justify\")",
		"中文字体: 内置 Noto Serif SC (宋体)",
		"页面设置: A4 + 自定义页边距",
	})

	// 分隔线
	doc.AddDivider()

	// 结尾
	doc.AddHeading("SamAI Group", 4).SetAlign("center")
	p = doc.AddParagraph("samai.cc · 永久公益开源")
	p.SetAlign("center").SetFontSize(10)

	// 保存
	outPath := "/home/z/my-project/download/pdfgo-演示报告.pdf"
	if err := doc.Save(outPath); err != nil {
		log.Fatal(err)
	}
	fmt.Printf("✅ 已保存 %s\n", outPath)
	fmt.Printf("   元素数: %d\n", len(doc.Elements()))
}
