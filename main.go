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
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/zai/samoffice/internal/core"
	"github.com/zai/samoffice/internal/dict"
	"github.com/zai/samoffice/internal/dict/hunspell"
	"github.com/zai/samoffice/internal/dict/userdict"
	"github.com/zai/samoffice/internal/officelib"
	"github.com/zai/samoffice/internal/parser"
	"github.com/zai/samoffice/internal/parser/pptx"
	"github.com/zai/samoffice/internal/parser/xlsx"
	"github.com/zai/samoffice/internal/server/api"
	"go.uber.org/zap"
)

//go:embed all:frontend/dist
var frontendAssets embed.FS

// App 是 Wails 应用上下文
type App struct {
	ctx         context.Context
	registry    *parser.Registry
	dictMgr     *dict.Manager
	userStore   *userdict.Store
	httpPort    int
	logger      *zap.Logger
	startupArgs []string
	// startupMu 守护 startupArgs / externalOpen / frontendReady：macOS 的 OnFileOpen
	// 可能在前端挂载前触发，需加锁避免数据竞争。
	startupMu sync.Mutex
	// externalOpen 缓存前端就绪前收到的外部打开请求（Finder 双击 / 「打开方式」）。
	// 前端注册好 second-instance-open 监听后会调 NotifyFrontendReady 让后端重放，
	// 否则冷启动时事件先于监听器发出会被丢弃（文档点开却没有反应）。
	externalOpen  []string
	frontendReady bool
	// confirmedClose 为 true 表示前端已完成未保存更改的询问，OnBeforeClose 应放行。
	confirmedClose bool
	// dictsOnce 守护词典按需加载：首次拼写相关调用（审阅页手动"拼写检查"）时
	// 才加载内置词典 —— 默认启动不加载、不检查（round24 用户需求：
	// 公式文档被误报大量拼写错误；10MB+ 词典常驻也无谓占用内存）。
	dictsOnce sync.Once
}

// ensureDicts 首次拼写调用时同步加载内置词典并 MarkReady（幂等）。
// 加载耗时数秒，仅在用户主动触发拼写检查时发生；期间前端按钮显示"检查中"。
func (a *App) ensureDicts() {
	a.dictsOnce.Do(func() {
		loadBuiltinDicts(a.dictMgr)
		a.dictMgr.MarkReady()
	})
}

// pendingOpenPath 返回"待打开文件"落盘路径（第二个实例把路径写到这里，首个实例轮询读取）
func pendingOpenPath() string {
	dir, err := os.UserCacheDir()
	if err != nil {
		dir = os.TempDir()
	}
	dir = filepath.Join(dir, "samoffice")
	_ = os.MkdirAll(dir, 0o755)
	return filepath.Join(dir, "pending_open.txt")
}

// round27 启动看门狗：诊断发现 shan 上偶发"Wails 启动死锁"（进程活着、
// 窗口不出现、单实例互斥体不释放，后续启动全部被挡）。看门狗机制：
//   - main 启动 45s 内 OnDomReady 未写入 boot_ok 标记 → 判定窗口未出现，
//     写 boot.log 后 os.Exit(1) 强制退出（释放单实例锁，下次启动可恢复）。
//   - 正常启动路径不受影响；boot.log 记录判定结果便于远程诊断。
//   - round45：30s→45s。shan 实测打开大文档时 OnDomReady 可达 29s
//     （分页震荡 + 日志 IO），30s 死线把正常启动误杀（用户"打不开"）。
func bootOkPath() string {
	dir, _ := os.UserCacheDir()
	if dir == "" {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "samoffice", "boot_ok.txt")
}

func bootLogPath() string {
	dir, _ := os.UserCacheDir()
	if dir == "" {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "samoffice", "boot.log")
}

// markBootOk 由 OnDomReady 调用：窗口 DOM 就绪（可见）即写入标记。
func markBootOk() {
	_ = os.MkdirAll(filepath.Dir(bootOkPath()), 0o755)
	_ = os.WriteFile(bootOkPath(), []byte(fmt.Sprintf("%d", time.Now().UnixMilli())), 0o644)
}

