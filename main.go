// Package main 是 Wails 桌面应用入口
// 本地模式：原生窗口 + 内嵌 WebView
// 同时启动 HTTP 服务，支持远程访问
package main

import (
	"context"
	"embed"
	"encoding/base64"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/zai/samoffice/internal/core"
	"github.com/zai/samoffice/internal/dict"
	"github.com/zai/samoffice/internal/dict/hunspell"
	"github.com/zai/samoffice/internal/dict/userdict"
	"github.com/zai/samoffice/internal/parser"
	"github.com/zai/samoffice/internal/parser/pptx"
	"github.com/zai/samoffice/internal/parser/xlsx"
	"github.com/zai/samoffice/internal/server/api"
	"go.uber.org/zap"
	"golang.org/x/sys/windows"
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
	startupArgs []string
}

// pendingOpenPath 返回“待打开文件”落盘路径（第二个实例把路径写到这里，首个实例轮询读取）
func pendingOpenPath() string {
        dir, err := os.UserCacheDir()
        if err != nil {
                dir = os.TempDir()
        }
        dir = filepath.Join(dir, "samoffice")
        _ = os.MkdirAll(dir, 0o755)
        return filepath.Join(dir, "pending_open.txt")
}

// tryEarlySingleInstance 在 wails.Run 之前做极早期单实例检测，避免第二个实例重复加载词典（慢）。
// - 若已存在实例：把第二个实例的文档参数写入 pending 文件后立刻退出（毫秒级），由首个实例负责打开并最大化窗口。
// - 否则：创建全局命名互斥体并持有，返回 true（本进程是首个实例）。
// 非 Windows 平台退化为直接返回 true（不阻止多开）。
func tryEarlySingleInstance() bool {
        const mutexName = "Global\\SamOffice-SingleInstance"
        _, err := windows.CreateMutex(nil, false, windows.StringToUTF16Ptr(mutexName))
        if err == nil {
                // 创建成功：本进程是第一个，继续
                return true
        }
        if errno, ok := err.(windows.Errno); ok && errno == windows.ERROR_ALREADY_EXISTS {
                // 已存在实例：把文档参数写出并立即退出，跳过昂贵初始化
		args := os.Args[1:]
		files := []string{}
		for _, a := range args {
			// 去除 Windows "打开方式" 可能包裹的首尾引号/空白，再判断扩展名，
			// 否则带引号路径（"C:\x.pdf"）会匹配失败导致pending不写入、第二实例不退。
			clean := strings.Trim(strings.TrimSpace(a), "\"'")
			lower := strings.ToLower(clean)
			if strings.HasSuffix(lower, ".docx") || strings.HasSuffix(lower, ".doc") ||
				strings.HasSuffix(lower, ".xlsx") || strings.HasSuffix(lower, ".xls") ||
				strings.HasSuffix(lower, ".pdf") || strings.HasSuffix(lower, ".md") ||
				strings.HasSuffix(lower, ".html") || strings.HasSuffix(lower, ".htm") ||
				strings.HasSuffix(lower, ".txt") {
				files = append(files, clean)
			}
		}
                if len(files) > 0 {
                        if f, ferr := os.OpenFile(pendingOpenPath(), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644); ferr == nil {
                                for _, p := range files {
                                        _, _ = f.WriteString(p + "\n")
                                }
                                f.Close()
                        }
                }
                os.Exit(0)
        }
        // 其它创建错误：退化为允许多开
        return true
}

