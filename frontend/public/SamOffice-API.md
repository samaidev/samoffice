# SamOffice API 接口文档（智能体版）

> SamOffice 是 Go + Web 技术栈的跨平台办公套件，支持 **Word(.docx/.doc)、Excel(.xlsx/.xls/.csv)、PowerPoint(.pptx/.ppt)、PDF、Markdown、HTML** 等格式。
> 本文档包含 SamOffice 的**全部 API 接口**。把本文档提供给智能体（AI Agent），智能体即可直接**创建、编辑、保存、打开** SamOffice 支持的各种文档格式。
>
> 文档版本：v0.6.8 ｜ 接口无鉴权，仅供本机/内网调用。

## 目录

1. [API 地址发现](#1-api-地址发现)
2. [健康检查](#2-健康检查)
3. [智能体直创 API（/api/lib/\*）](#3-智能体直创-apiapilib)
   - [创建 Word 文档](#31-创建-word-文档) ｜ [创建 Excel 表格](#32-创建-excel-表格) ｜ [创建 PPT 幻灯片](#33-创建-ppt-幻灯片) ｜ [创建 PDF](#34-创建-pdf)
   - [打印 API（返回打印就绪 PDF）](#35-打印-api返回打印就绪-pdf)
   - [获取官方 JSON 示例](#36-获取官方-json-示例)
4. [打开 / 解析文档（→ UDM）](#4-打开--解析文档-udm)
5. [保存 / 导出文档（UDM → 文件）](#5-保存--导出文档udm--文件)
6. [Excel 原生读写（完整格式）](#6-excel-原生读写完整格式)
7. [UDM 统一文档模型（JSON Schema）](#7-udm-统一文档模型json-schema)
8. [拼写检查 / 词典](#8-拼写检查--词典)
9. [桌面版 Wails 绑定（应用内 JS 调用）](#9-桌面版-wails-绑定应用内-js-调用)
10. [让正在运行的桌面版打开文件](#10-让正在运行的桌面版打开文件)
11. [独立服务模式 samoffice-server](#11-独立服务模式-samoffice-server)
12. [智能体典型工作流](#12-智能体典型工作流)

---

## 1. API 地址发现

SamOffice 桌面版**启动时会自动在本机开启一个 HTTP API 服务**（127.0.0.1 随机端口）：

- 桌面版启动时会向标准输出打印 `Local HTTP: http://127.0.0.1:<端口>`
- 桌面版界面**右上角点击「API」按钮**，弹窗顶部会显示当前实例的 API 基地址
- 下文用 `BASE` 代指该地址，例如 `BASE = http://127.0.0.1:53721`

所有接口均支持 **CORS**，浏览器页面也可以直接调用。

> 若使用独立服务模式（见[第 11 节](#11-独立服务模式-samoffice-server)），`BASE` 即启动参数指定的地址（默认 `http://127.0.0.1:8080`）。

## 2. 健康检查

```http
GET {BASE}/api/health
```

响应：`{"status":"ok"}`

## 3. 智能体直创 API（/api/lib/\*）

**最快路径**：智能体只需发送一份 JSON 描述，即可直接生成 docx / xlsx / pptx / pdf 文件（响应体即文件字节流，保存响应即可）。四种格式共用同一套调用风格。

### 3.1 创建 Word 文档

```http
POST {BASE}/api/lib/doc/create
Content-Type: application/json
```

**DocSpec 字段：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `title` | string | 文档标题（同时用作下载文件名） |
| `author` | string | 作者 |
| `subject` | string | 主题 |
| `header` / `footer` | string | 页眉 / 页脚文本 |
| `pageNum` | bool | 是否显示页码 |
| `govDoc` | bool | 政府公文标准排版（GB/T 9704-2012：每行 28 字、每页 22 行、红头线） |
| `docGrid` | `{charsPerLine, linesPerPage}` | 文档网格 |
| `pageMargins` | `{top,bottom,left,right}` | 页边距（cm） |
| `redHeaderLine` | bool | 红色分隔线 |
| `elements` | DocElement[] | 文档元素序列（见下） |

**DocElement（type 多态）：**

| type | 专属字段 | 说明 |
|---|---|---|
| `heading` | `text`, `level`(1-6) | 标题 |
| `paragraph` | `text` 或 `runs[]`, `align`, `lineSpacing`(倍数), `lineSpacingExact`(pt), `firstLineIndent`(字符), `spaceBefore`/`spaceAfter`(pt), `charSpacing`, `redBottomLine`, `pageBreakBefore`, `font`, `fontSize`(pt) | 段落 |
| `list` | `items[]`, `ordered` | 列表 |
| `table` | `rows[][]`（二维字符串数组） | 表格 |
| `code` | `language`, `code` | 代码块 |
| `toc` | `maxLevel`（默认 3） | 目录域（Word 中右键更新生成） |

**DocRun（富文本片段）：** `text`, `bold`, `italic`, `color`, `size`(pt), `font`

请求示例：

```bash
curl -s -X POST "$BASE/api/lib/doc/create" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "项目周报",
    "author": "智能体",
    "pageNum": true,
    "elements": [
      {"type": "heading", "text": "本周进展", "level": 1},
      {"type": "paragraph", "runs": [
        {"text": "本周完成 "},
        {"text": "3 个核心模块", "bold": true},
        {"text": " 的开发与联调，覆盖中文空格占位、API 直创、CI 修复。"}
      ], "firstLineIndent": 2},
      {"type": "list", "items": ["文档引擎", "表格引擎", "发布流水线"]},
      {"type": "table", "rows": [["模块", "状态"], ["文档", "完成"], ["表格", "完成"]]},
      {"type": "code", "language": "bash", "code": "curl $BASE/api/health"}
    ]
  }' -o 周报.docx
```

响应：`application/vnd.openxmlformats-officedocument.wordprocessingml.document`（.docx 字节流）

### 3.2 创建 Excel 表格

```http
POST {BASE}/api/lib/xls/create
Content-Type: application/json
```

**XlsSpec：**

```json
{
  "sheets": [
    {
      "name": "Sheet1",
      "headers": ["姓名", "部门", "分数"],
      "rows": [["张三", "研发", "95"], ["李四", "产品", "87"]],
      "colWidths": {"A": 15, "B": 12},
      "freeze": "A2"
    }
  ]
}
```

- `headers`：表头行（自动加粗样式），可为空
- `rows`：数据行（字符串二维数组）
- `colWidths`：列宽（键为列字母，如 `"A"`）
- `freeze`：冻结窗格锚点单元格（如 `"A2"` 冻结首行）

响应：`.xlsx` 字节流。

### 3.3 创建 PPT 幻灯片

```http
POST {BASE}/api/lib/ppt/create
Content-Type: application/json
```

**PptSpec：**

```json
{
  "title": "产品发布",
  "author": "智能体",
  "theme": "aurora",
  "slides": [
    {"layout": "title", "title": "SamOffice", "subtitle": "Go 原生办公套件"},
    {"layout": "content", "title": "亮点", "bullets": ["零依赖单文件", "全格式支持", "智能体 API"], "transition": "fade", "notes": "演讲备注"},
    {"layout": "blank", "bgGradient": ["0B1120", "131C30"],
     "kpiCards": [{"x": 457200, "y": 1600000, "w": 1828800, "h": 1200000, "value": "99%", "label": "格式兼容"}],
     "pills": [{"x": 457200, "y": 3200000, "w": 1600000, "h": 260000, "text": "v0.6.8", "color": "818CF8"}]}
  ]
}
```

**PptSlide 字段：**

| 字段 | 说明 |
|---|---|
| `layout` | `title` / `content` / `blank` |
| `title`, `subtitle`, `bullets[]` | 常规内容（`bullets` 为字符串数组） |
| `theme` | 全局或单页主题：`aurora` / `midnight` / `ocean` / `sunset` / `minimal` |
| `bgColor` | 纯色背景（hex，无 #） |
| `bgGradient` | 渐变背景 `["起色", "止色"]` |
| `bgAurora` | Aurora mesh 背景 `{baseColor, glows: [{x, y, r, color, alpha}]}` |
| `shapes[]` | 自定义形状：`{type: rect/roundRect/ellipse/triangle/diamond/star5/rightArrow, x, y, w, h(EMU), fill, gradient, stroke, strokeW, text, fontSize(pt), fontBold, fontColor, font, shadow, glow, glass, cornerRadius, rotation, textAlign(l/ctr/r/just), textAnchor(t/ctr/b), multiText[]}` |
| `cards[]` | 现代卡片：`{x, y, w, h, fill, stroke, glass, glassAlpha, cornerRadius, shadow, title, titleColor, titleSize, body, bodyColor, bodySize, font, accent}` |
| `kpiCards[]` | KPI 卡片：`{x, y, w, h, value, label, valueColor, accentColor}` |
| `codeBlocks[]` | 代码块：`{x, y, w, h, lines[], fontSize, bgColor}` |
| `texts[]` | 自由文本：`{x, y, w, h, text, fontSize, fontBold, fontColor, font, align(l/ctr/r/just), anchor(t/ctr/b), glow, glowColor}` |
| `pills[]` | 标签胶囊：`{x, y, w, h, text, color}` |
| `transition` | 切换动画：`fade` / `slide` 等 |
| `notes` | 演讲者备注 |

> 坐标单位均为 **EMU**（1 英寸 = 914400 EMU；16:9 页面约 12192000 × 6858000）。

响应：`.pptx` 字节流。

### 3.4 创建 PDF

```http
POST {BASE}/api/lib/pdf/create
Content-Type: application/json
```

**PdfSpec：**

```json
{
  "title": "报告", "author": "智能体",
  "pageSize": "A4", "pageNum": true, "fontSize": 12, "lineHeight": 1.6,
  "margins": {"top": 72, "bottom": 72, "left": 72, "right": 72},
  "elements": [
    {"type": "heading", "text": "标题", "level": 1, "align": "center"},
    {"type": "paragraph", "text": "正文段落。", "indent": 24, "lineSpacing": 1.6},
    {"type": "list", "items": ["项1", "项2"], "ordered": true},
    {"type": "table", "rows": [["A", "B"], ["1", "2"]]},
    {"type": "code", "language": "go", "code": "fmt.Println(\"hi\")"},
    {"type": "divider"},
    {"type": "pagebreak"},
    {"type": "image", "imagePath": "C:/pics/logo.png", "imageWidth": 200, "imageHeight": 80}
  ]
}
```

- `pageSize`：`A4`（默认）/ `A3` / `Letter` / `Legal`；`margins` 单位 pt
- `runs[]` 富文本片段与 DocSpec 相同（`text/bold/italic/color/size/font`）
- `image` 元素支持 `imagePath`（本机路径）+ `imageWidth/imageHeight`（pt）

响应：`application/pdf` 字节流。

### 3.5 打印 API（返回打印就绪 PDF）

三个端点统一接收 `{spec, print}`，返回按打印设置排版的 PDF：

```http
POST {BASE}/api/lib/doc/print   # spec = DocSpec
POST {BASE}/api/lib/ppt/print   # spec = PptSpec（print.pptContent: full/handout/notes/outline，slidesPerPage: 1/2/3/4/6/9）
POST {BASE}/api/lib/xls/print   # spec = XlsSpec（print.printGridlines / printTitle / pageOrder）
```

**PrintSpec（打印设置）：**

| 字段 | 取值 |
|---|---|
| `pageRange` | `"all"` / `"1-3,5"` |
| `copies` | 份数 |
| `orientation` | `portrait` / `landscape` |
| `paperSize` | `A4` / `A3` / `A5` / `Letter` / `Legal` |
| `marginTop/Bottom/Left/Right` | 页边距（mm） |
| `scale` | 缩放百分比 25-200 |
| `duplex` | `none` / `long` / `short` |
| `color` | `color` / `grayscale` / `blackwhite` |
| `quality` | `draft` / `normal` / `high` / `photo` |
| `collate` | 逐份打印 |

### 3.6 获取官方 JSON 示例

```http
GET {BASE}/api/lib/examples
```

返回 doc / xls / ppt / pdf / print_doc / print_ppt / print_xls 七组可直接使用的完整 JSON 示例。

## 4. 打开 / 解析文档（→ UDM）

把已有文档解析为 UDM JSON（详见[第 7 节](#7-udm-统一文档模型json-schema)），即可程序化**读取与编辑**内容。

### 4.1 上传文件解析

```http
POST {BASE}/api/doc/open
Content-Type: multipart/form-data
```

- 表单字段 `file`：任意 SamOffice 支持的文件（.docx/.doc/.xlsx/.xls/.csv/.tsv/.pptx/.ppt/.md/.markdown/.html/.htm/.txt 等）

响应：

```json
{
  "document": { "meta": {...}, "blocks": [...], ... },
  "warnings": [],
  "path": "C:\\Users\\...\\AppData\\Local\\Temp\\samoffice-uploads\\1699..._报告.docx"
}
```

- `document`：UDM JSON（解析失败的元素进 `warnings`，不中断）
- `path`：服务端落盘路径（可用 `/api/xlsx/read` 等按路径二次读取）
- Markdown/HTML 上传时额外返回 `rawContent`（原文 base64）

### 4.2 按本机路径解析（桌面版/服务端）

```http
GET {BASE}/api/doc/local?path=C:/docs/报告.docx
```

响应同上（`path` 为规范化后的绝对路径）。

## 5. 保存 / 导出文档（UDM → 文件）

### 5.1 UDM → docx

```http
POST {BASE}/api/doc/save
Content-Type: application/json
```

请求体：完整 UDM JSON（见第 7 节）。响应：`.docx` 字节流（文件名取 `meta.title`）。

### 5.2 UDM → PDF

```http
POST {BASE}/api/doc/export-pdf
Content-Type: application/json
```

请求体：UDM JSON。响应：`application/pdf` 字节流。

> **编辑已有文档的标准流程**：`/api/doc/open`（或 `/api/doc/local`）拿到 UDM → 程序化修改 `blocks` → `/api/doc/save` 导出 docx（或 `/api/doc/export-pdf` 导出 PDF）→ 把响应字节写入目标路径。

## 6. Excel 原生读写（完整格式）

### 6.1 读取（保留值/字体/填充/边框/对齐/合并）

```http
GET {BASE}/api/xlsx/read?path=C:/docs/表格.xlsx
```

响应为 JSON 字符串（与桌面版 ReadXLSX 绑定一致）：

```json
{
  "sheets": [
    {
      "name": "Sheet1",
      "cells": {
        "A1": {"value": "姓名", "font": {"bold": true, "size": 12}, "fill": "#EEF2FF", "align": "center", "border": {...}}
      },
      "merged": ["A1:B1"],
      "colWidths": {"A": 15}, "freeze": "A2"
    }
  ]
}
```

### 6.2 写入

桌面版经 Wails 绑定 `WriteXLSX(path, jsonStr)`（见第 9 节）；服务端模式可用 `/api/doc/save` 之外，配合上传与下载完成。

## 7. UDM 统一文档模型（JSON Schema）

UDM（Unified Document Model）是 SamOffice 所有格式的中间表示，**编辑/保存文档即编辑这份 JSON**。

### 7.1 顶层结构

```json
{
  "meta": {"title": "", "author": "", "subject": "", "description": "", "createdAt": "", "modifiedAt": "", "language": ""},
  "blocks": [],
  "comments": [{"id": "", "author": "", "content": "", "anchor": ""}],
  "pageNumber": {"enabled": true, "format": "第 {n} 页 / 共 {total} 页", "align": "center", "fontSize": 9, "firstPageDifferent": false},
  "pageSetup": {"widthTwips": 11906, "heightTwips": 16838, "orientation": "", "marginTop": 1440, "marginRight": 1440, "marginBottom": 1440, "marginLeft": 1440, "cols": 1},
  "header": {"text": "", "align": "c", "fontFamily": "", "fontSize": 9, "bold": false, "italic": false},
  "footer": {"text": ""},
  "protect": {"enabled": false, "hash": ""}
}
```

> 单位说明：pageSetup 用 twips（1pt = 20 twips；A4 = 11906×16838）；`pageNumber.fontSize` 为半磅（9 = 4.5pt）。

### 7.2 块类型（blocks[]，靠结构判别）

| 块 | 结构 |
|---|---|
| 段落 | `{"inline": [Text...], "style": "", "align": "left/center/right/justify", "props": {...}}` |
| 标题 | `{"level": 1, "inline": [...], "align": ""}` |
| 列表 | `{"items": [[块数组]...], "ordered": false, "start": 1, "style": ""}` |
| 表格 | `{"rows": [[{"inline": [...], "rowSpan": 0, "colSpan": 0, "isHeader": true, "align": "", "vAlign": "middle", "borders": "1111", "borderColor": "CBD5E1", "borderW": 0}]...], "width": [权重数组], "rowHeights": [], "border": 1}` |
| 图片 | `{"src": "data:image/png;base64,...", "width": 300, "height": 200, "alt": "", "float": "left/right", "align": ""}` |
| 代码块 | `{"language": "go", "code": "..."}` |
| 公式 | `{"formula": "E=mc^2", "inline": false}` |
| 文本框 | `{"type": "textbox", "inline": [块数组], "w": 0, "h": 0, "x": 0, "y": 0, "borderW": 1, "lineStyle": "solid", "borderColor": "#f59e0b", "bgColor": "#fef3c7", "shape": "rect", "width": 0, "float": "", "rotation": 0}` |
| 分页符 | `{"restart": false, "startNumber": 1}` |

**段落 props 常用键**（均可省略）：`indent`(em)、`indentLeft/Right`(px)、`firstLine`(em)、`hanging`(em)、`lineHeight`(如 "1.5")、`spaceBefore/spaceAfter`(pt)、`lineSpacingKind`("exact"/"atLeast"/"multiple")、`lineSpacingValue`(pt)、`keepLines`、`keepWithNext`、`pageBreakBefore`、`outlineLevel`、`border`(如 "top bottom")、`shading`、`letterSpacing`、`rtl`。

### 7.3 行内类型（inline[]）

| 行内 | 结构 |
|---|---|
| 文本 | `{"content": "", "bold": false, "italic": false, "under": false, "strike": false, "font": "宋体", "fontSize": 10.5, "color": "#C00000", "highlight": "#FFFF00", "superscript": false, "subscript": false, "letterSpacing": "1px", "commentId": ""}` |
| 链接 | `{"url": "https://...", "text": [Text...]}` |
| 行内图片 | `{"src": "data:image/...;base64,...", "width": 0, "height": 0}` |
| 脚注引用 | `{"type": "footnote", "num": 1, "content": "脚注正文"}` |
| 修订 | `{"type": "track", "track": "insert/delete", "author": "", "content": "", ...}` |

> **中文空格语义**：UDM 中文本的空格按 Word `xml:space="preserve"` 语义逐字符占位（连续空格、全角空格 U+3000 均原样保留），编辑器与 docx/pdf 导出端均按此处理。

## 8. 拼写检查 / 词典

```http
GET  {BASE}/api/dict/check?text=待检查文本&lang=zh     # → {"errors":[{"word":"","start":0,"end":2,"suggestions":["..."]}]}
GET  {BASE}/api/dict/suggest?word=documnet&lang=en&n=5 # → {"candidates":[{"word":"document","score":...}]}
POST {BASE}/api/dict/learn   # {"word":"自造词","lang":"zh","source":"manual"} → {"status":"ok"}
```

## 9. 桌面版 Wails 绑定（应用内 JS 调用）

桌面模式（页面地址 `http://wails.localhost`）中，前端/注入脚本可通过 `window.go.main.App.*` 直接调用（全部返回 Promise）：

| 方法 | 签名 | 说明 |
|---|---|---|
| `OpenFile` | `(path) → {document, warnings, path, rawContent?}` | 按路径打开并解析文档 |
| `WriteDocument` | `(path, format, document) → void` | UDM 渲染写盘；format：`docx` / `doc` / `wps` / `pdf`（自动补扩展名） |
| `ReadFile` | `(path) → base64` | 读取任意本地文件 |
| `WriteTextFile` | `(path, content) → void` | 写纯文本（md/html/txt） |
| `ReadXLSX` | `(path) → jsonString` | Excel 原生读（全格式） |
| `WriteXLSX` | `(path, jsonString) → void` | Excel 原生写（全格式） |
| `WritePPTX` | `(path, jsonString) → void` | PPT 写盘 |
| `OpenFileDialog` | `() → path` | 系统打开对话框 |
| `SaveFileDialog` | `(defaultName, format) → path` | 系统另存为对话框 |
| `HTTPPort` | `() → port` | 内嵌 HTTP 服务端口（即本文档 BASE 的端口） |
| `GetStartupArgs` | `() → string[]` | 启动参数中的文档路径 |
| `SpellCheck` / `Suggest` / `LearnWord` | 同第 8 节 | 拼写检查 |
| `NewWindow` | `() → void` | 新开桌面窗口 |
| `WindowMinimize` / `WindowMaximize` / `WindowClose` / `IsWindowMaximized` | — | 窗口控制 |

## 10. 让正在运行的桌面版打开文件

桌面版以**单实例**运行，并把待打开文件写入共享文件（Windows 路径）：

```
%LOCALAPPDATA%\samoffice\pending_open.txt
```

向该文件**追加一行绝对路径**（如 `C:\docs\报告.docx`），正在运行的 SamOffice 会在 200ms 内自动在前台打开该文件（支持 .docx/.doc/.xlsx/.xls/.pdf/.md/.html/.htm/.txt）。智能体生成文件后用这一步即可"打开"给用户看。

命令行也可以直接 `samoffice.exe C:\docs\报告.docx`（若已有实例，会转交给已运行实例打开）。

## 11. 独立服务模式 samoffice-server

无窗口的纯 API 服务（适合服务器/CI/智能体常驻调用）：

```bash
samoffice-server --addr 127.0.0.1:8080 --data ./samoffice-data --static ./frontend/dist
```

提供与桌面版完全相同的 `/api/*` 接口（含 `/api/lib/*`），并可托管 Web 前端。

## 12. 智能体典型工作流

**A. 从零创建文档（最快）**

```text
1. POST {BASE}/api/lib/doc/create  （或 xls / ppt / pdf）+ JSON 描述
2. 把响应字节流保存为文件（如 report.docx）
3. （可选）把文件路径追加到 %LOCALAPPDATA%\samoffice\pending_open.txt → 桌面版自动打开
```

**B. 编辑已有文档**

```text
1. POST {BASE}/api/doc/open 上传文件（或 GET /api/doc/local?path=...）→ 得到 UDM JSON
2. 程序化修改 document.blocks（增删段落/改文字/调样式，schema 见第 7 节）
3. POST {BASE}/api/doc/save → 保存响应为 .docx；或 POST /api/doc/export-pdf → .pdf
4. （可选）pending_open.txt 打开给用户
```

**C. 表格批量处理**

```text
1. GET {BASE}/api/xlsx/read?path=... 读全格式表格 JSON
2. 处理 cells / merged 数据
3. 桌面版：WriteXLSX 写回；服务模式：改 UDM 后 /api/doc/save
```

**D. 直接打印**

```text
POST {BASE}/api/lib/doc/print（或 ppt / xls）+ {spec, print} → 得到打印就绪 PDF
```

---

> 提示：所有接口返回的文件都是标准 Office/PDF 格式，可直接被 MS Word / WPS / LibreOffice 打开。
> 格式支持：读取 `.docx .doc .xlsx .xls .csv .tsv .pptx .ppt .md .markdown .html .htm .txt .pdf(预览)`；生成 `.docx .doc(兼容模式) .xlsx .pptx .pdf .md .html .txt .csv`。
