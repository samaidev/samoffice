// Package main 是 SamOffice 的独立 HTTP 服务入口
// 用于远程部署：gooffice-server --addr 0.0.0.0:8080
// 浏览器访问 http://host:8080
package main

import (
        "flag"
        "fmt"
        "log"
        "net/http"
        "os"
        "path/filepath"
        "strings"

        "github.com/gin-gonic/gin"
        "github.com/zai/gooffice/internal/dict"
        "github.com/zai/gooffice/internal/dict/hunspell"
        "github.com/zai/gooffice/internal/dict/userdict"
        "github.com/zai/gooffice/internal/officelib"
        "github.com/zai/gooffice/internal/parser"
        "github.com/zai/gooffice/internal/server/api"
        "go.uber.org/zap"
)

func main() {
        addr := flag.String("addr", "0.0.0.0:8080", "HTTP server listen address")
        dataDir := flag.String("data", "./gooffice-data", "Data directory for user dict and docs")
        flag.Parse()

        // 日志
        logger, _ := zap.NewProduction()
        defer logger.Sync()

        // 数据目录
        if err := os.MkdirAll(*dataDir, 0755); err != nil {
                log.Fatalf("create data dir: %v", err)
        }

        // 用户词库
        userStore, err := userdict.Open(filepath.Join(*dataDir, "userdict.sqlite"))
        if err != nil {
                log.Fatalf("open user dict: %v", err)
        }
        defer userStore.Close()

        // 词库管理器
        dictMgr := dict.NewManager(userStore)
        dictMgr.SetCacheDir(*dataDir) // 启用 SymSpell 索引缓存
        loadBuiltinDicts(dictMgr)

        // 解析器注册中心
        registry := parser.NewRegistry()

        // HTTP 服务
        gin.SetMode(gin.ReleaseMode)
        r := gin.Default()

        // API
        h := api.New(registry, dictMgr)
        h.Register(r)
        r.GET("/api/doc/local", h.LocalFileOpen)

        // officelib API（智能体调用）
        officelib.Register(r)

        // 静态前端资源
        frontendDir := "./frontend/dist"
        if _, err := os.Stat(frontendDir); err == nil {
                r.Static("/assets", filepath.Join(frontendDir, "assets"))
                r.Static("/vendor", filepath.Join(frontendDir, "vendor"))
                r.StaticFile("/", filepath.Join(frontendDir, "index.html"))
                // SPA fallback：仅对非 API 路径返回 index.html
                r.NoRoute(func(c *gin.Context) {
                        if strings.HasPrefix(c.Request.URL.Path, "/api/") {
                                c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
                                return
                        }
                        c.File(filepath.Join(frontendDir, "index.html"))
                })
                // 对 API 路径的错误 method 返回 405
                r.NoMethod(func(c *gin.Context) {
                        if strings.HasPrefix(c.Request.URL.Path, "/api/") {
                                c.JSON(http.StatusMethodNotAllowed, gin.H{"error": "method not allowed"})
                                return
                        }
                        c.JSON(http.StatusMethodNotAllowed, gin.H{"error": "method not allowed"})
                })
                r.HandleMethodNotAllowed = true
        } else {
                logger.Warn("frontend/dist not found, running API-only mode",
                        zap.String("dir", frontendDir))
        }

        // 健康检查与启动
        fmt.Printf("SamOffice Server starting at http://%s\n", *addr)
        fmt.Printf("Data directory: %s\n", *dataDir)
        fmt.Println("Press Ctrl+C to stop")

        srv := &http.Server{Addr: *addr, Handler: r}
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
                log.Fatalf("server: %v", err)
        }
}

// loadBuiltinDicts 加载内置词库
// 英文：从嵌入的 Hunspell en_US.dic 加载（~5万词）
// 中文：示例词集（待集成 jieba）
func loadBuiltinDicts(m *dict.Manager) {
        // 加载 Hunspell 英文词库
        enWords, err := hunspell.LoadBuiltin("en_US")
        if err != nil {
                log.Printf("WARN: load en_US dict failed: %v, using fallback", err)
                enWords = fallbackEnWords()
        } else {
                log.Printf("Loaded en_US dict: %d words", len(enWords))
        }
        if err := m.RegisterLang("en", enWords); err != nil {
                log.Printf("register en dict: %v", err)
        }

        // 中文示例词（实际应从结巴词典加载 ~35万词）
        zhWords := fallbackZhWords()
        if err := m.RegisterLang("zh", zhWords); err != nil {
                log.Printf("register zh dict: %v", err)
        }
}

