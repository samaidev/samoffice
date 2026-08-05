# SamOffice 独立库 — 智能体调用指南

SamOffice 提供三个独立的 Go 库，类似 python-docx / openpyxl / python-pptx，
专为智能体和开发者设计，一行 import 即可操作 Office 文件。

## 库一览

| 库 | 用途 | Python 对标 | 导入路径 |
|----|------|------------|----------|
| `docgo` | 读写 .docx | python-docx | `github.com/zai/SamOffice/pkg/docgo` |
| `xlsgo` | 读写 .xlsx | openpyxl | `github.com/zai/SamOffice/pkg/xlsgo` |
| `pptgo` | 读写 .pptx | python-pptx | `github.com/zai/SamOffice/pkg/pptgo` |

## docgo — Word 文档

### 创建文档

```go
package main

import "github.com/zai/SamOffice/pkg/docgo"

func main() {
    doc := docgo.New()
    doc.SetTitle("报告").SetAuthor("SamAI")

    doc.AddHeading("季度报告", 1)
    doc.AddParagraph("本季度进展顺利。")

    // 带样式的段落
    p := doc.AddParagraph("")
    p.AddRun("普通 ").Bold(false)
    p.AddRun("加粗 ").Bold(true)
    p.AddRun("红色").Color("FF0000")

    // 列表
    doc.AddList([]string{"要点一", "要点二"})

    // 表格
    doc.AddTable([][]string{
        {"模块", "状态"},
        {"文档", "✅"},
    })

    // 代码块
    doc.AddCodeBlock("go", `fmt.Println("hi")`)

    doc.Save("report.docx")
}
```

### 读取文档

```go
doc, _ := docgo.Open("report.docx")
fmt.Println(doc.Title())
for _, p := range doc.Paragraphs() {
    fmt.Println(p.Text())
}
```

### API 速查

| 方法 | 说明 |
|------|------|
| `New()` | 创建新文档 |
| `Open(path)` | 打开 docx |
| `SetTitle/Author/Subject` | 设置元数据 |
| `AddHeading(text, level)` | 添加标题（1-6） |
| `AddParagraph(text)` | 添加段落 |
| `AddList([]string)` | 无序列表 |
| `AddOrderedList([]string)` | 有序列表 |
| `AddTable([][]string)` | 表格 |
| `AddImage(path, w, h)` | 图片 |
| `AddCodeBlock(lang, code)` | 代码块 |
| `Save(path)` | 保存 |

## xlsgo — Excel 表格

### 创建工作簿

```go
package main

import "github.com/zai/SamOffice/pkg/xlsgo"

func main() {
    wb := xlsgo.New()
    ws := wb.ActiveSheet()

    // 表头
    ws.SetCell("A1", "姓名")
    ws.SetCell("B1", "分数")
    ws.SetCellStyleHeader("A1")

    // 数据
    ws.SetCell("A2", "张三")
    ws.SetCellInt("B2", 95)
    ws.SetCellFormula("C2", "=B2*0.9")

    // 列宽
    ws.SetColWidth("A", 15)

    wb.Save("scores.xlsx")
    wb.Close()
}
```

### 读取工作簿

```go
wb, _ := xlsgo.Open("scores.xlsx")
ws := wb.ActiveSheet()
val, _ := ws.GetCell("A2")  // "张三"
rows, _ := ws.ReadAll()      // 二维数组
```

### 批量填充

```go
ws.FillTable("A1", [][]string{
    {"Name", "Score"},
    {"Alice", "95"},
    {"Bob", "87"},
})
```

### API 速查

| 方法 | 说明 |
|------|------|
| `New()` / `Open(path)` | 创建/打开 |
| `ActiveSheet()` | 获取活动表 |
| `AddSheet(name)` | 新建工作表 |
| `SetCell(cell, val)` | 设置字符串 |
| `SetCellNumber/Int` | 设置数字 |
| `SetCellFormula(cell, formula)` | 设置公式 |
| `SetCellStyleBold/Header` | 设置样式 |
| `GetCell/GetNumber/GetFormula` | 读取 |
| `FillTable(start, data)` | 批量填充 |
| `ReadAll()` | 读取全部 |
| `MergeCell(range)` | 合并单元格 |
| `SetColWidth` | 列宽 |

## pptgo — PPT 演示

### 创建演示文稿

```go
package main

import "github.com/zai/SamOffice/pkg/pptgo"

func main() {
    prs := pptgo.New()
    prs.SetTitle("产品介绍").SetAuthor("SamAI")

    // 标题页
    s1 := prs.AddSlide()
    s1.SetLayout(pptgo.LayoutTitle)
    s1.AddTitle("SamOffice")
    s1.AddSubtitle("跨平台办公套件")

    // 内容页
    s2 := prs.AddSlide()
    s2.SetLayout(pptgo.LayoutContent)
    s2.AddTitle("核心功能")
    s2.AddBullets([]string{
        "文档编辑",
        "表格编辑",
        "PDF 导出",
    })

    prs.Save("presentation.pptx")
}
```

### 读取演示文稿

```go
prs, _ := pptgo.Open("presentation.pptx")
for i, s := range prs.Slides() {
    fmt.Printf("Slide %d: %s\n", i+1, s.Title())
}
```

### API 速查

| 方法 | 说明 |
|------|------|
| `New()` / `Open(path)` | 创建/打开 |
| `AddSlide()` | 添加幻灯片 |
| `SetLayout(Title/Content/Blank)` | 设置布局 |
| `AddTitle/Subtitle` | 添加标题/副标题 |
| `AddBullet/AddBullets` | 添加要点 |
| `AddImage(path, x, y, w, h)` | 添加图片 |
| `SetBgColor(hex)` | 背景色 |
| `Save(path)` | 保存 |

## 智能体调用示例

智能体（如 Claude/GPT）可通过生成 Go 代码调用这些库：

```
用户：帮我生成一份销售报告 Word 文档

智能体生成代码：
```go
package main

import "github.com/zai/SamOffice/pkg/docgo"

func main() {
    doc := docgo.New()
    doc.SetTitle("2026 Q2 销售报告")
    doc.AddHeading("销售概览", 1)
    doc.AddParagraph("本季度销售额同比增长 30%。")
    doc.AddTable([][]string{
        {"区域", "销售额", "增长率"},
        {"华东", "¥1.2M", "+25%"},
        {"华南", "¥0.8M", "+35%"},
    })
    doc.Save("sales-report.docx")
}
```
```

## 设计原则

1. **零外部依赖**（xlsgo 除外，依赖 excelize）
2. **链式 API**：所有 setter 返回 `*Self`
3. **智能体友好**：方法名直观，参数简单
4. **完整读写**：支持创建 + 解析
5. **OOXML 标准**：输出被 Word/WPS/Excel/PowerPoint 兼容

## 测试

```bash
go test ./pkg/...
```

所有库均通过单元测试，覆盖创建/保存/读取/样式。
