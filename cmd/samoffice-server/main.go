// samoffice-server 独立 HTTP 服务模式（无窗口、不依赖 Wails）。
// 与桌面版共用 internal/server/api 的全部 REST 接口，并为浏览器提供前端静态资源。
// 用法:
//
//	samoffice-server --addr 127.0.0.1:8080 --data ./samoffice-data
//
// 前端静态目录自动按顺序探测: --static 参数 → <exe目录>/frontend/dist → <exe目录>/dist
// → <工作目录>/frontend/dist → <工作目录>/dist。找不到时仅提供 /api/* 接口。
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/zai/samoffice/internal/dict"
	"github.com/zai/samoffice/internal/dict/hunspell"
	"github.com/zai/samoffice/internal/dict/userdict"
	"github.com/zai/samoffice/internal/officelib"
	"github.com/zai/samoffice/internal/parser"
	"github.com/zai/samoffice/internal/server/api"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8080", "HTTP 监听地址")
	dataDir := flag.String("data", "", "数据目录（默认 ~/.samoffice）")
	staticDir := flag.String("static", "", "前端静态目录（默认自动探测 frontend/dist）")
	flag.Parse()

	dir := *dataDir
	if dir == "" {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, ".samoffice")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		log.Fatalf("create data dir: %v", err)
	}

	userStore, err := userdict.Open(filepath.Join(dir, "userdict.sqlite"))
	if err != nil {
		log.Fatalf("open user dict: %v", err)
	}
	dictMgr := dict.NewManager(userStore)
	dictMgr.SetCacheDir(dir) // 启用索引缓存
	loadBuiltinDicts(dictMgr)
	dictMgr.MarkReady() // 同步就绪：服务端无窗口，词典加载完再开始服务

	static := *staticDir
	if static == "" {
		for _, cand := range staticCandidates() {
			if fi, err := os.Stat(cand); err == nil && fi.IsDir() {
				static = cand
				break
			}
		}
	}

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(api.CORSMiddleware())
	h := api.New(parser.NewRegistry(), dictMgr)
	h.Register(r)
	r.GET("/api/doc/local", h.LocalFileOpen)
	// officelib：智能体直创 API（/api/lib/doc|xls|ppt|pdf/create 与 print），
	// 与桌面版内嵌 HTTP 服务保持一致，API 文档见 frontend/public/SamOffice-API.md。
	officelib.Register(r)

	if static != "" {
		fileServer := http.FileServer(http.Dir(static))
		r.NoRoute(func(c *gin.Context) {
			p := strings.TrimPrefix(c.Request.URL.Path, "/")
			if p == "" {
				p = "index.html"
			}
			if _, err := os.Stat(filepath.Join(static, filepath.FromSlash(p))); err == nil {
				fileServer.ServeHTTP(c.Writer, c.Request)
				return
			}
			// SPA 路由回退到 index.html
			c.Request.URL.Path = "/"
			fileServer.ServeHTTP(c.Writer, c.Request)
		})
		log.Printf("frontend static dir: %s", static)
	} else {
		log.Printf("WARN: frontend static dir not found, only /api/* available")
	}

	srv := &http.Server{Addr: *addr, Handler: r}
	go func() {
		log.Printf("SamOffice server listening on http://%s", *addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("listen: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	<-quit
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	fmt.Println("samoffice-server stopped")
}

func staticCandidates() []string {
	var out []string
	if exe, err := os.Executable(); err == nil {
		d := filepath.Dir(exe)
		out = append(out, filepath.Join(d, "frontend", "dist"), filepath.Join(d, "dist"))
	}
	wd, _ := os.Getwd()
	out = append(out, filepath.Join(wd, "frontend", "dist"), filepath.Join(wd, "dist"))
	return out
}

// loadBuiltinDicts 与桌面版 main.go 保持一致（英文 Hunspell 内置词库 + 中文基础词表）。
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
