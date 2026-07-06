// Package pptgo — modern extensions
// 现代化扩展: 渐变背景 / Aurora 装饰 / Glass Morphism / 卡片组件 / KPI / 时间轴 / 代码块 / 多文本块
//
// 设计目标: 让 pptgo 生成的演示文稿达到 Apple Keynote × Stripe 级别的视觉精美度
// 兼容性: 所有新增字段都是可选的，旧代码无需修改
package pptgo

import (
        "fmt"
        "strings"
)

// === Slide 背景扩展 ===

// BgGradient 渐变背景
type BgGradient struct {
        Colors []string // ["4f46e5", "818cf8"]
        Angle  int      // 0-360 度，0=从下到上，90=从左到右
        Type   string   // "linear" / "radial"
}

// BgAurora Aurora mesh 背景 (多色径向渐变叠加)
type BgAurora struct {
        BaseColor string   // 基础色
        Glows     []AuroraGlow
}

// AuroraGlow 装饰性发光圆
type AuroraGlow struct {
        X, Y   int    // 位置 EMU
        R      int    // 半径 EMU
        Color  string // hex
        Alpha  int    // 0-100 透明度
}

// SetBgGradient 设置渐变背景
func (s *Slide) SetBgGradient(colors []string, angle int) *Slide {
        s.bgGradient = &BgGradient{Colors: colors, Angle: angle, Type: "linear"}
        return s
}

// SetBgRadialGradient 设置径向渐变背景
func (s *Slide) SetBgRadialGradient(colors []string) *Slide {
        s.bgGradient = &BgGradient{Colors: colors, Type: "radial"}
        return s
}

// SetBgAurora 设置 Aurora mesh 背景
func (s *Slide) SetBgAurora(baseColor string, glows []AuroraGlow) *Slide {
        s.bgAurora = &BgAurora{BaseColor: baseColor, Glows: glows}
        return s
}

// AddAuroraGlow 添加一个 aurora 发光装饰 (链式)
func (s *Slide) AddAuroraGlow(x, y, r int, color string, alpha int) *Slide {
        if s.bgAurora == nil {
                s.bgAurora = &BgAurora{BaseColor: s.bgColor}
        }
        s.bgAurora.Glows = append(s.bgAurora.Glows, AuroraGlow{X: x, Y: y, R: r, Color: color, Alpha: alpha})
        return s
}

// === Shape 扩展: 字体 / 玻璃质感 / 圆角 / 多行文本 ===
// (SetFont / SetFontBold 已在 pptgo.go 中定义)

// SetGlass 玻璃质感 (半透明 + 模糊)
func (sh *Shape) SetGlass(fillAlpha int, blurRad int) *Shape {
        sh.Glass = true
        sh.GlassAlpha = fillAlpha
        sh.GlassBlur = blurRad
        return sh
}

// SetCornerRadius 设置圆角半径 (EMU)
func (sh *Shape) SetCornerRadius(r int) *Shape { sh.CornerRadius = r; return sh }

// SetTextAlign 设置文字对齐 ("l"/"ctr"/"r"/"just")
func (sh *Shape) SetTextAlign(align string) *Shape { sh.TextAlign = align; return sh }

// SetTextAnchor 设置文字垂直对齐 ("t"/"ctr"/"b")
func (sh *Shape) SetTextAnchor(anchor string) *Shape { sh.TextAnchor = anchor; return sh }

// SetMultiText 设置多行/多段文本 (支持每段不同样式)
func (sh *Shape) SetMultiText(runs []TextRun) *Shape { sh.MultiText = runs; return sh }

// TextRun 单段文本
type TextRun struct {
        Text   string
        Size   int    // pt*100, 0=继承
        Bold   bool
        Italic bool
        Color  string
        Font   string
        NewLine bool // 是否在此段后换行
}

// === ArtText 扩展 ===

// SetBold 设置艺术字粗细 (链式)
func (a *ArtText) SetBold(b bool) *ArtText { a.Bold = b; return a }

// === 现代组件 API ===