// pollPendingOpens 由首个实例在 OnStartup 后启动，轮询第二个实例写入的待打开文件，
// 收到后通过事件通知前端打开，并将窗口恢复/最大化（复用当前窗口而非新开）。
func (a *App) pollPendingOpens() {
        last := ""
        for {
                time.Sleep(200 * time.Millisecond)
                if a.ctx == nil {
                        continue
                }
                data, err := os.ReadFile(pendingOpenPath())
                if err != nil {
                        continue
                }
                content := string(data)
                if content == "" || content == last {
                        continue
                }
                // 清空，避免重复触发
                _ = os.WriteFile(pendingOpenPath(), []byte{}, 0o644)
                last = content
                for _, line := range strings.Split(strings.TrimSpace(content), "\n") {
                        line = strings.TrimSpace(line)
                        if line == "" {
                                continue
                        }
                        runtime.EventsEmit(a.ctx, "second-instance-open", []string{line})
                        runtime.WindowUnminimise(a.ctx)
                        runtime.WindowShow(a.ctx)
                        if !runtime.WindowIsMaximised(a.ctx) {
                                runtime.WindowMaximise(a.ctx)
                        }
                }
        }
}

// WindowMinimize minimizes the window
func (a *App) WindowMinimize() {
        if a.ctx == nil { return }
        runtime.WindowMinimise(a.ctx)
}

// WindowMaximize toggles maximize
func (a *App) WindowMaximize() {
        if a.ctx == nil { return }
        runtime.WindowToggleMaximise(a.ctx)
}

// WindowClose closes the app
func (a *App) WindowClose() {
        if a.ctx == nil { return }
        runtime.Quit(a.ctx)
}

// IsWindowMaximized returns whether the window is currently maximized
func (a *App) IsWindowMaximized() bool {
        if a.ctx == nil { return false }
        return runtime.WindowIsMaximised(a.ctx)
}