// startBootWatchdog 45s 内无 boot_ok 标记则自杀（返回前阻塞在 wails.Run
// 的主流程不受影响，由独立 goroutine 执行）。
func startBootWatchdog() {
	go func() {
		deadline := time.Now().Add(45 * time.Second)
		for time.Now().Before(deadline) {
			if _, err := os.Stat(bootOkPath()); err == nil {
				_ = os.WriteFile(bootLogPath(), []byte(fmt.Sprintf("[%s] boot ok\n", time.Now().Format(time.RFC3339))), 0o644)
				return
			}
			time.Sleep(500 * time.Millisecond)
		}
		msg := fmt.Sprintf("[%s] BOOT WATCHDOG: no window in 45s, force exit (pid=%d)\n", time.Now().Format(time.RFC3339), os.Getpid())
		_ = os.MkdirAll(filepath.Dir(bootLogPath()), 0o755)
		f, _ := os.OpenFile(bootLogPath(), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
		if f != nil {
			_, _ = f.WriteString(msg)
			_ = f.Close()
		}
		fmt.Fprintln(os.Stderr, msg)
		os.Exit(1)
	}()
}

// tryEarlySingleInstance 在 wails.Run 之前做极早期单实例检测，避免第二个实例重复加载词典（慢）。
// - 若已存在实例：把第二个实例的文档参数写入 pending 文件后立刻退出（毫秒级），由首个实例负责打开并最大化窗口。
// - 否则：持有平台单实例锁（Windows 全局命名互斥体 / macOS·Linux flock 文件锁），返回 true（本进程是首个实例）。
// 平台差异收敛在 acquireSingleInstanceLock：singleinstance_windows.go / singleinstance_unix.go。
func tryEarlySingleInstance() bool {
	// 新建窗口模式：本进程由 NewWindow() 以 --new-window 启动，跳过单实例锁，允许并发生成新窗口
	for _, arg := range os.Args[1:] {
		if arg == "--new-window" {
			return true
		}
	}
	if acquireSingleInstanceLock() {
		return true
	}
	// 已存在实例：把文档参数写出并立即退出，跳过昂贵初始化
	if files := documentArgs(os.Args[1:]); len(files) > 0 {
		if f, ferr := os.OpenFile(pendingOpenPath(), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644); ferr == nil {
			for _, p := range files {
				_, _ = f.WriteString(p + "\n")
			}
			f.Close()
		}
	}
	os.Exit(0)
	return false
}

// documentArgs 从命令行参数里挑出文档路径。
// 先去掉「打开方式」可能包裹的首尾引号/空白再判断扩展名，否则带引号路径（"C:\x.pdf"）
// 会匹配失败导致 pending 不写入、第二实例不退。
func documentArgs(args []string) []string {
	suffixes := []string{
		".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".csv", ".tsv",
		".pdf", ".md", ".markdown", ".html", ".htm", ".txt", ".sam",
	}
	files := []string{}
	for _, a := range args {
		clean := strings.Trim(strings.TrimSpace(a), "\"'")
		lower := strings.ToLower(clean)
		for _, ext := range suffixes {
			if strings.HasSuffix(lower, ext) {
				files = append(files, clean)
				break
			}
		}
	}
	return files
}

// NewWindow 打开一个新的空 SamOffice 桌面窗口。
// Wails v2.13 的 runtime 未提供 WindowNew，这里通过启动自身新进程（带 --new-window 标志）
// 来实现独立窗口，并在 tryEarlySingleInstance 中识别该标志以跳过单实例互斥体。
func (a *App) NewWindow() {
	exe, err := os.Executable()
	if err != nil || exe == "" {
		return
	}
	cmd := exec.Command(exe, "--new-window")
	_ = cmd.Start()
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

// handleExternalOpenFile 处理 macOS 的「双击文档 / 右键打开方式 / 拖到 Dock 图标」：
// macOS 通过 Apple Event(odoc) 把文件路径交给 AppDelegate，不会出现在 os.Args 里，
// 因此必须走 Wails 的 mac.Options.OnFileOpen，再复用 Windows 第二实例的那条
// second-instance-open 事件通道交给前端在当前窗口打开。
func (a *App) handleExternalOpenFile(filePath string) {
	path := normalizePath(filePath)
	if path == "" {
		return
	}
	a.startupMu.Lock()
	ready := a.frontendReady
	if !ready {
		a.externalOpen = append(a.externalOpen, path)
	}
	a.startupMu.Unlock()
	if !ready {
		// 前端还没挂载：等它注册好监听器后调 NotifyFrontendReady 再打开
		return
	}
	a.deliverExternalOpen(path)
}

// deliverExternalOpen 通过事件通道让前端在当前窗口打开文档。
func (a *App) deliverExternalOpen(path string) {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, "second-instance-open", []string{path})
	runtime.WindowUnminimise(a.ctx)
	runtime.WindowShow(a.ctx)
}

// NotifyFrontendReady 由前端在注册完 second-instance-open 监听后调用，
// 重放启动期间缓存的外部打开请求（否则会丢第一个文档）。
func (a *App) NotifyFrontendReady() {
	a.startupMu.Lock()
	a.frontendReady = true
	pending := a.externalOpen
	a.externalOpen = nil
	a.startupMu.Unlock()
	for _, p := range pending {
		a.deliverExternalOpen(p)
	}
}

// WindowMinimize minimizes the window
func (a *App) WindowMinimize() {
	if a.ctx == nil {
		return
	}
	runtime.WindowMinimise(a.ctx)
}

// WindowMaximize toggles maximize
func (a *App) WindowMaximize() {
	if a.ctx == nil {
		return
	}
	runtime.WindowToggleMaximise(a.ctx)
}

// WindowClose closes the app
// WindowClose 由前端在完成未保存更改确认后调用，直接退出（不再回弹询问）。
func (a *App) WindowClose() {
	if a.ctx == nil {
		return
	}
	a.confirmedClose = true
	runtime.Quit(a.ctx)
}

// IsWindowMaximized returns whether the window is currently maximized
func (a *App) IsWindowMaximized() bool {
	if a.ctx == nil {
		return false
	}
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
	// round24：词典不再于启动时加载（也不在 OnStartup 后台加载）——
	// 默认"不加载字典、不检查拼写"，用户在审阅页点"拼写检查"时经
	// App.ensureDicts 按需加载（幂等），加载完成后关 ready 通道。

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
	// 规范化路径：邮件/Windows"打开方式"可能传入带引号或 file:// 前缀的路径，
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
	// round63：.txt 同为文本类 —— 返回原文（前端路由进 Markdown 编辑器纯文本模式）。
	if strings.HasSuffix(lower, ".md") || strings.HasSuffix(lower, ".markdown") ||
		strings.HasSuffix(lower, ".mdx") || strings.HasSuffix(lower, ".html") ||
		strings.HasSuffix(lower, ".htm") || strings.HasSuffix(lower, ".txt") {
		res["rawContent"] = base64.StdEncoding.EncodeToString(data)
	}
	return res, nil
}

// SpellCheck 拼写检查。词典按需加载：仅当用户在审阅页手动触发（前端调用本方法）
// 时才加载内置词典 —— 默认启动不加载、不检查。
func (a *App) SpellCheck(text, lang string) []dict.SpellError {
	a.ensureDicts()
	return a.dictMgr.SpellCheck(text, lang)
}

// Suggest 纠错建议
func (a *App) Suggest(word, lang string, n int) []dict.Candidate {
	a.ensureDicts()
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
	a.startupMu.Lock()
	defer a.startupMu.Unlock()
	out := []string{}
	for _, arg := range a.startupArgs {
		lower := strings.ToLower(arg)
		if strings.HasSuffix(lower, ".docx") || strings.HasSuffix(lower, ".doc") ||
			strings.HasSuffix(lower, ".xlsx") || strings.HasSuffix(lower, ".xls") ||
			strings.HasSuffix(lower, ".csv") || strings.HasSuffix(lower, ".tsv") ||
			strings.HasSuffix(lower, ".pptx") || strings.HasSuffix(lower, ".ppt") ||
			strings.HasSuffix(lower, ".md") || strings.HasSuffix(lower, ".markdown") ||
			strings.HasSuffix(lower, ".pdf") || strings.HasSuffix(lower, ".sam") ||
			strings.HasSuffix(lower, ".html") || strings.HasSuffix(lower, ".htm") ||
			strings.HasSuffix(lower, ".txt") {
			out = append(out, arg)
		}
	}
	return out
}

// === 本地文件对话框与写盘（Wails Binding）===

// OpenFileDialog 弹出系统"打开文件"对话框，返回选中文件的完整路径；用户取消则返回空字符串。
func (a *App) OpenFileDialog() (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("app not started")
	}
	filters := []runtime.FileFilter{
		{DisplayName: "Office 文档 (*.docx;*.doc;*.md;*.markdown;*.txt;*.xlsx;*.xls;*.pptx;*.ppt)", Pattern: "*.docx;*.doc;*.md;*.markdown;*.txt;*.xlsx;*.xls;*.pptx;*.ppt"},
		{DisplayName: "PDF 文件 (*.pdf)", Pattern: "*.pdf"},
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

// bootLogMaxBytes boot.log 轮转阈值（round45）：此前 PAGINATION_DEBUG 每次
// 分页都写 ~20KB 大行，shan 机器上 boot.log 曾膨胀到 499MB，且每次追加都要
// 打开巨型文件（ Defender 实时扫描放大的 IO），显著拖慢启动。
const bootLogMaxBytes = 10 << 20

// LogError 接收前端上报的错误/状态，写入 boot.log 便于排障（诊断用）。
// 超过 10MB 自动轮转为 boot.log.old（最多保留一份旧文件）。
// 前端渲染成功标记（FRONTEND_RENDERED_OK）同时写入 boot_ok —— 启动看门狗
// 以此作为“窗口已出现”的兜底信号（OnDomReady 可能在 JS 忙时晚于首次渲染）。
func (a *App) LogError(msg string) {
	home, _ := os.UserHomeDir()
	logPath := filepath.Join(home, ".samoffice", "boot.log")
	if fi, err := os.Stat(logPath); err == nil && fi.Size() > bootLogMaxBytes {
		old := logPath + ".old"
		_ = os.Remove(old)
		_ = os.Rename(logPath, old)
	}
	f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	_, _ = f.WriteString(time.Now().Format("[2006-01-02T15:04:05] ") + msg + "\n")
	_ = f.Close()
	if strings.Contains(msg, "FRONTEND_RENDERED_OK") {
		markBootOk()
	}
}

// SaveFileDialog 弹出系统"保存/另存为"对话框，返回用户选择的完整路径；用户取消则返回空字符串。
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
	case "txt":
		filters = []runtime.FileFilter{{DisplayName: "纯文本文件 (*.txt)", Pattern: "*.txt"}}
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
	// officelib：智能体直创 API（/api/lib/doc|xls|ppt|pdf/create 与 print），
	// 与前端"API"按钮的文档（frontend/public/SamOffice-API.md）保持一致。
	officelib.Register(r)

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
	// 不再加载词典/初始化 Wails（否则"再打开"会和首次一样慢）。
	tryEarlySingleInstance()

	// round27 启动看门狗：清除上次运行的 boot_ok 标记并武装 30s 计时
	_ = os.Remove(bootOkPath())
	startBootWatchdog()

	app := NewApp()
	app.startHTTPServer()

	dist, err := fs.Sub(frontendAssets, "frontend/dist")
	if err != nil {
		log.Fatalf("embed assets: %v", err)
	}

	fmt.Printf("SamOffice starting...\n  Local HTTP: http://127.0.0.1:%d\n", app.httpPort)

	err = wails.Run(&options.App{
		Title:       "SamOffice",
		Width:       1280,
		Height:      800,
		MinWidth:    800,
		MinHeight:   600,
		Frameless:   true,                                       // 无系统标题栏，由前端自绘窗口控制按钮
		DragAndDrop: &options.DragAndDrop{EnableFileDrop: true}, // 启用文件拖放：window.runtime.OnFileDrop 才能收到真实路径
		AssetServer: &assetserver.Options{
			Assets: dist,
		},
		BackgroundColour: &options.RGBA{R: 255, G: 255, B: 255, A: 1},
		// macOS 专有：接收 Finder 双击/「打开方式」传来的文档路径
		Mac: &mac.Options{
			OnFileOpen: func(filePath string) {
				app.handleExternalOpenFile(filePath)
			},
		},
		OnStartup: func(ctx context.Context) {
			app.ctx = ctx
			// round24：词典改为按需加载（SpellCheck/Suggest 首次调用时 ensureDicts）。
			// 默认启动不加载词典、不检查拼写 —— 用户在审阅页点"拼写检查"才加载。
			// 捕获右键"打开方式"/命令行传入的文件路径（os.Args[1:]）
			if len(os.Args) > 1 {
				app.startupMu.Lock()
				app.startupArgs = append(app.startupArgs, os.Args[1:]...)
				app.startupMu.Unlock()
			}
			// 清空可能残留的"待打开文件"，并启动轮询第二个实例写入的路径
			_ = os.WriteFile(pendingOpenPath(), []byte{}, 0o644)
			go app.pollPendingOpens()
		},
		// 拦截标题栏 ✕ / Alt+F4 / 任务栏关闭：先交给前端询问未保存更改。
		// 返回 true = 阻止关闭；前端确认后会调 WindowClose() 置位 confirmedClose 再退出。
		OnDomReady: func(ctx context.Context) {
			// 窗口 DOM 就绪 = 窗口已创建并加载 —— 看门狗解除武装
			markBootOk()
		},
		OnBeforeClose: func(ctx context.Context) bool {
			if app.confirmedClose {
				return false
			}
			runtime.EventsEmit(ctx, "app-close-requested")
			return true
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