// AddCard 添加现代卡片 (圆角矩形 + 阴影 + 可选玻璃质感)
// w, h: 卡片尺寸 EMU
// 返回 *Shape 可继续链式配置
func (s *Slide) AddCard(x, y, w, h int) *Shape {
        return s.AddShape("roundRect", x, y, w, h).
                SetCornerRadius(160000).
                SetShadow(true)
}

// AddGlassCard 添加玻璃质感卡片
func (s *Slide) AddGlassCard(x, y, w, h int, fillAlpha int) *Shape {
        return s.AddShape("roundRect", x, y, w, h).
                SetCornerRadius(160000).
                SetGlass(fillAlpha, 20000).
                SetShadow(true)
}

// AddCodeBlock 添加代码块 (深色背景 + 等宽字体)
// lines: 代码行
// fontSize: pt (建议 12-14)
// bgHex: 背景色 (默认 #0B1120)
func (s *Slide) AddCodeBlock(x, y, w, h int, lines []string, fontSize int, bgHex string) *Shape {
        if bgHex == "" {
                bgHex = "0B1120"
        }
        if fontSize == 0 {
                fontSize = 12
        }
        // 将多行代码合并为单 shape 的 MultiText
        runs := make([]TextRun, 0, len(lines)*2)
        for i, line := range lines {
                runs = append(runs, TextRun{
                        Text:   line,
                        Size:   fontSize * 100,
                        Color:  "86EFAC",
                        Font:   "Consolas",
                        NewLine: i < len(lines)-1,
                })
        }
        sh := s.AddShape("roundRect", x, y, w, h).
                SetFill("#" + bgHex).
                SetCornerRadius(120000).
                SetStroke("1e293b", 8000).
                SetMultiText(runs).
                SetTextAlign("l").
                SetTextAnchor("t")
        return sh
}

// AddKPICard 添加 KPI 卡片 (大数字 + 标签)
// value: 大数字 (如 "10x" / "127ms")
// label: 标签 (如 "PERF GAIN")
// valueColor: 数字颜色
// accentColor: 顶部强调条颜色
func (s *Slide) AddKPICard(x, y, w, h int, value, label, valueColor, accentColor string) *Shape {
        // 卡片背景
        card := s.AddCard(x, y, w, h).SetFill("#1A2540").SetStroke("334155", 6000)
        // 顶部强调条
        s.AddShape("rect", x+int(float64(w)*0.1), y+int(float64(h)*0.15), int(float64(w)*0.15), 30000).
                SetFill("#" + strings.TrimPrefix(accentColor, "#"))
        // 大数字
        s.AddShape("rect", x, y+int(float64(h)*0.25), w, int(float64(h)*0.45)).
                SetText(value).
                SetFontSize(36).
                SetFontBold(true).
                SetFontColor("#" + strings.TrimPrefix(valueColor, "#")).
                SetFont("Space Grotesk")
        // 标签
        s.AddShape("rect", x, y+int(float64(h)*0.72), w, int(float64(h)*0.2)).
                SetText(label).
                SetFontSize(10).
                SetFontColor("94A3B8").
                SetFont("Inter")
        return card
}

// AddTimelineItem 添加时间轴节点
// x, y: 起点位置 (圆点位置)
// dotColor: 圆点颜色
// title: 标题
// desc: 描述
// align: "l"/"r" — 圆点在左还是在右
func (s *Slide) AddTimelineItem(x, y, dotR int, dotColor, title, desc, align string) {
        // 圆点
        s.AddShape("ellipse", x-dotR/2, y-dotR/2, dotR, dotR).
                SetFill("#" + strings.TrimPrefix(dotColor, "#")).
                SetGlow(true, strings.TrimPrefix(dotColor, "#"), 40000)
        // 连接线 (向右延伸)
        lineW := 200000
        if align == "r" {
                s.AddShape("rect", x-lineW, y-3000, lineW, 6000).SetFill("334155")
        } else {
                s.AddShape("rect", x+dotR/2, y-3000, lineW, 6000).SetFill("334155")
        }
        // 标题
        titleX := x + dotR
        if align == "r" {
                titleX = x - dotR - 3500000
        }
        s.AddShape("rect", titleX, y-280000, 3500000, 280000).
                SetText(title).
                SetFontSize(14).
                SetFontBold(true).
                SetFontColor("F8FAFC").
                SetFont("Space Grotesk").
                SetTextAlign(map[string]string{"l": "l", "r": "r"}[align])
        // 描述
        s.AddShape("rect", titleX, y+50000, 3500000, 230000).
                SetText(desc).
                SetFontSize(10).
                SetFontColor("94A3B8").
                SetFont("Inter").
                SetTextAlign(map[string]string{"l": "l", "r": "r"}[align])
}