// WindowStartDrag is a no-op in Wails v2.12.0 (该版本 runtime 无 WindowDrag API)。
// frameless 窗口拖动改由前端 CSS `--wails-draggable: drag` 实现 (Wails 官方方案)。
// 保留方法签名以兼容前端已有的调用 (App.tsx header 的 onMouseDown fallback)。
func (a *App) WindowStartDrag() {
        // no-op: CSS --wails-draggable handles dragging in v2.12.0
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

// normalizePath 清理外部传入的文件路径：去掉首尾引号/空白，以及 file:// 协议前缀，
// 确保后续 os.ReadFile / ReadFile 前端调用能正确定位文件。
func normalizePath(p string) string {
	p = strings.TrimSpace(p)
	p = strings.Trim(p, "\"'")
	if strings.HasPrefix(strings.ToLower(p), "file:///") {
		p = p[8:]
	} else if strings.HasPrefix(strings.ToLower(p), "file://") {
		p = p[7:]
	}
	// Windows 路径 file:///C:/x 去掉前缀后为 /C:/x，补回盘符形式
	if len(p) >= 3 && p[0] == '/' && p[2] == ':' {
		p = p[1:]
	}
	return strings.TrimSpace(p)
}

// OpenFile 通过文件路径打开文档
func (a *App) OpenFile(path string) (map[string]any, error) {
	// 规范化路径：邮件/Windows“打开方式”可能传入带引号或 file:// 前缀的路径，
	// 直接 os.ReadFile 会因路径非法而失败。这里统一去掉引号与 file:// 前缀。
	path = normalizePath(path)

	lower := strings.ToLower(path)
	// PDF 不解析为 UDM 文档：前端 PdfViewer 直接读取原始字节渲染，
	// 故不读取文件内容、不调用解析器，直接返回路径即可，避免 os.ReadFile / 解析失败。
	if strings.HasSuffix(lower, ".pdf") {
		return map[string]any{
			"document": nil,
			"warnings": []any{},
			"path":     path,
		}, nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	doc, warns, err := a.registry.ParseBytes(path, data)
	if err != nil {
		return nil, err
	}
	// 对于文本类文件（Markdown / HTML），把原文以 base64 一并返回，
	// 前端无需再调用 ReadFile（远程/网页模式下 ReadFile 不可用），直接展示原文。
	// PDF 不解析为 UDM 文档：前端 PdfViewer 直接读取原始字节渲染，
	// 走 registry.ParseBytes 会因无 PDF 解析器返回 "unsupported format" 而失败。
	// 故 PDF 仅返回路径，由前端 openResult 的 pdf 分支处理。
	if strings.HasSuffix(lower, ".pdf") {
		return map[string]any{
			"document": nil,
			"warnings": []any{},
			"path":     path,
		}, nil
	}
	res := map[string]any{
		"document": doc,
		"warnings": warns,
		"path":     path,
	}
	if strings.HasSuffix(lower, ".md") || strings.HasSuffix(lower, ".markdown") ||
		strings.HasSuffix(lower, ".mdx") || strings.HasSuffix(lower, ".html") ||
		strings.HasSuffix(lower, ".htm") {
		res["rawContent"] = base64.StdEncoding.EncodeToString(data)
	}
	return res, nil
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

// GetStartupArgs 返回启动时传入的命令行参数（右键"打开方式"/命令行打开的文件路径）。
// 仅返回看起来像文档的路径（以常见扩展名结尾），其余忽略。
func (a *App) GetStartupArgs() []string {
	out := []string{}
	for _, arg := range a.startupArgs {
		lower := strings.ToLower(arg)
		if strings.HasSuffix(lower, ".docx") || strings.HasSuffix(lower, ".doc") ||
			strings.HasSuffix(lower, ".xlsx") || strings.HasSuffix(lower, ".xls") ||
			strings.HasSuffix(lower, ".csv") || strings.HasSuffix(lower, ".tsv") ||
			strings.HasSuffix(lower, ".pptx") ||
			strings.HasSuffix(lower, ".md") || strings.HasSuffix(lower, ".markdown") ||
			strings.HasSuffix(lower, ".pdf") || strings.HasSuffix(lower, ".sam") ||
			strings.HasSuffix(lower, ".html") || strings.HasSuffix(lower, ".htm") {
			out = append(out, arg)
		}
	}
	return out
}

// === 本地文件对话框与写盘（Wails Binding）===

// OpenFileDialog 弹出系统“打开文件”对话框，返回选中文件的完整路径；用户取消则返回空字符串。
func (a *App) OpenFileDialog() (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("app not started")
	}
	filters := []runtime.FileFilter{
		{DisplayName: "Office 文档 (*.docx;*.md;*.markdown;*.xlsx;*.pptx)", Pattern: "*.docx;*.md;*.markdown;*.xlsx;*.pptx"},
		{DisplayName: "所有文件 (*.*)", Pattern: "*.*"},
	}
	result, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "打开文件",
		Filters: filters,
	})
	if err != nil {
		return "", err
	}
	return result, nil
}

// ReadFile 读取本地文件并以 base64 返回（供前端构造 blob，例如 PDF 预览）。
func (a *App) ReadFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// LogError 接收前端上报的错误/状态，写入 boot.log 便于排障（诊断用）。
func (a *App) LogError(msg string) {
	home, _ := os.UserHomeDir()
	logPath := filepath.Join(home, ".samoffice", "boot.log")
	f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintln(f, msg)
}

// SaveFileDialog 弹出系统“保存/另存为”对话框，返回用户选择的完整路径；用户取消则返回空字符串。
func (a *App) SaveFileDialog(defaultName, format string) (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("app not started")
	}
	var filters []runtime.FileFilter
	switch strings.ToLower(format) {
	case "docx":
		filters = []runtime.FileFilter{{DisplayName: "Word 文档 (*.docx)", Pattern: "*.docx"}}
	case "doc":
		filters = []runtime.FileFilter{{DisplayName: "Word 97-2003 (*.doc)", Pattern: "*.doc"}}
	case "wps":
		filters = []runtime.FileFilter{{DisplayName: "WPS 文档 (*.wps)", Pattern: "*.wps"}}
	case "pdf":
		filters = []runtime.FileFilter{{DisplayName: "PDF 文件 (*.pdf)", Pattern: "*.pdf"}}
	default:
		filters = []runtime.FileFilter{{DisplayName: "所有文件 (*.*)", Pattern: "*.*"}}
	}
	name := defaultName
	if name == "" {
		name = "untitled"
	}
	result, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		DefaultFilename: name + "." + strings.ToLower(format),
		Title:           "另存为",
		Filters:         filters,
	})
	if err != nil {
		return "", err
	}
	return result, nil
}

