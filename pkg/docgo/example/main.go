// docgo 示例：创建一个报告文档
package main

import (
	"fmt"
	"log"

	"github.com/zai/gooffice/pkg/docgo"
)

func main() {
	doc := docgo.New()
	doc.SetTitle("GoOffice 季度报告")
	doc.SetAuthor("SamAI Group")

	doc.AddHeading("GoOffice 季度运营报告", 1)
	doc.AddHeading("概述", 2)
	doc.AddParagraph("本季度 GoOffice 项目取得了显著进展。")

	p := doc.AddParagraph("")
	p.AddRun("普通文本 ").Bold(false)
	p.AddRun("加粗文本 ").Bold(true)
	p.AddRun("红色文本").Color("FF0000")

	doc.AddList([]string{"用户增长 150%", "GitHub Star 1000+"})

	doc.AddTable([][]string{
		{"模块", "状态"},
		{"文档", "✅"},
		{"表格", "✅"},
	})

	doc.AddCodeBlock("go", `package main
import "fmt"
func main() { fmt.Println("Hi") }`)

	err := doc.Save("/tmp/docgo-example.docx")
	if err != nil { log.Fatal(err) }
	fmt.Println("✅ 已保存 /tmp/docgo-example.docx")

	doc2, _ := docgo.Open("/tmp/docgo-example.docx")
	fmt.Printf("标题: %s, 作者: %s, 段落数: %d\n", doc2.Title(), doc2.Author(), len(doc2.Paragraphs()))
}
