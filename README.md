# GoOffice - 跨平台 Office 三件套

基于 Go + Web 技术构建的跨平台 Office 套件（文档/表格/演示），核心特性：

- **跨平台**：Windows / macOS / Linux 原生运行
- **跨网络**：本地 Wails 套壳 + 远程 HTTP 服务双模式
- **强容错**：自研 docx 解析器，ZIP/XML 宽松解析，未知元素保留
- **丰富词库**：SymSpell 算法 + 用户词库自学习 + 中英双语

## 快速开始

### 环境要求

- Go 1.21+
- Node.js 18+
- (可选) Wails CLI: `go install github.com/wailsapp/wails/v2/cmd/wails@latest`

### 构建

```bash
# 一键构建
./scripts/build.sh all

# 仅构建服务端（HTTP 模式）
./scripts/build.sh server

# 仅构建桌面端（Wails 模式）
./scripts/build.sh wails
```

### 运行

**远程模式**（浏览器访问）：

```bash
./bin/gooffice-server --addr 0.0.0.0:8080 --data ./data
# 浏览器访问 http://localhost:8080
```

**本地模式**（Wails 原生窗口）：

```bash
./bin/gooffice
# 自动启动原生窗口 + 内嵌 HTTP 服务
```

## 架构

```
┌─────────────────────────────────────────────┐
│  前端: React 18 + ProseMirror + Vite        │
├─────────────────────────────────────────────┤
│  通信层: Backend 抽象 (Local | Remote)      │
├─────────────────────────────────────────────┤
│  后端: Go + Gin + Wails                     │
│  ├─ 解析器: docx / xlsx / pptx / markdown   │
│  ├─ 词库: SymSpell + 用户词库 (SQLite)      │
│  └─ 协同: Yjs (规划中)                      │
└─────────────────────────────────────────────┘
```

## 项目结构

```
gooffice/
├── main.go                     # Wails 桌面入口
├── cmd/
│   ├── gooffice-server/        # 独立 HTTP 服务入口
│   ├── test/                   # 模块集成测试
│   ├── test-symspell/          # SymSpell 算法测试
│   └── gen-docx/               # 生成测试 docx
├── internal/
│   ├── core/                   # UDM 统一文档模型
│   ├── parser/                 # 文档解析器
│   │   ├── docx/               # 自研 docx 解析
│   │   └── markdown/           # Markdown 解析
│   ├── dict/                   # 词库系统
│   │   ├── symspell/           # 纯 Go SymSpell
│   │   ├── userdict/           # 用户词库 SQLite
│   │   └── manager.go          # 词库调度
│   └── server/api/             # HTTP API
├── frontend/                   # React 前端
│   └── src/
│       ├── editors/
│       │   ├── document/       # ProseMirror 文档编辑器
│       │   ├── spreadsheet/    # 轻量表格编辑器
│       │   └── slide/          # 演示编辑器
│       ├── services/           # Backend 抽象层
│       └── types/udm.ts        # UDM TypeScript 类型
└── scripts/build.sh
```

## 已实现功能

### Phase 1 MVP（已完成）

- [x] 双模架构（Wails 本地 + HTTP 远程）
- [x] UDM 统一文档模型（Go + TS 双端定义）
- [x] docx 自研解析器（容错：ZIP/XML 宽松解析）
- [x] Markdown 解析器
- [x] SymSpell 拼写纠错算法（纯 Go，比 BK-Tree 快 1000x）
- [x] 用户词库 SQLite 持久化 + 自学习
- [x] 中英双语词库（示例词集，可扩展到 10万+ 词条）
- [x] ProseMirror 文档编辑器（标题/段落/列表/代码块/粗斜体/链接）
- [x] 轻量表格编辑器（类 Excel 单元格）
- [x] 演示编辑器（多幻灯片 + 属性面板）
- [x] 拼写检查 UI（错误浮窗 + 一键加入词典）

### Phase 2 规划

- [ ] 完整 Hunspell 词库（10万英文词 + 35万中文词）
- [ ] docx 写回（renderer）
- [ ] xlsx 解析（excelize 集成）
- [ ] pptx 解析
- [ ] Yjs 实时协同
- [ ] PDF 导出
- [ ] 插件系统

## API 文档

### 健康检查
`GET /api/health`

### 文档操作
- `POST /api/doc/open` - 上传文件解析（multipart）
- `GET /api/doc/local?path=xxx` - 本地路径打开
- `POST /api/doc/save` - 保存 UDM

### 词库
- `GET /api/dict/check?text=xxx&lang=en` - 拼写检查
- `GET /api/dict/suggest?word=xxx&lang=en&n=5` - 纠错建议
- `POST /api/dict/learn` - 学习用户词 `{word, lang, source}`

## 容错设计

```
原始文档 → ZIP 容错解压 → XML 宽松解析 → Schema 校验 → UDM 映射 → 渲染降级
            ↓               ↓              ↓             ↓
         跳过损坏条目     修复未闭合标签  未知字段降级  占位符显示
```

永不崩溃，未知内容保留到 `Raw` 字段，损坏内容跳过并记录 Warning。

## 许可证

MIT
