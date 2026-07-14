package main

import (
	"fmt"
	"log"

	"github.com/zai/samoffice/pkg/pptgo"
)

func main() {
	prs := pptgo.New()
	prs.SetTitle("GoOffice 高级功能演示").SetAuthor("SamAI Group")
	prs.SetAutoPlay(true, 5) // 自动播放，每页5秒

	// === Slide 1: 标题页 ===
	s1 := prs.AddSlide()
	s1.SetLayout(pptgo.LayoutTitle)
	s1.AddTitle("GoOffice PPT 高级功能")
	s1.AddSubtitle("形状 · 动画 · 流程图 · 艺术字 · 特效")
	s1.SetBgColor("#1e293b")
	s1.SetTransition("fade", 500)
	s1.AddEntranceAnim("title", "zoom", 0, 1000)
	s1.AddEntranceAnim("subtitle", "fade", 500, 800)

	// === Slide 2: 形状 + 特效 ===
	s2 := prs.AddSlide()
	s2.AddTitle("形状与特效")
	s2.SetTransition("push", 500)

	// 矩形带阴影
	s2.AddShape("rect", 914400, 1828800, 2286000, 1143000).
		SetText("阴影矩形").
		SetFill("#4f46e5").
		SetShadow(true)

	// 圆角矩形带渐变
	s2.AddShape("roundRect", 3429000, 1828800, 2286000, 1143000).
		SetText("渐变圆角").
		SetGradient("6366f1,818cf8").
		SetShadow(true)

	// 椭圆带发光
	s2.AddShape("ellipse", 5943600, 1828800, 2286000, 1143000).
		SetText("发光椭圆").
		SetFill("#10b981").
		SetGlow(true, "#34d399", 80000)

	// 星形带旋转
	s2.AddShape("star5", 914400, 3429000, 2286000, 1143000).
		SetText("旋转星形").
		SetFill("#f59e0b").
		SetRotation(15).
		SetShadow(true)

	// 箭头
	s2.AddShape("rightArrow", 3429000, 3429000, 2286000, 1143000).
		SetText("箭头").
		SetFill("#ef4444").
		SetShadow(true)

	// 三角形带反射
	s2.AddShape("triangle", 5943600, 3429000, 2286000, 1143000).
		SetText("反射三角").
		SetFill("#8b5cf6").
		SetReflection(true)

	// 菱形带柔边
	s2.AddShape("diamond", 8458200, 3429000, 2286000, 1143000).
		SetText("柔边菱形").
		SetFill("#ec4899").
		SetSoftEdge(true)

	s2.AddEntranceAnim("shape_1", "fly", 0, 500)
	s2.AddEntranceAnim("shape_2", "fly", 200, 500)
	s2.AddEntranceAnim("shape_3", "zoom", 400, 500)

	// === Slide 3: 艺术字 ===
	s3 := prs.AddSlide()
	s3.AddTitle("艺术字效果")
	s3.SetBgColor("#0f172a")
	s3.SetTransition("zoom", 600)

	// 渐变艺术字
	s3.AddArtText("GoOffice", 1838400, 1828800, 8515200, 1828800).
		SetFontSize(54).
		SetGradient("4f46e5,818cf8").
		SetShadow(true)

	// 描边艺术字
	s3.AddArtText("SamAI Group", 1838400, 4114800, 8515200, 1143000).
		SetFontSize(36).
		SetColor("#f1f5f9").
		SetOutline("#4f46e5", 12700).
		SetGlow(true, "#6366f1")

	// 旋转艺术字
	s3.AddArtText("samai.cc", 2743200, 5715000, 5715000, 914400).
		SetFontSize(28).
		SetColor("#94a3b8").
		SetRotation(-10).
		SetReflection(true)

	s3.AddEntranceAnim("title", "fade", 0, 800)

	// === Slide 4: 智能流程图 ===
	s4 := prs.AddSlide()
	s4.AddTitle("智能流程图")
	s4.SetTransition("wipe", 500)

	nodes := []pptgo.FlowNode{
		{Text: "用户输入", Type: "start"},
		{Text: "AI 处理", Type: "process"},
		{Text: "判断结果", Type: "decision"},
		{Text: "输出文档", Type: "end"},
	}
	s4.AddFlowChart(nodes, 1371600, 2057400, "horizontal").
		SetNodeSize(2286000, 1143000).
		SetNodeGap(685800)

	s4.AddEntranceAnim("shape_1", "fly", 0, 400)
	s4.AddEntranceAnim("shape_2", "fly", 300, 400)
	s4.AddEntranceAnim("shape_3", "fly", 600, 400)
	s4.AddEntranceAnim("shape_4", "fly", 900, 400)

	// === Slide 5: 动画展示 ===
	s5 := prs.AddSlide()
	s5.AddTitle("动画效果展示")
	s5.SetTransition("morph", 500)

	s5.AddShape("rect", 1371600, 1828800, 1828800, 1143000).
		SetText("淡入").
		SetFill("#4f46e5")
	s5.AddEntranceAnim("shape_1", "fade", 0, 800)

	s5.AddShape("rect", 3657600, 1828800, 1828800, 1143000).
		SetText("飞入").
		SetFill("#10b981")
	s5.AddEntranceAnim("shape_2", "fly", 500, 600)

	s5.AddShape("rect", 5943600, 1828800, 1828800, 1143000).
		SetText("缩放").
		SetFill("#f59e0b")
	s5.AddEntranceAnim("shape_3", "zoom", 1000, 600)

	s5.AddShape("rect", 8229600, 1828800, 1828800, 1143000).
		SetText("弹跳").
		SetFill("#ef4444")
	s5.AddEntranceAnim("shape_4", "bounce", 1500, 800)

	// 强调动画
	s5.AddEmphasisAnim("shape_1", "pulse", 2500, 500)
	s5.AddEmphasisAnim("shape_2", "spin", 3000, 800)

	s5.SetNotes("这页展示了4种进入动画和2种强调动画。")

	// === Slide 6: 结尾 ===
	s6 := prs.AddSlide()
	s6.SetLayout(pptgo.LayoutTitle)
	s6.AddTitle("SamAI Group")
	s6.AddSubtitle("samai.cc · 永久公益开源")
	s6.SetBgColor("#1e293b")
	s6.SetTransition("fade", 800)
	s6.SetAdvanceTime(3)

	err := prs.Save("/home/z/my-project/download/GoOffice-高级PPT演示.pptx")
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("✅ 已保存 GoOffice-高级PPT演示.pptx\n")
	fmt.Printf("   幻灯片数: %d\n", len(prs.Slides()))
	for i, s := range prs.Slides() {
		fmt.Printf("   Slide %d: %s (动画:%d, 形状:%d)\n", i+1, s.Title(), len(s.Animations()), 0)
	}
}
