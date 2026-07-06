package main

import (
	"fmt"
	"log"

	"github.com/zai/gooffice/pkg/pptgo"
)

// Aurora Indigo 主题常量
const (
	bgBase      = "0B1120"
	bgElev      = "131C30"
	bgCard      = "1A2540"
	primary     = "6366F1"
	primaryBr   = "818CF8"
	primaryDp   = "4338CA"
	accent      = "22D3EE"
	accentWarm  = "F59E0B"
	accentPink  = "EC4899"
	accentGreen = "10B981"
	textBright  = "F8FAFC"
	textMuted   = "94A3B8"
	textFaint   = "64748B"
	border      = "334155"
	fontHead    = "Space Grotesk"
	fontBody    = "Inter"
	fontNum     = "Space Grotesk"
)

// EMU helpers
const (
	emuIn    = 914400
	emuCm    = 360000
	slideW   = 12192000 // 1280px @ 96dpi → 13.333in
	slideH   = 6858000  // 720px @ 96dpi → 7.5in
)

func main() {
	prs := pptgo.New()
	prs.SetTitle("GoOffice PPT 高级功能演示 v2").SetAuthor("SamAI Group")

	// === Slide 1: 封面 (Aurora mesh) ===
	s1 := prs.AddSlide()
	s1.SetLayout(pptgo.LayoutBlank)
	// Aurora 背景
	s1.SetBgAurora(bgBase, []pptgo.AuroraGlow{
		{X: 2000000, Y: 1500000, R: 2500000, Color: primary, Alpha: 25},
		{X: 10000000, Y: 5500000, R: 2200000, Color: accent, Alpha: 20},
		{X: 6000000, Y: 3500000, R: 1800000, Color: accentPink, Alpha: 12},
	})
	s1.SetTransition("fade", 600)
	// 顶部 brand mark
	s1.AddShape("roundRect", 600000, 400000, 280000, 280000).
		SetCornerRadius(80000).
		SetGradient(primary + "," + accent)
	// GoOffice 文字
	s1.AddShape("rect", 950000, 430000, 3500000, 280000).
		SetText("GOOFFICE / 2026").
		SetFontSize(11).SetFontColor(textMuted).SetFont(fontHead).SetTextAlign("l")
	// 主标题 (居中)
	s1.AddGlowText(800000, 2200000, 10500000, 900000, "GoOffice PPT", textBright, primary, 44)
	// 渐变副标题
	s1.AddShape("rect", 800000, 3100000, 10500000, 900000).
		SetText("高级功能演示 v2").
		SetFontSize(56).SetFontBold(true).SetFontColor(primaryBr).
		SetFont(fontHead).SetTextAlign("ctr").
		SetGlow(true, primary, 80000)
	// 副标题描述
	s1.AddShape("rect", 1500000, 4100000, 9200000, 500000).
		SetText("形状 · 动画 · 流程图 · 艺术字 · 特效 — 一站式办公演示能力").
		SetFontSize(18).SetFontColor(textMuted).SetFont(fontBody).SetTextAlign("ctr")
	// 元数据分栏
	s1.AddShape("rect", 3500000, 5100000, 2500000, 300000).
		SetText("PRESENTED BY").SetFontSize(10).SetFontColor(textFaint).
		SetFont(fontBody).SetTextAlign("ctr")
	s1.AddShape("rect", 3500000, 5400000, 2500000, 380000).
		SetText("SamAI Group").SetFontSize(18).SetFontBold(true).
		SetFontColor(textBright).SetFont(fontBody).SetTextAlign("ctr")
	// 竖线分隔
	s1.AddShape("rect", 6000000, 5100000, 15000, 700000).SetFill(border)
	s1.AddShape("rect", 6200000, 5100000, 2500000, 300000).
		SetText("DATE").SetFontSize(10).SetFontColor(textFaint).
		SetFont(fontBody).SetTextAlign("ctr")
	s1.AddShape("rect", 6200000, 5400000, 2500000, 380000).
		SetText("2026.07.06").SetFontSize(18).SetFontBold(true).
		SetFontColor(textBright).SetFont(fontBody).SetTextAlign("ctr")
	// 底部 pill
	s1.AddPill(5400000, 6300000, 1400000, 320000, "● LIVE DEMO", accentGreen)
	// 页码
	s1.AddShape("rect", 11000000, 6500000, 1000000, 250000).
		SetText("01 / 06").SetFontSize(10).SetFontColor(textFaint).
		SetFont(fontNum).SetTextAlign("r")

	// === Slide 2: 形状与特效 (Bento Grid) ===
	s2 := prs.AddSlide()
	s2.SetLayout(pptgo.LayoutBlank)
	s2.SetBgGradient([]string{bgBase, bgElev}, 135)
	s2.SetTransition("push", 500)
	// brand mark
	s2.AddShape("roundRect", 600000, 400000, 220000, 220000).
		SetCornerRadius(60000).SetGradient(primary + "," + accent)
	// pill
	s2.AddPill(600000, 800000, 4000000, 320000, "CHAPTER 01 · SHAPES & EFFECTS", primary)
	// 主标题
	s2.AddShape("rect", 600000, 1250000, 8000000, 600000).
		SetText("形状与特效").SetFontSize(40).SetFontBold(true).
		SetFontColor(textBright).SetFont(fontHead).SetTextAlign("l")
	// 副标题
	s2.AddShape("rect", 600000, 1900000, 9000000, 400000).
		SetText("6 种形状 × 4 种特效自由组合 — 阴影、渐变、发光、反射、柔边，覆盖现代演示的全部视觉表达").
		SetFontSize(13).SetFontColor(textMuted).SetFont(fontBody).SetTextAlign("l")

	// Bento grid: 3 cols × 2 rows
	colW := 3400000
	colGap := 200000
	rowH := 1900000
	rowGap := 200000
	x0 := 600000
	y0 := 2500000
	// 卡片1: 大卡片 跨2列 — 阴影矩形 (渐变背景)
	s2.AddCard(x0, y0, colW*2+colGap, rowH).
		SetFill(primaryDp).SetStroke(primary, 8000).SetCornerRadius(200000)
	s2.AddShape("rect", x0+200000, y0+250000, 800000, 250000).
		SetText("DROP SHADOW · 60PX BLUR").SetFontSize(9).SetFontBold(true).
		SetFontColor("C7D2FE").SetFont(fontBody).SetTextAlign("l")
	s2.AddShape("rect", x0+200000, y0+550000, 5000000, 600000).
		SetText("阴影矩形").SetFontSize(28).SetFontBold(true).
		SetFontColor(textBright).SetFont(fontHead).SetTextAlign("l")
	s2.AddShape("rect", x0+200000, y0+1200000, 5000000, 400000).
		SetText("box-shadow: 0 20px 40px rgba(15, 23, 42, 0.12)").
		SetFontSize(11).SetFontColor("C7D2FE").SetFont("Consolas").SetTextAlign("l")

	// 卡片2: 渐变圆角矩形
	s2.AddCard(x0+(colW+colGap)*2, y0, colW, rowH).
		SetGradient(primary + "," + primaryBr).SetCornerRadius(240000).
		SetGlow(true, accent, 60000)
	s2.AddShape("rect", x0+(colW+colGap)*2, y0+600000, colW, 700000).
		SetText("渐变").SetFontSize(24).SetFontBold(true).
		SetFontColor(textBright).SetFont(fontHead).SetTextAlign("ctr")

	// 卡片3: 发光椭圆
	glowCard := s2.AddCard(x0, y0+rowH+rowGap, colW, rowH).
		SetFill(bgCard).SetStroke(border, 6000)
	_ = glowCard
	s2.AddShape("ellipse", x0+colW/2-700000, y0+rowH+rowGap+300000, 1400000, 1400000).
		SetFill(accentGreen).SetGlow(true, accentGreen, 120000)
	s2.AddShape("rect", x0, y0+rowH+rowGap+1750000, colW, 350000).
		SetText("发光椭圆").SetFontSize(14).SetFontBold(true).
		SetFontColor(textBright).SetFont(fontHead).SetTextAlign("ctr")

	// 卡片4: 旋转星形
	s2.AddCard(x0+colW+colGap, y0+rowH+rowGap, colW, rowH).
		SetFill(bgCard).SetStroke(border, 6000)
	s2.AddShape("star5", x0+colW+colGap+colW/2-600000, y0+rowH+rowGap+250000, 1200000, 1200000).
		SetFill(accentWarm).SetRotation(15).SetGlow(true, accentWarm, 80000)
	s2.AddShape("rect", x0+colW+colGap, y0+rowH+rowGap+1550000, colW, 350000).
		SetText("旋转星形").SetFontSize(14).SetFontBold(true).
		SetFontColor(textBright).SetFont(fontHead).SetTextAlign("ctr")

	// 卡片5: 箭头
	s2.AddCard(x0+(colW+colGap)*2, y0+rowH+rowGap, colW, rowH).
		SetFill(bgCard).SetStroke(border, 6000)
	s2.AddShape("rightArrow", x0+(colW+colGap)*2+colW/2-700000, y0+rowH+rowGap+500000, 1400000, 800000).
		SetFill(accentPink).SetGlow(true, accentPink, 80000)
	s2.AddShape("rect", x0+(colW+colGap)*2, y0+rowH+rowGap+1550000, colW, 350000).
		SetText("方向箭头").SetFontSize(14).SetFontBold(true).
		SetFontColor(textBright).SetFont(fontHead).SetTextAlign("ctr")

	// 页码
	s2.AddShape("rect", 11000000, 6500000, 1000000, 250000).
		SetText("02 / 06").SetFontSize(10).SetFontColor(textFaint).
		SetFont(fontNum).SetTextAlign("r")

	// === Slide 3: 艺术字效果 ===
	s3 := prs.AddSlide()
	s3.SetLayout(pptgo.LayoutBlank)
	s3.SetBgGradient([]string{bgBase, bgElev}, 135)
	s3.SetTransition("wipe", 500)
	// brand mark
	s3.AddShape("roundRect", 600000, 400000, 220000, 220000).
		SetCornerRadius(60000).SetGradient(primary + "," + accent)
	// pill
	s3.AddPill(600000, 800000, 3500000, 320000, "CHAPTER 02 · WORDART", primary)
	// 主标题
	s3.AddShape("rect", 600000, 1250000, 8000000, 600000).
		SetText("艺术字效果").SetFontSize(40).SetFontBold(true).
		SetFontColor(textBright).SetFont(fontHead).SetTextAlign("l")

	// 左栏 4 个艺术字示例
	// 示例1: 渐变艺术字
	s3.AddArtText("GoOffice", 600000, 2200000, 6500000, 900000).
		SetFontSize(54).SetGradient(primary + "," + primaryBr).
		SetShadow(true).SetFont(fontHead)
	// 示例2: 描边发光艺术字
	s3.AddArtText("SamAI Group", 600000, 3200000, 6500000, 700000).
		SetFontSize(36).SetColor(textBright).
		SetOutline(primary, 12700).SetGlow(true, primary).
		SetFont(fontHead)
	// 示例3: 旋转反射艺术字
	s3.AddArtText("samai.cc", 600000, 4100000, 6500000, 500000).
		SetFontSize(28).SetColor(textMuted).
		SetRotation(-6).SetReflection(true).SetFont(fontNum)
	// 示例4: 暖色渐变艺术字
	s3.AddArtText("永久公益开源", 600000, 4800000, 6500000, 500000).
		SetFontSize(32).SetGradient(accentWarm + "," + accentPink).
		SetFont(fontBody)

	// 右栏玻璃卡片
	cardX := 7400000
	cardY := 2200000
	cardW := 4100000
	cardH := 3300000
	s3.AddGlassCard(cardX, cardY, cardW, cardH, 60).
		SetFill(bgCard).SetStroke(border, 6000).SetCornerRadius(200000)
	s3.AddPill(cardX+200000, cardY+200000, 1200000, 300000, "4 STYLES", accent)
	s3.AddShape("rect", cardX+200000, cardY+600000, cardW-400000, 450000).
		SetText("四种艺术字风格").SetFontSize(22).SetFontBold(true).
		SetFontColor(textBright).SetFont(fontHead).SetTextAlign("l")
	// 列表
	styles := []string{
		"1. 渐变填充 (Gradient Fill)",
		"2. 描边发光 (Outline + Glow)",
		"3. 旋转反射 (Rotation + Reflection)",
		"4. 双色渐变 (Dual-tone Gradient)",
	}
	for i, st := range styles {
		s3.AddShape("rect", cardX+200000, cardY+1200000+i*380000, cardW-400000, 320000).
			SetText(st).SetFontSize(12).SetFontColor(textMuted).
			SetFont(fontBody).SetTextAlign("l")
	}
	// 分隔线
	s3.AddShape("rect", cardX+200000, cardY+2750000, cardW-400000, 15000).SetFill(border)
	s3.AddShape("rect", cardX+200000, cardY+2850000, cardW-400000, 280000).
		SetText("基于 OOXML <a:r> 标签渲染，完美兼容 PowerPoint").
		SetFontSize(10).SetFontColor(textFaint).SetFont(fontBody).SetTextAlign("l")

	// 页码
	s3.AddShape("rect", 11000000, 6500000, 1000000, 250000).
		SetText("03 / 06").SetFontSize(10).SetFontColor(textFaint).
		SetFont(fontNum).SetTextAlign("r")

	// === Slide 4: 智能流程图 ===
	s4 := prs.AddSlide()
	s4.SetLayout(pptgo.LayoutBlank)
	s4.SetBgGradient([]string{bgBase, bgElev}, 135)
	s4.SetTransition("zoom", 500)
	// brand mark
	s4.AddShape("roundRect", 600000, 400000, 220000, 220000).
		SetCornerRadius(60000).SetGradient(primary + "," + accent)
	// pill
	s4.AddPill(600000, 800000, 3500000, 320000, "CHAPTER 03 · FLOWCHART", primary)
	// 主标题
	s4.AddShape("rect", 600000, 1250000, 8000000, 500000).
		SetText("智能流程图自动布局").SetFontSize(36).SetFontBold(true).
		SetFontColor(textBright).SetFont(fontHead).SetTextAlign("l")
	s4.AddShape("rect", 600000, 1800000, 9000000, 350000).
		SetText("输入节点列表，自动计算坐标与连线 — 支持 horizontal / vertical 双向布局").
		SetFontSize(13).SetFontColor(textMuted).SetFont(fontBody).SetTextAlign("l")

	// 流程图节点 (横向)
	fcX := 600000
	fcY := 2600000
	fcW := 2000000
	fcH := 1100000
	fcGap := 600000
	// 节点1: start
	s4.AddShape("roundRect", fcX, fcY, fcW, fcH).
		SetGradient(accentGreen + ",059669").SetCornerRadius(200000).
		SetGlow(true, accentGreen, 60000)
	s4.AddShape("rect", fcX+100000, fcY+200000, 600000, 200000).
		SetText("START").SetFontSize(9).SetFontBold(true).
		SetFontColor("D1FAE5").SetFont(fontBody).SetTextAlign("ctr")
	s4.AddShape("rect", fcX, fcY+450000, fcW, 500000).
		SetText("用户输入").SetFontSize(18).SetFontBold(true).
		SetFontColor(textBright).SetFont(fontHead).SetTextAlign("ctr")
	// 箭头1
	s4.AddShape("rightArrow", fcX+fcW+fcGap/4, fcY+fcH/2-100000, fcGap/2, 200000).
		SetFill(accent)
	// 节点2: process
	fcX2 := fcX + fcW + fcGap
	s4.AddShape("rect", fcX2, fcY, fcW, fcH).
		SetGradient(primaryDp + "," + primary).SetGlow(true, primary, 60000)
	s4.AddShape("rect", fcX2+100000, fcY+200000, 800000, 200000).
		SetText("PROCESS").SetFontSize(9).SetFontBold(true).
		SetFontColor("C7D2FE").SetFont(fontBody).SetTextAlign("ctr")
	s4.AddShape("rect", fcX2, fcY+450000, fcW, 500000).
		SetText("AI 处理").SetFontSize(18).SetFontBold(true).
		SetFontColor(textBright).SetFont(fontHead).SetTextAlign("ctr")
	// 箭头2
	s4.AddShape("rightArrow", fcX2+fcW+fcGap/4, fcY+fcH/2-100000, fcGap/2, 200000).
		SetFill(accent)
	// 节点3: decision (菱形)
	fcX3 := fcX2 + fcW + fcGap
	s4.AddShape("diamond", fcX3, fcY, fcW, fcH).
		SetGradient(accentWarm + ",D97706").SetGlow(true, accentWarm, 60000)
	s4.AddShape("rect", fcX3, fcY+200000, fcW, 200000).
		SetText("DECISION").SetFontSize(9).SetFontBold(true).
		SetFontColor("FEF3C7").SetFont(fontBody).SetTextAlign("ctr")
	s4.AddShape("rect", fcX3, fcY+450000, fcW, 500000).
		SetText("判断结果").SetFontSize(16).SetFontBold(true).
		SetFontColor(textBright).SetFont(fontHead).SetTextAlign("ctr")
	// 箭头3
	s4.AddShape("rightArrow", fcX3+fcW+fcGap/4, fcY+fcH/2-100000, fcGap/2, 200000).
		SetFill(accent)
	// 节点4: end
	fcX4 := fcX3 + fcW + fcGap
	s4.AddShape("roundRect", fcX4, fcY, fcW, fcH).
		SetGradient(accentPink + ",BE185D").SetCornerRadius(200000).
		SetGlow(true, accentPink, 60000)
	s4.AddShape("rect", fcX4+100000, fcY+200000, 600000, 200000).
		SetText("END").SetFontSize(9).SetFontBold(true).
		SetFontColor("FCE7F3").SetFont(fontBody).SetTextAlign("ctr")
	s4.AddShape("rect", fcX4, fcY+450000, fcW, 500000).
		SetText("输出文档").SetFontSize(18).SetFontBold(true).
		SetFontColor(textBright).SetFont(fontHead).SetTextAlign("ctr")

	// 代码块 (玻璃卡片)
	cbX := 600000
	cbY := 4200000
	cbW := 10900000
	cbH := 2000000
	s4.AddGlassCard(cbX, cbY, cbW, cbH, 60).
		SetFill(bgCard).SetStroke(border, 6000).SetCornerRadius(160000)
	s4.AddShape("rect", cbX+200000, cbY+150000, 1500000, 200000).
		SetText("INPUT").SetFontSize(9).SetFontBold(true).
		SetFontColor(textFaint).SetFont(fontBody).SetTextAlign("l")
	s4.AddShape("rect", cbW-1500000, cbY+150000, 1500000, 200000).
		SetText("4 nodes · horizontal").SetFontSize(9).
		SetFontColor(accent).SetFont(fontNum).SetTextAlign("r")
	// 代码内容
	codeLines := []string{
		`nodes := []pptgo.FlowNode{`,
		`  {Text: "用户输入",  Type: "start"},`,
		`  {Text: "AI 处理",   Type: "process"},`,
		`  {Text: "判断结果",  Type: "decision"},`,
		`  {Text: "输出文档",  Type: "end"},`,
		`}`,
		`slide.AddFlowChart(nodes, x, y, "horizontal")`,
	}
	s4.AddCodeBlock(cbX+200000, cbY+450000, cbW-400000, cbH-600000, codeLines, 12, "0B1120")

	// 页码
	s4.AddShape("rect", 11000000, 6500000, 1000000, 250000).
		SetText("04 / 06").SetFontSize(10).SetFontColor(textFaint).
		SetFont(fontNum).SetTextAlign("r")

	// === Slide 5: 动画效果展示 ===
	s5 := prs.AddSlide()
	s5.SetLayout(pptgo.LayoutBlank)
	s5.SetBgGradient([]string{bgBase, bgElev}, 135)
	s5.SetTransition("morph", 500)
	// brand mark
	s5.AddShape("roundRect", 600000, 400000, 220000, 220000).
		SetCornerRadius(60000).SetGradient(primary + "," + accent)
	// pill
	s5.AddPill(600000, 800000, 3500000, 320000, "CHAPTER 04 · ANIMATION", primary)
	// 主标题
	s5.AddShape("rect", 600000, 1250000, 8000000, 500000).
		SetText("动画效果展示").SetFontSize(36).SetFontBold(true).
		SetFontColor(textBright).SetFont(fontHead).SetTextAlign("l")
	s5.AddShape("rect", 600000, 1800000, 9000000, 350000).
		SetText("进入 · 强调 · 退出 · 路径 — 四类动画覆盖完整演示节奏").
		SetFontSize(13).SetFontColor(textMuted).SetFont(fontBody).SetTextAlign("l")

	// 时间轴
	tlY := 2400000
	tlX0 := 600000
	tlX1 := 11500000
	s5.AddShape("rect", tlX0, tlY, tlX1-tlX0, 15000).SetFill(border)
	// 时间点标记
	timePoints := []struct {
		x    int
		label string
		color string
	}{
		{tlX0, "0ms", primary},
		{tlX0 + 2500000, "500ms", accentGreen},
		{tlX0 + 5000000, "1000ms", accentWarm},
		{tlX0 + 7500000, "1500ms", accentPink},
		{tlX1, "2500ms", primaryBr},
	}
	for _, tp := range timePoints {
		s5.AddShape("ellipse", tp.x-60000, tlY-60000, 120000, 120000).SetFill(tp.color)
		s5.AddShape("rect", tp.x-300000, tlY+150000, 600000, 250000).
			SetText(tp.label).SetFontSize(10).SetFontColor(textFaint).
			SetFont(fontNum).SetTextAlign("ctr")
	}

	// 动画矩阵 (2 rows × 4 cols)
	animData := []struct {
		label    string
		name     string
		color    string
		detail   string
		category string
	}{
		{"ENTRANCE", "Fade", primary, "0ms · 800ms duration", "entr"},
		{"ENTRANCE", "Fly", accentGreen, "500ms · 600ms", "entr"},
		{"ENTRANCE", "Zoom", accentWarm, "1000ms · 600ms", "entr"},
		{"ENTRANCE", "Bounce", accentPink, "1500ms · 800ms", "entr"},
		{"EMPHASIS", "Pulse", primaryBr, "2500ms · 500ms", "emph"},
		{"EMPHASIS", "Spin", accentGreen, "3000ms · 800ms", "emph"},
	}
	cardWW := 2600000
	cardHH := 1300000
	animY0 := 3300000
	animY1 := animY0 + cardHH + 200000
	for i, ad := range animData {
		col := i % 4
		row := i / 4
		ax := tlX0 + col*(cardWW+200000)
		ay := animY0
		if row == 1 { ay = animY1 }
		s5.AddCard(ax, ay, cardWW, cardHH).
			SetFill(bgCard).SetStroke(border, 6000).SetCornerRadius(160000)
		s5.AddShape("rect", ax+150000, ay+150000, 1200000, 200000).
			SetText(ad.label).SetFontSize(8).SetFontBold(true).
			SetFontColor(textFaint).SetFont(fontBody).SetTextAlign("l")
		s5.AddShape("rect", ax+150000, ay+400000, cardWW-300000, 500000).
			SetText(ad.name).SetFontSize(24).SetFontBold(true).
			SetFontColor(ad.color).SetFont(fontHead).SetTextAlign("l")
		s5.AddShape("rect", ax+150000, ay+950000, cardWW-300000, 250000).
			SetText(ad.detail).SetFontSize(10).SetFontColor(textMuted).
			SetFont(fontNum).SetTextAlign("l")
	}
	// 第7个卡片: 演示备注 (跨2列)
	notesX := tlX0 + 2*(cardWW+200000)
	notesY := animY1
	s5.AddGlassCard(notesX, notesY, cardWW*2+200000, cardHH, 60).
		SetFill(bgCard).SetStroke(border, 6000).SetCornerRadius(160000)
	s5.AddShape("rect", notesX+150000, notesY+200000, cardWW*2-100000, 400000).
		SetText("演示备注").SetFontSize(14).SetFontBold(true).
		SetFontColor(textBright).SetFont(fontHead).SetTextAlign("l")
	s5.AddShape("rect", notesX+150000, notesY+600000, cardWW*2-100000, 350000).
		SetText("本页展示 4 种进入动画 + 2 种强调动画的完整时间编排").
		SetFontSize(11).SetFontColor(textMuted).SetFont(fontBody).SetTextAlign("l")
	s5.AddShape("rect", notesX+150000, notesY+950000, cardWW*2-100000, 250000).
		SetText("支持 4 类动画 × 8 种效果 = 32 种组合").
		SetFontSize(10).SetFontColor(textFaint).SetFont(fontBody).SetTextAlign("l")

	// 页码
	s5.AddShape("rect", 11000000, 6500000, 1000000, 250000).
		SetText("05 / 06").SetFontSize(10).SetFontColor(textFaint).
		SetFont(fontNum).SetTextAlign("r")

	// === Slide 6: 结尾 (Aurora mesh) ===
	s6 := prs.AddSlide()
	s6.SetLayout(pptgo.LayoutBlank)
	s6.SetBgAurora(bgBase, []pptgo.AuroraGlow{
		{X: 3000000, Y: 2000000, R: 2200000, Color: primary, Alpha: 25},
		{X: 9000000, Y: 5000000, R: 2000000, Color: accent, Alpha: 20},
		{X: 6000000, Y: 3500000, R: 1500000, Color: accentPink, Alpha: 12},
	})
	s6.SetTransition("fade", 800)
	s6.SetAdvanceTime(3)
	// brand mark
	s6.AddShape("roundRect", 600000, 400000, 220000, 220000).
		SetCornerRadius(60000).SetGradient(primary + "," + accent)
	// 中央装饰方块
	s6.AddShape("roundRect", 5400000, 1700000, 1400000, 1400000).
		SetCornerRadius(400000).SetGradient(primary + "," + accent).
		SetGlow(true, primary, 120000)
	// 装饰下方渐变线
	s6.AddShape("rect", 5700000, 3250000, 800000, 30000).
		SetGradient(primary + "," + accent)
	// 主标题
	s6.AddGlowText(2000000, 3500000, 8000000, 1100000, "SamAI Group", textBright, primary, 60)
	// 副标题
	s6.AddShape("rect", 2000000, 4650000, 8000000, 500000).
		SetText("samai.cc · 永久公益开源").SetFontSize(20).
		SetFontColor(textMuted).SetFont(fontBody).SetTextAlign("ctr")
	// 分隔线
	s6.AddShape("rect", 3800000, 5300000, 4600000, 15000).SetFill(border)
	// 三列元数据
	footerData := []struct {
		label string
		value string
	}{
		{"GITHUB", "samaidev/samoffice"},
		{"LICENSE", "MIT"},
		{"VERSION", "v0.3.0"},
	}
	for i, fd := range footerData {
		fx := 2800000 + i*2500000
		s6.AddShape("rect", fx, 5450000, 2000000, 250000).
			SetText(fd.label).SetFontSize(10).SetFontBold(true).
			SetFontColor(textFaint).SetFont(fontBody).SetTextAlign("ctr")
		s6.AddShape("rect", fx, 5750000, 2000000, 300000).
			SetText(fd.value).SetFontSize(13).SetFontColor(textBright).
			SetFont(fontBody).SetTextAlign("ctr")
	}
	// 底部
	s6.AddShape("rect", 4000000, 6400000, 4000000, 250000).
		SetText("— END OF PRESENTATION —").SetFontSize(9).
		SetFontColor(textFaint).SetFont(fontNum).SetTextAlign("ctr")

	// 保存
	outPath := "/home/z/my-project/download/GoOffice-v2-高级PPT演示.pptx"
	if err := prs.Save(outPath); err != nil {
		log.Fatal(err)
	}
	fmt.Printf("✅ 已保存 %s\n", outPath)
	fmt.Printf("   幻灯片数: %d\n", len(prs.Slides()))
	for i, s := range prs.Slides() {
		fmt.Printf("   Slide %d: title=%q animations=%d\n", i+1, s.Title(), len(s.Animations()))
	}
}
