package api

import (
        "fmt"
        "net/http"
        "os"
        "path/filepath"
        "strings"

        "github.com/gin-gonic/gin"
        "github.com/zai/samoffice/internal/core"
        "github.com/zai/samoffice/internal/dict"
        "github.com/zai/samoffice/internal/parser"
        "github.com/zai/samoffice/internal/renderer/docx"
        "github.com/zai/samoffice/internal/renderer/pdf"
)

// alias for clarity
var _ = docx.New
var _ = pdf.New

// Handler 持有所有依赖的 API handler
type Handler struct {
        Parsers *parser.Registry
        Dict    *dict.Manager
}

func New(parsers *parser.Registry, dictMgr *dict.Manager) *Handler {
        return &Handler{Parsers: parsers, Dict: dictMgr}
}

// Register 注册所有路由
func (h *Handler) Register(r *gin.Engine) {
        r.GET("/api/health", h.health)
        r.POST("/api/doc/open", h.openDocument)
        r.POST("/api/doc/save", h.saveDocument)
        r.POST("/api/doc/save-doc", h.saveDocumentDoc) // .doc format
        r.POST("/api/doc/save-wps", h.saveDocumentWps) // .wps format
        r.POST("/api/doc/export-pdf", h.exportPDF)
        r.GET("/api/dict/check", h.spellCheck)
        r.POST("/api/dict/learn", h.learnWord)
        r.GET("/api/dict/suggest", h.suggest)
}

