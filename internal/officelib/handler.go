// Package officelib 提供 HTTP API 暴露 docgo/xlsgo/pptgo 能力
// 智能体可通过 HTTP 调用生成 Office 文件
//
// 端点：
//   POST /api/lib/doc/create   - 创建 docx（JSON 描述 → 文件下载）
//   POST /api/lib/xls/create   - 创建 xlsx
//   POST /api/lib/ppt/create   - 创建 pptx
//   GET  /api/lib/examples      - 获取各端点 JSON 示例
package officelib

import (
        "encoding/json"
        "net/http"
        "strconv"

        "github.com/gin-gonic/gin"
        "github.com/zai/gooffice/pkg/docgo"
        "github.com/zai/gooffice/pkg/pptgo"
        "github.com/zai/gooffice/pkg/xlsgo"
)

// Register 注册所有 officelib 路由
func Register(r *gin.Engine) {
        r.POST("/api/lib/doc/create", handleDocCreate)
        r.POST("/api/lib/xls/create", handleXlsCreate)
        r.POST("/api/lib/ppt/create", handlePptCreate)
        r.GET("/api/lib/examples", handleExamples)
}

// === docgo ===

// DocSpec docx 创建规格（JSON）
type DocSpec struct {
        Title    string       `json:"title"`
        Author   string       `json:"author"`
        Subject  string       `json:"subject"`
        Header   string       `json:"header"`
        Footer   string       `json:"footer"`
        PageNum  bool         `json:"pageNum"`
        Elements []DocElement `json:"elements"`
}

// DocElement docx 元素（多态）
type DocElement struct {
        Type     string     `json:"type"` // heading/paragraph/list/table/code/toc
        Text     string     `json:"text,omitempty"`
        Level    int        `json:"level,omitempty"`
        Items    []string   `json:"items,omitempty"`
        Ordered  bool       `json:"ordered,omitempty"`
        Rows     [][]string `json:"rows,omitempty"`
        Language string     `json:"language,omitempty"`
        Code     string     `json:"code,omitempty"`
        Runs     []DocRun   `json:"runs,omitempty"`
        MaxLevel int        `json:"maxLevel,omitempty"`
}

// DocRun 段落文本片段
type DocRun struct {
        Text   string `json:"text"`
        Bold   bool   `json:"bold,omitempty"`
        Italic bool   `json:"italic,omitempty"`
        Color  string `json:"color,omitempty"`
        Size   int    `json:"size,omitempty"`
}

