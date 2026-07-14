// Package main 是 Wails 桌面应用入口
// 本地模式：原生窗口 + 内嵌 WebView
// 同时启动 HTTP 服务，支持远程访问
package main

import (
        "context"
        "embed"
        "fmt"
        "io/fs"
        "log"
        "net"
        "net/http"
        "os"
        "path/filepath"

        "github.com/gin-gonic/gin"
        "github.com/wailsapp/wails/v2"
        "github.com/wailsapp/wails/v2/pkg/options"
        "github.com/wailsapp/wails/v2/pkg/options/assetserver"
        "github.com/zai/samoffice/internal/dict"
        "github.com/zai/samoffice/internal/dict/hunspell"
        "github.com/zai/samoffice/internal/dict/userdict"
        "github.com/zai/samoffice/internal/parser"
        "github.com/zai/samoffice/internal/server/api"
        "go.uber.org/zap"
)

//go:embed all:frontend/dist
var frontendAssets embed.FS

// App 是 Wails 应用上下文
type App struct {
        ctx       context.Context
        registry  *parser.Registry
        dictMgr   *dict.Manager
        userStore *userdict.Store
        httpPort  int
        logger    *zap.Logger
}

func NewApp() *App {
        logger, _ := zap.NewProduction()

        home, _ := os.UserHomeDir()
        dataDir := filepath.Join(home, ".samoffice")
        os.MkdirAll(dataDir, 0755)

        userStore, err := userdict.Open(filepath.Join(dataDir, "userdict.sqlite"))
        if err != nil {
                log.Fatalf("open user dict: %v", err)
        }

        dictMgr := dict.NewManager(userStore)
        dictMgr.SetCacheDir(dataDir) // 启用索引缓存
        loadBuiltinDicts(dictMgr)

        return &App{
                registry:  parser.NewRegistry(),
                dictMgr:   dictMgr,
                userStore: userStore,
                logger:    logger,
        }
}

// === 暴露给前端的方法（Wails Binding）===

// OpenFile 通过文件路径打开文档
func (a *App) OpenFile(path string) (map[string]any, error) {
        data, err := os.ReadFile(path)
        if err != nil {
                return nil, err
        }
        doc, warns, err := a.registry.ParseBytes(path, data)
        if err != nil {
                return nil, err
        }
        return map[string]any{
                "document": doc,
                "warnings": warns,
                "path":     path,
        }, nil
}

// SpellCheck 拼写检查
func (a *App) SpellCheck(text, lang string) []dict.SpellError {
        return a.dictMgr.SpellCheck(text, lang)
}

// Suggest 纠错建议
func (a *App) Suggest(word, lang string, n int) []dict.Candidate {
        return a.dictMgr.Suggest(word, lang, n)
}

// LearnWord 加入用户词库
func (a *App) LearnWord(word, lang, source string) error {
        return a.dictMgr.LearnUserWord(word, lang, source)
}

// HTTPPort 返回内嵌 HTTP 服务端口
func (a *App) HTTPPort() int { return a.httpPort }

// === 内嵌 HTTP 服务 ===
func (a *App) startHTTPServer() {
        gin.SetMode(gin.ReleaseMode)
        r := gin.New()
        r.Use(gin.Recovery())
        h := api.New(a.registry, a.dictMgr)
        h.Register(r)
        r.GET("/api/doc/local", h.LocalFileOpen)

        ln, err := net.Listen("tcp", "127.0.0.1:0")
        if err != nil {
                log.Fatalf("listen: %v", err)
        }
        a.httpPort = ln.Addr().(*net.TCPAddr).Port

        go func() {
                srv := &http.Server{Handler: r}
                _ = srv.Serve(ln)
        }()

        a.logger.Info("HTTP server started", zap.Int("port", a.httpPort))
}

func main() {
        app := NewApp()
        app.startHTTPServer()

        dist, err := fs.Sub(frontendAssets, "frontend/dist")
        if err != nil {
                log.Fatalf("embed assets: %v", err)
        }

        fmt.Printf("SamOffice starting...\n  Local HTTP: http://127.0.0.1:%d\n", app.httpPort)

        err = wails.Run(&options.App{
                Title:     "SamOffice - Cross-platform Office Suite",
                Width:     1280,
                Height:    800,
                MinWidth:  800,
                MinHeight: 600,
                AssetServer: &assetserver.Options{
                        Assets: dist,
                },
                BackgroundColour: &options.RGBA{R: 255, G: 255, B: 255, A: 1},
                OnStartup: func(ctx context.Context) {
                        app.ctx = ctx
                },
                Bind: []interface{}{app},
        })

        if err != nil {
                log.Fatal(err)
        }
}

func loadBuiltinDicts(m *dict.Manager) {
        enWords, err := hunspell.LoadBuiltin("en_US")
        if err != nil {
                log.Printf("WARN: load en_US dict failed: %v, using fallback", err)
                enWords = map[string]int{
                        "hello": 1000, "world": 1000, "the": 5000, "be": 5000, "to": 5000,
                        "of": 5000, "and": 5000, "a": 5000, "in": 5000, "that": 4000,
                        "office": 500, "document": 500, "open": 500, "save": 500, "edit": 500,
                        "file": 500, "text": 500, "format": 500, "spell": 200, "check": 500,
                        "language": 300, "word": 500, "sentence": 200,
                }
        } else {
                log.Printf("Loaded en_US dict: %d words", len(enWords))
        }
        m.RegisterLang("en", enWords)

        zhWords := map[string]int{
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
        }
        m.RegisterLang("zh", zhWords)
}
