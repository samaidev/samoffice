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
	Slides []PptSlide `json:"slides"`
}

// PptSlide 幻灯片规格
type PptSlide struct {
	Layout     string   `json:"layout"` // title/content/blank
	Title      string   `json:"title"`
	Subtitle   string   `json:"subtitle"`
	Bullets    []string `json:"bullets"`
	BgColor    string   `json:"bgColor"`
	Transition string   `json:"transition"`
	Notes      string   `json:"notes"`
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
		if s.Title != "" { slide.AddTitle(s.Title) }
		if s.Subtitle != "" { slide.AddSubtitle(s.Subtitle) }
		if len(s.Bullets) > 0 { slide.AddBullets(s.Bullets) }
		if s.BgColor != "" { slide.SetBgColor(s.BgColor) }
		if s.Transition != "" { slide.SetTransition(s.Transition, 500) }
		if s.Notes != "" { slide.SetNotes(s.Notes) }
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