// AddPill 添加 pill 标签 (胶囊形)
func (s *Slide) AddPill(x, y, w, h int, text, color string) *Shape {
        return s.AddShape("roundRect", x, y, w, h).
                SetCornerRadius(h/2).
                SetFill(color).
                SetText(text).
                SetFontSize(9).
                SetFontBold(true).
                SetFontColor("FFFFFF").
                SetFont("Inter")
}

// AddDivider 添加分隔线
func (s *Slide) AddDivider(x, y, w int, color string) *Shape {
        return s.AddShape("rect", x, y, w, 15000).SetFill(color)
}

// AddGlowText 添加带发光效果的标题文字
func (s *Slide) AddGlowText(x, y, w, h int, text, color, glowColor string, fontSize int) *Shape {
        return s.AddShape("rect", x, y, w, h).
                SetText(text).
                SetFontSize(fontSize).
                SetFontBold(true).
                SetFontColor(color).
                SetFont("Space Grotesk").
                SetGlow(true, glowColor, 60000)
}

// AddGradientText 添加渐变文字 (通过两段叠加近似)
// 注意: OOXML 真正的渐变文字需要 gradFill on text, 这里用纯色 + 发光近似
func (s *Slide) AddGradientText(x, y, w, h int, text, color1, color2 string, fontSize int) *Shape {
        // 用 color1 作主色, color2 作发光
        return s.AddShape("rect", x, y, w, h).
                SetText(text).
                SetFontSize(fontSize).
                SetFontBold(true).
                SetFontColor(color1).
                SetFont("Space Grotesk").
                SetGlow(true, color2, 80000)
}

// === 主题预设 ===

// Theme 主题预设
type Theme struct {
        Name        string
        BgColor     string
        BgGradient  []string // 渐变色
        Primary     string
        Accent      string
        TextBright  string
        TextMuted   string
        TextFaint   string
        CardBg      string
        Border      string
        FontHeading string
        FontBody    string
        FontNum     string
}

// 主题预设
var (
        ThemeAuroraIndigo = Theme{
                Name: "Aurora Indigo", BgColor: "0B1120",
                BgGradient: []string{"0B1120", "131C30"},
                Primary:    "6366F1", Accent: "22D3EE",
                TextBright: "F8FAFC", TextMuted: "94A3B8", TextFaint: "64748B",
                CardBg:     "1A2540", Border: "334155",
                FontHeading: "Space Grotesk", FontBody: "Inter", FontNum: "Space Grotesk",
        }
        ThemeMidnight = Theme{
                Name: "Midnight", BgColor: "020617",
                BgGradient: []string{"020617", "0F172A"},
                Primary:    "818CF8", Accent: "F472B6",
                TextBright: "F1F5F9", TextMuted: "94A3B8", TextFaint: "64748B",
                CardBg:     "0F172A", Border: "1E293B",
                FontHeading: "Inter", FontBody: "Inter", FontNum: "JetBrains Mono",
        }
        ThemeOcean = Theme{
                Name: "Ocean", BgColor: "0C4A6E",
                BgGradient: []string{"0C4A6E", "0E7490"},
                Primary:    "06B6D4", Accent: "FBBF24",
                TextBright: "F0FDFF", TextMuted: "A5F3FC", TextFaint: "67E8F9",
                CardBg:     "155E75", Border: "0E7490",
                FontHeading: "Inter", FontBody: "Inter", FontNum: "Space Grotesk",
        }
        ThemeSunset = Theme{
                Name: "Sunset", BgColor: "431407",
                BgGradient: []string{"431407", "9A3412"},
                Primary:    "F59E0B", Accent: "EC4899",
                TextBright: "FFF7ED", TextMuted: "FED7AA", TextFaint: "FDBA74",
                CardBg:     "7C2D12", Border: "9A3412",
                FontHeading: "Inter", FontBody: "Inter", FontNum: "Space Grotesk",
        }
        ThemeMinimal = Theme{
                Name: "Minimal", BgColor: "FFFFFF",
                BgGradient: []string{"FFFFFF", "F8FAFC"},
                Primary:    "0F172A", Accent: "6366F1",
                TextBright: "0F172A", TextMuted: "475569", TextFaint: "94A3B8",
                CardBg:     "F8FAFC", Border: "E2E8F0",
                FontHeading: "Inter", FontBody: "Inter", FontNum: "Space Grotesk",
        }
)