// WriteDocument 把 UDM 文档渲染为指定格式并写入磁盘。
// format 支持: docx / doc / wps / pdf。若 path 缺少扩展名会自动补全。
func (a *App) WriteDocument(path, format string, document core.Document) error {
	data, ext, err := api.RenderToBytes(&document, format)
	if err != nil {
		return err
	}
	if !strings.EqualFold(filepath.Ext(path), ext) {
		path = path + ext
	}
	return os.WriteFile(path, data, 0644)
}

// === Excel 原生读写（保留格式：值/字体/填充/边框/对齐/合并） ===

// ReadXLSX 读取 xlsx 为 JSON（完整保留单元格格式与合并信息）
func (a *App) ReadXLSX(path string) (string, error) {
	return xlsx.ReadXLSX(path)
}

// WriteXLSX 将前端传来的 JSON 写成真正的 xlsx（保留格式与合并）
func (a *App) WriteXLSX(path, jsonStr string) error {
	return xlsx.WriteXLSX(path, jsonStr)
}

// WriteTextFile 把纯文本（Markdown / HTML / TXT 等）原样写入磁盘。
// 用于"保存"当前 Markdown/HTML 选项卡的文件，保留原文而非重新渲染。
func (a *App) WriteTextFile(path, content string) error {
	content = strings.ReplaceAll(content, "\r\n", "\n")
	return os.WriteFile(path, []byte(content), 0644)
}

// WritePPTX 把前端传来的幻灯片 JSON 写成真正的 .pptx（自研 OOXML 写入器）。
func (a *App) WritePPTX(path, jsonStr string) error {
	return pptx.WritePPTX(path, jsonStr)
}

// === 内嵌 HTTP 服务 ===
func (a *App) startHTTPServer() {
        gin.SetMode(gin.ReleaseMode)
        r := gin.New()
        r.Use(gin.Recovery())
        r.Use(api.CORSMiddleware()) // 放行 Wails WebView 跨域请求，修复导出/另存为预检失败
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
        // 极早期单实例检测：若已有实例在运行，第二个实例把文档参数写出后立即退出，
        // 不再加载词典/初始化 Wails（否则“再打开”会和首次一样慢）。
        tryEarlySingleInstance()

        app := NewApp()
        app.startHTTPServer()

        dist, err := fs.Sub(frontendAssets, "frontend/dist")
        if err != nil {
                log.Fatalf("embed assets: %v", err)
        }

        fmt.Printf("SamOffice starting...\n  Local HTTP: http://127.0.0.1:%d\n", app.httpPort)

        err = wails.Run(&options.App{
                Title:     "SamOffice",
                Width:     1280,
                Height:    800,
                MinWidth:  800,
                MinHeight: 600,
                Frameless: true, // 无系统标题栏，由前端自绘窗口控制按钮
                AssetServer: &assetserver.Options{
                        Assets: dist,
                },
                BackgroundColour: &options.RGBA{R: 255, G: 255, B: 255, A: 1},
                OnStartup: func(ctx context.Context) {
                        app.ctx = ctx
                        // 捕获右键"打开方式"/命令行传入的文件路径（os.Args[1:]）
                        if len(os.Args) > 1 {
                                app.startupArgs = append(app.startupArgs, os.Args[1:]...)
                        }
                        // 清空可能残留的“待打开文件”，并启动轮询第二个实例写入的路径
                        _ = os.WriteFile(pendingOpenPath(), []byte{}, 0o644)
                        go app.pollPendingOpens()
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