func handleDocCreate(c *gin.Context) {
        var spec DocSpec
        if err := c.ShouldBindJSON(&spec); err != nil {
                c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
                return
        }

        doc := docgo.New()
        if spec.Title != "" { doc.SetTitle(spec.Title) }
        if spec.Author != "" { doc.SetAuthor(spec.Author) }
        if spec.Subject != "" { doc.SetSubject(spec.Subject) }
        if spec.Header != "" { doc.SetHeader(spec.Header) }
        if spec.Footer != "" { doc.SetFooter(spec.Footer) }
        if spec.PageNum { doc.SetPageNumber(true) }

        for _, e := range spec.Elements {
                switch e.Type {
                case "heading":
                        doc.AddHeading(e.Text, e.Level)
                case "paragraph":
                        p := doc.AddParagraph("")
                        if len(e.Runs) > 0 {
                                for _, r := range e.Runs {
                                        run := p.AddRun(r.Text)
                                        if r.Bold { run.Bold(true) }
                                        if r.Italic { run.Italic(true) }
                                        if r.Color != "" { run.Color(r.Color) }
                                        if r.Size > 0 { run.Size(r.Size) }
                                }
                        } else if e.Text != "" {
                                p.AddRun(e.Text)
                        }
                case "list":
                        if e.Ordered {
                                doc.AddOrderedList(e.Items)
                        } else {
                                doc.AddList(e.Items)
                        }
                case "table":
                        doc.AddTable(e.Rows)
                case "code":
                        doc.AddCodeBlock(e.Language, e.Code)
                case "toc":
                        maxLevel := e.MaxLevel
                        if maxLevel == 0 { maxLevel = 3 }
                        doc.AddTableOfContents(maxLevel)
                }
        }

        data, err := doc.Bytes()
        if err != nil {
                c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
                return
        }

        filename := spec.Title
        if filename == "" { filename = "untitled" }
        c.Header("Content-Disposition", "attachment; filename=\""+filename+".docx\"")
        c.Data(http.StatusOK, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", data)
}

// === xlsgo ===

// XlsSpec xlsx 创建规格
type XlsSpec struct {
        Sheets []XlsSheetSpec `json:"sheets"`
}

// XlsSheetSpec 工作表规格
type XlsSheetSpec struct {
        Name     string         `json:"name"`
        Headers  []string       `json:"headers"`
        Rows     [][]string     `json:"rows"`
        ColWidths map[string]int `json:"colWidths,omitempty"`
        Freeze   string         `json:"freeze,omitempty"`
}

func handleXlsCreate(c *gin.Context) {
        var spec XlsSpec
        if err := c.ShouldBindJSON(&spec); err != nil {
                c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
                return
        }

        wb := xlsgo.New()
        for si, sheetSpec := range spec.Sheets {
                var ws *xlsgo.Sheet
                if si == 0 {
                        ws = wb.ActiveSheet()
                        if sheetSpec.Name != "" {
                                // 重命名默认 Sheet
                        }
                } else {
                        ws = wb.AddSheet(sheetSpec.Name)
                }

                // 表头
                for ci, h := range sheetSpec.Headers {
                        col := colName(ci)
                        ws.SetCell(col+"1", h)
                        ws.SetCellStyleHeader(col + "1")
                }

                // 数据行
                for ri, row := range sheetSpec.Rows {
                        for ci, val := range row {
                                ws.SetCell(colName(ci)+strconv.Itoa(ri+2), val)
                        }
                }

                // 列宽
                for col, w := range sheetSpec.ColWidths {
                        ws.SetColWidth(col, float64(w))
                }

                // 冻结
                if sheetSpec.Freeze != "" {
                        ws.FreezePanes(sheetSpec.Freeze)
                }
        }

        // 用 excelize 的 WriteTo 写到 buffer
        data, err := wb.Bytes()
        if err != nil {
                c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
                return
        }

        c.Header("Content-Disposition", "attachment; filename=\"spreadsheet.xlsx\"")
        c.Data(http.StatusOK, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data)
}

// === pptgo ===

// PptSpec pptx 创建规格
type PptSpec struct {
        Title  string     `json:"title"`
        Author string     `json:"author"`
        Theme  string     `json:"theme"`  // 主题预设: aurora/midnight/ocean/sunset/minimal
        Slides []PptSlide `json:"slides"`
}

// PptSlide 幻灯片规格 (现代化扩展)
type PptSlide struct {
        Layout     string         `json:"layout"`     // title/content/blank
        Title      string         `json:"title"`
        Subtitle   string         `json:"subtitle"`
        Bullets    []string       `json:"bullets"`
        BgColor    string         `json:"bgColor"`
        BgGradient []string       `json:"bgGradient"` // 渐变背景 ["0B1120","131C30"]
        BgAurora   *PptBgAurora   `json:"bgAurora"`   // Aurora mesh 背景
        Theme      string         `json:"theme"`      // 单页主题覆盖
        Shapes     []PptShape     `json:"shapes"`     // 自定义形状
        Cards      []PptCard      `json:"cards"`      // 现代卡片
        KPICards   []PptKPICard   `json:"kpiCards"`   // KPI 卡片
        CodeBlocks []PptCodeBlock `json:"codeBlocks"` // 代码块
        Texts      []PptText      `json:"texts"`      // 自由文本块
        Pills      []PptPill      `json:"pills"`      // pill 标签
        Transition string         `json:"transition"`
        Notes      string         `json:"notes"`
}

// PptBgAurora Aurora mesh 背景
type PptBgAurora struct {
        BaseColor string          `json:"baseColor"`
        Glows     []PptAuroraGlow `json:"glows"`
}

// PptAuroraGlow 装饰性发光圆
type PptAuroraGlow struct {
        X, Y  int    `json:"x"`  // EMU
        R     int    `json:"r"`  // 半径 EMU
        Color string `json:"color"`
        Alpha int    `json:"alpha"` // 0-100
}

// PptShape 自定义形状
type PptShape struct {
        Type     string  `json:"type"`     // rect/roundRect/ellipse/triangle/diamond/star5/rightArrow
        X, Y     int     `json:"x,y"`      // EMU
        W, H     int     `json:"w,h"`      // EMU
        Fill     string  `json:"fill"`
        Gradient string  `json:"gradient"` // "4f46e5,818cf8"
        Stroke   string  `json:"stroke"`
        StrokeW  int     `json:"strokeW"`
        Text     string  `json:"text"`
        FontSize int     `json:"fontSize"` // pt
        FontBold bool    `json:"fontBold"`
        FontColor string `json:"fontColor"`
        Font     string  `json:"font"`     // 字体名
        Shadow   bool    `json:"shadow"`
        Glow     bool    `json:"glow"`
        GlowColor string `json:"glowColor"`
        GlowRadius int   `json:"glowRadius"`
        Glass    bool    `json:"glass"`
        GlassAlpha int   `json:"glassAlpha"` // 0-100
        CornerRadius int `json:"cornerRadius"` // EMU
        Rotation int     `json:"rotation"`
        TextAlign string `json:"textAlign"`   // l/ctr/r/just
        TextAnchor string `json:"textAnchor"` // t/ctr/b
        MultiText []PptTextRun `json:"multiText"`
}

// PptTextRun 多段文本
type PptTextRun struct {
        Text   string `json:"text"`
        Size   int    `json:"size"` // pt
        Bold   bool   `json:"bold"`
        Italic bool   `json:"italic"`
        Color  string `json:"color"`
        Font   string `json:"font"`
}

// PptCard 现代卡片
type PptCard struct {
        X, Y, W, H int    `json:"x,y,w,h"`
        Fill       string `json:"fill"`
        Stroke     string `json:"stroke"`
        Glass      bool   `json:"glass"`
        GlassAlpha int    `json:"glassAlpha"`
        CornerRadius int  `json:"cornerRadius"`
        Shadow     bool   `json:"shadow"`
        // 卡片内容 (可选)
        Title    string `json:"title"`
        TitleColor string `json:"titleColor"`
        TitleSize int    `json:"titleSize"`
        Body     string `json:"body"`
        BodyColor string `json:"bodyColor"`
        BodySize int    `json:"bodySize"`
        Font     string `json:"font"`
        Accent   string `json:"accent"` // 顶部强调条颜色
}

// PptKPICard KPI 卡片
type PptKPICard struct {
        X, Y, W, H int    `json:"x,y,w,h"`
        Value      string `json:"value"`      // 大数字
        Label      string `json:"label"`      // 标签
        ValueColor string `json:"valueColor"`
        AccentColor string `json:"accentColor"` // 顶部强调条
}

// PptCodeBlock 代码块
type PptCodeBlock struct {
        X, Y, W, H int      `json:"x,y,w,h"`
        Lines      []string `json:"lines"`
        FontSize   int      `json:"fontSize"` // pt
        BgColor    string   `json:"bgColor"`
}

// PptText 自由文本块
type PptText struct {
        X, Y, W, H int    `json:"x,y,w,h"`
        Text       string `json:"text"`
        FontSize   int    `json:"fontSize"` // pt
        FontBold   bool   `json:"fontBold"`
        FontColor  string `json:"fontColor"`
        Font       string `json:"font"`
        Align      string `json:"align"`   // l/ctr/r/just
        Anchor     string `json:"anchor"`  // t/ctr/b
        Glow       bool   `json:"glow"`
        GlowColor  string `json:"glowColor"`
}

// PptPill pill 标签
type PptPill struct {
        X, Y, W, H int    `json:"x,y,w,h"`
        Text       string `json:"text"`
        Color      string `json:"color"`
}

func handlePptCreate(c *gin.Context) {
        var spec PptSpec
        if err := c.ShouldBindJSON(&spec); err != nil {
                c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
                return
        }

        prs := pptgo.New()
        if spec.Title != "" { prs.SetTitle(spec.Title) }
        if spec.Author != "" { prs.SetAuthor(spec.Author) }

        // 解析主题
        var theme pptgo.Theme
        if spec.Theme != "" {
                theme = pptgo.GetTheme(spec.Theme)
        }

        for _, s := range spec.Slides {
                slide := prs.AddSlide()
                switch s.Layout {
                case "title":
                        slide.SetLayout(pptgo.LayoutTitle)
                case "blank":
                        slide.SetLayout(pptgo.LayoutBlank)
                default:
                        slide.SetLayout(pptgo.LayoutContent)
                }

                // 主题应用 (优先级: 单页 theme > spec.theme > 默认)
                effectiveTheme := theme
                if s.Theme != "" {
                        effectiveTheme = pptgo.GetTheme(s.Theme)
                }
                themeApplied := false
                if effectiveTheme.Name != "" {
                        slide.ApplyTheme(effectiveTheme)
                        themeApplied = true
                }

                // 背景: aurora > gradient > solid
                if s.BgAurora != nil {
                        glows := make([]pptgo.AuroraGlow, 0, len(s.BgAurora.Glows))
                        for _, g := range s.BgAurora.Glows {
                                glows = append(glows, pptgo.AuroraGlow{X: g.X, Y: g.Y, R: g.R, Color: g.Color, Alpha: g.Alpha})
                        }
                        slide.SetBgAurora(s.BgAurora.BaseColor, glows)
                } else if len(s.BgGradient) >= 2 {
                        slide.SetBgGradient(s.BgGradient, 135)
                } else if s.BgColor != "" {
                        slide.SetBgColor(s.BgColor)
                } else if !themeApplied {
                        // 默认白底
                }

                if s.Title != "" { slide.AddTitle(s.Title) }
                if s.Subtitle != "" { slide.AddSubtitle(s.Subtitle) }
                if len(s.Bullets) > 0 { slide.AddBullets(s.Bullets) }
                if s.Transition != "" { slide.SetTransition(s.Transition, 500) }
                if s.Notes != "" { slide.SetNotes(s.Notes) }

                // 自定义形状
                for _, sh := range s.Shapes {
                        shape := slide.AddShape(sh.Type, sh.X, sh.Y, sh.W, sh.H)
                        if sh.Fill != "" { shape.SetFill(sh.Fill) }
                        if sh.Gradient != "" { shape.SetGradient(sh.Gradient) }
                        if sh.Stroke != "" { shape.SetStroke(sh.Stroke, sh.StrokeW) }
                        if sh.Text != "" { shape.SetText(sh.Text) }
                        if sh.FontSize > 0 { shape.SetFontSize(sh.FontSize) }
                        shape.SetFontBold(sh.FontBold)
                        if sh.FontColor != "" { shape.SetFontColor(sh.FontColor) }
                        if sh.Font != "" { shape.SetFont(sh.Font) }
                        if sh.Shadow { shape.SetShadow(true) }
                        if sh.Glow { shape.SetGlow(true, sh.GlowColor, sh.GlowRadius) }
                        if sh.Glass { shape.SetGlass(sh.GlassAlpha, 20000) }
                        if sh.CornerRadius > 0 { shape.SetCornerRadius(sh.CornerRadius) }
                        if sh.Rotation != 0 { shape.SetRotation(sh.Rotation) }
                        if sh.TextAlign != "" { shape.SetTextAlign(sh.TextAlign) }
                        if sh.TextAnchor != "" { shape.SetTextAnchor(sh.TextAnchor) }
                        if len(sh.MultiText) > 0 {
                                runs := make([]pptgo.TextRun, 0, len(sh.MultiText))
                                for _, r := range sh.MultiText {
                                        runs = append(runs, pptgo.TextRun{
                                                Text: r.Text, Size: r.Size * 100, Bold: r.Bold, Italic: r.Italic,
                                                Color: r.Color, Font: r.Font,
                                        })
                                }
                                shape.SetMultiText(runs)
                        }
                }

                // 现代卡片
                for _, card := range s.Cards {
                        var shape *pptgo.Shape
                        if card.Glass {
                                shape = slide.AddGlassCard(card.X, card.Y, card.W, card.H, card.GlassAlpha)
                                if card.Fill != "" { shape.SetFill(card.Fill) }
                        } else {
                                shape = slide.AddCard(card.X, card.Y, card.W, card.H)
                                if card.Fill != "" { shape.SetFill(card.Fill) }
                        }
                        if card.Stroke != "" { shape.SetStroke(card.Stroke, 6000) }
                        if card.CornerRadius > 0 { shape.SetCornerRadius(card.CornerRadius) }
                        if !card.Shadow { shape.SetShadow(false) }
                        // 顶部强调条
                        if card.Accent != "" {
                                slide.AddShape("rect", card.X+int(float64(card.W)*0.08), card.Y+int(float64(card.H)*0.1), int(float64(card.W)*0.12), 30000).
                                        SetFill(card.Accent)
                        }
                        // 标题
                        if card.Title != "" {
                                titleColor := card.TitleColor
                                if titleColor == "" { titleColor = "F8FAFC" }
                                titleSize := card.TitleSize
                                if titleSize == 0 { titleSize = 18 }
                                fontName := card.Font
                                if fontName == "" { fontName = "Space Grotesk" }
                                slide.AddShape("rect", card.X+int(float64(card.W)*0.08), card.Y+int(float64(card.H)*0.22), int(float64(card.W)*0.84), int(float64(card.H)*0.25)).
                                        SetText(card.Title).SetFontSize(titleSize).SetFontBold(true).
                                        SetFontColor(titleColor).SetFont(fontName).SetTextAlign("l").SetTextAnchor("t")
                        }
                        // 正文
                        if card.Body != "" {
                                bodyColor := card.BodyColor
                                if bodyColor == "" { bodyColor = "94A3B8" }
                                bodySize := card.BodySize
                                if bodySize == 0 { bodySize = 11 }
                                bodyFont := card.Font
                                if bodyFont == "" { bodyFont = "Inter" }
                                slide.AddShape("rect", card.X+int(float64(card.W)*0.08), card.Y+int(float64(card.H)*0.5), int(float64(card.W)*0.84), int(float64(card.H)*0.4)).
                                        SetText(card.Body).SetFontSize(bodySize).
                                        SetFontColor(bodyColor).SetFont(bodyFont).SetTextAlign("l").SetTextAnchor("t")
                        }
                }

                // KPI 卡片
                for _, kpi := range s.KPICards {
                        slide.AddKPICard(kpi.X, kpi.Y, kpi.W, kpi.H, kpi.Value, kpi.Label, kpi.ValueColor, kpi.AccentColor)
                }

                // 代码块
                for _, cb := range s.CodeBlocks {
                        slide.AddCodeBlock(cb.X, cb.Y, cb.W, cb.H, cb.Lines, cb.FontSize, cb.BgColor)
                }

                // 自由文本
                for _, t := range s.Texts {
                        shape := slide.AddShape("rect", t.X, t.Y, t.W, t.H).
                                SetText(t.Text)
                        if t.FontSize > 0 { shape.SetFontSize(t.FontSize) }
                        shape.SetFontBold(t.FontBold)
                        if t.FontColor != "" { shape.SetFontColor(t.FontColor) }
                        if t.Font != "" { shape.SetFont(t.Font) }
                        if t.Align != "" { shape.SetTextAlign(t.Align) }
                        if t.Anchor != "" { shape.SetTextAnchor(t.Anchor) }
                        if t.Glow { shape.SetGlow(true, t.GlowColor, 60000) }
                }

                // pill 标签
                for _, p := range s.Pills {
                        slide.AddPill(p.X, p.Y, p.W, p.H, p.Text, p.Color)
                }
        }

        data, err := prs.Bytes()
        if err != nil {
                c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
                return
        }

        filename := spec.Title
        if filename == "" { filename = "untitled" }
        c.Header("Content-Disposition", "attachment; filename=\""+filename+".pptx\"")
        c.Data(http.StatusOK, "application/vnd.openxmlformats-officedocument.presentationml.presentation", data)
}

// === 示例 ===

func handleExamples(c *gin.Context) {
        c.JSON(http.StatusOK, gin.H{
                "doc": DocSpec{
                        Title:  "示例报告",
                        Author: "SamAI",
                        Elements: []DocElement{
                                {Type: "heading", Text: "第一章", Level: 1},
                                {Type: "paragraph", Runs: []DocRun{
                                        {Text: "这是 "}, {Text: "加粗", Bold: true}, {Text: " 文本"},
                                }},
                                {Type: "list", Items: []string{"项1", "项2"}},
                                {Type: "table", Rows: [][]string{{"A", "B"}, {"1", "2"}}},
                                {Type: "code", Language: "go", Code: "fmt.Println(\"hi\")"},
                                {Type: "toc", MaxLevel: 3},
                        },
                },
                "xls": XlsSpec{
                        Sheets: []XlsSheetSpec{{
                                Name:    "Sheet1",
                                Headers: []string{"姓名", "分数"},
                                Rows:    [][]string{{"张三", "95"}, {"李四", "87"}},
                                ColWidths: map[string]int{"A": 15, "B": 10},
                                Freeze:   "A2",
                        }},
                },
                "ppt": PptSpec{
                        Title:  "示例演示",
                        Author: "SamAI",
                        Slides: []PptSlide{
                                {Layout: "title", Title: "标题页", Subtitle: "副标题"},
                                {Layout: "content", Title: "内容页", Bullets: []string{"要点1", "要点2"}, Transition: "fade"},
                        },
                },
        })
}

// === 工具 ===

// colName 列号转字母（0→A, 1→B, 26→AA）
func colName(c int) string {
        if c < 26 {
                return string(rune('A' + c))
        }
        return string(rune('A'+c/26-1)) + string(rune('A'+c%26))
}

// 让编译器知道我们用了 json 包（避免 unused import）
var _ = json.Marshal