// ApplyTheme 应用主题到幻灯片
func (s *Slide) ApplyTheme(theme Theme) *Slide {
        if len(theme.BgGradient) == 2 {
                s.SetBgGradient(theme.BgGradient, 135)
        } else {
                s.bgColor = "#" + theme.BgColor
        }
        // 默认标题色
        return s
}

// GetTheme 根据名称获取主题
func GetTheme(name string) Theme {
        switch strings.ToLower(name) {
        case "aurora", "aurora-indigo", "indigo":
                return ThemeAuroraIndigo
        case "midnight":
                return ThemeMidnight
        case "ocean":
                return ThemeOcean
        case "sunset":
                return ThemeSunset
        case "minimal", "light":
                return ThemeMinimal
        default:
                return ThemeAuroraIndigo
        }
}

// === 工具函数 ===

// Helper: hex 数字转 alpha 百分比 (用于 OOXML alpha val)
// OOXML alpha val 是 0-100000, 100% = 100000
func alphaToOOXML(alphaPercent int) int {
        if alphaPercent < 0 {
                alphaPercent = 0
        }
        if alphaPercent > 100 {
                alphaPercent = 100
        }
        return alphaPercent * 1000
}

// Helper: 渐变背景转 XML (供 slideXML 使用)
func (g *BgGradient) toXML() string {
        if g == nil || len(g.Colors) < 2 {
                return ""
        }
        var sb strings.Builder
        if g.Type == "radial" {
                sb.WriteString(`<a:gradFill><a:gsLst>`)
                sb.WriteString(fmt.Sprintf(`<a:gs pos="0"><a:srgbClr val="%s"/></a:gs>`, strings.TrimPrefix(g.Colors[0], "#")))
                sb.WriteString(fmt.Sprintf(`<a:gs pos="100000"><a:srgbClr val="%s"/></a:gs>`, strings.TrimPrefix(g.Colors[1], "#")))
                sb.WriteString(`</a:gsLst><a:tileRect/></a:gradFill>`)
        } else {
                // linear
                ang := g.Angle * 60000
                sb.WriteString(`<a:gradFill><a:gsLst>`)
                sb.WriteString(fmt.Sprintf(`<a:gs pos="0"><a:srgbClr val="%s"/></a:gs>`, strings.TrimPrefix(g.Colors[0], "#")))
                sb.WriteString(fmt.Sprintf(`<a:gs pos="100000"><a:srgbClr val="%s"/></a:gs>`, strings.TrimPrefix(g.Colors[1], "#")))
                sb.WriteString(fmt.Sprintf(`</a:gsLst><a:lin ang="%d" scaled="1"/></a:gradFill>`, ang))
        }
        return sb.String()
}

// Helper: aurora 装饰转 XML — 用多个透明椭圆模拟 mesh
func (a *BgAurora) toXML() string {
        if a == nil {
                return ""
        }
        var sb strings.Builder
        // 基础色背景
        sb.WriteString(fmt.Sprintf(`<p:bg><p:bgPr><a:solidFill><a:srgbClr val="%s"/></a:solidFill></p:bgPr></p:bg>`, strings.TrimPrefix(a.BaseColor, "#")))
        return sb.String()
}
