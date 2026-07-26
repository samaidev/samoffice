# SamOffice — 跨平台 Office 三件套

基于 Go + Web 技术构建的跨平台 Office 套件（文档 / 表格 / 演示）。
核心特性：**双模架构**（Wails 桌面 + 独立 HTTP 服务）、**强容错文档解析**、**拼写纠错词库**。

> **命名说明（避免混淆）**
> - 仓库 Go 模块路径：`github.com/zai/samoffice`
> - 产品名（Wails `name`）：`SamOffice`（安装目录 / 可执行文件名均为 `samoffice`）
> - ⚠️ 旧文档（如 `pkg/README.md`）中出现的 `github.com/zai/gooffice` 是**过时写法**，正确路径为 `github.com/zai/samoffice`。

---

## 0. 速查表（一眼看懂）

| 项 | 值 |
|----|----|
| 模块路径 | `github.com/zai/samoffice` |
| 语言 / 框架 | Go 1.25 + React 18 + Wails v2.12.0 |
| 桌面壳 | Wails（frameless 无边框，前端自绘标题栏）|
| 后端服务 | Gin（内嵌 HTTP + 独立 `samoffice-server`）|
| 存储 | SQLite（用户词库 `userdict.sqlite`）|
| 构建入口 | `main.go`（桌面） / `cmd/samoffice-server`（服务）|
| 包管理 | Go modules + npm（前端）|
| 测试 | 116 个 e2e 全通过（100%）；Go 单测 `go test ./...` |
| 安装位置 | `C:\Program Files\SamOffice\`（Windows）|

**Windows 打包产物（截至 2026-07-19 安装）：**

| 文件 | 大小 | 说明 |
|------|------|------|
| `samoffice.exe` | ~49.9 MB | 桌面主程序（前端已 embed 进 exe）|
| `samoffice-server.exe` | ~43.5 MB | 独立 HTTP 服务模式 |
| `uninstall.exe` | ~76 KB | 卸载程序 |
| `frontend\` | — | ⚠️ 非 NSIS 安装产出（前端已编译进 exe）；为额外/调试目录，**不影响运行** |

---

## 1. 构建环境

| 依赖 | 版本 | 用途 |
|------|------|------|
| Go | **1.25.0** | 后端 / 桌面编译（见 `go.mod`）|
| Node.js | **18+** | 前端构建（Vite 5 / React 18 / TypeScript）|
| Wails CLI | v2.12.0（可选）| `go install github.com/wailsapp/wails/v2/cmd/wails@latest`，仅用于 dev |
| NSIS | 3.x（仅 Windows 打包）| 生成安装器 `samoffice-setup-0.1.0.exe` |
| 系统 | Windows 10/11 64-bit（NSIS 脚本要求 x64）| 桌面运行 / 打包 |

---

## 2. 构建与运行

### 2.1 一键构建（按平台）

```bash
# Linux / macOS：构建桌面 + 服务端 + 前端
./scripts/build.sh all
./scripts/build.sh server     # 仅服务端
./scripts/build.sh wails      # 仅桌面端

# Windows：打包 NSIS 安装器（含前端构建 + Go 编译 + NSIS）
packaging/windows/build_windows_package.bat
```

### 2.2 手动编译（等价命令，便于排查）

```bash
# 前端
cd frontend && npm install && npm run build && cd ..

# 桌面主程序（Windows）
go build -tags desktop,production -ldflags="-s -w -H windowsgui" -o samoffice.exe .

# 独立 HTTP 服务端
go build -ldflags="-s -w" -o samoffice-server.exe ./cmd/samoffice-server
```

### 2.3 运行

```bash
# 远程模式：浏览器访问 http://localhost:8080
./samoffice-server --addr 0.0.0.0:8080 --data ./data