func (h *Handler) health(c *gin.Context) {
        c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// openDocument 接收文件上传，返回 UDM JSON
func (h *Handler) openDocument(c *gin.Context) {
        file, err := c.FormFile("file")
        if err != nil {
                c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
                return
        }
        src, err := file.Open()
        if err != nil {
                c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
                return
        }
        defer src.Close()

        doc, warns, err := h.Parsers.ParseReader(file.Filename, src)
        if err != nil {
                c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
                return
        }
        c.JSON(http.StatusOK, gin.H{
                "document": doc,
                "warnings": warns,
        })
}

// RenderToBytes 把 UDM 文档渲染为指定格式，返回字节与规范扩展名。
// format 支持: docx / doc / wps / pdf。供 HTTP 端点与本地写盘（Wails 绑定）共用。
func RenderToBytes(doc *core.Document, format string) ([]byte, string, error) {
	switch strings.ToLower(format) {
	case "docx", "wps":
		r := docx.New()
		data, err := r.Render(doc)
		if err != nil {
			return nil, "", err
		}
		return data, "." + strings.ToLower(format), nil
	case "doc":
		// .doc 为二进制 OLE 格式，这里用 Word/WPS 均可打开的 RTF 包裹。
		return []byte(generateRTF(doc)), ".doc", nil
	case "pdf":
		r := pdf.New()
		data, err := r.Render(doc)
		if err != nil {
			return nil, "", err
		}
		return data, ".pdf", nil
	default:
		return nil, "", fmt.Errorf("unsupported format: %s", format)
	}
}

// saveDocument 接收 UDM JSON 保存为 docx 文件并返回
func (h *Handler) saveDocument(c *gin.Context) {
	var doc core.Document
	if err := c.ShouldBindJSON(&doc); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	data, _, err := RenderToBytes(&doc, "docx")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	filename := doc.Meta.Title
	if filename == "" {
		filename = "untitled"
	}
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.docx"`, filename))
	c.Data(http.StatusOK, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", data)
}

// saveDocumentDoc saves as .doc (legacy Word format).
// .doc is a binary OLE format. We generate a minimal RTF wrapper that Word
// and WPS can both open when saved with .doc extension.
func (h *Handler) saveDocumentDoc(c *gin.Context) {
	var doc core.Document
	if err := c.ShouldBindJSON(&doc); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// Generate RTF (Rich Text Format) — opens in Word/WPS as .doc
	data, _, _ := RenderToBytes(&doc, "doc")
	filename := doc.Meta.Title
	if filename == "" {
		filename = "untitled"
	}
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.doc"`, filename))
	c.Data(http.StatusOK, "application/msword", data)
}

// saveDocumentWps saves as .wps format (WPS Office native).
// WPS can open .docx, so we reuse the docx renderer with .wps extension.
func (h *Handler) saveDocumentWps(c *gin.Context) {
	var doc core.Document
	if err := c.ShouldBindJSON(&doc); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	data, _, err := RenderToBytes(&doc, "wps")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	filename := doc.Meta.Title
	if filename == "" {
		filename = "untitled"
	}
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.wps"`, filename))
	c.Data(http.StatusOK, "application/vnd.ms-works", data)
}

// generateRTF converts UDM to a minimal RTF string that Word/WPS can open
func generateRTF(doc *core.Document) string {
        var sb strings.Builder
        sb.WriteString("{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Times New Roman;}}")
        if doc.Meta.Title != "" {
                sb.WriteString("{\\info {\\title " + doc.Meta.Title + "}}")
        }
        for _, block := range doc.Blocks {
                if block == nil {
                        continue
                }
                // Block 是 interface，需类型断言取 Inline (Paragraph/Heading)
                var inlines []core.Inline
                switch b := block.(type) {
                case *core.Paragraph:
                        inlines = b.Inline
                case core.Paragraph:
                        inlines = b.Inline
                case *core.Heading:
                        inlines = b.Inline
                case core.Heading:
                        inlines = b.Inline
                default:
                        // 其他块类型 (BulletList/Table/CodeBlock/Image) 跳过
                        sb.WriteString("\\par\n")
                        continue
                }
                for _, inline := range inlines {
                        if inline == nil {
                                continue
                        }
                        // Inline 是 interface，需类型断言取文本属性 (Text.Under 非 Underline)
                        text, bold, italic, under := "", false, false, false
                        switch in := inline.(type) {
                        case *core.Text:
                                text, bold, italic, under = in.Content, in.Bold, in.Italic, in.Under
                        case core.Text:
                                text, bold, italic, under = in.Content, in.Bold, in.Italic, in.Under
                        case *core.Hyperlink:
                                for _, ti := range in.Text {
                                        if t, ok := ti.(*core.Text); ok {
                                                text += t.Content
                                        } else if t, ok := ti.(core.Text); ok {
                                                text += t.Content
                                        }
                                }
                        case core.Hyperlink:
                                for _, ti := range in.Text {
                                        if t, ok := ti.(*core.Text); ok {
                                                text += t.Content
                                        } else if t, ok := ti.(core.Text); ok {
                                                text += t.Content
                                        }
                                }
                        default:
                                continue
                        }
                        if text == "" {
                                continue
                        }
                        if bold {
                                sb.WriteString("{\\b ")
                        }
                        if italic {
                                sb.WriteString("{\\i ")
                        }
                        if under {
                                sb.WriteString("{\\ul ")
                        }
                        // Escape RTF special chars
                        esc := strings.ReplaceAll(text, "\\", "\\\\")
                        esc = strings.ReplaceAll(esc, "{", "\\{")
                        esc = strings.ReplaceAll(esc, "}", "\\}")
                        sb.WriteString(esc)
                        if under {
                                sb.WriteString("}")
                        }
                        if italic {
                                sb.WriteString("}")
                        }
                        if bold {
                                sb.WriteString("}")
                        }
                }
                sb.WriteString("\\par\n")
        }
        sb.WriteString("}")
        return sb.String()
}

// exportPDF 接收 UDM JSON 导出为 PDF 文件
func (h *Handler) exportPDF(c *gin.Context) {
	var doc core.Document
	if err := c.ShouldBindJSON(&doc); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	data, _, err := RenderToBytes(&doc, "pdf")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	filename := doc.Meta.Title
	if filename == "" {
		filename = "untitled"
	}
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.pdf"`, filename))
	c.Data(http.StatusOK, "application/pdf", data)
}

// spellCheck GET /api/dict/check?text=xxx&lang=en
func (h *Handler) spellCheck(c *gin.Context) {
        text := c.Query("text")
        lang := c.DefaultQuery("lang", "en")
        if h.Dict == nil {
                c.JSON(http.StatusOK, gin.H{"errors": []any{}})
                return
        }
        errs := h.Dict.SpellCheck(text, lang)
        c.JSON(http.StatusOK, gin.H{"errors": errs})
}

// learnWord POST /api/dict/learn {word, lang, source}
func (h *Handler) learnWord(c *gin.Context) {
        var req struct {
                Word   string `json:"word"`
                Lang   string `json:"lang"`
                Source string `json:"source"`
        }
        if err := c.ShouldBindJSON(&req); err != nil {
                c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
                return
        }
        if req.Source == "" {
                req.Source = "manual"
        }
        if err := h.Dict.LearnUserWord(req.Word, req.Lang, req.Source); err != nil {
                c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
                return
        }
        c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// suggest GET /api/dict/suggest?word=xxx&lang=en&n=5
func (h *Handler) suggest(c *gin.Context) {
        word := c.Query("word")
        lang := c.DefaultQuery("lang", "en")
        n := 5
        if v := c.Query("n"); v != "" {
                if i, err := parseInt(v); err == nil {
                        n = i
                }
        }
        if h.Dict == nil {
                c.JSON(http.StatusOK, gin.H{"candidates": []any{}})
                return
        }
        cands := h.Dict.Suggest(word, lang, n)
        c.JSON(http.StatusOK, gin.H{"candidates": cands})
}

// LocalFileOpen 从本地路径打开文档（仅本地模式可用）
func (h *Handler) LocalFileOpen(c *gin.Context) {
        path := c.Query("path")
        if path == "" {
                c.JSON(http.StatusBadRequest, gin.H{"error": "missing path"})
                return
        }
        abs, err := filepath.Abs(path)
        if err != nil {
                c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
                return
        }
        data, err := os.ReadFile(abs)
        if err != nil {
                c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
                return
        }
        doc, warns, err := h.Parsers.ParseBytes(abs, data)
        if err != nil {
                c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
                return
        }
        c.JSON(http.StatusOK, gin.H{
                "document": doc,
                "warnings": warns,
                "path":     abs,
        })
}

func parseInt(s string) (int, error) {
        n := 0
        for _, r := range s {
                if r < '0' || r > '9' {
                        return 0, fmt.Errorf("invalid int")
                }
                n = n*10 + int(r-'0')
        }
        return n, nil
}
