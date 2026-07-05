// pptgo 示例：创建演示文稿
package main

import (
	"fmt"
	"log"

	"github.com/zai/gooffice/pkg/pptgo"
)

func main() {
	prs := pptgo.New()
	prs.SetTitle("GoOffice 产品介绍")
	prs.SetAuthor("SamAI Group")

	// 第一张：标题页
	slide1 := prs.AddSlide()
	slide1.SetLayout(pptgo.LayoutTitle)
	slide1.AddTitle("GoOffice")
	slide1.AddSubtitle("跨平台办公套件 · 用 Go + Web 构建")

	// 第二张：内容页
	slide2 := prs.AddSlide()
	slide2.SetLayout(pptgo.LayoutContent)
	slide2.AddTitle("核心功能")
	slide2.AddBullets([]string{
		"文档编辑（ProseMirror）",
		"表格编辑（多 Sheet）",
		"演示编辑（多布局）",
		"Markdown + HTML 编辑",
		"PDF / docx 导出",
	})

	// 第三张：亮点
	slide3 := prs.AddSlide()
	slide3.SetLayout(pptgo.LayoutContent)
	slide3.AddTitle("技术亮点")
	slide3.AddBullets([]string{
		"SymSpell 拼写纠错（纯 Go）",
		"Hunspell 词库 + aff 派生",
		"jieba 中文分词",
		"深色模式 + 响应式",
		"Wails 桌面 + HTTP 远程双模",
	})
	slide3.SetBgColor("#f0f9ff")

	// 第四张：关于
	slide4 := prs.AddSlide()
	slide4.SetLayout(pptgo.LayoutTitle)
	slide4.AddTitle("SamAI Group")
	slide4.AddSubtitle("samai.cc · 公益开源")
	slide4.SetBgColor("#1e293b")

	err := prs.Save("/tmp/pptgo-example.pptx")
	if err != nil { log.Fatal(err) }
	fmt.Println("✅ 已保存 /tmp/pptgo-example.pptx")
	fmt.Printf("幻灯片数: %d\n", len(prs.Slides()))
	for i, s := range prs.Slides() {
		fmt.Printf("  Slide %d: %s (bullets: %d)\n", i+1, s.Title(), len(s.Bullets()))
	}
}