func fallbackEnWords() map[string]int {
        return map[string]int{
                "hello": 1000, "world": 1000, "the": 5000, "be": 5000, "to": 5000,
                "of": 5000, "and": 5000, "a": 5000, "in": 5000, "that": 4000,
                "have": 4000, "i": 4000, "it": 4000, "for": 4000, "not": 4000,
                "on": 4000, "with": 4000, "he": 4000, "as": 4000, "you": 4000,
                "do": 4000, "at": 4000, "this": 4000, "but": 4000, "his": 4000,
                "by": 4000, "from": 4000, "they": 4000, "we": 4000, "say": 4000,
                "her": 4000, "she": 4000, "or": 4000, "an": 4000, "will": 4000,
                "my": 4000, "one": 4000, "all": 4000, "would": 4000, "there": 4000,
                "their": 4000, "what": 4000, "so": 4000, "up": 4000, "out": 4000,
                "if": 4000, "about": 4000, "who": 4000, "get": 4000, "which": 4000,
                "go": 4000, "me": 4000, "when": 4000, "make": 4000, "can": 4000,
                "like": 4000, "time": 4000, "no": 4000, "just": 4000, "him": 4000,
                "know": 4000, "take": 4000, "people": 4000, "into": 4000, "year": 4000,
                "your": 4000, "good": 4000, "some": 4000, "could": 4000, "them": 4000,
                "see": 4000, "other": 4000, "than": 4000, "then": 4000, "now": 4000,
                "look": 4000, "only": 4000, "come": 4000, "its": 4000, "over": 4000,
                "think": 4000, "also": 4000, "back": 4000, "after": 4000, "use": 4000,
                "two": 4000, "how": 4000, "our": 4000, "work": 4000, "first": 4000,
                "well": 4000, "way": 4000, "even": 4000, "new": 4000, "want": 4000,
                "because": 4000, "any": 4000, "these": 4000, "give": 4000, "day": 4000,
                "most": 4000, "us": 4000, "office": 500, "document": 500, "open": 500,
                "save": 500, "edit": 500, "file": 500, "text": 500, "format": 500,
                "spell": 200, "check": 500, "language": 300, "word": 500, "sentence": 200,
        }
}

func fallbackZhWords() map[string]int {
        return map[string]int{
                "你好": 1000, "世界": 1000, "中国": 1000, "文档": 800, "编辑": 800,
                "打开": 800, "保存": 800, "关闭": 800, "复制": 800, "粘贴": 800,
                "剪切": 800, "撤销": 800, "重做": 800, "查找": 800, "替换": 800,
                "字体": 600, "字号": 600, "加粗": 600, "斜体": 600, "下划": 600,
                "颜色": 800, "对齐": 800, "居中": 800, "表格": 800, "图片": 800,
                "链接": 800, "标题": 800, "段落": 800, "列表": 800, "页眉": 600,
                "页脚": 600, "页码": 600, "目录": 600, "办公": 800, "软件": 800,
                "应用": 800, "程序": 800, "系统": 800, "用户": 800, "管理": 800,
                "设置": 800, "选项": 800, "配置": 800, "工具": 800, "菜单": 800,
                "窗口": 800, "面板": 800, "按钮": 800, "输入": 800, "输出": 800,
                "数据": 800, "信息": 800, "内容": 800, "格式": 800, "样式": 800,
                "模板": 800, "插件": 800, "扩展": 800, "协同": 800, "协作": 800,
                "共享": 800, "版本": 800, "历史": 800, "我们": 1000, "你们": 1000,
                "他们": 1000, "自己": 1000, "这个": 1000, "那个": 1000, "什么": 1000,
                "怎么": 1000, "为什么": 1000, "哪里": 1000, "时间": 1000, "地方": 1000,
                "人": 1000, "事": 1000, "物": 1000,
        }
}
