package api

import (
        "fmt"
        "net/http"
        "os"
        "path/filepath"

        "github.com/gin-gonic/gin"
        "github.com/zai/gooffice/internal/core"
        "github.com/zai/gooffice/internal/dict"
        "github.com/zai/gooffice/internal/parser"
)

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

// saveDocument 接收 UDM JSON 保存为文件
func (h *Handler) saveDocument(c *gin.Context) {
        var doc core.Document
        if err := c.ShouldBindJSON(&doc); err != nil {
                c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
                return
        }
        // TODO: 调用 renderer 输出 docx/md
        c.JSON(http.StatusOK, gin.H{
                "status":  "ok",
                "blocks":  len(doc.Blocks),
                "message": "save not fully implemented, content received",
        })
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