# 本地模式：原生窗口 + 内嵌 HTTP 服务
./samoffice        # 自动启动窗口，并打印内嵌 HTTP 端口
```

---

## 3. 源码结构（**实际已实现**，非规划）

```
samoffice/
├── main.go                     # Wails 桌面入口 + 内嵌 Gin HTTP 服务（127.0.0.1:随机端口）
├── wails.json                  # Wails 配置（name=SamOffice, 嵌入 frontend/dist）
├── cmd/                        # 多个可执行入口
│   ├── samoffice-server/        # 独立 HTTP 服务入口
│   ├── test/                   # 集成测试
│   ├── test-symspell/          # SymSpell 算法测试
│   ├── gen-docx/               # 生成测试 docx
│   ├── debug-sym/              # 拼写调试工具
│   ├── test-fuzz/              # 模糊测试
│   ├── test-roundtrip/         # 解析/写回往返测试
│   └── gen-test-files/         # 生成测试文件
├── internal/
│   ├── core/                   # UDM 统一文档模型（document.go, json.go）—— Go 与 TS 双端定义
│   ├── parser/                 # 解析器
│   │   ├── docx/               # 自研 docx 解析（容错：ZIP/XML 宽松解析）
│   │   ├── markdown/           # Markdown 解析
│   │   ├── pptx/               # PPTX 解析
│   │   ├── xlsx/               # XLSX 解析（excelize）
│   │   └── registry.go         # 解析器注册表（按扩展名分发）
│   ├── dict/                   # 词库系统
│   │   ├── symspell/           # 纯 Go SymSpell 拼写纠错
│   │   ├── hunspell/           # Hunspell 词库加载（.aff/.dic）
│   │   ├── userdict/           # 用户词库 SQLite 持久化 + 自学习
│   │   ├── chinese/            # 中文词库
│   │   └── manager.go          # 词库调度（多语言注册 / 缓存）
│   ├── server/api/             # HTTP API（Gin Handler + CORS 中间件）
│   ├── renderer/               # 渲染/写回
│   │   ├── docx/               # docx 写回
│   │   └── pdf/                # PDF 导出（gopdf + 内嵌字体 fonts/）
│   └── officelib/              # 统一 Office 操作 handler（内部库封装）
├── pkg/                        # 独立可复用库（智能体/开发者友好，链式 API）
│   ├── docgo/                  # 读写 .docx（对标 python-docx）
│   ├── xlsgo/                  # 读写 .xlsx（对标 openpyxl，依赖 excelize）
│   ├── pptgo/                  # 读写 .pptx（对标 python-pptx）
│   ├── pdfgo/                  # PDF 生成
│   └── README.md               # 各库 API 速查（注意：其中 import 路径待修正）
├── frontend/                   # React 18 + TypeScript 前端
│   ├── src/
│   │   ├── editors/            # document(ProseMirror) / spreadsheet / slide 三个编辑器
│   │   ├── services/backend.ts # Backend 抽象：LocalBackend(Wails) / RemoteBackend(HTTP) 自动切换
│   │   ├── types/udm.ts        # UDM TypeScript 类型（与 internal/core 对应）
│   │   ├── components/ hooks/   # UI 组件与 hooks
│   │   ├── App.tsx i18n.tsx main.tsx index.css
│   ├── dist/                   # 构建产物（被 main.go 的 //go:embed 编入 exe）
│   └── package.json            # React18/Vite5/Tailwind3/ProseMirror/Zustand
├── scripts/
│   ├── build.sh                # Linux/macOS 构建脚本
│   └── e2e/                    # 端到端测试（Playwright .mjs）
├── packaging/windows/          # Windows 安装器
│   ├── build_windows_package.bat
│   ├── samoffice_installer.nsi # NSIS 脚本（安装到 $PROGRAMFILES64\SamOffice）
│   └── stage/                  # 打包暂存区（exe + README/LICENSE）
├── test-report.html            # 测试报告（HTML）
└── test-results.json           # 测试结果（结构化 JSON）
```

### 已实现功能

- [x] **双模架构**：Wails 本地窗口 + 独立 HTTP 服务，前端 `backend.ts` 自动切换
- [x] **UDM 统一文档模型**：Go（`internal/core`）+ TS（`types/udm.ts`）双端定义
- [x] **文档解析**：docx（自研容错）、markdown、xlsx（excelize）、pptx
- [x] **渲染/写回**：docx 写回、PDF 导出（`internal/renderer`）
- [x] **独立 Office 库**：`pkg/{docgo,xlsgo,pptgo,pdfgo}`（对标 python-docx/openpyxl/python-pptx）
- [x] **拼写纠错**：SymSpell + Hunspell + 用户词库（SQLite 自学习）+ 中英双语
- [x] **前端编辑器**：ProseMirror 文档 / 轻量表格 / 演示编辑器 + 拼写检查 UI
- [x] **e2e 测试**：116 项全通过（见第 5 节）

### 仍处规划 / 未实现

- [ ] Yjs 实时协同
- [ ] 完整 Hunspell 大词库（10万英文 + 35万中文）
- [ ] 插件系统

---

## 4. 架构

```
┌─────────────────────────────────────────────┐
│  前端: React 18 + ProseMirror + Vite        │
├─────────────────────────────────────────────┤
│  通信层: Backend 抽象 (LocalBackend | Remote)│
│          自动检测 window.go.main.App        │
├─────────────────────────────────────────────┤
│  后端: Go + Gin + Wails                     │
│  ├─ parser:   docx/markdown/xlsx/pptx       │
│  ├─ renderer: docx/pdf                       │
│  ├─ dict:     symspell/hunspell/userdict/zh │
│  └─ pkg:      docgo/xlsgo/pptgo/pdfgo        │
└─────────────────────────────────────────────┘
```

**双模数据流**：
- 本地模式：`main.go` 启动 Wails 窗口，并起一个 `127.0.0.1:0` 随机端口的 Gin 服务；前端经 Wails Binding 调 `OpenFile/SpellCheck/Suggest/LearnWord/HTTPPort`。
- 远程模式：`samoffice-server` 暴露 REST（`/api/doc/*`、`/api/dict/*`），前端走 `RemoteBackend` 的 `fetch`。

### 关键 API

| 方法 | 说明 |
|------|------|
| `GET /api/health` | 健康检查 |
| `POST /api/doc/open` | 上传文件解析（multipart）|
| `GET /api/doc/local?path=xxx` | 本地路径打开 |
| `POST /api/doc/save` | 保存 UDM |
| `GET /api/dict/check?text=&lang=` | 拼写检查 |
| `GET /api/dict/suggest?word=&lang=&n=` | 纠错建议 |
| `POST /api/dict/learn` | 学习用户词 `{word,lang,source}` |
| Wails `App.OpenFile / SpellCheck / Suggest / LearnWord / HTTPPort` | 本地绑定方法 |

---

## 5. 测试结果

- 文件：`test-results.json` / `test-report.html`（来源：`scripts/e2e/` 端到端测试）
- 最近一次：**总计 116 项，通过 116，失败 0，通过率 100.0%**（时间戳 2026-07-09）
- 覆盖：首页加载、顶栏/菜单、Tab 切换、主题与语言切换、状态栏版本号、Toast、文档/表格/演示各编辑器交互等。
- Go 单元测试：
  ```bash
  go test ./...
  go test ./pkg/...   # docgo/xlsgo/pptgo/pdfgo 创建/保存/读取/样式
  ```

---

## 6. 容错设计

```
原始文档 → ZIP 容错解压 → XML 宽松解析 → Schema 校验 → UDM 映射 → 渲染降级
            ↓               ↓              ↓             ↓
         跳过损坏条目     修复未闭合标签  未知字段降级  占位符显示
```

永不崩溃：未知内容保留到 `Raw` 字段，损坏内容跳过并记录 Warning。

---

## 7. 许可证

MIT
